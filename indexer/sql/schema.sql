-- The Permanent Library — Indexer Database Schema
--
-- Tables:
--   documents     — Assembled documents (one row per DOC-ID per chain)
--   transactions  — Individual on-chain transactions (one per tx hash)
--   scan_state    — Tracks last scanned block per chain
--
-- Moderation is handled via the 'hidden' and 'hidden_reason' columns
-- on the documents table. Per spec: hidden content is still on-chain.

-- Documents table: stores assembled document metadata and content
CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  doc_id        VARCHAR(66) NOT NULL,       -- 0x + 64 hex chars
  chain         VARCHAR(20) NOT NULL,       -- ethereum, polygon, arbitrum
  title         TEXT NOT NULL,
  tags          TEXT[] DEFAULT '{}',         -- Array of tag strings
  content       TEXT NOT NULL,              -- Full reassembled content
  uploader      VARCHAR(42) NOT NULL,       -- Wallet address (0x + 40 hex)
  total_chunks  INTEGER NOT NULL DEFAULT 1,
  found_chunks  INTEGER NOT NULL DEFAULT 1,
  is_complete   BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  block_number  BIGINT NOT NULL,            -- Block of first chunk
  hidden        BOOLEAN NOT NULL DEFAULT FALSE,
  hidden_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(doc_id, chain)
);

-- Transactions table: individual on-chain transactions
CREATE TABLE IF NOT EXISTS transactions (
  id            SERIAL PRIMARY KEY,
  tx_hash       VARCHAR(66) NOT NULL,       -- 0x + 64 hex chars
  chain         VARCHAR(20) NOT NULL,
  block_number  BIGINT NOT NULL,
  from_address  VARCHAR(42) NOT NULL,
  doc_id        VARCHAR(66) NOT NULL,
  chunk_current INTEGER NOT NULL,
  chunk_total   INTEGER NOT NULL,
  title         TEXT NOT NULL,
  tags          TEXT[] DEFAULT '{}',
  content       TEXT NOT NULL,              -- Content of THIS chunk only
  raw_input     TEXT,                       -- Raw hex input data (for debugging)
  indexed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tx_hash, chain)
);

-- Scan state: tracks progress per chain
CREATE TABLE IF NOT EXISTS scan_state (
  chain           VARCHAR(20) PRIMARY KEY,
  last_block      BIGINT NOT NULL DEFAULT 0,
  last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Initialize scan state for all chains
INSERT INTO scan_state (chain, last_block) VALUES
  ('ethereum', 0),
  ('polygon', 0),
  ('arbitrum', 0)
ON CONFLICT (chain) DO NOTHING;

-- Indexes for search performance
CREATE INDEX IF NOT EXISTS idx_documents_chain ON documents(chain);
CREATE INDEX IF NOT EXISTS idx_documents_title ON documents USING gin(to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_documents_tags ON documents USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_documents_uploader ON documents(uploader);
CREATE INDEX IF NOT EXISTS idx_documents_first_seen ON documents(first_seen DESC);
CREATE INDEX IF NOT EXISTS idx_documents_hidden ON documents(hidden);
CREATE INDEX IF NOT EXISTS idx_documents_doc_id ON documents(doc_id);
CREATE INDEX IF NOT EXISTS idx_transactions_doc_id ON transactions(doc_id, chain);
CREATE INDEX IF NOT EXISTS idx_transactions_chain_block ON transactions(chain, block_number);

-- Image support columns (added for PERMLIB_V1_IMAGE_SPEC)
-- content_text: content with Base64 data URIs stripped (for search + preview)
-- has_images: quick filter for documents with embedded images
-- image_count: number of embedded images
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_text TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS has_images BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS image_count INTEGER NOT NULL DEFAULT 0;

-- Full-text search index on stripped content (avoids indexing Base64 gibberish)
CREATE INDEX IF NOT EXISTS idx_documents_content_text
  ON documents USING gin(to_tsvector('english', COALESCE(content_text, '')));

-- On-chain timestamp for transactions (actual block time, not indexer processing time)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ;
