# The Permanent Library — Indexer + Search Portal

Scans all three blockchains for Permanent Library uploads, indexes them in PostgreSQL, and serves a searchable web portal + REST API.

## Prerequisites

- Node.js 22+ (LTS)
- PostgreSQL 15+

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create PostgreSQL database
createdb permlib
# Or: psql -c "CREATE DATABASE permlib;"

# 3. Configure environment
cp .env.example .env
# Edit .env with your PostgreSQL credentials

# 4. Start the indexer
npm start
```

The indexer will:
1. Initialize the database schema automatically
2. Start scanning all three chains for PERMLIB-V1 transactions
3. Serve the search portal at http://127.0.0.1:3000
4. Serve the REST API at http://127.0.0.1:3000/api/

## Tech Stack

| Dependency | Version | Purpose |
|---|---|---|
| Node.js | 22+ LTS | Runtime |
| Express | 5.2.1 | REST API |
| ethers.js | 6.16.0 | Blockchain interaction |
| pg | 8.20.0 | PostgreSQL client |

All dependencies audited — **0 vulnerabilities**.

## REST API

All endpoints return JSON. Read-only — no authentication required.

### GET /api/search

Search documents by text, chain, tags, or uploader.

| Param | Type | Description |
|---|---|---|
| q | string | Full-text search query |
| chain | string | Filter: ethereum, polygon, arbitrum |
| tags | string | Comma-separated tag filter |
| uploader | string | Filter by wallet address |
| limit | number | Max results (default 50, max 100) |
| offset | number | Pagination offset |

### GET /api/recent

Recent documents across all chains.

| Param | Type | Description |
|---|---|---|
| limit | number | Max results (default 20) |

### GET /api/document/:chain/:docId

Full document with content and transaction list.

### GET /api/document/:chain/:docId/transactions

Transaction list for a document (without content).

### GET /api/stats

Index statistics (document counts per chain).

## Project Structure

```
indexer/
├── package.json
├── .env.example
├── sql/
│   └── schema.sql        # PostgreSQL schema (auto-applied on start)
├── src/
│   ├── index.js           # Entry point
│   ├── config.js          # Chains, burn address, env vars
│   ├── db.js              # PostgreSQL pool + queries
│   ├── parser.js          # PERMLIB-V1 parser
│   ├── scanner.js         # Chain scanner (polls for new blocks)
│   └── api.js             # REST API routes
└── public/
    └── index.html         # Search portal web page
```

## Security

- The indexer has NO write access to the blockchain
- All API endpoints are read-only
- API server binds to 127.0.0.1 by default (use a reverse proxy for public access)
- Security headers: X-Content-Type-Options, X-Frame-Options, Referrer-Policy
- CORS allows GET requests only

## Burn Address

```
0x734F6C30fcd31819c46E49B98C69D89978446fa6
```

Same address on all three chains. EIP-55 checksum validated at startup.
