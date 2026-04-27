export default function UploadProgress({
  currentChunk,
  totalChunks,
  status, // 'preparing' | 'waiting-signature' | 'sending' | 'confirming' | 'error'
  errorMessage,
  confirmedChunks = 0,
}) {
  const progress = totalChunks > 0 ? (currentChunk - 1) / totalChunks : 0;
  const progressPercent = Math.round(progress * 100);

  const statusMessages = {
    'preparing': 'Preparing document…',
    'waiting-signature': `Sign transaction ${currentChunk} of ${totalChunks} in your wallet`,
    'sending': `Sending transaction ${currentChunk} of ${totalChunks}…`,
    'confirming': `Confirming transaction ${currentChunk} of ${totalChunks}…`,
    'error': errorMessage || 'An error occurred',
  };

  return (
    <div className="flex flex-col gap-4 px-6 py-5 bg-vault-800 border border-vault-700 rounded-xl">
      <div className="flex justify-between items-center">
        <span className="text-vault-200 font-medium">
          {status === 'error' ? 'Upload Error' : 'Uploading to Blockchain'}
        </span>
        <span className="text-vault-400 text-sm font-mono">
          {confirmedChunks}/{totalChunks}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-vault-900 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            status === 'error' ? 'bg-danger' : 'bg-amber-glow'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Status message */}
      <p className={`text-sm ${status === 'error' ? 'text-danger' : 'text-vault-400'}`}>
        {statusMessages[status] || status}
      </p>

      {status === 'waiting-signature' && (
        <p className="text-vault-500 text-xs">
          Check your wallet for a transaction confirmation popup.
          Do not close this page until all transactions are confirmed.
        </p>
      )}

      {status === 'error' && (
        <p className="text-vault-500 text-xs">
          {confirmedChunks > 0
            ? `${confirmedChunks} of ${totalChunks} chunks confirmed on-chain. Click "Resume Upload" to continue from chunk ${confirmedChunks + 1}.`
            : 'No chunks were sent yet. Click "Resume Upload" to try again, or go back to the editor.'
          }
        </p>
      )}
    </div>
  );
}
