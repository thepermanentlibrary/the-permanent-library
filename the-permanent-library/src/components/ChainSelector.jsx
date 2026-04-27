import { CHAINS } from '../config/chains.js';

const CHAIN_ORDER = ['ethereum', 'arbitrum', 'polygon'];

export default function ChainSelector({ selectedChain, onSelect, disabled }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-vault-400 text-sm font-medium">Select Blockchain</label>
      <div className="grid grid-cols-3 gap-3">
        {CHAIN_ORDER.map((key) => {
          const chain = CHAINS[key];
          const isSelected = selectedChain === key;

          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              disabled={disabled}
              className={`
                flex flex-col items-start gap-1 px-4 py-3 rounded-lg border transition-all duration-200
                cursor-pointer disabled:cursor-not-allowed disabled:opacity-50
                ${isSelected
                  ? 'border-amber-glow bg-amber-glow/10 text-amber-bright'
                  : 'border-vault-700 bg-vault-800 text-vault-300 hover:border-vault-500'
                }
              `}
            >
              <span className="font-semibold text-sm">{chain.name}</span>
              <span className={`text-xs ${isSelected ? 'text-amber-dim' : 'text-vault-500'}`}>
                {chain.securityLevel}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-vault-500 text-xs mt-1">
        {CHAINS[selectedChain]?.description}
      </p>
    </div>
  );
}
