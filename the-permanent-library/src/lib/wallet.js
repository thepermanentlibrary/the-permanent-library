/**
 * The Permanent Library — Wallet Connection Module
 *
 * Uses ethers.js v6 BrowserProvider with the EIP-1193 injected provider
 * (window.ethereum) for wallet connections. Supports MetaMask, Trust Wallet,
 * Coinbase Wallet, Brave Wallet, and any EIP-1193 compatible browser wallet.
 *
 * No third-party API keys required. No WalletConnect project ID needed.
 * The wallet connection is a convenience layer — the blockchain data
 * persists regardless of how the wallet connected.
 *
 * Per PERMLIB-V1 spec § Transaction Structure:
 *   - to: burn address (EIP-55 validated)
 *   - value: 0 (MUST be enforced)
 *   - data: hex-encoded PERMLIB-V1 calldata
 */

import { BrowserProvider } from 'ethers';
import { BURN_ADDRESS, CHAINS, getChainByDecimalId } from '../config/chains.js';

/**
 * Check if a browser wallet (EIP-1193 provider) is available.
 * @returns {boolean}
 */
export function isWalletAvailable() {
  return typeof window !== 'undefined' && window.ethereum != null;
}

/**
 * Connect to the user's browser wallet.
 * Requests account access and returns the provider, signer, address, and chain.
 *
 * @returns {Promise<{ provider, signer, address: string, chain: object|null }>}
 * @throws {Error} if wallet is not installed or user rejects connection
 */
export async function connectWallet() {
  if (!isWalletAvailable()) {
    throw new Error(
      'No browser wallet detected. Please install MetaMask, Trust Wallet, or another EIP-1193 compatible wallet.'
    );
  }

  const provider = new BrowserProvider(window.ethereum);

  // Request account access — triggers the wallet's permission popup
  const accounts = await provider.send('eth_requestAccounts', []);
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned. Please unlock your wallet and try again.');
  }

  const signer = await provider.getSigner();
  const address = await signer.getAddress();

  // Detect current chain
  const network = await provider.getNetwork();
  const chain = getChainByDecimalId(network.chainId);

  return { provider, signer, address, chain };
}

/**
 * Switch the wallet to a specific chain.
 * If the chain is not configured in the wallet, attempt to add it.
 *
 * @param {object} targetChain — A chain config object from CHAINS
 * @returns {Promise<void>}
 * @throws {Error} if switching fails
 */
export async function switchChain(targetChain) {
  if (!isWalletAvailable()) {
    throw new Error('No browser wallet detected.');
  }

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetChain.chainIdHex }],
    });
  } catch (error) {
    // Error code 4902: chain not added to wallet yet
    if (error.code === 4902 && targetChain.addChainParams) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [targetChain.addChainParams],
      });
    } else {
      throw error;
    }
  }
}

/**
 * Send a PERMLIB-V1 transaction to the burn address.
 *
 * Per PERMLIB-V1 spec § Transaction Structure:
 *   - to: burn address (EIP-55 validated at module load time)
 *   - value: 0 (enforced — never send native currency to the burn address)
 *   - data: hex-encoded calldata
 *
 * @param {object} signer — ethers.js Signer from BrowserProvider
 * @param {string} calldata — Hex-encoded PERMLIB-V1 calldata (0x-prefixed)
 * @returns {Promise<{ hash: string, wait: Function }>} — The transaction response
 */
export async function sendPermlibTransaction(signer, calldata) {
  const tx = await signer.sendTransaction({
    to: BURN_ADDRESS,
    value: 0n, // MUST be zero — per spec, any value sent is permanently lost
    data: calldata,
  });

  return tx;
}

/**
 * Listen for account and chain change events from the wallet.
 * Returns a cleanup function to remove listeners.
 *
 * @param {Function} onAccountChange — Called with new accounts array
 * @param {Function} onChainChange — Called with new chainId (hex string)
 * @returns {Function} — Call this to remove all listeners
 */
export function listenForWalletEvents(onAccountChange, onChainChange) {
  if (!isWalletAvailable()) return () => {};

  const handleAccountsChanged = (accounts) => {
    onAccountChange(accounts);
  };

  const handleChainChanged = (chainIdHex) => {
    onChainChange(chainIdHex);
  };

  window.ethereum.on('accountsChanged', handleAccountsChanged);
  window.ethereum.on('chainChanged', handleChainChanged);

  return () => {
    window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
    window.ethereum.removeListener('chainChanged', handleChainChanged);
  };
}
