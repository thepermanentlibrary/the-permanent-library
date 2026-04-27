/**
 * The Permanent Library — Gas Estimation Module
 *
 * Estimates the gas cost for uploading a document to each chain.
 * Uses EIP-2028 calldata gas costs and real-time gas price fetching.
 *
 * Per master doc § Gas Estimation:
 *   - Real-time gas price fetching from each chain
 *   - Cost calculated based on actual byte size of the encoded document
 *   - Displayed in both native token and USD equivalent
 *
 * Gas calculation for calldata:
 *   - 21000 base transaction gas
 *   - 16 gas per non-zero byte of calldata
 *   - 4 gas per zero byte of calldata
 */

import { JsonRpcProvider, formatEther } from 'ethers';
import {
  CHAINS,
  BASE_TX_GAS,
  GAS_PER_NONZERO_BYTE,
  GAS_PER_ZERO_BYTE,
} from '../config/chains.js';
import { toCalldata, utf8ByteLength } from './permlib.js';

/**
 * Estimate the total gas needed for a given calldata hex string.
 *
 * @param {string} calldataHex — The 0x-prefixed hex calldata
 * @returns {bigint} — Estimated gas units
 */
export function estimateGasForCalldata(calldataHex) {
  // Strip 0x prefix, then process hex pairs (each pair = 1 byte)
  const hex = calldataHex.startsWith('0x') ? calldataHex.slice(2) : calldataHex;
  let gas = BASE_TX_GAS;

  for (let i = 0; i < hex.length; i += 2) {
    const byteVal = parseInt(hex.substring(i, i + 2), 16);
    gas += byteVal === 0 ? GAS_PER_ZERO_BYTE : GAS_PER_NONZERO_BYTE;
  }

  return gas;
}

/**
 * Estimate gas for a given content size (in bytes) without computing full calldata.
 * Used for quick UI previews. Assumes worst case (all non-zero bytes).
 *
 * @param {number} totalBytes — Total byte size of the encoded document
 * @returns {bigint} — Estimated gas units (worst case)
 */
export function estimateGasQuick(totalBytes) {
  return BASE_TX_GAS + BigInt(totalBytes) * GAS_PER_NONZERO_BYTE;
}

/**
 * Fetch the current gas price from a chain's public RPC.
 * Tries multiple RPC endpoints with fallback.
 *
 * @param {object} chainConfig — Chain config object from CHAINS
 * @returns {Promise<{ gasPrice: bigint, maxFeePerGas: bigint|null }>}
 */
export async function fetchGasPrice(chainConfig) {
  const errors = [];

  for (const rpcUrl of chainConfig.rpcUrls) {
    try {
      const provider = new JsonRpcProvider(rpcUrl, undefined, {
        staticNetwork: true,
      });

      const feeData = await provider.getFeeData();

      // EIP-1559 chains return maxFeePerGas; legacy chains return gasPrice
      const effectiveGasPrice = feeData.maxFeePerGas || feeData.gasPrice;

      if (!effectiveGasPrice) {
        throw new Error('No gas price data returned');
      }

      return {
        gasPrice: feeData.gasPrice,
        maxFeePerGas: feeData.maxFeePerGas,
        effectiveGasPrice,
      };
    } catch (err) {
      errors.push(`${rpcUrl}: ${err.message}`);
      continue; // try next RPC
    }
  }

  throw new Error(
    `Failed to fetch gas price from all RPCs for ${chainConfig.name}: ${errors.join('; ')}`
  );
}

/**
 * Estimate the full cost of uploading a document to a specific chain.
 *
 * @param {number} totalBytes — Total calldata byte size
 * @param {object} chainConfig — Chain config from CHAINS
 * @returns {Promise<{ gasUnits: bigint, costWei: bigint, costNative: string, symbol: string }>}
 */
export async function estimateCost(totalBytes, chainConfig) {
  const gasUnits = estimateGasQuick(totalBytes);
  const { effectiveGasPrice } = await fetchGasPrice(chainConfig);

  const costWei = gasUnits * effectiveGasPrice;
  const costNative = formatEther(costWei);

  return {
    gasUnits,
    costWei,
    costNative,
    symbol: chainConfig.currency.symbol,
  };
}

/**
 * Estimate cost across all three chains for a given byte size.
 * Returns results for each chain, with errors handled gracefully.
 *
 * @param {number} totalBytes — Total calldata byte size
 * @returns {Promise<Object>} — { ethereum: { ... }, polygon: { ... }, arbitrum: { ... } }
 */
export async function estimateCostAllChains(totalBytes) {
  const results = {};

  const promises = Object.entries(CHAINS).map(async ([key, chain]) => {
    try {
      results[key] = await estimateCost(totalBytes, chain);
      results[key].error = null;
    } catch (err) {
      results[key] = {
        gasUnits: estimateGasQuick(totalBytes),
        costWei: 0n,
        costNative: '?',
        symbol: chain.currency.symbol,
        error: err.message,
      };
    }
  });

  await Promise.allSettled(promises);
  return results;
}

/**
 * Format a native token cost for display.
 * Shows appropriate precision based on the value.
 *
 * @param {string} costNative — The cost in native token units (from formatEther)
 * @param {string} symbol — The token symbol (ETH, POL)
 * @returns {string} — Formatted string like "0.0023 ETH" or "< 0.0001 POL"
 */
export function formatCostDisplay(costNative, symbol) {
  if (costNative === '?') return `? ${symbol}`;

  const num = parseFloat(costNative);
  if (num === 0) return `0 ${symbol}`;
  if (num < 0.0001) return `< 0.0001 ${symbol}`;
  if (num < 0.01) return `${num.toFixed(6)} ${symbol}`;
  if (num < 1) return `${num.toFixed(4)} ${symbol}`;
  return `${num.toFixed(3)} ${symbol}`;
}
