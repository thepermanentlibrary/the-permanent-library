/**
 * The Permanent Library — Database Module
 *
 * PostgreSQL connection pool and query helpers.
 * Uses the 'pg' library (node-postgres).
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ENV } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
  connectionString: ENV.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Initialize the database schema.
 */
export async function initDatabase() {
  const schemaPath = join(__dirname, '..', 'sql', 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  await pool.query(schema);
  console.log('[DB] Schema initialized');
}

/**
 * Get the last scanned block for a chain.
 */
export async function getLastBlock(chain) {
  const res = await pool.query(
    'SELECT last_block FROM scan_state WHERE chain = $1',
    [chain]
  );
  return res.rows.length > 0 ? Number(res.rows[0].last_block) : 0;
}

/**
 * Update the last scanned block for a chain.
 */
export async function setLastBlock(chain, blockNumber) {
  await pool.query(
    'UPDATE scan_state SET last_block = $1, last_scanned_at = NOW() WHERE chain = $2',
    [blockNumber, chain]
  );
}

// ============================================================================
// Image Content Helpers
// ============================================================================

/**
 * Strip Base64 data URIs from content, preserving alt text (captions).
 * Replaces ![caption](data:image/...;base64,...) with ![caption]()
 * so captions remain searchable but Base64 gibberish is removed.
 *
 * Uses string indexOf (no regex) to avoid catastrophic backtracking
 * on large Base64 strings.
 *
 * @param {string} content — Full document content
 * @returns {string} — Content with data URIs stripped
 */
function stripBase64FromContent(content) {
  if (!content) return content;

  let result = '';
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const imgStart = content.indexOf('![', searchFrom);
    if (imgStart === -1) {
      result += content.substring(searchFrom);
      break;
    }

    const dataMarker = content.indexOf('](data:image/', imgStart);
    if (dataMarker === -1) {
      result += content.substring(searchFrom);
      break;
    }

    // Base64 charset never contains ")" — first ")" closes the data URI
    const closingParen = content.indexOf(')', dataMarker + 2);
    if (closingParen === -1) {
      result += content.substring(searchFrom);
      break;
    }

    // Keep everything up to "](" then replace data URI with empty "()"
    result += content.substring(searchFrom, dataMarker) + ']()';
    searchFrom = closingParen + 1;
  }

  return result;
}

/**
 * Count embedded images in content.
 *
 * @param {string} content — Full document content
 * @returns {number} — Number of data:image URIs found
 */
function countImages(content) {
  if (!content) return 0;

  let count = 0;
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const imgStart = content.indexOf('![', searchFrom);
    if (imgStart === -1) break;

    const dataMarker = content.indexOf('](data:image/', imgStart);
    if (dataMarker === -1) break;

    const closingParen = content.indexOf(')', dataMarker + 2);
    if (closingParen === -1) break;

    count++;
    searchFrom = closingParen + 1;
  }

  return count;
}

/**
 * Insert a parsed transaction into the database.
 */
export async function insertTransaction(tx) {
  await pool.query(
    `INSERT INTO transactions (tx_hash, chain, block_number, from_address, doc_id,
       chunk_current, chunk_total, title, tags, content, raw_input, block_timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (tx_hash, chain) DO NOTHING`,
    [
      tx.txHash, tx.chain, tx.blockNumber, tx.fromAddress, tx.docId,
      tx.chunkCurrent, tx.chunkTotal, tx.title, tx.tags, tx.content,
      tx.rawInput, tx.blockTimestamp,
    ]
  );
}

/**
 * Assemble or update a document from its transactions.
 * Called after inserting a new transaction — checks if all chunks exist
 * and assembles the full content.
 */
export async function assembleDocument(docId, chain) {
  // Get one transaction per chunk (deduplicated).
  // If the same chunk was sent multiple times (e.g., wallet retry or upload resume),
  // keep the earliest transaction (lowest block_number) for each chunk_current.
  const res = await pool.query(
    `SELECT DISTINCT ON (chunk_current) * FROM transactions
     WHERE doc_id = $1 AND chain = $2
     ORDER BY chunk_current ASC, block_number ASC`,
    [docId, chain]
  );

  if (res.rows.length === 0) return;

  const chunks = res.rows;
  const first = chunks[0];
  const totalChunks = first.chunk_total;
  const foundChunks = chunks.length;
  const isComplete = foundChunks === totalChunks;

  // Reassemble content by concatenating chunks in order
  const fullContent = chunks.map(c => c.content).join('');

  // Strip Base64 data URIs for search index and preview
  const contentText = stripBase64FromContent(fullContent);
  const imageCount = countImages(fullContent);
  const hasImages = imageCount > 0;

  // Find earliest block number and on-chain timestamp
  const minBlock = Math.min(...chunks.map(c => Number(c.block_number)));

  // Use the earliest on-chain timestamp, fallback to NOW() if not available
  const blockTimestamps = chunks
    .map(c => c.block_timestamp)
    .filter(t => t != null);
  const earliestTimestamp = blockTimestamps.length > 0
    ? new Date(Math.min(...blockTimestamps.map(t => new Date(t).getTime())))
    : new Date();

  await pool.query(
    `INSERT INTO documents (doc_id, chain, title, tags, content, content_text,
       uploader, total_chunks, found_chunks, is_complete, block_number,
       has_images, image_count, first_seen)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (doc_id, chain) DO UPDATE SET
       content = EXCLUDED.content,
       content_text = EXCLUDED.content_text,
       found_chunks = EXCLUDED.found_chunks,
       is_complete = EXCLUDED.is_complete,
       has_images = EXCLUDED.has_images,
       image_count = EXCLUDED.image_count,
       first_seen = EXCLUDED.first_seen,
       updated_at = NOW()`,
    [
      docId, chain, first.title, first.tags, fullContent, contentText,
      first.from_address, totalChunks, foundChunks, isComplete, minBlock,
      hasImages, imageCount, earliestTimestamp,
    ]
  );
}

/**
 * Search documents.
 */
export async function searchDocuments({ query, chain, tags, uploader, limit, offset }) {
  const conditions = ['hidden = FALSE'];
  const params = [];
  let paramIdx = 1;

  if (query) {
    conditions.push(`to_tsvector('english', title || ' ' || COALESCE(content_text, content)) @@ plainto_tsquery('english', $${paramIdx})`);
    params.push(query);
    paramIdx++;
  }

  if (chain) {
    conditions.push(`chain = $${paramIdx}`);
    params.push(chain);
    paramIdx++;
  }

  if (tags && tags.length > 0) {
    conditions.push(`tags && $${paramIdx}`);
    params.push(tags);
    paramIdx++;
  }

  if (uploader) {
    conditions.push(`uploader = $${paramIdx}`);
    params.push(uploader.toLowerCase());
    paramIdx++;
  }

  const lim = Math.min(limit || 50, ENV.MAX_SEARCH_RESULTS);
  const off = offset || 0;

  const sql = `
    SELECT doc_id, chain, title, tags, uploader, total_chunks, found_chunks,
           is_complete, first_seen, block_number, has_images, image_count,
           LEFT(COALESCE(content_text, content), 300) AS preview
    FROM documents
    WHERE ${conditions.join(' AND ')}
    ORDER BY first_seen DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `;
  params.push(lim, off);

  const res = await pool.query(sql, params);
  return res.rows;
}

/**
 * Get a single document by DOC-ID and chain.
 */
export async function getDocument(docId, chain) {
  const res = await pool.query(
    `SELECT * FROM documents WHERE doc_id = $1 AND chain = $2`,
    [docId, chain]
  );
  return res.rows[0] || null;
}

/**
 * Get transactions for a document (one per chunk, deduplicated).
 */
export async function getDocumentTransactions(docId, chain) {
  const res = await pool.query(
    `SELECT DISTINCT ON (chunk_current) tx_hash, chunk_current, chunk_total, block_number, from_address
     FROM transactions
     WHERE doc_id = $1 AND chain = $2
     ORDER BY chunk_current ASC, block_number ASC`,
    [docId, chain]
  );
  return res.rows;
}

/**
 * Get recent documents across all chains.
 */
export async function getRecentDocuments(limit = 20, offset = 0) {
  const res = await pool.query(
    `SELECT doc_id, chain, title, tags, uploader, total_chunks, found_chunks,
            is_complete, first_seen, block_number, has_images, image_count,
            LEFT(COALESCE(content_text, content), 300) AS preview
     FROM documents
     WHERE hidden = FALSE
     ORDER BY first_seen DESC
     LIMIT $1 OFFSET $2`,
    [Math.min(limit, ENV.MAX_SEARCH_RESULTS), offset]
  );
  return res.rows;
}

/**
 * Hide a document from search results (moderation).
 * Per spec: "always shows a notice that hidden content is still accessible on-chain."
 */
export async function hideDocument(docId, chain, reason) {
  await pool.query(
    `UPDATE documents SET hidden = TRUE, hidden_reason = $3, updated_at = NOW()
     WHERE doc_id = $1 AND chain = $2`,
    [docId, chain, reason]
  );
}

/**
 * Get document count and stats.
 */
export async function getStats() {
  const res = await pool.query(`
    SELECT
      COUNT(*) AS total_documents,
      COUNT(*) FILTER (WHERE chain = 'ethereum') AS ethereum_docs,
      COUNT(*) FILTER (WHERE chain = 'polygon') AS polygon_docs,
      COUNT(*) FILTER (WHERE chain = 'arbitrum') AS arbitrum_docs,
      COUNT(*) FILTER (WHERE is_complete = FALSE) AS incomplete_docs
    FROM documents
    WHERE hidden = FALSE
  `);
  return res.rows[0];
}

export { pool };
