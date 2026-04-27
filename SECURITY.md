# Security Policy

## Security Model

The Permanent Library is designed with a layered security model:

**The blockchain layer is immutable by design.** Documents are stored as raw transaction calldata sent to a provably unowned burn address. There are no smart contracts, no admin functions, no upgrade mechanisms, and no owner keys. There is nothing to hack on-chain — the data is simply bytes in confirmed transactions on public blockchains.

**The convenience layer (frontend, indexer, search portal) is designed to be replaceable.** If every server, domain, and deployment of The Permanent Library disappeared, all documents would remain permanently accessible on-chain through block explorers, the standalone reader, or anyone rebuilding the index from scratch.

**The indexer is a read-only observer.** It scans publicly available blockchain data and stores it in a local database for searchability. It never holds private keys, never signs transactions, and never writes to any blockchain.

**The frontend never touches your private keys.** All transaction signing happens inside your browser wallet (MetaMask, etc.). The frontend constructs the transaction data and asks your wallet to sign and broadcast it. Your keys never leave your wallet.

## Reporting a Vulnerability

If you discover a security vulnerability in any component of The Permanent Library, please report it responsibly.

**Email:** [librarian@thepermanentlibrary.org](mailto:librarian@thepermanentlibrary.org)

Please include:

- A description of the vulnerability
- Steps to reproduce it
- The component affected (frontend, indexer, search portal, standalone reader)
- The potential impact as you understand it

We will acknowledge your report within 48 hours and provide a more detailed response within 7 days indicating next steps.

**Please do not open a public GitHub issue for security vulnerabilities.** Public disclosure before a fix is available puts all deployments at risk.

## Scope

### In Scope

- Cross-site scripting (XSS) in the search portal, standalone reader, or frontend
- Injection vulnerabilities in the indexer API (SQL injection, command injection)
- Content Security Policy bypasses that could lead to code execution
- Denial of service vulnerabilities in the indexer that could be triggered by crafted on-chain data
- Vulnerabilities in the image sanitization logic (allowing non-data-URI image sources)
- Dependencies with known CVEs that affect our usage

### Out of Scope

The following are intentional design decisions, not vulnerabilities:

- **Anyone can upload anything to the burn address.** This is by design. The blockchain is permissionless. The indexer has moderation capability to hide content from search results, but the data remains on-chain. This is a feature, not a bug.
- **Documents cannot be deleted from the blockchain.** This is the entire purpose of the project. Once data is in a confirmed transaction, it is permanent.
- **The burn address has no private key.** It is derived from a deterministic hash. This is intentional and verifiable.
- **The frontend allows `unsafe-inline` in its Content Security Policy.** This is required for MetaMask compatibility on Firefox (Mozilla bug 1267027). The search portal at `/explore` uses strict CSP without `unsafe-inline`. This is a deliberate architectural decision documented in the codebase.
- **Gas cost for uploads.** Users pay blockchain gas fees to store data. This is inherent to how public blockchains work.
- **Rate limiting responses (HTTP 429).** The indexer rate-limits API requests to prevent abuse. This is intentional.

## Security Practices

The project follows these security practices across all components:

- **Zero known vulnerabilities** — `npm audit` is run before every release and must return clean
- **No third-party CDN dependencies** — all JavaScript libraries are served locally (marked.js is bundled, not loaded from a CDN)
- **Content Security Policy** — strict CSP headers on the search portal to prevent XSS from user-uploaded content
- **Security headers** — HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy no-referrer, and Permissions-Policy on all responses
- **Image sanitization** — only `data:image/jpeg` and `data:image/png` Base64 URIs are allowed in rendered documents; all external URLs, `javascript:` URIs, and other schemes are blocked
- **HTML escaping** — all user-generated content is HTML-escaped before Markdown rendering to prevent XSS
- **API input validation** — query parameters are validated and clamped to safe ranges
- **Localhost binding** — the indexer binds to `127.0.0.1` only; public access must go through a reverse proxy
- **No sensitive data in source code** — API keys and database credentials are loaded from environment variables via `.env` files, which are excluded from the repository

## Deployment Security Recommendations

If you are running your own instance:

- **Never expose Node.js or PostgreSQL directly to the internet.** Use nginx or another reverse proxy in front of the indexer. Bind the indexer to `127.0.0.1` only.
- **Use strong database passwords.** Generate with `openssl rand -base64 32` or a password manager.
- **Set `ALLOWED_ORIGINS` in production.** Restrict CORS to your domain only.
- **Keep dependencies updated.** Run `npm audit` regularly and update packages when security patches are available.
- **Use HTTPS.** Configure SSL via Let's Encrypt, Cloudflare, or your preferred provider.
- **Restrict firewall access.** Only ports 22 (SSH), 80 (HTTP), and 443 (HTTPS) should be open to the internet.
- **Set `.env` file permissions to 600.** Only the owner should be able to read the environment file.
- **Do not run the indexer as root.** Create a dedicated user with minimal privileges.
- **If using Docker, bind all ports to `127.0.0.1`** except the reverse proxy on ports 80/443. Bare `PORT:PORT` bindings in Docker bypass firewall rules.

## Dependency Versions

The project pins specific dependency versions that have been verified against current CVE databases. Before updating any dependency, check for known vulnerabilities in the new version.

Current dependencies (at time of initial release):

**Frontend:** React 19, ethers.js 6, Vite, Tailwind CSS

**Indexer:** Express 5, ethers.js 6, node-postgres (pg), marked

All dependencies have 0 known vulnerabilities as of the initial release.

---

*The Permanent Library — Because knowledge should outlive those who create it.*
