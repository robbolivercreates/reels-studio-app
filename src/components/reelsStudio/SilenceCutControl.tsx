import React from 'react';
import type { SilencePreset } from './types';

interface Props {
  enabled: boolean;
  preset: SilencePreset;
  detecting: boolean;
  /** True while the worker is re-encoding the cut MP3. */
  applying?: boolean;
  detectedSilenceSec: number;
  effectiveDuration: number;
  rawDuration: number;
  onToggle: (on: boolean) => void;
  onPresetChange: (preset: SilencePreset) => void;
  disabled?: boolean;
}

const PRESETS: { id: SilencePreset; label: string; emoji: string; hint: string }[] = [
  { id: 'natural', label: 'Natural',     emoji: '🌿', hint: 'pausas > 0.8s'  },
  { id: 'fast',    label: 'Rápido',      emoji: '⚡', hint: 'pausas > 0.4s'  },
  { id: 'super',   label: 'Super',       emoji: '🚀', hint: 'pausas > 0.2s'  },
];

const formatSec = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = (s % 60);
  return `${m}:${String(Math.floor(sec)).padStart(2, '0')}`;
};

export const SilenceCutControl: React.FC<Props> = ({
  enabled, preset, detecting, applying, detectedSilenceSec, effectiveDuration, rawDuration, onToggle, onPresetChange, disabled,
}) => {
  return (
    <div className={`rounded-xl border transition-all ${
      enabled
        ? 'bg-violet-500/[0.06] border-violet-500/30'
        : 'bg-white/[0.02] border-white/10'
    } ${disabled ? 'opacity-50' : ''}`}>
      <div className="px-3 py-2.5 flex items-start gap-3">
        <button
          type="button"
          onClick={() => !disabled && onToggle(!enabled)}
          disabled={disabled}
          className={`relative shrink-0 w-9 h-5 rounded-full transition-colors mt-0.5 ${enabled ? 'bg-violet-500' : 'bg-zinc-700'}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`}></div>
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
            ✂ Cortar silêncios
            {detecting && <span className="text-[9px] text-violet-300">analisando...</span>}
            {applying && <span className="text-[9px] text-violet-300">aplicando cortes...</span>}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5 leading-relaxed">
            {!enabled && 'Corta pausas pra deixar o ritmo dinâmico, estilo Recut.'}
            {enabled && detecting && 'Detectando pausas...'}
            {enabled && applying && 'Re-encodando o áudio com as palavras coladas...'}
            {enabled && !detecting && !applying && detectedSilenceSec < 0.1 && 'Sem pausas longas detectadas no áudio.'}
            {enabled && !detecting && !applying && detectedSilenceSec >= 0.1 && (
              <>
                Cortando <span className="text-violet-300 font-mono font-semibold">−{detectedSilenceSec.toFixed(1)}s</span> de pausas.
                Reel fica em <span className="text-emerald-300 font-mono font-semibold">{formatSec(effectiveDuration)}</span>{' '}
                <span className="text-zinc-600">(era {formatSec(rawDuration)})</span>.
              </>
            )}
          </div>
        </div>
      </div>

      {enabled && (
        <div className="px-3 pb-3 grid grid-cols-3 gap-1.5">
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => !disabled && onPresetChange(p.id)}
              disabled={disabled}
              className={`px-2 py-2 rounded-lg border text-left transition-all ${
                preset === p.id
                  ? 'bg-violet-500/20 border-violet-400/60 shadow-[0_0_12px_rgba(167,139,250,0.25)]'
                  : 'bg-black/20 border-white/5 hover:border-white/15'
              }`}
            >
              <div className="text-[11px] font-semibold text-zinc-100 flex items-center gap-1">
                <span>{p.emoji}</span>
                {p.label}
              </div>
              <div className="text-[9px] text-zinc-500 mt-0.5">{p.hint}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
