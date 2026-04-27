import { useState, useEffect, useCallback, useRef } from 'react';
import { CHAINS, getChainByDecimalId, BURN_ADDRESS } from './config/chains.js';
import {
  isWalletAvailable,
  connectWallet,
  switchChain,
  sendPermlibTransaction,
  listenForWalletEvents,
} from './lib/wallet.js';
import { prepareDocument } from './lib/chunking.js';
import WalletConnect from './components/WalletConnect.jsx';
import ChainSelector from './components/ChainSelector.jsx';
import DocumentEditor from './components/DocumentEditor.jsx';
import CostEstimate from './components/CostEstimate.jsx';
import UploadProgress from './components/UploadProgress.jsx';
import UploadComplete from './components/UploadComplete.jsx';

const INITIAL_WALLET_STATE = {
  connected: false,
  provider: null,
  signer: null,
  address: null,
  chain: null,
};

export default function App() {
  // Wallet state
  const [walletState, setWalletState] = useState(INITIAL_WALLET_STATE);

  // Document state
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [content, setContent] = useState('');

  // Chain selection
  const [selectedChain, setSelectedChain] = useState('polygon');

  // Upload state
  const [uploadPhase, setUploadPhase] = useState('editing');
  // 'editing' | 'uploading' | 'complete'

  const [uploadProgress, setUploadProgress] = useState({
    currentChunk: 1,
    totalChunks: 1,
    status: 'preparing',
    errorMessage: null,
  });

  const [uploadResult, setUploadResult] = useState(null);
  // { docId, transactions: [{ hash, title }] }

  const [burnCopied, setBurnCopied] = useState(false);

  // Resume tracking — refs for use inside async upload loop,
  // state for display in UploadProgress
  const confirmedChunksRef = useRef(0);
  const completedTxsRef = useRef([]);
  const uploadNonceRef = useRef(null);

  // --- Wallet connection ---
  const handleConnect = useCallback(async () => {
    const result = await connectWallet();
    setWalletState({
      connected: true,
      provider: result.provider,
      signer: result.signer,
      address: result.address,
      chain: result.chain,
    });

    // If wallet is on a supported chain, select it
    if (result.chain) {
      setSelectedChain(result.chain.id);
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    setWalletState(INITIAL_WALLET_STATE);
  }, []);

  // Listen for wallet events (account change, chain change)
  useEffect(() => {
    if (!walletState.connected) return;

    const cleanup = listenForWalletEvents(
      (accounts) => {
        if (!accounts || accounts.length === 0) {
          handleDisconnect();
        } else {
          // Re-connect to get new signer for new account
          handleConnect().catch(() => handleDisconnect());
        }
      },
      (_chainIdHex) => {
        // Chain changed — re-connect to get updated provider/signer
        handleConnect().catch(() => handleDisconnect());
      }
    );

    return cleanup;
  }, [walletState.connected, handleConnect, handleDisconnect]);

  // --- Chain switching ---
  const handleChainSelect = useCallback(async (chainKey) => {
    setSelectedChain(chainKey);

    if (walletState.connected) {
      const targetChain = CHAINS[chainKey];
      try {
        await switchChain(targetChain);
      } catch (err) {
        // User rejected chain switch — just keep the selection
        // They can still switch manually in their wallet
        console.warn('Chain switch rejected:', err.message);
      }
    }
  }, [walletState.connected]);

  // --- Upload logic ---
  const canUpload = walletState.connected
    && title.trim().length > 0
    && content.trim().length > 0
    && uploadPhase === 'editing';

  const handleUpload = useCallback(async () => {
    if (!canUpload) return;

    // Fresh upload — reset tracking
    confirmedChunksRef.current = 0;
    completedTxsRef.current = [];
    uploadNonceRef.current = crypto.randomUUID();

    await performUpload(0);
  }, [canUpload, selectedChain, title, tags, content, walletState]);

  const handleResume = useCallback(async () => {
    await performUpload(confirmedChunksRef.current);
  }, [selectedChain, title, tags, content, walletState]);

  // Core upload logic — starts from startFrom index (0 for fresh, N for resume)
  const performUpload = async (startFrom) => {
    setUploadPhase('uploading');
    setUploadProgress({
      currentChunk: startFrom + 1,
      totalChunks: startFrom + 1,
      status: 'preparing',
      errorMessage: null,
    });

    try {
      // Ensure wallet is on the correct chain
      const targetChain = CHAINS[selectedChain];
      try {
        await switchChain(targetChain);
      } catch {
        // If switch fails, check if already on right chain
        const network = await walletState.provider.getNetwork();
        if (Number(network.chainId) !== targetChain.chainIdDecimal) {
          throw new Error(
            `Please switch your wallet to ${targetChain.name} (Chain ID: ${targetChain.chainIdDecimal})`
          );
        }
      }

      // Re-get signer after potential chain switch
      const signer = await walletState.provider.getSigner();
      const address = await signer.getAddress();

      // Prepare document (deterministic — same input + nonce always produces same output)
      setUploadProgress(prev => ({ ...prev, status: 'preparing' }));
      const { docId, chunks } = prepareDocument({
        title: title.trim(),
        tags: tags.trim(),
        content,
        senderAddress: address,
        nonce: uploadNonceRef.current,
      });

      setUploadProgress(prev => ({
        ...prev,
        totalChunks: chunks.length,
      }));

      // Send chunks starting from startFrom
      for (let i = startFrom; i < chunks.length; i++) {
        const chunk = chunks[i];

        setUploadProgress({
          currentChunk: i + 1,
          totalChunks: chunks.length,
          status: 'waiting-signature',
          errorMessage: null,
        });

        // Send transaction — user signs in wallet
        const txResponse = await sendPermlibTransaction(signer, chunk.calldata);

        setUploadProgress(prev => ({ ...prev, status: 'confirming' }));

        // Wait for transaction to be mined (1 confirmation)
        const receipt = await txResponse.wait(1);

        // Track confirmed chunk in ref (survives re-renders) and state (for display)
        confirmedChunksRef.current = i + 1;
        completedTxsRef.current = [...completedTxsRef.current, {
          hash: receipt.hash,
          title: title.trim(),
          blockNumber: receipt.blockNumber,
        }];
      }

      // All chunks sent successfully
      setUploadResult({
        docId,
        transactions: completedTxsRef.current,
      });
      setUploadPhase('complete');

    } catch (err) {
      console.error('Upload error:', err);

      // Detect user rejection
      const isUserReject = err.code === 4001
        || err.code === 'ACTION_REJECTED'
        || err.message?.includes('user rejected')
        || err.message?.includes('User denied');

      setUploadProgress(prev => ({
        ...prev,
        status: 'error',
        errorMessage: isUserReject
          ? 'Transaction rejected in wallet. You can retry when ready.'
          : err.message || 'An unexpected error occurred.',
      }));
    }
  };

  const handleRetry = useCallback(() => {
    setUploadPhase('editing');
    setUploadProgress({
      currentChunk: 1,
      totalChunks: 1,
      status: 'preparing',
      errorMessage: null,
    });
    confirmedChunksRef.current = 0;
    completedTxsRef.current = [];
    uploadNonceRef.current = null;
  }, []);

  const handleNewUpload = useCallback(() => {
    setTitle('');
    setTags('');
    setContent('');
    setUploadPhase('editing');
    setUploadResult(null);
    setUploadProgress({
      currentChunk: 1,
      totalChunks: 1,
      status: 'preparing',
      errorMessage: null,
    });
    confirmedChunksRef.current = 0;
    completedTxsRef.current = [];
    uploadNonceRef.current = null;
  }, []);

  const handleCopyBurnAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(BURN_ADDRESS);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = BURN_ADDRESS;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setBurnCopied(true);
    setTimeout(() => setBurnCopied(false), 2000);
  }, []);

  // --- Render ---
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-vault-800 header-accent">
        <div className="max-w-4xl mx-auto px-8 py-6 flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl text-vault-100 leading-tight tracking-wide font-normal">
              The Permanent Library
            </h1>
            <p className="text-vault-500 text-sm mt-1 italic">
              Store knowledge on the blockchain. Forever.
            </p>
            <a
              href="/explore"
              className="text-amber-dim text-xs mt-2 inline-block hover:text-amber-glow transition-colors"
              style={{ textDecoration: 'none' }}
            >
              Explore the archive →
            </a>
          </div>
          {walletState.connected && (
            <WalletConnect
              walletState={walletState}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-8 py-10">
        {/* Landing / connect wallet */}
        {!walletState.connected && (
          <div className="flex flex-col items-center justify-center gap-10 py-20">
            <div className="text-center max-w-lg">
              <h2 className="font-display text-4xl text-vault-100 mb-5 leading-tight font-normal">
                Knowledge should outlive<br />those who create it.
              </h2>
              <p className="text-vault-400 leading-relaxed text-base">
                Upload research papers, documents, and knowledge permanently
                to the blockchain. No one can delete, censor, or modify it.
                Not governments. Not corporations. Not even us.
              </p>
            </div>
            <WalletConnect
              walletState={walletState}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
            <a
              href="/explore"
              className="text-amber-dim text-sm hover:text-amber-glow transition-colors"
              style={{ textDecoration: 'none' }}
            >
              Or explore what's already been preserved →
            </a>
            <div className="text-vault-600 text-xs text-center max-w-sm leading-relaxed">
              <p>
                Burn address:{' '}
                <button
                  onClick={handleCopyBurnAddress}
                  className="text-vault-500 font-mono cursor-pointer hover:text-amber-glow transition-colors"
                  title="Click to copy full address"
                >
                  {burnCopied ? '✓ Copied!' : `${BURN_ADDRESS.slice(0, 10)}…${BURN_ADDRESS.slice(-8)}`}
                </button>
              </p>
              <p className="mt-1.5">
                No smart contracts. Raw transaction data.
              </p>
            </div>
          </div>
        )}

        {/* Upload complete */}
        {uploadPhase === 'complete' && uploadResult && (
          <UploadComplete
            docId={uploadResult.docId}
            transactions={uploadResult.transactions}
            chainKey={selectedChain}
            onNewUpload={handleNewUpload}
          />
        )}

        {/* Upload in progress */}
        {uploadPhase === 'uploading' && (
          <div className="flex flex-col gap-4">
            <UploadProgress
              currentChunk={uploadProgress.currentChunk}
              totalChunks={uploadProgress.totalChunks}
              status={uploadProgress.status}
              errorMessage={uploadProgress.errorMessage}
              confirmedChunks={confirmedChunksRef.current}
            />
            {uploadProgress.status === 'error' && (
              <div className="flex gap-3">
                <button
                  onClick={handleResume}
                  className="px-6 py-3 bg-amber-glow text-vault-950 font-semibold rounded-lg
                             hover:bg-amber-bright transition-colors cursor-pointer text-sm"
                >
                  Resume Upload
                </button>
                <button
                  onClick={handleRetry}
                  className="px-6 py-3 bg-vault-700 text-vault-200 rounded-lg
                             hover:bg-vault-600 transition-colors cursor-pointer text-sm"
                >
                  ← Back to Editor
                </button>
              </div>
            )}
          </div>
        )}

        {/* Document editor */}
        {walletState.connected && uploadPhase === 'editing' && (
          <div className="flex flex-col gap-6">
            <ChainSelector
              selectedChain={selectedChain}
              onSelect={handleChainSelect}
              disabled={false}
            />

            <DocumentEditor
              title={title}
              onTitleChange={setTitle}
              tags={tags}
              onTagsChange={setTags}
              content={content}
              onContentChange={setContent}
              disabled={false}
            />

            <CostEstimate
              title={title}
              tags={tags}
              content={content}
              selectedChain={selectedChain}
            />

            <button
              onClick={handleUpload}
              disabled={!canUpload}
              className="w-full px-6 py-4 bg-amber-glow text-vault-950 font-semibold rounded-lg
                         hover:bg-amber-bright transition-colors text-base tracking-wide
                         disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Upload to {CHAINS[selectedChain]?.name || 'Blockchain'}
            </button>

            <p className="text-vault-600 text-xs text-center leading-relaxed">
              Your document will be permanently and immutably stored on{' '}
              {CHAINS[selectedChain]?.name}. This action cannot be undone.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-vault-800 mt-auto">
        <div className="max-w-4xl mx-auto px-8 py-5 flex items-center justify-between text-vault-600 text-xs">
          <div className="flex items-center gap-3">
            <span>The Permanent Library — Open Source Public Good</span>
            <span>·</span>
            <a
              href="/terms.html"
              className="text-vault-600 hover:text-amber-dim transition-colors"
              style={{ textDecoration: 'none' }}
            >
              Terms
            </a>
          </div>
          <button
            onClick={handleCopyBurnAddress}
            className="font-mono text-vault-700 cursor-pointer hover:text-amber-dim transition-colors"
            title="Click to copy burn address"
          >
            {burnCopied ? '✓ Copied!' : `${BURN_ADDRESS.slice(0, 10)}…${BURN_ADDRESS.slice(-4)}`}
          </button>
        </div>
      </footer>
    </div>
  );
}
