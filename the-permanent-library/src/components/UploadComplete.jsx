import { useState } from 'react';
import { getTxExplorerUrl, CHAINS } from '../config/chains.js';

export default function UploadComplete({ docId, transactions, chainKey, onNewUpload }) {
  const [copied, setCopied] = useState(false);
  const chain = CHAINS[chainKey];

  // Build the full text to copy — all links + DOC-ID
  const allLinksText = [
    `Document: ${transactions[0]?.title || 'Untitled'}`,
    `Chain: ${chain.name}`,
    `Document ID: ${docId}`,
    `Transactions (${transactions.length}):`,
    ...transactions.map((tx, i) =>
      `  ${i + 1}. ${getTxExplorerUrl(chain, tx.hash)}`
    ),
    '',
    'These links are permanent. They work as long as the blockchain exists.',
    'The Permanent Library — https://thepermanentlibrary.org',
  ].join('\n');

  const handleCopyAll = async () => {
    try {
      await navigator.clipboard.writeText(allLinksText);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = allLinksText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  return (
    <div className="flex flex-col gap-6 px-6 py-6 bg-vault-800 border border-vault-700 rounded-xl">
      {/* Header */}
      <div className="flex flex-col gap-2 text-center">
        <span className="text-success text-4xl">✓</span>
        <h2 className="font-display text-2xl text-vault-100">
          Permanently Recorded
        </h2>
        <p className="text-vault-400 text-sm">
          on {chain.name}
        </p>
      </div>

      {/* Critical warning */}
      <div className="px-4 py-3 bg-amber-glow/10 border border-amber-dim/30 rounded-lg">
        <p className="text-amber-bright text-sm font-medium text-center">
          Save these links now. They are your permanent proof.
        </p>
        <p className="text-amber-dim text-xs text-center mt-1">
          Even if this website disappears, these links will work forever
          as long as the blockchain exists.
        </p>
      </div>

      {/* Document ID */}
      <div className="flex flex-col gap-1">
        <span className="text-vault-400 text-xs font-medium">Document ID</span>
        <code className="text-vault-200 text-xs font-mono bg-vault-900 px-3 py-2 rounded break-all">
          {docId}
        </code>
      </div>

      {/* Transaction links */}
      <div className="flex flex-col gap-2">
        <span className="text-vault-400 text-xs font-medium">
          Permanent Links ({transactions.length} transaction{transactions.length > 1 ? 's' : ''})
        </span>
        <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
          {transactions.map((tx, index) => (
            <a
              key={tx.hash}
              href={getTxExplorerUrl(chain, tx.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-vault-900 rounded-lg
                         hover:bg-vault-700 transition-colors group"
            >
              <span className="text-vault-500 text-xs w-6 shrink-0">
                #{index + 1}
              </span>
              <span className="text-amber-glow text-xs font-mono truncate group-hover:text-amber-bright transition-colors">
                {tx.hash}
              </span>
              <span className="text-vault-500 text-xs shrink-0 ml-auto">↗</span>
            </a>
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleCopyAll}
          className="flex-1 px-4 py-3 bg-amber-glow text-vault-950 font-semibold rounded-lg
                     hover:bg-amber-bright transition-colors cursor-pointer text-sm"
        >
          {copied ? '✓ Copied!' : 'Copy All Links'}
        </button>
        <button
          onClick={onNewUpload}
          className="px-4 py-3 border border-vault-600 text-vault-300 rounded-lg
                     hover:border-vault-400 hover:text-vault-100 transition-colors
                     cursor-pointer text-sm"
        >
          New Upload
        </button>
      </div>

      {/* How to verify */}
      <div className="text-vault-500 text-xs leading-relaxed border-t border-vault-700 pt-4">
        <p className="font-medium text-vault-400 mb-1">How to verify your upload:</p>
        <p>
          Click any transaction link above. On the explorer page, find the "Input Data" section
          and click "View Input As" → "UTF-8". Your full document is right there — readable by
          anyone, forever.
        </p>
      </div>
    </div>
  );
}
