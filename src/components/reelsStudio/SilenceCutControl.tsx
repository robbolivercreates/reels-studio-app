import React, { useState } from 'react';
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
  { id: 'natural', label: 'Natural', emoji: '🌿', hint: 'pausas > 0.8s' },
  { id: 'fast',    label: 'Rápido',  emoji: '⚡', hint: 'pausas > 0.4s' },
  { id: 'super',   label: 'Super',   emoji: '🚀', hint: 'pausas > 0.2s' },
];

const formatSec = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(Math.floor(sec)).padStart(2, '0')}`;
};

export const SilenceCutControl: React.FC<Props> = ({
  enabled, preset, detecting, applying, detectedSilenceSec, effectiveDuration, rawDuration, onToggle, onPresetChange, disabled,
}) => {
  const [expanded, setExpanded] = useState(false);

  const activePreset = PRESETS.find(p => p.id === preset) ?? PRESETS[1];
  const showSaving = enabled && !detecting && !applying && detectedSilenceSec >= 0.1;

  const handleToggle = () => {
    if (disabled) return;
    const next = !enabled;
    onToggle(next);
    if (!next) setExpanded(false);
  };

  return (
    <div className={`rounded-xl border transition-all ${
      enabled ? 'bg-blue-500/[0.06] border-blue-500/30' : 'bg-white/[0.02] border-white/10'
    } ${disabled ? 'opacity-50' : ''}`}>
      {/* Compact header row */}
      <div className="px-3 py-2 flex items-center gap-2">
        {/* Left: icon + label + status chips — clickable to expand presets */}
        <button
          type="button"
          onClick={() => enabled && !disabled && setExpanded(o => !o)}
          disabled={!enabled || disabled}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
          title={enabled ? (expanded ? 'Fechar opções' : 'Ajustar preset') : undefined}
        >
          <span className="text-[11px] text-zinc-400 shrink-0">✂</span>
          <span className="text-xs font-medium text-zinc-200 shrink-0">Cortar silêncios</span>

          {enabled && !detecting && !applying && (
            <>
              <span className="text-zinc-600 shrink-0">·</span>
              <span className={`text-[10px] font-medium shrink-0 ${expanded ? 'text-blue-300' : 'text-zinc-400'}`}>
                {activePreset.emoji} {activePreset.label}
              </span>
            </>
          )}

          {showSaving && (
            <>
              <span className="text-zinc-600 shrink-0">·</span>
              <span className="text-[10px] text-emerald-300 font-mono shrink-0">
                −{detectedSilenceSec.toFixed(1)}s → {formatSec(effectiveDuration)}
              </span>
            </>
          )}

          {detecting && (
            <span className="text-[9px] text-blue-300 animate-pulse shrink-0">analisando…</span>
          )}
          {applying && (
            <span className="text-[9px] text-blue-300 animate-pulse shrink-0">aplicando…</span>
          )}

          {enabled && !disabled && (
            <svg
              className={`w-3 h-3 text-zinc-600 ml-auto transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>

        {/* Right: toggle */}
        <button
          type="button"
          onClick={handleToggle}
          disabled={disabled}
          className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${enabled ? 'bg-blue-500' : 'bg-zinc-700'}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>

      {/* Expandable preset grid */}
      {enabled && expanded && (
        <div className="px-3 pb-3 grid grid-cols-3 gap-1.5">
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => { if (!disabled) { onPresetChange(p.id); setExpanded(false); } }}
              disabled={disabled}
              className={`px-2 py-2 rounded-lg border text-left transition-all ${
                preset === p.id
                  ? 'bg-blue-500/20 border-blue-400/60 shadow-[0_0_12px_rgba(10,132,255,0.25)]'
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
