/**
 * The Permanent Library — REST API
 *
 * Endpoints:
 *   GET /api/search       — Search documents by query, chain, tags, uploader
 *   GET /api/recent       — Recent documents across all chains
 *   GET /api/document/:chain/:docId — Get a single document with full content
 *   GET /api/document/:chain/:docId/transactions — Get transaction list for a document
 *   GET /api/stats        — Index statistics
 *
 * Per master doc § Indexer Security Note:
 *   The indexer has NO write access to the blockchain.
 *   It is read-only. Compromising it cannot modify or delete on-chain data.
 */

import express from 'express';
import { CHAINS } from './config.js';
import {
  searchDocuments,
  getDocument,
  getDocumentTransactions,
  getRecentDocuments,
  getStats,
} from './db.js';

const router = express.Router();

/**
 * GET /api/search
 * Query params:
 *   q        — Search query (full-text search on title + content)
 *   chain    — Filter by chain (ethereum, polygon, arbitrum)
 *   tags     — Comma-separated tags to filter by
 *   uploader — Filter by wallet address
 *   limit    — Max results (default 50, max 100)
 *   offset   — Pagination offset
 */
router.get('/search', async (req, res) => {
  try {
    const { q, chain, tags, uploader, limit, offset } = req.query;

    // Validate chain if provided
    if (chain && !CHAINS[chain]) {
      return res.status(400).json({ error: 'Invalid chain. Must be: ethereum, polygon, or arbitrum' });
    }

    const parsedTags = tags
      ? tags.split(',').map(t => t.trim()).filter(t => t.length > 0)
      : null;

    const results = await searchDocuments({
      query: q || null,
      chain: chain || null,
      tags: parsedTags,
      uploader: uploader || null,
      limit: Math.max(1, parseInt(limit || '50', 10) || 50),
      offset: Math.max(0, parseInt(offset || '0', 10) || 0),
    });

    // Add explorer URLs to results
    const enriched = results.map(doc => ({
      ...doc,
      explorer_url: CHAINS[doc.chain]
        ? `${CHAINS[doc.chain].explorer}/address/${doc.uploader}`
        : null,
    }));

    res.json({ results: enriched, count: enriched.length });
  } catch (err) {
    console.error('[API] Search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/recent
 * Query params:
 *   limit  — Max results (default 50)
 *   offset — Pagination offset (default 0)
 */
router.get('/recent', async (req, res) => {
  try {
    const limit = Math.max(1, parseInt(req.query.limit || '50', 10) || 50);
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
    const results = await getRecentDocuments(limit, offset);

    res.json({ results, count: results.length });
  } catch (err) {
    console.error('[API] Recent error:', err.message);
    res.status(500).json({ error: 'Failed to fetch recent documents' });
  }
});

/**
 * GET /api/document/:chain/:docId
 * Returns full document with content.
 */
router.get('/document/:chain/:docId', async (req, res) => {
  try {
    const { chain, docId } = req.params;

    if (!CHAINS[chain]) {
      return res.status(400).json({ error: 'Invalid chain' });
    }

    // Validate DOC-ID format
    if (!/^0x[0-9a-f]{64}$/.test(docId)) {
      return res.status(400).json({ error: 'Invalid DOC-ID format' });
    }

    const doc = await getDocument(docId, chain);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // If hidden, show notice per spec
    if (doc.hidden) {
      return res.json({
        ...doc,
        content: null,
        notice: 'This document has been hidden from the search portal. ' +
                'The content is still accessible on the blockchain via the transaction hash(es). ' +
                'Hidden reason: ' + (doc.hidden_reason || 'Not specified'),
      });
    }

    // Get associated transactions
    const transactions = await getDocumentTransactions(docId, chain);
    const chainConfig = CHAINS[chain];

    res.json({
      ...doc,
      transactions: transactions.map(tx => ({
        tx_hash: tx.tx_hash,
        chunk: `${tx.chunk_current}/${tx.chunk_total}`,
        block_number: tx.block_number,
        explorer_url: `${chainConfig.explorer}/tx/${tx.tx_hash}`,
      })),
    });
  } catch (err) {
    console.error('[API] Document error:', err.message);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

/**
 * GET /api/document/:chain/:docId/transactions
 * Returns transaction list for a document (without full content).
 */
router.get('/document/:chain/:docId/transactions', async (req, res) => {
  try {
    const { chain, docId } = req.params;

    if (!CHAINS[chain]) {
      return res.status(400).json({ error: 'Invalid chain' });
    }

    const transactions = await getDocumentTransactions(docId, chain);
    const chainConfig = CHAINS[chain];

    res.json({
      doc_id: docId,
      chain,
      transactions: transactions.map(tx => ({
        tx_hash: tx.tx_hash,
        chunk: `${tx.chunk_current}/${tx.chunk_total}`,
        block_number: tx.block_number,
        from_address: tx.from_address,
        explorer_url: `${chainConfig.explorer}/tx/${tx.tx_hash}`,
      })),
    });
  } catch (err) {
    console.error('[API] Transactions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

/**
 * GET /api/stats
 * Returns indexer statistics.
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    console.error('[API] Stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
