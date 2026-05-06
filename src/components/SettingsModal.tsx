import React, { useState, useEffect } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

interface KeyConfig {
  storageKey: string;
  label: string;
  placeholder: string;
  hint: string;
  required: boolean;
  helpUrl?: string;
}

const KEYS: KeyConfig[] = [
  {
    storageKey: 'FAL_KEY',
    label: 'fal.ai API Key',
    placeholder: 'fal-...',
    hint: 'Para Minimax (TTS) e upload de áudio.',
    required: true,
    helpUrl: 'https://fal.ai/dashboard/keys',
  },
  {
    storageKey: 'GOOGLE_API_KEY',
    label: 'Google AI Studio API Key',
    placeholder: 'AIza...',
    hint: 'Para importação de roteiro com IA (Gemini).',
    required: false,
    helpUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    storageKey: 'HEYGEN_API_KEY',
    label: 'HeyGen API Key',
    placeholder: '...',
    hint: 'Para gerar clipes de avatar (Avatar 4).',
    required: true,
    helpUrl: 'https://app.heygen.com/settings?nav=api',
  },
];

export const SettingsModal: React.FC<Props> = ({ isOpen, onClose, onSave }) => {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) return;
    const next: Record<string, string> = {};
    for (const k of KEYS) {
      next[k.storageKey] = localStorage.getItem(k.storageKey) ?? '';
    }
    setValues(next);
  }, [isOpen]);

  if (!isOpen) return null;

  const canSave = KEYS.filter(k => k.required).every(k => values[k.storageKey]?.trim().length > 0);

  const handleSave = () => {
    for (const k of KEYS) {
      const v = values[k.storageKey]?.trim();
      if (v) localStorage.setItem(k.storageKey, v);
      else localStorage.removeItem(k.storageKey);
    }
    onSave();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
      <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-md w-full overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 pt-6 pb-4">
          <div className="text-base font-semibold text-zinc-100 mb-1">Configurações</div>
          <div className="text-xs text-zinc-500">Suas chaves ficam salvas localmente — nunca saem do app.</div>
        </div>

        <div className="px-6 pb-2 flex-1 overflow-y-auto space-y-4">
          {KEYS.map(k => (
            <div key={k.storageKey}>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold flex items-center gap-1.5">
                {k.label}
                {k.required && <span className="text-red-400">*</span>}
                {k.helpUrl && (
                  <a
                    href={k.helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-[9px] text-violet-300 hover:text-violet-200"
                  >
                    pegar →
                  </a>
                )}
              </label>
              <input
                type="password"
                value={values[k.storageKey] ?? ''}
                onChange={e => setValues(v => ({ ...v, [k.storageKey]: e.target.value }))}
                placeholder={k.placeholder}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 outline-none focus:border-violet-400/50 transition-colors font-mono"
              />
              <div className="mt-1 text-[10px] text-zinc-600">{k.hint}</div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-white/5 bg-black/30 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};
