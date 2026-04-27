/**
 * The Permanent Library — PERMLIB-V1 Encoding Module
 *
 * Implements the PERMLIB-V1 encoding format as defined in PERMLIB_V1_SPEC.md.
 * This module constructs the UTF-8 string that goes into a transaction's
 * input data field.
 *
 * Format:
 *   [PERMLIB-V1]
 *   [TITLE] Document title here
 *   [TAGS] tag1, tag2, tag3
 *   [CHUNK] current/total
 *   [DOC-ID] 0x...64 lowercase hex chars...
 *   [CONTENT]
 *   ...document content...
 *
 * CRITICAL: The [TAGS] line MUST always be present even if empty.
 * CRITICAL: The [CONTENT] marker is on its own line with nothing after it.
 * CRITICAL: Line endings are \n (Unix-style LF).
 */

import { keccak256, toUtf8Bytes, hexlify, getBytes } from 'ethers';

/**
 * Generate the DOC-ID for a document.
 *
 * Per PERMLIB-V1 spec § DOC-ID Generation:
 *   1. content_bytes = UTF-8 encode the full document content
 *   2. address_bytes = hex-decode the sender address (lowercase, no 0x, 20 bytes)
 *   3. nonce_bytes = UTF-8 encode the upload nonce (ensures unique DOC-ID per upload)
 *   4. combined = content_bytes + address_bytes + nonce_bytes
 *   5. doc_id = keccak256(combined)
 *   6. Format as "0x" + 64 lowercase hex chars
 *
 * The nonce prevents DOC-ID collisions when the same content is uploaded
 * multiple times by the same address. Without it, identical uploads would
 * merge into a single document.
 *
 * @param {string} content — The full document text (what goes after [CONTENT])
 * @param {string} senderAddress — The sender's wallet address (0x-prefixed)
 * @param {string} [nonce=''] — Unique upload nonce (generated per upload session)
 * @returns {string} — The DOC-ID as "0x" + 64 lowercase hex chars (66 chars total)
 */
export function generateDocId(content, senderAddress, nonce = '') {
  // Step 1: content to UTF-8 bytes
  const contentBytes = toUtf8Bytes(content);

  // Step 2: address to raw bytes (lowercase, strip 0x, decode hex → 20 bytes)
  const addressLower = senderAddress.toLowerCase();
  const addressBytes = getBytes(addressLower); // getBytes handles 0x-prefixed hex

  // Step 3: nonce to UTF-8 bytes (empty if not provided — backwards compatible)
  const nonceBytes = nonce ? toUtf8Bytes(nonce) : new Uint8Array(0);

  // Step 4: concatenate content bytes + address bytes + nonce bytes
  const combined = new Uint8Array(contentBytes.length + addressBytes.length + nonceBytes.length);
  combined.set(contentBytes, 0);
  combined.set(addressBytes, contentBytes.length);
  combined.set(nonceBytes, contentBytes.length + addressBytes.length);

  // Step 5: keccak256 hash
  const hash = keccak256(combined);

  // Step 6: return as lowercase 0x + 64 hex chars
  return hash.toLowerCase();
}

/**
 * Encode a complete PERMLIB-V1 document (single chunk or one chunk of many).
 *
 * @param {Object} params
 * @param {string} params.title — Document title (required, max 500 UTF-8 bytes)
 * @param {string} params.tags — Comma-separated tags (optional, empty string if none)
 * @param {number} params.chunkCurrent — Current chunk number (1-indexed)
 * @param {number} params.chunkTotal — Total number of chunks
 * @param {string} params.docId — The DOC-ID (0x + 64 hex chars)
 * @param {string} params.content — The content for THIS chunk
 * @returns {string} — The full PERMLIB-V1 encoded string
 */
export function encodePermlibV1({ title, tags, chunkCurrent, chunkTotal, docId, content }) {
  // Validate inputs
  if (!title || title.trim().length === 0) {
    throw new Error('Title is required');
  }
  if (title.includes('\n')) {
    throw new Error('Title must not contain newlines');
  }

  const titleBytes = toUtf8Bytes(title);
  if (titleBytes.length > 500) {
    throw new Error(`Title exceeds 500 UTF-8 bytes (got ${titleBytes.length})`);
  }

  if (tags && tags.includes('\n')) {
    throw new Error('Tags must not contain newlines');
  }
  if (tags) {
    const tagsBytes = toUtf8Bytes(tags);
    if (tagsBytes.length > 500) {
      throw new Error(`Tags exceed 500 UTF-8 bytes (got ${tagsBytes.length})`);
    }
  }

  if (chunkCurrent < 1 || chunkCurrent > chunkTotal) {
    throw new Error(`Invalid chunk: ${chunkCurrent}/${chunkTotal}`);
  }
  if (chunkTotal < 1) {
    throw new Error(`Invalid total chunks: ${chunkTotal}`);
  }

  // Validate DOC-ID format: 0x + 64 lowercase hex chars = 66 chars total
  if (!docId || docId.length !== 66 || !docId.startsWith('0x')) {
    throw new Error(`Invalid DOC-ID format: must be 0x + 64 hex chars (got ${docId?.length || 0} chars)`);
  }
  if (!/^0x[0-9a-f]{64}$/.test(docId)) {
    throw new Error('DOC-ID must contain only lowercase hex characters after 0x');
  }

  // Build the PERMLIB-V1 encoded string
  // Per spec: each field on its own line, \n line endings
  const lines = [
    '[PERMLIB-V1]',
    `[TITLE] ${title}`,
    tags ? `[TAGS] ${tags}` : '[TAGS]',
    `[CHUNK] ${chunkCurrent}/${chunkTotal}`,
    `[DOC-ID] ${docId}`,
    '[CONTENT]',
    content,
  ];

  return lines.join('\n');
}

/**
 * Convert a PERMLIB-V1 encoded string to hex calldata for the transaction.
 *
 * Per PERMLIB-V1 spec § Calldata Encoding Note:
 *   1. Construct full PERMLIB-V1 string
 *   2. Convert to UTF-8 bytes
 *   3. Encode as 0x-prefixed hex string
 *   4. Use as the transaction's `data` field
 *
 * @param {string} permlibString — The PERMLIB-V1 encoded string
 * @returns {string} — Hex-encoded calldata (0x-prefixed)
 */
export function toCalldata(permlibString) {
  return hexlify(toUtf8Bytes(permlibString));
}

/**
 * Calculate the byte size of a UTF-8 string.
 * Used for gas estimation and chunking decisions.
 *
 * @param {string} text
 * @returns {number} — Size in bytes
 */
export function utf8ByteLength(text) {
  return toUtf8Bytes(text).length;
}

/**
 * Calculate the header size for a given title, tags, docId, and chunk info.
 * This is the overhead per chunk (everything except the content).
 *
 * @param {string} title
 * @param {string} tags
 * @param {string} docId
 * @param {number} chunkTotal — Needed to know the character width of the chunk numbers
 * @returns {number} — Header size in bytes
 */
export function calculateHeaderSize(title, tags, docId, chunkTotal) {
  // Worst case: chunkCurrent and chunkTotal both at max digits
  const maxChunkStr = String(chunkTotal);
  const headerTemplate = [
    '[PERMLIB-V1]',
    `[TITLE] ${title}`,
    tags ? `[TAGS] ${tags}` : '[TAGS]',
    `[CHUNK] ${maxChunkStr}/${maxChunkStr}`,
    `[DOC-ID] ${docId}`,
    '[CONTENT]',
    '', // The \n after [CONTENT] before actual content
  ].join('\n');

  return utf8ByteLength(headerTemplate);
}
