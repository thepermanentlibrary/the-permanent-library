/**
 * The Permanent Library — Chain Scanner
 *
 * Monitors the burn address on all three chains for new transactions.
 * For each new transaction:
 *   1. Discovers transactions via Etherscan V2 API (txlist endpoint)
 *   2. Parses the input data as PERMLIB-V1
 *   3. Falls back to RPC if explorer input data is missing/truncated
 *   4. Stores in PostgreSQL
 *   5. Assembles chunked documents
 *
 * Architecture change (2026):
 *   Old: Block-by-block RPC scanning (getBlock for every block).
 *        Failed on Arbitrum (~4 blocks/sec) — couldn't keep up, rate-limited all RPCs.
 *   New: Etherscan V2 API returns all transactions to the burn address in one call.
 *        RPCs are only used as fallback for individual tx data fetch.
 *
 * Uses Node.js v24 native fetch() — no additional dependencies.
 */

import { JsonRpcProvider, Network } from 'ethers';
import { CHAINS, BURN_ADDRESS, ETHERSCAN_API_URL, ENV } from './config.js';
import { hexToUtf8, parsePermlibV1 } from './parser.js';
import {
  getLastBlock,
  setLastBlock,
  insertTransaction,
  assembleDocument,
} from './db.js';

// ============================================================================
// RPC Provider Cache (for fallback only)
// ============================================================================

/**
 * Provider cache — created once per RPC URL, reused for all calls.
 * Providers are created with explicit Network objects so ethers.js
 * never makes eth_chainId calls to detect the network.
 */
const providerCache = new Map();

function getProvider(rpc, chainId) {
  if (!providerCache.has(rpc)) {
    const network = Network.from(chainId);
    const provider = new JsonRpcProvider(rpc, network, {
      staticNetwork: network,
      batchMaxCount: 1,
    });
    providerCache.set(rpc, provider);
  }
  return providerCache.get(rpc);
}

/**
 * Try an RPC call with fallback across all endpoints for a chain.
 */
async function withFallback(chain, fn) {
  const errors = [];
  for (const rpc of chain.rpcs) {
    try {
      const provider = getProvider(rpc, chain.chainId);
      return await fn(provider);
    } catch (err) {
      errors.push(`${rpc}: ${err.message}`);
    }
  }
  throw new Error(`All RPCs failed for ${chain.name}: ${errors.join('; ')}`);
}

// ============================================================================
// Etherscan V2 API — Transaction Discovery
// ============================================================================

/**
 * Fetch transactions to the burn address from Etherscan V2 API.
 *
 * Uses the unified V2 endpoint with chainid parameter.
 * Returns an array of transaction objects or an empty array.
 * Throws on rate limit or API errors.
 *
 * @param {object} chain — Chain config from CHAINS
 * @param {number} startBlock — First block to include (inclusive)
 * @param {number} [page=1] — Page number for pagination
 * @returns {Array} Transaction objects from Etherscan
 */
async function fetchExplorerPage(chain, startBlock, page = 1) {
  const params = new URLSearchParams({
    chainid: String(chain.chainId),
    module: 'account',
    action: 'txlist',
    address: BURN_ADDRESS,
    startblock: String(startBlock),
    endblock: '999999999',
    page: String(page),
    offset: '10000',
    sort: 'asc',
    apikey: ENV.ETHERSCAN_API_KEY,
  });

  const url = `${ETHERSCAN_API_URL}?${params.toString()}`;

  // 30-second timeout to prevent indefinite hangs
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Explorer API HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Etherscan returns status "0" for both errors and "no results"
  if (data.status === '0') {
    // "No transactions found" is normal — not an error
    if (data.message === 'No transactions found') {
      return [];
    }
    // Actual error (rate limit, invalid key, etc.)
    throw new Error(`Explorer API: ${data.message} — ${data.result}`);
  }

  return data.result || [];
}

/**
 * Fetch ALL transactions to the burn address since startBlock.
 * Handles pagination if results exceed 10,000 per page.
 *
 * @param {object} chain — Chain config
 * @param {number} startBlock — First block to include
 * @returns {Array} All transaction objects
 */
async function fetchAllExplorerTransactions(chain, startBlock) {
  const allTransactions = [];
  let page = 1;
  const MAX_PAGES = 10; // Safety limit: 100,000 transactions max per poll

  while (page <= MAX_PAGES) {
    const batch = await fetchExplorerPage(chain, startBlock, page);
    allTransactions.push(...batch);

    // If we got fewer than 10,000 results, we've reached the end
    if (batch.length < 10000) break;

    // More pages exist — continue pagination
    page++;
    console.log(
      `[Scanner:${chain.id}] Pagination: fetching page ${page} (${allTransactions.length} txs so far)`
    );
  }

  if (page > MAX_PAGES) {
    console.warn(
      `[Scanner:${chain.id}] Hit pagination safety limit (${MAX_PAGES} pages). ` +
      `Some transactions may be deferred to the next poll cycle.`
    );
  }

  return allTransactions;
}

// ============================================================================
// Transaction Processing
// ============================================================================

/**
 * Fetch full transaction input data via RPC.
 * Used as fallback when explorer API data is missing or truncated.
 *
 * @param {object} chain — Chain config
 * @param {string} txHash — Transaction hash
 * @returns {string} Input data hex string
 */
async function fetchInputViaRPC(chain, txHash) {
  return withFallback(chain, async (provider) => {
    const tx = await provider.getTransaction(txHash);
    if (!tx || !tx.data || tx.data === '0x') {
      throw new Error('Transaction has no input data');
    }
    return tx.data;
  });
}

/**
 * Process a single transaction from explorer API results.
 * Parses PERMLIB-V1 format and stores in database.
 *
 * @param {object} chain — Chain config
 * @param {object} explorerTx — Transaction object from Etherscan API
 * @returns {boolean} True if a document was indexed
 */
async function processTransaction(chain, explorerTx) {
  // Only process successful transactions
  if (explorerTx.isError === '1' || explorerTx.txreceipt_status === '0') {
    return false;
  }

  // Verify destination is the burn address (API filters this, but verify)
  if (
    !explorerTx.to ||
    explorerTx.to.toLowerCase() !== BURN_ADDRESS.toLowerCase()
  ) {
    return false;
  }

  // Must have input data
  const inputData = explorerTx.input;
  if (!inputData || inputData === '0x' || inputData.length < 10) {
    return false;
  }

  const txHash = explorerTx.hash;
  const blockNumber = parseInt(explorerTx.blockNumber, 10);
  const fromAddress = explorerTx.from.toLowerCase();

  // Convert Etherscan Unix timestamp to ISO date
  const blockTimestamp = explorerTx.timeStamp
    ? new Date(parseInt(explorerTx.timeStamp, 10) * 1000).toISOString()
    : null;

  // Try parsing the explorer-provided input data first
  try {
    const utf8 = hexToUtf8(inputData);
    const parsed = parsePermlibV1(utf8);

    // Not a PERMLIB-V1 transaction — skip silently.
    // But if the data starts with [PERMLIB-, it's likely truncated.
    // In that case, throw to trigger RPC fallback.
    if (!parsed) {
      if (utf8.startsWith('[PERMLIB-')) {
        throw new Error('PERMLIB header detected but parse failed — possible truncation');
      }
      return false;
    }

    await insertTransaction({
      txHash,
      chain: chain.id,
      blockNumber,
      fromAddress,
      blockTimestamp,
      docId: parsed.docId,
      chunkCurrent: parsed.chunkCurrent,
      chunkTotal: parsed.chunkTotal,
      title: parsed.title,
      tags: parsed.tags,
      content: parsed.content,
      rawInput: inputData,
    });

    await assembleDocument(parsed.docId, chain.id);

    console.log(
      `[Scanner:${chain.id}] Indexed tx ${txHash.substring(0, 14)}… ` +
      `chunk ${parsed.chunkCurrent}/${parsed.chunkTotal} ` +
      `"${parsed.title.substring(0, 40)}"`
    );

    return true;
  } catch (explorerParseErr) {
    // Explorer input data might be truncated for large documents.
    // Fall back to fetching the full transaction via RPC.
    console.log(
      `[Scanner:${chain.id}] Explorer data parse failed for ${txHash.substring(0, 14)}…, ` +
      `trying RPC fallback: ${explorerParseErr.message}`
    );
  }

  // RPC fallback — fetch full input data directly from blockchain
  try {
    const rpcInput = await fetchInputViaRPC(chain, txHash);
    const utf8 = hexToUtf8(rpcInput);
    const parsed = parsePermlibV1(utf8);

    if (!parsed) return false;

    await insertTransaction({
      txHash,
      chain: chain.id,
      blockNumber,
      fromAddress,
      blockTimestamp,
      docId: parsed.docId,
      chunkCurrent: parsed.chunkCurrent,
      chunkTotal: parsed.chunkTotal,
      title: parsed.title,
      tags: parsed.tags,
      content: parsed.content,
      rawInput: rpcInput,
    });

    await assembleDocument(parsed.docId, chain.id);

    console.log(
      `[Scanner:${chain.id}] Indexed tx ${txHash.substring(0, 14)}… (via RPC fallback) ` +
      `chunk ${parsed.chunkCurrent}/${parsed.chunkTotal} ` +
      `"${parsed.title.substring(0, 40)}"`
    );

    return true;
  } catch (rpcErr) {
    console.warn(
      `[Scanner:${chain.id}] Failed to process tx ${txHash}: ${rpcErr.message}`
    );
    return false;
  }
}

// ============================================================================
// Scanner Loop
// ============================================================================

/**
 * Per-chain backoff state for rate limit handling.
 * Tracks consecutive failures to implement exponential backoff.
 */
const backoffState = new Map();

function getBackoff(chainId) {
  if (!backoffState.has(chainId)) {
    backoffState.set(chainId, { failures: 0, nextRetryAt: 0 });
  }
  return backoffState.get(chainId);
}

function recordFailure(chainId) {
  const state = getBackoff(chainId);
  state.failures = Math.min(state.failures + 1, 8); // Cap at 2^8 = 256x multiplier
  const delayMs = Math.min(1000 * Math.pow(2, state.failures), 300000); // Cap at 5 minutes
  state.nextRetryAt = Date.now() + delayMs;
  return delayMs;
}

function recordSuccess(chainId) {
  const state = getBackoff(chainId);
  state.failures = 0;
  state.nextRetryAt = 0;
}

function shouldSkip(chainId) {
  const state = getBackoff(chainId);
  return Date.now() < state.nextRetryAt;
}

/**
 * Start the continuous scanner for a single chain.
 * Polls Etherscan V2 API for new transactions to the burn address.
 */
export async function startChainScanner(chain) {
  // Validate API key at startup
  if (!ENV.ETHERSCAN_API_KEY) {
    console.error(
      `[Scanner:${chain.id}] ETHERSCAN_API_KEY is not set. ` +
      `Scanner cannot start. Set it in your .env file.`
    );
    return () => {};
  }

  console.log(
    `[Scanner:${chain.id}] Starting scanner (poll every ${chain.pollInterval / 1000}s)`
  );

  const scanLoop = async () => {
    // Check backoff
    if (shouldSkip(chain.id)) {
      return;
    }

    try {
      // Get last scanned block from database
      const lastBlock = await getLastBlock(chain.id);

      // Determine start block:
      // - If we have progress in DB, continue from there
      // - If DB is at 0, use the configured SCAN_START env var
      // - If SCAN_START is also 0, get current block from RPC (skip history)
      let startBlock;
      if (lastBlock > 0) {
        startBlock = lastBlock + 1;
      } else {
        const scanStartKey = 'SCAN_START_' + chain.id.toUpperCase();
        const configuredStart = ENV[scanStartKey] || 0;
        if (configuredStart > 0) {
          startBlock = configuredStart;
        } else {
          // No configured start — get current block and start from there
          const currentBlock = await withFallback(chain, (p) =>
            p.getBlockNumber()
          );
          startBlock = currentBlock;
          console.log(
            `[Scanner:${chain.id}] No scan start configured, starting from current block ${currentBlock}`
          );
        }
      }

      // Fetch all transactions since startBlock via explorer API
      const transactions = await fetchAllExplorerTransactions(chain, startBlock);

      if (transactions.length === 0) {
        // No transactions found — nothing to do.
        // If lastBlock was 0 (first run), save startBlock so we don't
        // re-enter the "determine start block" path every poll.
        if (lastBlock === 0) {
          await setLastBlock(chain.id, startBlock);
        }
        recordSuccess(chain.id);
        return;
      }

      // Process each transaction
      let indexed = 0;
      let highestBlock = startBlock;

      for (const tx of transactions) {
        const blockNum = parseInt(tx.blockNumber, 10);
        if (blockNum > highestBlock) {
          highestBlock = blockNum;
        }

        const wasIndexed = await processTransaction(chain, tx);
        if (wasIndexed) indexed++;
      }

      // Update scan state to highest block seen
      await setLastBlock(chain.id, highestBlock);

      if (indexed > 0) {
        console.log(
          `[Scanner:${chain.id}] Poll complete: ${indexed} document(s) indexed ` +
          `from ${transactions.length} transaction(s), up to block ${highestBlock}`
        );
      }

      recordSuccess(chain.id);
    } catch (err) {
      const delayMs = recordFailure(chain.id);
      console.error(
        `[Scanner:${chain.id}] Scan error (backoff ${Math.round(delayMs / 1000)}s): ${err.message}`
      );
    }
  };

  // Initial scan
  await scanLoop();

  // Continuous polling
  const interval = setInterval(scanLoop, chain.pollInterval);

  return () => clearInterval(interval);
}

/**
 * Start scanners for all chains.
 * Returns a cleanup function to stop all scanners.
 */
export async function startAllScanners() {
  // Validate API key once before starting any scanner
  if (!ENV.ETHERSCAN_API_KEY) {
    console.error(
      '[Scanner] FATAL: ETHERSCAN_API_KEY is not set in .env file. ' +
      'Register at https://etherscan.io/register to get a free API key. ' +
      'Scanners will not start.'
    );
    return () => {};
  }

  const cleanups = [];
  for (const [key, chain] of Object.entries(CHAINS)) {
    const cleanup = await startChainScanner(chain);
    cleanups.push(cleanup);
  }
  console.log('[Scanner] All chain scanners started (Etherscan V2 API mode)');
  return () => cleanups.forEach((fn) => fn());
}
