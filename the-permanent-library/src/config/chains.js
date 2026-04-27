/**
 * The Permanent Library — Chain Configuration
 *
 * Burn address: 0x734F6C30fcd31819c46E49B98C69D89978446fa6
 * Derivation: keccak256("The Permanent Library") → last 20 bytes
 * Verified with: PyCryptodome, Web3.py, eth-hash (triple-verified)
 *
 * CRITICAL: The EIP-55 checksum of the burn address MUST be validated
 * before any transaction is sent. See PERMLIB_V1_SPEC.md § Address Validation.
 *
 * RPC note: ankr removed — requires API key as of early 2026.
 */

import { getAddress } from 'ethers';

// The burn address — same on all chains (EVM addresses are chain-agnostic)
const BURN_ADDRESS_RAW = '0x734F6C30fcd31819c46E49B98C69D89978446fa6';

// Validate EIP-55 checksum at module load time.
// If this throws, the address has been corrupted — refuse to operate.
export const BURN_ADDRESS = getAddress(BURN_ADDRESS_RAW);

// Conservative safe calldata limit per transaction (in bytes).
// Per PERMLIB-V1 spec: 80 KB across all chains. Actual limits depend
// on block gas limits and gas pricing. We go conservative.
export const SAFE_CALLDATA_LIMIT = 80 * 1024; // 81920 bytes

// Gas cost per byte of calldata (EIP-2028):
// 16 gas per non-zero byte, 4 gas per zero byte.
// We use 16 as the worst-case for estimation.
export const GAS_PER_NONZERO_BYTE = 16n;
export const GAS_PER_ZERO_BYTE = 4n;
// Base transaction gas (21000 for a simple transaction)
export const BASE_TX_GAS = 21000n;

export const CHAINS = {
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    chainIdHex: '0x1',
    chainIdDecimal: 1,
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [
      'https://ethereum-rpc.publicnode.com',
      'https://1rpc.io/eth',
      'https://eth.llamarpc.com',
    ],
    explorerUrl: 'https://etherscan.io',
    explorerTxPath: '/tx/',
    explorerAddressPath: '/address/',
    securityLevel: 'Maximum',
    description: 'Most decentralized. Most expensive. Maximum permanence.',
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    chainIdHex: '0x89',
    chainIdDecimal: 137,
    currency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://1rpc.io/matic',
      'https://polygon.llamarpc.com',
    ],
    explorerUrl: 'https://polygonscan.com',
    explorerTxPath: '/tx/',
    explorerAddressPath: '/address/',
    securityLevel: 'Good',
    description: 'Affordable uploads. Fractions of a cent.',
    // Parameters for wallet_addEthereumChain (when user doesn't have Polygon configured)
    addChainParams: {
      chainId: '0x89',
      chainName: 'Polygon Mainnet',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: ['https://polygon-bor-rpc.publicnode.com'],
      blockExplorerUrls: ['https://polygonscan.com'],
    },
  },
  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    chainIdHex: '0xa4b1',
    chainIdDecimal: 42161,
    currency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [
      'https://arbitrum-one-rpc.publicnode.com',
      'https://1rpc.io/arb',
      'https://arbitrum.llamarpc.com',
    ],
    explorerUrl: 'https://arbiscan.io',
    explorerTxPath: '/tx/',
    explorerAddressPath: '/address/',
    securityLevel: 'High',
    description: 'Low cost. Settles on Ethereum.',
    addChainParams: {
      chainId: '0xa4b1',
      chainName: 'Arbitrum One',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://arbitrum-one-rpc.publicnode.com'],
      blockExplorerUrls: ['https://arbiscan.io'],
    },
  },
};

/**
 * Get chain config by decimal chain ID (returned by wallet).
 * Returns null if the chain is not supported.
 */
export function getChainByDecimalId(decimalId) {
  const id = Number(decimalId);
  for (const chain of Object.values(CHAINS)) {
    if (chain.chainIdDecimal === id) return chain;
  }
  return null;
}

/**
 * Build the full explorer URL for a transaction hash on a given chain.
 */
export function getTxExplorerUrl(chain, txHash) {
  return `${chain.explorerUrl}${chain.explorerTxPath}${txHash}`;
}
