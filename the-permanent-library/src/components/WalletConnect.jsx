import { useState } from 'react';

export default function WalletConnect({ walletState, onConnect, onDisconnect }) {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await onConnect();
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  // Not connected
  if (!walletState.connected) {
    return (
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="px-8 py-3 bg-amber-glow text-vault-950 font-semibold rounded-lg
                     hover:bg-amber-bright transition-colors duration-200
                     disabled:opacity-50 disabled:cursor-not-allowed
                     text-base tracking-wide cursor-pointer"
        >
          {connecting ? 'Connecting…' : 'Connect Wallet'}
        </button>
        {error && (
          <p className="text-danger text-sm max-w-md text-center">{error}</p>
        )}
        <p className="text-vault-500 text-sm">
          MetaMask, Trust Wallet, Coinbase Wallet, or any browser wallet
        </p>
      </div>
    );
  }

  // Connected
  const shortAddr = `${walletState.address.slice(0, 6)}…${walletState.address.slice(-4)}`;

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 px-4 py-2 bg-vault-800 border border-vault-700 rounded-lg">
        <span className="w-2 h-2 bg-success rounded-full" />
        <span className="text-vault-200 text-sm font-mono">{shortAddr}</span>
      </div>
      <button
        onClick={onDisconnect}
        className="px-3 py-2 text-vault-500 hover:text-vault-300 text-sm transition-colors cursor-pointer"
      >
        Disconnect
      </button>
    </div>
  );
}
