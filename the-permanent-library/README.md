# The Permanent Library — Frontend

Store knowledge on the blockchain. Forever. Unstoppable.

## Quick Start

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

## Project Structure

```
src/
├── main.jsx                    # React entry point
├── App.jsx                     # Main app — orchestrates full user flow
├── index.css                   # Tailwind CSS + custom theme
├── config/
│   └── chains.js               # Chain configs, burn address, gas constants
├── lib/
│   ├── permlib.js              # PERMLIB-V1 encoding (format spec implementation)
│   ├── chunking.js             # UTF-8 safe document chunking
│   ├── wallet.js               # Wallet connection (EIP-1193 / window.ethereum)
│   └── gas.js                  # Gas estimation and cost display
└── components/
    ├── WalletConnect.jsx       # Wallet connection button and status
    ├── ChainSelector.jsx       # Ethereum / Polygon / Arbitrum selector
    ├── DocumentEditor.jsx      # Title, tags, content editor with byte counter
    ├── CostEstimate.jsx        # Real-time gas cost estimation
    ├── UploadProgress.jsx      # Chunk-by-chunk upload progress
    └── UploadComplete.jsx      # Post-upload permanent links display
```

## Tech Stack

| Dependency | Version | Purpose |
|---|---|---|
| React | 19.2.5 | UI framework |
| ethers.js | 6.16.0 | Blockchain interaction, wallet connection, keccak256 |
| Vite | 8.0.9 | Build tool |
| Tailwind CSS | 4.2.4 | Styling |

All dependencies audited — **0 vulnerabilities**.

## Deployment

The production build (`npm run build`) outputs a static site to `dist/`.
Deploy to any static hosting:

```bash
# Build
npm run build

# The dist/ folder contains:
#   index.html
#   assets/index-*.css
#   assets/index-*.js
#
# Upload these files to any web server, VPS, or static host.
```

No backend required. No API keys required. The frontend connects directly
to the user's browser wallet and public blockchain RPCs.

## Architecture

- **No smart contracts.** Documents are stored as raw transaction calldata.
- **No backend.** The frontend is fully static.
- **No API keys.** Wallet connection uses EIP-1193 (window.ethereum).
  Gas prices fetched from public RPCs.
- **No third-party storage.** Data lives directly on-chain.

## Burn Address

```
0x734F6C30fcd31819c46E49B98C69D89978446fa6
```

Derived from `keccak256("The Permanent Library")` → last 20 bytes.
Same address on Ethereum, Polygon, and Arbitrum.
EIP-55 checksum validated at application load time.

## Supported Wallets

Any EIP-1193 compatible browser wallet:
- MetaMask
- Trust Wallet (browser extension)
- Coinbase Wallet
- Brave Wallet
- Any injected provider

## License

Public domain. This is a public good.
