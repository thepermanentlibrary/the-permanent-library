/**
 * The Permanent Library — Chunking Module
 *
 * Splits document content into chunks that fit within the safe calldata
 * limit per transaction. Handles multi-byte UTF-8 characters safely.
 *
 * Per PERMLIB-V1 spec § Chunking Process:
 *   1. Generate DOC-ID BEFORE splitting
 *   2. Determine safe content size per chunk: safe_limit - header_size
 *   3. Split at safe byte boundaries (NEVER mid-character)
 *   4. Wrap each chunk with full header
 *   5. Send sequentially
 *
 * CRITICAL: Never split in the middle of a multi-byte UTF-8 character.
 * UTF-8 characters can be 1-4 bytes. Chinese, Arabic, Japanese, emoji,
 * and other non-ASCII characters MUST remain intact.
 *
 * CRITICAL: Never split in the middle of an embedded image data URI.
 * Per PERMLIB_V1_IMAGE_SPEC.md § 4.2:
 *   "An embedded image is an atomic unit. The chunker must never break
 *    inside a Base64 data URI."
 * A partial Base64 string is corrupted, undecodable garbage.
 */

import { toUtf8Bytes } from 'ethers';
import { SAFE_CALLDATA_LIMIT } from '../config/chains.js';
import {
  generateDocId,
  encodePermlibV1,
  toCalldata,
  utf8ByteLength,
  calculateHeaderSize,
} from './permlib.js';

/**
 * Determine if a document needs chunking and prepare all chunks.
 *
 * @param {Object} params
 * @param {string} params.title — Document title
 * @param {string} params.tags — Comma-separated tags (or empty string)
 * @param {string} params.content — Full document content
 * @param {string} params.senderAddress — The uploader's wallet address
 * @param {string} params.nonce — Unique upload nonce (ensures unique DOC-ID per upload)
 * @returns {Object} — { docId, chunks: [{ encoded, calldata, chunkIndex, totalChunks }] }
 */
export function prepareDocument({ title, tags, content, senderAddress, nonce }) {
  // Step 1: Generate DOC-ID from full content + sender address + nonce (BEFORE any splitting)
  const docId = generateDocId(content, senderAddress, nonce || '');

  // Step 2: Try encoding as a single chunk first
  const singleEncoded = encodePermlibV1({
    title,
    tags,
    chunkCurrent: 1,
    chunkTotal: 1,
    docId,
    content,
  });

  const singleCalldata = toCalldata(singleEncoded);
  const singleByteSize = (singleCalldata.length - 2) / 2; // subtract "0x", each hex pair = 1 byte

  // If it fits in one transaction, return single chunk
  if (singleByteSize <= SAFE_CALLDATA_LIMIT) {
    return {
      docId,
      chunks: [{
        encoded: singleEncoded,
        calldata: singleCalldata,
        chunkIndex: 1,
        totalChunks: 1,
        byteSize: singleByteSize,
      }],
    };
  }

  // Step 3: Need to chunk — calculate available content space per chunk
  // Start with an estimate for total chunks, then refine
  const contentBytes = utf8ByteLength(content);

  // Estimate header size (will be recalculated once we know total chunks)
  let estimatedTotalChunks = Math.ceil(contentBytes / (SAFE_CALLDATA_LIMIT * 0.9));
  if (estimatedTotalChunks < 2) estimatedTotalChunks = 2;

  // Iteratively determine the correct number of chunks
  let totalChunks;
  let contentChunks;

  for (let attempt = 0; attempt < 10; attempt++) {
    const headerSize = calculateHeaderSize(title, tags, docId, estimatedTotalChunks);
    const availablePerChunk = SAFE_CALLDATA_LIMIT - headerSize;

    if (availablePerChunk <= 0) {
      throw new Error('Header too large: title or tags are too long to fit with any content');
    }

    contentChunks = splitContentSafe(content, availablePerChunk);
    totalChunks = contentChunks.length;

    // If our estimate matches reality, we're done
    if (totalChunks <= estimatedTotalChunks) {
      break;
    }

    // Otherwise, adjust estimate and retry
    estimatedTotalChunks = totalChunks;
  }

  // Step 4: Wrap each chunk with full header
  const chunks = contentChunks.map((chunkContent, index) => {
    const encoded = encodePermlibV1({
      title,
      tags,
      chunkCurrent: index + 1,
      chunkTotal: totalChunks,
      docId,
      content: chunkContent,
    });

    const calldata = toCalldata(encoded);
    const byteSize = (calldata.length - 2) / 2;

    return {
      encoded,
      calldata,
      chunkIndex: index + 1,
      totalChunks,
      byteSize,
    };
  });

  return { docId, chunks };
}

/**
 * Split a UTF-8 string into chunks, each fitting within maxBytes,
 * WITHOUT breaking multi-byte characters or embedded image data URIs.
 *
 * UTF-8 encoding rules:
 *   - 0xxxxxxx: 1-byte character (ASCII)
 *   - 110xxxxx: start of 2-byte character
 *   - 1110xxxx: start of 3-byte character
 *   - 11110xxx: start of 4-byte character
 *   - 10xxxxxx: continuation byte (NOT a valid split point)
 *
 * Image atomicity rule (PERMLIB_V1_IMAGE_SPEC.md § 4.2):
 *   A split must never fall inside a ![...](data:image/...;base64,...) block.
 *   If it does, the split point moves to just before the "![" that starts
 *   the image line. If the image alone exceeds maxBytes, throw an error.
 *
 * @param {string} text — The full text to split
 * @param {number} maxBytes — Maximum bytes per chunk
 * @returns {string[]} — Array of content strings, one per chunk
 */
function splitContentSafe(text, maxBytes) {
  const fullBytes = toUtf8Bytes(text);
  const chunks = [];
  let offset = 0;

  while (offset < fullBytes.length) {
    let end = Math.min(offset + maxBytes, fullBytes.length);

    // If we're not at the end of the buffer, find a safe split point
    if (end < fullBytes.length) {
      // First: don't split mid-UTF-8 character
      end = findSafeUtf8SplitPoint(fullBytes, end);

      // Second: don't split inside an embedded image data URI
      const candidateChunk = new TextDecoder('utf-8').decode(fullBytes.slice(offset, end));
      const safeCharLen = findSafeImageSplitPoint(candidateChunk);

      if (safeCharLen < candidateChunk.length) {
        // Need to truncate before an image — recalculate byte offset
        const safeChunk = candidateChunk.substring(0, safeCharLen);
        const safeBytesLen = toUtf8Bytes(safeChunk).length;
        end = offset + safeBytesLen;

        // If we can't fit anything before the image, the image is too large
        if (end <= offset) {
          throw new Error(
            'An embedded image is too large to fit in a single chunk. ' +
            'Reduce image resolution or quality before uploading.'
          );
        }
      }
    }

    // Extract this chunk's bytes and decode back to string
    const chunkBytes = fullBytes.slice(offset, end);
    const chunkStr = new TextDecoder('utf-8').decode(chunkBytes);
    chunks.push(chunkStr);

    offset = end;
  }

  return chunks;
}

/**
 * Find a safe UTF-8 split point at or before the given position.
 * Walks backwards from `position` until we find a byte that is NOT
 * a continuation byte (10xxxxxx).
 *
 * @param {Uint8Array} bytes — The full UTF-8 byte array
 * @param {number} position — The desired split position
 * @returns {number} — A safe split position (at a character boundary)
 */
function findSafeUtf8SplitPoint(bytes, position) {
  // Walk backwards while we're on a continuation byte (10xxxxxx)
  while (position > 0 && (bytes[position] & 0xc0) === 0x80) {
    position--;
  }
  return position;
}

/**
 * Check if a text chunk ends in the middle of an image data URI.
 * If so, return the character position to truncate to (just before the "![").
 * Otherwise, return the full text length (no truncation needed).
 *
 * This uses string indexOf (no regex) to avoid catastrophic backtracking
 * on large Base64 strings.
 *
 * @param {string} text — The candidate chunk text
 * @returns {number} — Safe character count (text.length if no truncation needed)
 */
function findSafeImageSplitPoint(text) {
  // Search backwards for the last "![" in the text
  let searchPos = text.length;

  while (searchPos > 0) {
    const imgStart = text.lastIndexOf('![', searchPos - 1);
    if (imgStart === -1) break;

    // Check if this "![" leads to a data:image URI
    const dataMarker = text.indexOf('](data:image/', imgStart);
    if (dataMarker === -1) {
      // Not a data URI image — could be a regular markdown image/link.
      // Keep searching for earlier "![" markers.
      searchPos = imgStart;
      continue;
    }

    // Found ![...](data:image/... — check if the closing ")" exists
    // Base64 charset is A-Z, a-z, 0-9, +, /, = — never contains ")"
    // So the first ")" after "data:image/" definitely closes the URI.
    const searchAfterData = dataMarker + '](data:image/'.length;
    const closingParen = text.indexOf(')', searchAfterData);

    if (closingParen === -1) {
      // No closing paren — we split inside the data URI.
      // Truncate to just before the "![".
      return imgStart;
    }

    // Closing paren exists — this image is complete, no problem.
    // No need to check earlier "![" markers.
    break;
  }

  // No truncation needed
  return text.length;
}

/**
 * Estimate the total number of chunks needed for a document.
 * Used for UI cost preview before the user commits to upload.
 *
 * @param {string} title
 * @param {string} tags
 * @param {string} content
 * @returns {number} — Estimated number of chunks (at least 1)
 */
export function estimateChunkCount(title, tags, content) {
  const contentSize = utf8ByteLength(content);

  // Quick check: will it fit in one transaction?
  // Use a rough estimate: header ≈ 200 bytes for typical title/tags
  const roughHeaderSize = 200 + utf8ByteLength(title) + utf8ByteLength(tags || '');
  const roughTotalSize = roughHeaderSize + contentSize;

  if (roughTotalSize <= SAFE_CALLDATA_LIMIT) {
    return 1;
  }

  // Estimate with proper header size
  const estimatedTotal = Math.max(2, Math.ceil(contentSize / (SAFE_CALLDATA_LIMIT * 0.9)));
  const headerSize = calculateHeaderSize(title, tags || '', '0x' + '0'.repeat(64), estimatedTotal);
  const availablePerChunk = SAFE_CALLDATA_LIMIT - headerSize;

  if (availablePerChunk <= 0) return -1; // header too large

  return Math.ceil(contentSize / availablePerChunk);
}
