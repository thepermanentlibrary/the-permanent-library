/**
 * The Permanent Library — PERMLIB-V1 Parser (Indexer)
 *
 * Server-side parser matching PERMLIB_V1_SPEC.md § Parsing Algorithm.
 * Identical logic to the Phase 3 standalone reader parser.
 *
 * Steps:
 *   1. Decode input data as UTF-8
 *   2. Check first line is "[PERMLIB-V1]"
 *   3. Parse [TITLE], [TAGS], [CHUNK], [DOC-ID], [CONTENT]
 *   4. Return structured result or null if not a valid document
 */

/**
 * Convert hex-encoded transaction input data to UTF-8 string.
 *
 * @param {string} hexInput — 0x-prefixed hex string from transaction input
 * @returns {string} — UTF-8 decoded string
 */
export function hexToUtf8(hexInput) {
  const clean = hexInput.startsWith('0x') ? hexInput.slice(2) : hexInput;
  const bytes = Buffer.from(clean, 'hex');
  return bytes.toString('utf-8');
}

/**
 * Parse a UTF-8 string as a PERMLIB-V1 document.
 *
 * Per PERMLIB_V1_SPEC.md § Parsing Algorithm:
 *   1. Check first line is exactly "[PERMLIB-V1]"
 *   2. Parse [TITLE] — strip "[TITLE] " prefix
 *   3. Parse [TAGS] — if "[TAGS]" alone → empty array; else strip "[TAGS] ", split by ","
 *   4. Parse [CHUNK] — strip "[CHUNK] ", split by "/"
 *   5. Parse [DOC-ID] — strip "[DOC-ID] ", validate format
 *   6. Verify [CONTENT] marker
 *   7. Everything after [CONTENT]\n is content
 *
 * @param {string} utf8Text — The decoded UTF-8 text
 * @returns {object|null} — Parsed document or null if not valid PERMLIB-V1
 */
export function parsePermlibV1(utf8Text) {
  const lines = utf8Text.split('\n');

  // Step 1: Check version header
  if (lines[0] !== '[PERMLIB-V1]') {
    return null; // Not a Permanent Library document — skip
  }

  // Step 2: Parse title
  if (!lines[1] || !lines[1].startsWith('[TITLE] ')) {
    console.warn('[Parser] Malformed [TITLE] field');
    return null;
  }
  const title = lines[1].substring(8);

  // Step 3: Parse tags
  let tags = [];
  if (lines[2] === '[TAGS]') {
    tags = [];
  } else if (lines[2] && lines[2].startsWith('[TAGS] ')) {
    tags = lines[2].substring(7)
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);
  } else {
    console.warn('[Parser] Malformed [TAGS] field');
    return null;
  }

  // Step 4: Parse chunk info
  if (!lines[3] || !lines[3].startsWith('[CHUNK] ')) {
    console.warn('[Parser] Malformed [CHUNK] field');
    return null;
  }
  const chunkParts = lines[3].substring(8).split('/');
  const chunkCurrent = parseInt(chunkParts[0], 10);
  const chunkTotal = parseInt(chunkParts[1], 10);
  if (isNaN(chunkCurrent) || isNaN(chunkTotal) || chunkCurrent < 1 || chunkCurrent > chunkTotal) {
    console.warn('[Parser] Invalid chunk numbers:', lines[3]);
    return null;
  }

  // Step 5: Parse DOC-ID
  if (!lines[4] || !lines[4].startsWith('[DOC-ID] ')) {
    console.warn('[Parser] Malformed [DOC-ID] field');
    return null;
  }
  const docId = lines[4].substring(9);
  if (!/^0x[0-9a-f]{64}$/.test(docId)) {
    console.warn('[Parser] Invalid DOC-ID format:', docId.substring(0, 20));
    return null;
  }

  // Step 6: Verify [CONTENT] marker
  if (lines[5] !== '[CONTENT]') {
    console.warn('[Parser] Missing [CONTENT] marker');
    return null;
  }

  // Step 7: Everything after [CONTENT]\n is content
  const contentStartIndex = utf8Text.indexOf('[CONTENT]\n');
  const content = contentStartIndex >= 0 ? utf8Text.substring(contentStartIndex + 10) : '';

  return {
    title,
    tags,
    chunkCurrent,
    chunkTotal,
    docId,
    content,
  };
}
