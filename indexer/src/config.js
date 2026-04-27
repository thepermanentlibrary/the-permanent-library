/**
 * The Permanent Library — Indexer Configuration
 *
 * Chain config, burn address, and environment variables.
 * RPC endpoints and burn address MUST stay consistent with
 * Phase 2 frontend (src/config/chains.js) and Phase 3 reader.
 *
 * Scanner uses Etherscan V2 API for transaction discovery.
 * RPCs are kept as fallback for fetching individual transaction data
 * when the explorer API response is incomplete.
 */

import { getAddress } from 'ethers';

// Burn address — EIP-55 validated at load time
const BURN_ADDRESS_RAW = '0x734F6C30fcd31819c46E49B98C69D89978446fa6';
export const BURN_ADDRESS = getAddress(BURN_ADDRESS_RAW);

// Etherscan V2 API — unified endpoint for all chains
// Docs: https://docs.etherscan.io/v2-migration
// V1 endpoints (api.etherscan.io/api, api.polygonscan.com/api, api.arbiscan.io/api)
// were deprecated on August 15, 2025.
export const ETHERSCAN_API_URL = 'https://api.etherscan.io/v2/api';

// Chain configurations
// RPCs: ankr removed (requires API key as of early 2026).
// Remaining RPCs are used ONLY for fallback individual transaction fetches,
// NOT for block-by-block scanning. The scanner uses Etherscan V2 API.
export const CHAINS = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    rpcs: [
      'https://ethereum-rpc.publicnode.com',
      'https://1rpc.io/eth',
      'https://eth.llamarpc.com',
    ],
    explorer: 'https://etherscan.io',
    // Poll interval in ms — explorer API returns all txs since last block,
    // so polling can be much slower than block time
    pollInterval: 60000,
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    chainId: 137,
    rpcs: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://1rpc.io/matic',
      'https://polygon.llamarpc.com',
    ],
    explorer: 'https://polygonscan.com',
    pollInterval: 30000,
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    chainId: 42161,
    rpcs: [
      'https://arbitrum-one-rpc.publicnode.com',
      'https://1rpc.io/arb',
      'https://arbitrum.llamarpc.com',
    ],
    explorer: 'https://arbiscan.io',
    pollInterval: 30000,
  },
};

// Environment configuration with defaults
export const ENV = {
  // PostgreSQL
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://permlib:permlib@localhost:5432/permlib',

  // API server
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '127.0.0.1',

  // Etherscan V2 API key (required — register at https://etherscan.io/register)
  // One key works for all chains. Free tier: 5 calls/sec, 100K calls/day.
  // NEVER hardcode this in source. Only set via .env file.
  ETHERSCAN_API_KEY: process.env.ETHERSCAN_API_KEY || '',

  // Scanner: project genesis blocks per chain.
  // These are the blocks just before the first Permanent Library upload on each chain.
  // Every new indexer deployment starts here by default — guarantees all documents
  // ever uploaded to The Permanent Library are indexed, even 23 months from now.
  // Can be overridden in .env (set to 0 to skip history and start from current block).
  SCAN_START_ETHEREUM: parseInt(process.env.SCAN_START_ETHEREUM || '24935000', 10),
  SCAN_START_POLYGON: parseInt(process.env.SCAN_START_POLYGON || '85871000', 10),
  SCAN_START_ARBITRUM: parseInt(process.env.SCAN_START_ARBITRUM || '455175000', 10),

  // Maximum results per search query
  MAX_SEARCH_RESULTS: parseInt(process.env.MAX_SEARCH_RESULTS || '100', 10),
};
