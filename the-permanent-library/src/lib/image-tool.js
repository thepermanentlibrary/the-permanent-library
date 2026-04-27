/**
 * The Permanent Library — Image Tool
 *
 * Client-side image processing for embedding figures in PERMLIB-V1 documents.
 * All processing runs in the browser — no image data ever touches a server.
 *
 * Per PERMLIB_V1_IMAGE_SPEC.md:
 *   - Images are embedded as Base64 data URIs in Markdown: ![caption](data:image/jpeg;base64,...)
 *   - Max resolution: 1200×1200 px (bounding box, aspect preserved)
 *   - Min resolution: 200×200 px
 *   - Max per-image: 75 KB of Base64 text (~56 KB binary, real limit — must fit in one chunk)
 *   - No limit on image count or total size — the chunker handles distribution across transactions
 *   - Formats: JPEG (default) or PNG (diagrams only)
 *   - Resize: multi-step canvas downscale (near-Lanczos quality, zero deps)
 *
 * Uses native browser APIs only:
 *   - createImageBitmap: async image loading from File/Blob
 *   - Canvas 2D: resize, compress, export
 *   - FileReader: blob → Base64 data URL conversion
 *
 * Zero external dependencies.
 */

// ============================================================================
// Constants
// ============================================================================

export const IMAGE_LIMITS = {
  MAX_DIM: 1200,               // Max width or height in pixels
  MIN_DIM: 200,                // Min width or height in pixels
  MAX_BASE64_SIZE: 75000,      // 75 KB of Base64 text per image (real limit — one image must fit in one chunk)
  JPEG_INITIAL_QUALITY: 0.75,  // Starting JPEG quality
  JPEG_MIN_QUALITY: 0.50,      // Floor — below this, reduce resolution instead
  JPEG_QUALITY_STEP: 0.05,     // Quality reduction per attempt
  JPEG_FALLBACK_QUALITY: 0.90, // When PNG is too large, fall back to JPEG at this quality
  REDUCED_MAX_DIM: 900,        // Fallback resolution if quality reduction alone isn't enough
};

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that a file is an acceptable image type.
 *
 * @param {File} file — The file to validate
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateImageFile(file) {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { valid: false, error: 'Only JPEG and PNG images are supported' };
  }

  return { valid: true };
}

// ============================================================================
// Canvas Helpers
// ============================================================================

/**
 * Calculate target dimensions to fit within a square bounding box,
 * preserving aspect ratio. Never upscales.
 *
 * @param {number} width — Original width
 * @param {number} height — Original height
 * @param {number} maxDim — Bounding box dimension
 * @returns {{ width: number, height: number }}
 */
function calculateTargetDimensions(width, height, maxDim) {
  if (width <= maxDim && height <= maxDim) {
    return { width, height };
  }

  const ratio = Math.min(maxDim / width, maxDim / height);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

/**
 * Multi-step canvas downscale for high-quality resizing.
 *
 * Halves the image dimensions repeatedly until within 2× of the target,
 * then does one final draw to exact dimensions. Each step uses the browser's
 * bilinear/bicubic interpolation (imageSmoothingQuality: 'high'), which
 * produces near-Lanczos quality without any external library.
 *
 * @param {ImageBitmap|HTMLCanvasElement} source — The image to downscale
 * @param {number} targetWidth — Final width
 * @param {number} targetHeight — Final height
 * @returns {HTMLCanvasElement} — Canvas at the target dimensions
 */
function multiStepDownscale(source, targetWidth, targetHeight) {
  let currentWidth = source.width;
  let currentHeight = source.height;
  let currentSource = source;

  // Step down by halving until within 2× of target
  while (currentWidth > targetWidth * 2 || currentHeight > targetHeight * 2) {
    const nextWidth = Math.max(Math.round(currentWidth / 2), targetWidth);
    const nextHeight = Math.max(Math.round(currentHeight / 2), targetHeight);

    const stepCanvas = document.createElement('canvas');
    stepCanvas.width = nextWidth;
    stepCanvas.height = nextHeight;
    const stepCtx = stepCanvas.getContext('2d');
    stepCtx.imageSmoothingEnabled = true;
    stepCtx.imageSmoothingQuality = 'high';
    stepCtx.drawImage(currentSource, 0, 0, nextWidth, nextHeight);

    // Release previous ImageBitmap if applicable (canvases are GC'd)
    if (currentSource !== source && typeof currentSource.close === 'function') {
      currentSource.close();
    }

    currentSource = stepCanvas;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  // Final draw at exact target dimensions
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = targetWidth;
  finalCanvas.height = targetHeight;
  const finalCtx = finalCanvas.getContext('2d');
  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = 'high';
  finalCtx.drawImage(currentSource, 0, 0, targetWidth, targetHeight);

  // Release intermediate source
  if (currentSource !== source && typeof currentSource.close === 'function') {
    currentSource.close();
  }

  return finalCanvas;
}

/**
 * Export a canvas to a Blob.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} mimeType — 'image/jpeg' or 'image/png'
 * @param {number} [quality] — JPEG quality (0–1), ignored for PNG
 * @returns {Promise<Blob>}
 */
function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas export failed — toBlob returned null'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

/**
 * Convert a Blob to a Base64 data URL string.
 *
 * @param {Blob} blob
 * @returns {Promise<string>} — e.g. "data:image/jpeg;base64,/9j/4AAQ..."
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to convert image to Base64'));
    reader.readAsDataURL(blob);
  });
}

// ============================================================================
// Compression Pipeline
// ============================================================================

/**
 * Progressively reduce JPEG quality until the data URL fits within the size limit.
 * If quality reduction alone isn't enough, reduces resolution to 900×900 and retries.
 *
 * @param {HTMLCanvasElement} canvas — The canvas at current resolution
 * @param {number} currentWidth — Current canvas width
 * @param {number} currentHeight — Current canvas height
 * @returns {Promise<string>} — Data URL that fits within MAX_BASE64_SIZE
 * @throws {Error} If the image can't be compressed enough
 */
async function compressUntilFits(canvas, currentWidth, currentHeight) {
  // Phase 1: Reduce quality at current resolution
  let quality = IMAGE_LIMITS.JPEG_INITIAL_QUALITY - IMAGE_LIMITS.JPEG_QUALITY_STEP;

  while (quality >= IMAGE_LIMITS.JPEG_MIN_QUALITY - 0.001) {
    const roundedQuality = Math.round(quality * 100) / 100;
    const blob = await canvasToBlob(canvas, 'image/jpeg', roundedQuality);
    const dataUrl = await blobToDataUrl(blob);

    if (dataUrl.length <= IMAGE_LIMITS.MAX_BASE64_SIZE) {
      return dataUrl;
    }

    quality -= IMAGE_LIMITS.JPEG_QUALITY_STEP;
  }

  // Phase 2: Reduce resolution to REDUCED_MAX_DIM and retry
  const { width: reducedW, height: reducedH } = calculateTargetDimensions(
    currentWidth,
    currentHeight,
    IMAGE_LIMITS.REDUCED_MAX_DIM
  );

  // Only reduce if dimensions actually decrease
  if (reducedW < currentWidth || reducedH < currentHeight) {
    const reducedCanvas = multiStepDownscale(canvas, reducedW, reducedH);

    quality = IMAGE_LIMITS.JPEG_INITIAL_QUALITY;
    while (quality >= IMAGE_LIMITS.JPEG_MIN_QUALITY - 0.001) {
      const roundedQuality = Math.round(quality * 100) / 100;
      const blob = await canvasToBlob(reducedCanvas, 'image/jpeg', roundedQuality);
      const dataUrl = await blobToDataUrl(blob);

      if (dataUrl.length <= IMAGE_LIMITS.MAX_BASE64_SIZE) {
        return dataUrl;
      }

      quality -= IMAGE_LIMITS.JPEG_QUALITY_STEP;
    }
  }

  throw new Error(
    'Image too large for on-chain storage even after compression. ' +
    'Try a simpler image or split complex figures into sub-figures.'
  );
}

// ============================================================================
// Main Processing Function
// ============================================================================

/**
 * Process an image file for embedding in a PERMLIB-V1 document.
 *
 * Pipeline:
 *   1. Validate file type (JPEG/PNG only)
 *   2. Load with createImageBitmap (async, efficient)
 *   3. Validate minimum dimensions (200×200)
 *   4. Resize to fit 1200×1200 bounding box (multi-step downscale)
 *   5. Export and compress:
 *      - Photo mode: JPEG 75%, reduce quality if over 75 KB
 *      - Diagram mode: PNG first, fall back to JPEG 90% if PNG too large
 *   6. Return data URL and metadata
 *
 * @param {File} file — The image file to process
 * @param {'photo'|'diagram'} [mode='photo'] — Compression mode
 * @returns {Promise<Object>} — { dataUrl, format, width, height, originalWidth, originalHeight, base64Size }
 * @throws {Error} On validation failure or if image can't fit in 75 KB
 */
export async function processImage(file, mode = 'photo') {
  // Step 1: Validate file type
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Step 2: Load image
  const bitmap = await createImageBitmap(file);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;

  // Step 3: Validate minimum dimensions
  if (originalWidth < IMAGE_LIMITS.MIN_DIM || originalHeight < IMAGE_LIMITS.MIN_DIM) {
    bitmap.close();
    throw new Error(
      `Image too small to be useful (minimum ${IMAGE_LIMITS.MIN_DIM}×${IMAGE_LIMITS.MIN_DIM}, ` +
      `got ${originalWidth}×${originalHeight})`
    );
  }

  // Step 4: Calculate target dimensions and resize
  const { width: targetW, height: targetH } = calculateTargetDimensions(
    originalWidth,
    originalHeight,
    IMAGE_LIMITS.MAX_DIM
  );

  const canvas = multiStepDownscale(bitmap, targetW, targetH);
  bitmap.close();

  // Step 5: Export and compress
  let dataUrl;
  let format;
  let pngFallback = false;

  if (mode === 'diagram') {
    // Diagram mode: try PNG first (lossless, sharp edges)
    const pngBlob = await canvasToBlob(canvas, 'image/png');
    const pngDataUrl = await blobToDataUrl(pngBlob);

    if (pngDataUrl.length <= IMAGE_LIMITS.MAX_BASE64_SIZE) {
      dataUrl = pngDataUrl;
      format = 'png';
    } else {
      // PNG too large — fall back to high-quality JPEG
      pngFallback = true;
      const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', IMAGE_LIMITS.JPEG_FALLBACK_QUALITY);
      const jpegDataUrl = await blobToDataUrl(jpegBlob);

      if (jpegDataUrl.length <= IMAGE_LIMITS.MAX_BASE64_SIZE) {
        dataUrl = jpegDataUrl;
        format = 'jpeg';
      } else {
        // Still too large — progressive compression
        dataUrl = await compressUntilFits(canvas, targetW, targetH);
        format = 'jpeg';
      }
    }
  } else {
    // Photo mode: JPEG at 75% quality
    const blob = await canvasToBlob(canvas, 'image/jpeg', IMAGE_LIMITS.JPEG_INITIAL_QUALITY);
    const initialDataUrl = await blobToDataUrl(blob);

    if (initialDataUrl.length <= IMAGE_LIMITS.MAX_BASE64_SIZE) {
      dataUrl = initialDataUrl;
      format = 'jpeg';
    } else {
      // Too large — progressive compression
      dataUrl = await compressUntilFits(canvas, targetW, targetH);
      format = 'jpeg';
    }
  }

  // Step 6: Return result
  return {
    dataUrl,
    format,
    width: targetW,
    height: targetH,
    originalWidth,
    originalHeight,
    base64Size: dataUrl.length,
    pngFallback, // true if PNG was requested but JPEG was used instead
  };
}

// ============================================================================
// Content Analysis Helpers
// ============================================================================

/**
 * Build the Markdown image line for insertion into document content.
 * Sanitizes the caption to prevent breaking markdown syntax.
 *
 * @param {string} caption — Figure caption (alt text)
 * @param {string} dataUrl — Base64 data URL from processImage()
 * @returns {string} — e.g. '![Figure 1: Coral sampling sites](data:image/jpeg;base64,...)'
 */
export function buildImageMarkdown(caption, dataUrl) {
  // Strip [ and ] from caption to prevent breaking ![...](...) syntax
  // and to avoid confusing the content parser
  const safeCaption = caption.replace(/[\[\]]/g, '');
  return `![${safeCaption}](${dataUrl})`;
}

/**
 * Count embedded images in document content and calculate total payload.
 * Uses string searching (no regex) to avoid backtracking on large Base64 strings.
 *
 * @param {string} content — Document content string
 * @returns {{ count: number, totalBase64Size: number, captions: string[] }}
 */
export function countImagesInContent(content) {
  if (!content) {
    return { count: 0, totalBase64Size: 0, captions: [] };
  }

  let count = 0;
  let totalBase64Size = 0;
  const captions = [];
  let searchFrom = 0;

  while (searchFrom < content.length) {
    // Find next image start marker
    const imgStart = content.indexOf('![', searchFrom);
    if (imgStart === -1) break;

    // Find the data URI marker
    const dataMarker = content.indexOf('](data:image/', imgStart);
    if (dataMarker === -1) {
      searchFrom = imgStart + 2;
      continue;
    }

    // Find the closing parenthesis
    // Base64 charset is A-Z, a-z, 0-9, +, /, = — no parentheses
    // So the first ) after data:image/ definitely closes the data URI
    const closingParen = content.indexOf(')', dataMarker + 2);
    if (closingParen === -1) {
      searchFrom = dataMarker + 2;
      continue;
    }

    // Extract caption (between ![ and ](data:)
    const captionText = content.substring(imgStart + 2, dataMarker);
    captions.push(captionText);

    // Calculate data URI size (from "data:" to before closing paren)
    const dataUriStart = dataMarker + 2; // skip "]("
    const dataUriLength = closingParen - dataUriStart;
    totalBase64Size += dataUriLength;

    count++;
    searchFrom = closingParen + 1;
  }

  return { count, totalBase64Size, captions };
}


