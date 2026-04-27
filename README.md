# The Permanent Library

**Permanently store documents on public blockchains. No censorship. No deletion. No intermediaries.**

The Permanent Library lets anyone store research papers, documents, and knowledge directly on Ethereum, Polygon, and Arbitrum as raw transaction data. Once uploaded, the data cannot be deleted, censored, or modified by anyone — not governments, not corporations, not even the creator.

---

## Why This Exists

Scientists, researchers, and whistleblowers around the world face suppression, persecution, and worse for their discoveries. Critical research disappears when the people behind it are silenced. The Permanent Library ensures that knowledge can be made permanent before anything happens to those who create it.

This is a public good. No monetization. No company. No tracking. Fully open source under the MIT license. Anyone can deploy their own instance.

---

## How It Works

Documents are encoded in a format called **PERMLIB-V1** and sent as raw transaction data (calldata) to a provably unowned burn address on public blockchains. There are no smart contracts — zero code on-chain, zero attack surface. The transaction value is always 0 (only gas is paid).

### The Burn Address

```
0x734F6C30fcd31819c46E49B98C69D89978446fa6
```

This address is derived from `keccak256("The Permanent Library")` (last 20 bytes). It is provably unowned — finding its private key would require breaking elliptic curve cryptography. The same address works on all EVM-compatible chains.

### Supported Chains

| Chain | Currency | Purpose |
|---|---|---|
| Ethereum | ETH | Maximum permanence, highest cost |
| Polygon | POL | Affordable — fractions of a cent per document |
| Arbitrum | ETH | Mid-range cost, settles on Ethereum |

### What Makes It Unkillable

Even if every server hosting The Permanent Library goes offline, your documents survive. There are four independent ways to retrieve them:

1. **Share your transaction links** — save the transaction hashes at upload time and share them with anyone
2. **Use the standalone reader** — a single HTML file that fetches documents directly from the blockchain using only a browser and public RPC endpoints
3. **Browse block explorers manually** — go to the burn address on Etherscan, Polygonscan, or Arbiscan and read the transaction input data as UTF-8
4. **Rebuild the index from scratch** — anyone can scan the burn address, parse PERMLIB-V1 headers, and reconstruct the entire library

---

## Project Components

The Permanent Library consists of three independent components:

### 1. Frontend Uploader

A React application for composing and uploading documents to the blockchain.

- Connect any browser wallet (MetaMask, Trust Wallet, Coinbase Wallet, Brave Wallet, or any EIP-1193 compatible wallet)
- Select a chain (Ethereum, Polygon, or Arbitrum)
- Write documents in Markdown with embedded images
- Real-time gas cost estimation
- Automatic chunking for large documents with UTF-8 safe splitting
- Resume interrupted uploads without re-sending confirmed chunks
- Post-upload screen with all permanent links and DOC-ID

### 2. Standalone Reader

A single self-contained HTML file (64 KB) that can read any Permanent Library document with zero server dependencies. Open it in any browser — it fetches transaction data directly from public RPC endpoints.

- Paste one or more transaction hashes to read documents
- Supports chunked documents (paste all hashes, one per line)
- Markdown rendering with LaTeX support
- Multiple RPC endpoints per chain with automatic fallback
- Add your own custom RPC endpoint
- Works offline once loaded (only needs internet for RPC calls)

This is the survival file. Save it. Distribute it. It works as long as at least one blockchain RPC endpoint is accessible.

### 3. Indexer + Search Portal

A Node.js backend that continuously scans all three chains for PERMLIB-V1 transactions and provides a searchable web interface.

- Full-text search across all indexed documents
- Filter by chain, tags, or uploader address
- Automatic chunk assembly for multi-transaction documents
- Document download as self-contained HTML
- Image lightbox for embedded images
- REST API for programmatic access
- Moderation capability with transparency (hidden documents show a notice that content is still on-chain)

---

## Using the Hosted Instance

Visit [thepermanentlibrary.org](https://thepermanentlibrary.org) to upload documents. Visit [thepermanentlibrary.org/explore](https://thepermanentlibrary.org/explore) to search and browse the library.

You will need:
- A browser wallet (MetaMask or similar) with funds on your chosen chain
- ETH for Ethereum or Arbitrum, POL for Polygon
- Polygon is the cheapest option — uploading a short document costs fractions of a cent

---

## Self-Hosting Guide

Anyone can deploy their own instance of The Permanent Library. The more independent deployments exist, the more resilient the system becomes.

### Prerequisites

- **Node.js** v20.6.0 or later (required for the `--env-file` flag)
- **PostgreSQL** 14 or later
- **nginx** (recommended as reverse proxy)
- A domain name (optional but recommended)
- An Etherscan API key (free tier — register at [etherscan.io](https://etherscan.io/apis))

### Repository Structure

The repo contains two projects — the frontend uploader and the backend indexer. The frontend folder shares the repo name (both are called `the-permanent-library`) — just keep in mind that the inner one is the frontend.

```
the-permanent-library/               ← repo root
├── README.md
├── SECURITY.md
├── LICENSE
├── .gitignore
├── the-permanent-library/           ← frontend uploader (React + Vite)
│   ├── src/                         # Source code
│   ├── public/                      # reader.html, terms.html, static assets
│   ├── package.json
│   └── index.html                   # Vite entry point
└── indexer/                         ← backend indexer + search portal
    ├── src/                         # index.js, api.js, db.js, config.js, scanner.js, parser.js
    ├── public/                      # Search portal HTML + JS
    ├── sql/                         # PostgreSQL schema (auto-applied on start)
    ├── .env.example                 # Environment variables template
    └── package.json
```

The standalone reader (`reader.html`) is inside `the-permanent-library/public/`. When you build the frontend, it gets included in the `dist/` output and is accessible at `/reader.html` on your domain. You can also save it separately and use it offline — it works with just a browser and internet for RPC calls.

### Step 1 — Deploy the Frontend

The frontend is a static site. Build it and serve it with any web server.

```bash
cd the-permanent-library/the-permanent-library   # the frontend subfolder
npm install
npm run build
```

This produces a `dist/` folder. Serve it with nginx, Apache, Caddy, or any static file server.

### Step 2 — Set Up PostgreSQL

Create a database and user for the indexer:

```bash
sudo -u postgres psql -c "CREATE USER permlib WITH PASSWORD 'YOUR_STRONG_PASSWORD_HERE';"
sudo -u postgres psql -c "CREATE DATABASE permlib OWNER permlib;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE permlib TO permlib;"
```

Generate a strong password — use `openssl rand -base64 32` or a password manager. The database schema is applied automatically when the indexer starts.

### Step 3 — Configure the Indexer

```bash
cd indexer
npm install
cp .env.example .env
```

Edit `.env` with your settings:

```bash
DATABASE_URL=postgresql://permlib:YOUR_STRONG_PASSWORD_HERE@127.0.0.1:5432/permlib
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
ALLOWED_ORIGINS=https://yourdomain.com
```

The indexer includes hardcoded genesis block numbers so it automatically scans from the project's beginning — every document ever uploaded will be found. You can override these with `SCAN_START_ETHEREUM`, `SCAN_START_POLYGON`, and `SCAN_START_ARBITRUM` in `.env` if needed.

### Step 4 — Start the Indexer

```bash
node --env-file=.env src/index.js
```

The indexer listens on `127.0.0.1:3000` by default. Never expose it directly to the internet — put a reverse proxy in front of it.

For production, create a systemd service so it starts automatically and restarts on failure:

```ini
[Unit]
Description=The Permanent Library Indexer
After=network.target postgresql.service

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/indexer
ExecStart=/usr/bin/node --env-file=.env src/index.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true

[Install]
WantedBy=multi-user.target
```

### Step 5 — Configure nginx

Example nginx configuration. Adapt paths and domain to your setup:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    # Frontend (static files from Vite build)
    root /path/to/the-permanent-library/the-permanent-library/dist;
    index index.html;

    # Reject large request bodies (the site is read-only + static)
    client_max_body_size 1k;

    # Security headers (applied to all routes)
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # CSP for the uploader (needs unsafe-inline for MetaMask on Firefox)
    # connect-src includes public RPC endpoints for gas estimation
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://ethereum-rpc.publicnode.com https://polygon-bor-rpc.publicnode.com https://arbitrum-one-rpc.publicnode.com https://1rpc.io https://eth.llamarpc.com https://polygon.llamarpc.com https://arbitrum.llamarpc.com https://gasstation.polygon.technology; frame-ancestors 'none'" always;

    # Search portal and API — reverse proxy to indexer
    location /explore {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # nginx location blocks override server-level add_header — repeat security headers here
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

        # Strict CSP for search portal (renders user content — no unsafe-inline)
        add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'" always;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Serve indexer static assets (proxied to Node.js)
    location = /search.js {
        proxy_pass http://127.0.0.1:3000;
    }

    location = /marked.umd.js {
        proxy_pass http://127.0.0.1:3000;
    }

    # Frontend SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

For HTTPS, use Let's Encrypt (certbot), Cloudflare, or your preferred SSL provider.

**Production tip:** To avoid repeating security headers in every location block, extract them into an nginx snippet file and use `include /etc/nginx/snippets/your-headers.conf;` in each block. See the [nginx documentation](https://nginx.org/en/docs/) for details.

### Step 6 — Verify

1. Open your domain — the uploader should load
2. Visit `/explore` — the search portal should show indexed documents
3. Check the indexer logs — it should be scanning all three chains and finding transactions

---

## PERMLIB-V1 Encoding Format

Every document stored on-chain follows this exact format in the transaction input data:

```
[PERMLIB-V1]
[TITLE] Document title here
[TAGS] tag1, tag2, tag3
[CHUNK] 1/1
[DOC-ID] 0x + 64 lowercase hex characters
[CONTENT]
The document content in Markdown...
```

- Content is UTF-8 encoded (supports all languages including Chinese, Arabic, Russian, etc.)
- Content format is Markdown with LaTeX support (`$...$` inline, `$$...$$` display)
- Images are embedded as Base64 data URIs within the Markdown content
- Documents larger than ~80 KB are automatically split into chunks, each carrying the full header
- The DOC-ID ties all chunks of a document together
- The `[TAGS]` line is always present (even if empty)

This format is permanent. Once the first document was uploaded, the V1 format became locked. Future improvements will use new version headers (PERMLIB-V2, etc.).

The encoding logic is in `the-permanent-library/src/lib/permlib.js` and the parsing logic is in `indexer/src/parser.js` — both are fully commented and serve as the reference implementation.

---

## REST API

The indexer exposes a read-only API:

| Endpoint | Description |
|---|---|
| `GET /api/search?q=...&chain=...&tags=...&uploader=...&limit=...&offset=...` | Full-text search with filters |
| `GET /api/recent?limit=...&offset=...` | Recently indexed documents |
| `GET /api/document/:chain/:docId` | Full document with content and transaction list |
| `GET /api/document/:chain/:docId/transactions` | Transaction list only |
| `GET /api/stats` | Document counts per chain |

All endpoints are GET-only. CORS is configurable via the `ALLOWED_ORIGINS` environment variable.

---

## Tech Stack

### Frontend
- React 19
- ethers.js 6 (blockchain interaction)
- Vite (build tool)
- Tailwind CSS (styling)
- Zero third-party API keys required — wallet connection uses the browser's native EIP-1193 provider

### Indexer
- Express 5
- ethers.js 6
- PostgreSQL (via node-postgres)
- marked (Markdown rendering, served locally — no CDN dependency)
- Etherscan V2 API (transaction discovery)

### Standalone Reader
- Pure HTML + JavaScript
- marked.js embedded directly in the file (no external dependencies)
- Multiple public RPC endpoints per chain with automatic fallback

All components have **0 known vulnerabilities** (`npm audit` clean).

---

## Verifying the Burn Address

You don't have to trust anyone. The burn address is derived from `keccak256("The Permanent Library")` — take the last 20 bytes of the hash and apply EIP-55 checksum encoding. You can verify this independently using any keccak256 implementation in any programming language.

---

## Contributing

Contributions are welcome. If you find a bug or have an improvement, please open an issue or submit a pull request.

If you discover a security vulnerability, please do **not** open a public issue. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

---

*The Permanent Library — Because knowledge should outlive those who create it.*
