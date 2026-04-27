import { useState, useMemo, useRef } from 'react';
import { utf8ByteLength } from '../lib/permlib.js';
import { estimateChunkCount } from '../lib/chunking.js';
import {
  processImage,
  buildImageMarkdown,
  countImagesInContent,
} from '../lib/image-tool.js';
import { SAFE_CALLDATA_LIMIT } from '../config/chains.js';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function DocumentEditor({
  title, onTitleChange,
  tags, onTagsChange,
  content, onContentChange,
  disabled,
}) {
  // Image insertion state
  const [imageProcessing, setImageProcessing] = useState(false);
  const [pendingImage, setPendingImage] = useState(null);
  const [caption, setCaption] = useState('');
  const [imageMode, setImageMode] = useState('photo');
  const [imageError, setImageError] = useState(null);

  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const cursorPosRef = useRef(null);

  // Document stats (text)
  const stats = useMemo(() => {
    const contentBytes = content ? utf8ByteLength(content) : 0;
    const titleBytes = title ? utf8ByteLength(title) : 0;
    const chunks = (title && content)
      ? estimateChunkCount(title, tags || '', content)
      : 1;

    return { contentBytes, titleBytes, chunks };
  }, [title, tags, content]);

  // Image stats (derived from content)
  const imageStats = useMemo(() => {
    return countImagesInContent(content);
  }, [content]);

  const titleTooLong = stats.titleBytes > 500;

  // ---- Image insertion handlers ----

  const handleInsertFigureClick = () => {
    // Save cursor position before opening file picker
    if (textareaRef.current) {
      cursorPosRef.current = textareaRef.current.selectionStart;
    }
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset file input so same file can be re-selected
    e.target.value = '';

    setImageError(null);
    setImageProcessing(true);
    setPendingImage(null);

    try {
      // Process the image
      const result = await processImage(file, imageMode);

      setPendingImage(result);
      setCaption('');
    } catch (err) {
      setImageError(err.message);
      setPendingImage(null);
    } finally {
      setImageProcessing(false);
    }
  };

  const handleImageInsert = () => {
    if (!pendingImage || !caption.trim()) return;

    const markdownLine = buildImageMarkdown(caption.trim(), pendingImage.dataUrl);

    // Insert at saved cursor position, or append at end
    const pos = cursorPosRef.current ?? content.length;
    const before = content.substring(0, pos);
    const after = content.substring(pos);

    // Ensure proper line spacing around the image
    let prefix = '';
    if (before.length > 0 && !before.endsWith('\n\n')) {
      prefix = before.endsWith('\n') ? '\n' : '\n\n';
    }
    let suffix = '';
    if (after.length > 0 && !after.startsWith('\n\n')) {
      suffix = after.startsWith('\n') ? '\n' : '\n\n';
    }

    const newContent = before + prefix + markdownLine + suffix + after;
    onContentChange(newContent);

    // Reset image state
    setPendingImage(null);
    setCaption('');
    setImageError(null);
    cursorPosRef.current = null;
  };

  const handleImageCancel = () => {
    setPendingImage(null);
    setCaption('');
    setImageError(null);
    cursorPosRef.current = null;
  };

  // ---- Render ----

  return (
    <div className="flex flex-col gap-4">
      {/* Title */}
      <div className="flex flex-col gap-1">
        <label htmlFor="doc-title" className="text-vault-400 text-sm font-medium">
          Title <span className="text-amber-dim">*</span>
        </label>
        <input
          id="doc-title"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          disabled={disabled}
          placeholder="Your document title"
          maxLength={500}
          className={`
            w-full px-4 py-3 bg-vault-900 border rounded-lg text-vault-100
            placeholder-vault-600 outline-none transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed
            ${titleTooLong
              ? 'border-danger focus:border-danger'
              : 'border-vault-700 focus:border-amber-glow'
            }
          `}
        />
        <div className="flex justify-between text-xs">
          <span className={titleTooLong ? 'text-danger' : 'text-vault-500'}>
            {stats.titleBytes}/500 bytes
          </span>
          {titleTooLong && (
            <span className="text-danger">Title exceeds maximum size</span>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="flex flex-col gap-1">
        <label htmlFor="doc-tags" className="text-vault-400 text-sm font-medium">
          Tags <span className="text-vault-600">(optional, comma-separated)</span>
        </label>
        <input
          id="doc-tags"
          type="text"
          value={tags}
          onChange={(e) => onTagsChange(e.target.value)}
          disabled={disabled}
          placeholder="physics, energy, research"
          className="w-full px-4 py-3 bg-vault-900 border border-vault-700 rounded-lg
                     text-vault-100 placeholder-vault-600 outline-none
                     focus:border-amber-glow transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Content */}
      <div className="flex flex-col gap-1">
        <label htmlFor="doc-content" className="text-vault-400 text-sm font-medium">
          Document Content <span className="text-amber-dim">*</span>
        </label>
        <textarea
          id="doc-content"
          ref={textareaRef}
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          disabled={disabled || imageProcessing}
          placeholder={'Paste your research, paper, or document here.\n\nSupports Markdown formatting. Write in any language.\nMathematical formulas use LaTeX: $E = mc^2$\n\nUse "Insert Figure" below to embed images.'}
          rows={16}
          className="w-full px-4 py-3 bg-vault-900 border border-vault-700 rounded-lg
                     text-vault-100 placeholder-vault-600 outline-none resize-y
                     focus:border-amber-glow transition-colors leading-relaxed text-sm
                     disabled:opacity-50 disabled:cursor-not-allowed min-h-[200px]"
        />
        <div className="flex justify-between items-center text-xs text-vault-500 mt-1">
          <span>{formatBytes(stats.contentBytes)}</span>
          {stats.chunks > 1 && (
            <span className="text-amber-dim">
              ~{stats.chunks} transaction{stats.chunks > 1 ? 's' : ''} required
            </span>
          )}
          {stats.chunks === -1 && (
            <span className="text-danger">
              Title or tags too long
            </span>
          )}
        </div>
      </div>

      {/* Image insertion controls */}
      <div className="flex flex-col gap-3">
        {/* Insert Figure button + mode toggle + counters */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleInsertFigureClick}
            disabled={disabled || imageProcessing}
            className="px-4 py-2 bg-vault-800 border border-vault-600 rounded-lg
                       text-vault-300 text-sm hover:bg-vault-700 hover:text-vault-100
                       transition-colors cursor-pointer
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {imageProcessing ? 'Processing…' : 'Insert Figure'}
          </button>

          {/* Mode toggle */}
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setImageMode('photo')}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${
                imageMode === 'photo'
                  ? 'bg-amber-dim text-vault-950'
                  : 'bg-vault-800 text-vault-400 hover:text-vault-200'
              }`}
            >
              Photo
            </button>
            <button
              type="button"
              onClick={() => setImageMode('diagram')}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${
                imageMode === 'diagram'
                  ? 'bg-amber-dim text-vault-950'
                  : 'bg-vault-800 text-vault-400 hover:text-vault-200'
              }`}
            >
              Diagram
            </button>
          </div>

          {/* Image counter (informational — no cap) */}
          {imageStats.count > 0 && (
            <span className="text-xs text-vault-500">
              {imageStats.count} figure{imageStats.count !== 1 ? 's' : ''} · {formatBytes(imageStats.totalBase64Size)}
            </span>
          )}
        </div>

        {/* Chunk capacity meter — shows how full the current chunk is */}
        {stats.contentBytes > 0 && stats.chunks >= 1 && (() => {
          const perChunkCapacity = SAFE_CALLDATA_LIMIT - 300; // header overhead estimate
          const remainder = stats.contentBytes % perChunkCapacity;
          const chunkFillPercent = remainder === 0 ? 100 : (remainder / perChunkCapacity) * 100;
          return (
            <div className="flex flex-col gap-1">
              <div className="w-full h-1.5 bg-vault-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-dim rounded-full transition-all"
                  style={{ width: `${Math.min(100, chunkFillPercent)}%` }}
                />
              </div>
              <span className="text-xs text-vault-500">
                {stats.chunks === 1
                  ? `${formatBytes(stats.contentBytes)} · fits in 1 transaction`
                  : `${formatBytes(stats.contentBytes)} · chunk ${stats.chunks} of ~${stats.chunks} — ${Math.round(chunkFillPercent)}% full`
                }
              </span>
            </div>
          );
        })()}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleFileSelected}
          className="hidden"
        />

        {/* Error display */}
        {imageError && (
          <div className="px-3 py-2 bg-vault-900 border border-danger rounded-lg text-danger text-sm">
            {imageError}
          </div>
        )}

        {/* Pending image preview + caption input */}
        {pendingImage && (
          <div className="flex flex-col gap-3 px-4 py-3 bg-vault-900 border border-vault-600 rounded-lg">
            <div className="flex gap-4">
              {/* Preview thumbnail */}
              <img
                src={pendingImage.dataUrl}
                alt="Preview"
                className="w-24 h-24 object-contain bg-vault-800 rounded border border-vault-700 shrink-0"
              />

              {/* Image info */}
              <div className="flex flex-col gap-1 text-xs text-vault-400 min-w-0">
                <span>
                  {pendingImage.width}×{pendingImage.height} px
                  {(pendingImage.originalWidth > pendingImage.width ||
                    pendingImage.originalHeight > pendingImage.height) && (
                    <span className="text-vault-600">
                      {' '}(from {pendingImage.originalWidth}×{pendingImage.originalHeight})
                    </span>
                  )}
                </span>
                <span>
                  {formatBytes(pendingImage.base64Size)} Base64
                  <span className="text-vault-600">
                    {' '}({pendingImage.format.toUpperCase()})
                  </span>
                </span>
                {pendingImage.pngFallback && (
                  <span className="text-amber-dim">
                    PNG was too large — exported as high-quality JPEG instead
                  </span>
                )}
              </div>
            </div>

            {/* Caption input */}
            <div className="flex flex-col gap-1">
              <label className="text-vault-400 text-xs font-medium">
                Figure caption <span className="text-amber-dim">*</span>
              </label>
              <input
                type="text"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Figure 1: Description of this figure"
                maxLength={300}
                className="w-full px-3 py-2 bg-vault-800 border border-vault-700 rounded
                           text-vault-100 placeholder-vault-600 outline-none text-sm
                           focus:border-amber-glow transition-colors"
                autoFocus
              />
              <span className="text-vault-600 text-xs">
                Required — the caption is the only description that survives if the image can't render
              </span>
            </div>

            {/* Insert / Cancel */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleImageInsert}
                disabled={!caption.trim()}
                className="px-4 py-2 bg-amber-glow text-vault-950 text-sm font-medium rounded
                           hover:bg-amber-bright transition-colors cursor-pointer
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Insert
              </button>
              <button
                type="button"
                onClick={handleImageCancel}
                className="px-4 py-2 bg-vault-800 text-vault-400 text-sm rounded
                           hover:bg-vault-700 hover:text-vault-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
