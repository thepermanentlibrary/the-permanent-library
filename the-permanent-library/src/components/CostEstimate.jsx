import { useState, useEffect, useRef } from 'react';
import { formatEther } from 'ethers';
import { CHAINS } from '../config/chains.js';
import { estimateCost, formatCostDisplay, estimateGasQuick } from '../lib/gas.js';
import { utf8ByteLength } from '../lib/permlib.js';
import { estimateChunkCount } from '../lib/chunking.js';

export default function CostEstimate({ title, tags, content, selectedChain }) {
  const [costData, setCostData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  // Compute byte size and chunk count for display
  const contentBytes = content ? utf8ByteLength(content) : 0;
  const totalChunks = (title && content)
    ? estimateChunkCount(title, tags || '', content)
    : 1;

  // Rough total bytes (content + headers per chunk)
  const headerOverhead = totalChunks > 0 ? totalChunks * 250 : 250;
  const totalBytes = contentBytes + headerOverhead;

  useEffect(() => {
    if (!content || !title || !selectedChain) {
      setCostData(null);
      return;
    }

    // Debounce gas price fetches — wait 800ms after user stops typing
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const chain = CHAINS[selectedChain];
        const result = await estimateCost(totalBytes, chain);

        // For multi-chunk uploads, multiply cost
        if (totalChunks > 1) {
          const perChunkCost = result.costWei;
          const totalCost = perChunkCost * BigInt(totalChunks);
          setCostData({
            ...result,
            costWei: totalCost,
            costNative: formatEther(totalCost),
            chunks: totalChunks,
          });
        } else {
          setCostData({ ...result, chunks: 1 });
        }
      } catch (err) {
        setError('Could not fetch gas price');
        // Show a static estimate based on gas units only
        const gasUnits = estimateGasQuick(totalBytes);
        setCostData({
          gasUnits: gasUnits * BigInt(Math.max(1, totalChunks)),
          costNative: '?',
          symbol: CHAINS[selectedChain].currency.symbol,
          chunks: totalChunks,
          error: err.message,
        });
      } finally {
        setLoading(false);
      }
    }, 800);

    return () => clearTimeout(debounceRef.current);
  }, [content, title, tags, selectedChain, totalBytes, totalChunks]);

  if (!content || !title) return null;

  const chain = CHAINS[selectedChain];

  return (
    <div className="flex flex-col gap-2 px-4 py-3 bg-vault-800 border border-vault-700 rounded-lg">
      <div className="flex justify-between items-center">
        <span className="text-vault-400 text-sm">Estimated Cost</span>
        {loading && (
          <span className="text-amber-dim text-xs animate-pulse-amber">Fetching gas price…</span>
        )}
      </div>

      {costData && (
        <div className="flex flex-col gap-1">
          <span className="text-amber-bright text-lg font-semibold font-mono">
            {formatCostDisplay(costData.costNative, costData.symbol)}
          </span>
          {costData.chunks > 1 && (
            <span className="text-vault-500 text-xs">
              {costData.chunks} transactions × ~{formatCostDisplay(
                costData.costWei && costData.chunks > 0
                  ? (Number(costData.costNative) / costData.chunks).toFixed(8)
                  : '?',
                costData.symbol
              )} each
            </span>
          )}
          {costData.error && (
            <span className="text-vault-500 text-xs">
              Gas price unavailable — cost shown after wallet confirmation
            </span>
          )}
        </div>
      )}

      {error && !costData && (
        <span className="text-vault-500 text-sm">{error}</span>
      )}
    </div>
  );
}
