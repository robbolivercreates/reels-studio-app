/**
 * Motion Dock — THE single surface for choosing a motion, used identically by
 * both pipelines:
 *   - creation: inside the block Inspector (layout="horizontal" — 3 columns
 *     side by side, everything visible inside the 280px-tall strip, no scroll)
 *   - edit-video: floating panel (layout="vertical" — narrow 320px column)
 *
 * Three steps: ① VISUAL (Auto / template / AI style) → ② ONDE (placement) →
 * ③ QUANDO (offset + duration) → Gerar.
 *
 * Containment rules (the previous version failed these and flooded the UI):
 *   - placement buttons are FIXED-SIZE, never flex-stretched
 *   - chips live on ONE line with horizontal scroll (category-chip pattern)
 *   - the Auto card is one compact line
 *   - the CTA is always visible (no vertical scroll in horizontal layout)
 *
 * Palette: graphite + steel blue + discreet amber. NO violet/fuchsia (user
 * design rule — see memory design-no-lilac).
 */

import React from 'react';
import {
  STYLE_PRESETS,
  type StylePresetId,
} from './motionStylePresets';
import { TEMPLATE_PICKER_IDS, STYLE_PRESET_IDS, isHidden } from './presetCategory';
import type { MotionPlacement } from './motionLibrary';
import { FLOAT_SHIFT_TOP, FLOAT_SHIFT_MIDDLE, FLOAT_SHIFT_BOTTOM, DEFAULT_SCRIM_ALPHA, DEFAULT_SCRIM_SPREAD } from './motionLibrary';
import type { MotionColorMode } from './types';

/** Dock palette — graphite/steel, zero lilac. */
const C = {
  accent: '#60A5FA',
  accentBg: 'rgba(96,165,250,0.12)',
  accentBorder: 'rgba(96,165,250,0.55)',
  surface: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.09)',
  borderStrong: 'rgba(255,255,255,0.18)',
  text: '#f4f4f5',
  text2: '#a1a1aa',
  text3: '#71717a',
  amber: 'rgba(251,191,36,0.85)',
};

/** Subset of AI styles surfaced in the dock (full variety lives in generation, not the picker). */
const DOCK_AI_STYLE_IDS: StylePresetId[] = ['bold-pop', 'glass-tech', 'editorial-clean', 'illustrated-explainer'];

export interface MotionDockValue {
  /** 'auto' = LLM router decides; otherwise a preset id. */
  visual: 'auto' | StylePresetId;
  placement: MotionPlacement;
}

interface Props {
  value: MotionDockValue;
  onChange: (v: MotionDockValue) => void;
  /** Block/segment duration in seconds — bounds the QUANDO sliders. */
  segmentDurationSec: number;
  motionColorMode: MotionColorMode;
  onSetMotionColorMode: (m: MotionColorMode) => void;
  /** 'horizontal' = Inspector strip (3 columns); 'vertical' = narrow panel. */
  layout?: 'horizontal' | 'vertical';
  /**
   * Placement areas valid in this context (product rule: a creation B-roll
   * block is always full-frame — its motion IS the content). When only one
   * area is allowed, the whole "② Onde" step is hidden.
   */
  allowedAreas?: MotionPlacement['area'][];
  /** Restrict template chips to overlay-safe ones (edit-video pipeline). */
  overlayContext?: boolean;
  /** Overlay-safe ids — passed in to avoid importing the service layer here. */
  overlaySafeIds?: readonly string[];
  /** Generate CTA. Label varies by context. */
  onGenerate: () => void;
  generateLabel?: string;
  busy?: boolean;
  /** Optional secondary CTA (e.g. "Gerar todos (Auto)" in edit mode). */
  secondaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  /** Open the advanced editor (text/intent/HTML). */
  onOpenAdvanced?: () => void;
}

const AREAS: { id: MotionPlacement['area']; label: string; mini: React.CSSProperties }[] = [
  { id: 'float',       label: 'Flutuar',    mini: { left: '12%', right: '12%', top: '58%', height: '20%', borderRadius: 1 } },
  { id: 'top-half',    label: 'Metade ↑',   mini: { left: 0, right: 0, top: 0, height: '50%' } },
  { id: 'bottom-half', label: 'Metade ↓',   mini: { left: 0, right: 0, top: '50%', height: '50%' } },
  { id: 'full',        label: 'Tela cheia', mini: { inset: 0 } },
];

export const MotionDock: React.FC<Props> = ({
  value, onChange, segmentDurationSec, motionColorMode, onSetMotionColorMode,
  layout = 'vertical', allowedAreas, overlayContext, overlaySafeIds, onGenerate, generateLabel, busy,
  secondaryAction, onOpenAdvanced,
}) => {
  const horizontal = layout === 'horizontal';
  const areas = AREAS.filter(a => !allowedAreas || allowedAreas.includes(a.id));
  const showPlacementStep = areas.length > 1;
  const visible = STYLE_PRESETS.filter(p => !isHidden(p.id));
  // Templates are full-frame DESIGNS (giant titles, centered grids) — they
  // only make sense when the motion IS the whole screen. On float/splits the
  // art is authored from scratch inside the safe zone, so template chips are
  // hidden there (picking one would plaster a full-frame layout over the face).
  const templatesAllowed = value.placement.area === 'full';
  const templateChips = !templatesAllowed ? [] : visible.filter(p =>
    (TEMPLATE_PICKER_IDS as readonly string[]).includes(p.id)
    && (!overlayContext || !overlaySafeIds || overlaySafeIds.includes(p.id)),
  );
  const styleChips = visible.filter(p => DOCK_AI_STYLE_IDS.includes(p.id) && (STYLE_PRESET_IDS as readonly string[]).includes(p.id));

  const patchPlacement = (patch: Partial<MotionPlacement>) =>
    onChange({ ...value, placement: { ...value.placement, ...patch } });

  const isFloat = value.placement.area === 'float';
  const startOffset = value.placement.startOffsetSec ?? 0;
  const dur = value.placement.durationSec ?? segmentDurationSec;
  const maxOffset = Math.max(0, segmentDurationSec - 1);

  // ── shared pieces ─────────────────────────────────────────────────────────

  const stepLabel = (n: number, title: string) => (
    <div className="flex items-center gap-1.5 mb-1.5 shrink-0">
      <span
        className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-extrabold"
        style={{ backgroundColor: C.accentBg, color: C.accent }}
      >{n}</span>
      <span className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.text2 }}>{title}</span>
    </div>
  );

  const chip = (p: typeof visible[number], isTemplate: boolean) => {
    const sel = value.visual === p.id;
    return (
      <button
        key={p.id}
        onClick={() => onChange({ ...value, visual: p.id })}
        className="px-2 py-1 rounded-lg text-[10.5px] whitespace-nowrap shrink-0 transition-colors"
        style={{
          backgroundColor: sel ? C.accentBg : C.surface,
          border: `1px solid ${sel ? C.accentBorder : C.border}`,
          color: sel ? '#bfdbfe' : C.text2,
          cursor: 'pointer',
        }}
        title={`${p.bestFor}${isTemplate ? ' · Template pronto — rápido e garantido, a IA só preenche os textos.' : ' · A IA cria a animação do zero.'}`}
      >
        {p.emoji} {p.label}{isTemplate && <span style={{ fontSize: 8, marginLeft: 3, color: C.amber }}>⚡</span>}
      </button>
    );
  };

  // Auto card — one compact line in both layouts.
  const autoCard = (
    <button
      onClick={() => onChange({ ...value, visual: 'auto' })}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors shrink-0"
      style={{
        border: `1.5px solid ${value.visual === 'auto' ? C.accentBorder : C.border}`,
        backgroundColor: value.visual === 'auto' ? C.accentBg : C.surface,
        cursor: 'pointer',
      }}
      title="A IA analisa a fala e escolhe o template visual certo automaticamente."
    >
      <span className="text-sm">⚡</span>
      <span className="text-[11.5px] font-semibold whitespace-nowrap" style={{ color: C.text }}>Auto</span>
      <span className="text-[10px] truncate min-w-0" style={{ color: C.text2 }}>a IA escolhe o visual certo pra cada fala</span>
      {value.visual === 'auto' && <span className="ml-auto text-[10px] shrink-0" style={{ color: C.accent }}>✓</span>}
    </button>
  );

  // Chips — ONE line, horizontal scroll (category-chip pattern). Templates first.
  const chipRow = (
    <div className="flex gap-1.5 overflow-x-auto pb-1 shrink-0" style={{ scrollbarWidth: 'thin' }}>
      {templateChips.map(p => chip(p, true))}
      {styleChips.map(p => chip(p, false))}
    </div>
  );

  const colorToggle = isFloat ? (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded shrink-0"
      style={{ color: C.text3, border: `1px solid ${C.border}` }}
      title="Flutuar usa fundo transparente (screen-blend) — sempre sobre o vídeo, sem modo claro."
    >🌙 transparente</span>
  ) : (
    <div className="flex rounded-lg p-0.5 shrink-0" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
      {(['dark', 'light'] as const).map(m => (
        <button
          key={m}
          onClick={() => onSetMotionColorMode(m)}
          className="px-1.5 py-0.5 rounded-md text-[10px]"
          style={{
            backgroundColor: motionColorMode === m ? C.surface : 'transparent',
            color: motionColorMode === m ? C.text : C.text3,
            border: 'none', cursor: 'pointer',
          }}
          title={m === 'dark' ? 'Fundo escuro' : 'Fundo claro'}
        >{m === 'dark' ? '🌙' : '☀️'}</button>
      ))}
    </div>
  );

  // Placement buttons — FIXED size, never stretched.
  const areaButtons = (
    <div className="flex gap-1.5 shrink-0">
      {areas.map(a => {
        const sel = value.placement.area === a.id;
        return (
          <button
            key={a.id}
            onClick={() => {
              // Leaving 'full' with a template selected → reset to Auto:
              // templates are full-frame designs, invalid on float/splits.
              const leavingFullWithTemplate = a.id !== 'full'
                && (TEMPLATE_PICKER_IDS as readonly string[]).includes(value.visual);
              onChange({
                ...value,
                visual: leavingFullWithTemplate ? 'auto' : value.visual,
                placement: { ...value.placement, area: a.id },
              });
            }}
            className="flex flex-col items-center gap-1 py-1.5 rounded-lg transition-colors shrink-0"
            style={{
              width: 62,
              border: `1.5px solid ${sel ? C.accentBorder : C.border}`,
              backgroundColor: sel ? C.accentBg : C.surface,
              cursor: 'pointer',
            }}
          >
            <span
              className="relative rounded-[3px] overflow-hidden"
              style={{ width: 18, height: 32, backgroundColor: '#26262c', border: `1px solid ${C.borderStrong}` }}
            >
              <span style={{ position: 'absolute', background: 'linear-gradient(160deg,#2563EB,#60A5FA)', ...a.mini }} />
            </span>
            <span className="text-[8.5px] font-semibold whitespace-nowrap" style={{ color: sel ? C.text : C.text2 }}>{a.label}</span>
          </button>
        );
      })}
    </div>
  );

  const sliderRow = (label: string, min: number, max: number, step: number, val: number, fmt: (v: number) => string, set: (v: number) => void) => (
    <div className="flex items-center gap-2">
      <span className="text-[9.5px] w-14 shrink-0" style={{ color: C.text3 }}>{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={val}
        onChange={e => set(parseFloat(e.target.value))}
        className="flex-1 min-w-0" style={{ accentColor: C.accent, height: 3 }}
      />
      <span className="text-[9.5px] w-9 text-right font-mono shrink-0" style={{ color: C.text2 }}>{fmt(val)}</span>
    </div>
  );

  // Split = SOLID panel: the motion owns its half and the video is squeezed
  // into the other one (preview and export). Said explicitly because the
  // float-only Posição/Contraste controls vanish here and that read as a bug.
  const isSplit = value.placement.area === 'top-half' || value.placement.area === 'bottom-half';
  const splitHint = isSplit && (
    <div className="text-[9px] leading-snug mt-1" style={{ color: C.text3 }}>
      ◱ painel sólido — o vídeo é espremido pra outra metade.
      Pra um card transparente <i>sobre</i> o vídeo, use <b style={{ color: C.text2 }}>Flutuar</b> (com Posição e Contraste).
    </div>
  );

  // Float position: a pure compositor translate of the full-frame blend —
  // moving the card top/middle/bottom is INSTANT (no regeneration; black
  // stays transparent under screen blend, so shifted edges are invisible).
  const shift = value.placement.floatShiftY ?? FLOAT_SHIFT_BOTTOM;
  const FLOAT_POSITIONS: { id: string; label: string; v: number }[] = [
    { id: 'top',    label: '↑ Topo',  v: FLOAT_SHIFT_TOP },
    { id: 'middle', label: '· Meio',  v: FLOAT_SHIFT_MIDDLE },
    { id: 'bottom', label: '↓ Base',  v: FLOAT_SHIFT_BOTTOM },
  ];
  const floatPosition = isFloat && (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[9.5px] w-14 shrink-0" style={{ color: C.text3 }}>Posição</span>
        {FLOAT_POSITIONS.map(p => {
          const sel = Math.abs(shift - p.v) < 0.02;
          return (
            <button
              key={p.id}
              onClick={() => patchPlacement({ floatShiftY: p.v })}
              className="px-2 py-0.5 rounded-md text-[9.5px] font-semibold transition-colors"
              style={{
                backgroundColor: sel ? C.accentBg : C.surface,
                border: `1px solid ${sel ? C.accentBorder : C.border}`,
                color: sel ? '#bfdbfe' : C.text2,
                cursor: 'pointer',
              }}
              title="Move o card na hora — sem regenerar"
            >{p.label}</button>
          );
        })}
      </div>
      {sliderRow('Ajuste fino', -55, 12, 1, Math.round(shift * 100), v => `${v}%`, v => patchPlacement({ floatShiftY: v / 100 }))}
      {sliderRow('Contraste', 0, 80, 5, Math.round((value.placement.scrimAlpha ?? DEFAULT_SCRIM_ALPHA) * 100), v => v === 0 ? 'off' : `${v}%`, v => patchPlacement({ scrimAlpha: v / 100 }))}
      {sliderRow('Grad. altura', 10, 45, 1, Math.round((value.placement.scrimSpread ?? DEFAULT_SCRIM_SPREAD) * 100), v => `${v}%`, v => patchPlacement({ scrimSpread: v / 100 }))}
    </div>
  );

  const whenSliders = (
    <>
      {sliderRow('Começa em', 0, maxOffset, 0.5, startOffset, v => v === 0 ? 'início' : `${v.toFixed(1)}s`, v => patchPlacement({ startOffsetSec: v }))}
      {sliderRow('Duração', 1, segmentDurationSec, 0.5, Math.min(dur, segmentDurationSec), v => `${v.toFixed(1)}s`, v => patchPlacement({ durationSec: v }))}
    </>
  );

  const generateBtn = (
    <button
      onClick={onGenerate}
      disabled={busy}
      className="w-full py-2 rounded-xl text-[12px] font-bold text-white transition-opacity shrink-0"
      style={{
        background: 'linear-gradient(180deg, #60A5FA, #3b82f6)',
        border: 'none',
        boxShadow: '0 4px 18px rgba(96,165,250,0.3)',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? '⏳ Gerando…' : (generateLabel ?? '✨ Gerar motion')}
    </button>
  );

  const secondaryBtn = secondaryAction && (
    <button
      onClick={secondaryAction.onClick}
      disabled={secondaryAction.disabled || busy}
      className="w-full py-1.5 rounded-xl text-[10.5px] font-semibold transition-opacity shrink-0"
      style={{
        backgroundColor: 'rgba(52,211,153,0.10)',
        border: '1px solid rgba(52,211,153,0.32)',
        color: '#a7f3d0',
        cursor: secondaryAction.disabled || busy ? 'not-allowed' : 'pointer',
        opacity: secondaryAction.disabled || busy ? 0.5 : 1,
      }}
    >
      {secondaryAction.label}
    </button>
  );

  const advancedLink = onOpenAdvanced && (
    <button
      onClick={onOpenAdvanced}
      className="text-[9.5px] underline shrink-0"
      style={{ color: C.text3, background: 'none', border: 'none', cursor: 'pointer' }}
    >
      avançado…
    </button>
  );

  // ── HORIZONTAL: 3 columns side by side, no vertical scroll ───────────────
  if (horizontal) {
    return (
      <div className="h-full flex gap-3 items-stretch min-h-0">
        {/* ① VISUAL — grows */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5 px-2.5 py-2 rounded-xl" style={{ border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between">
            {stepLabel(1, 'Visual')}
            {colorToggle}
          </div>
          {autoCard}
          {chipRow}
        </div>

        {/* ② ONDE — natural width. Hidden when the context allows only one
            area (creation B-roll: motion is always the full content). */}
        {showPlacementStep && (
          <div className="shrink-0 flex flex-col gap-1.5 px-2.5 py-2 rounded-xl" style={{ border: `1px solid ${C.border}` }}>
            {stepLabel(2, 'Onde aparece')}
            {areaButtons}
            {floatPosition && <div className="mt-0.5" style={{ width: 268 }}>{floatPosition}</div>}
            {splitHint && <div style={{ width: 268 }}>{splitHint}</div>}
          </div>
        )}

        {/* ③ QUANDO + CTA — fixed width, CTA always on screen */}
        <div className="shrink-0 w-[230px] flex flex-col gap-1.5 px-2.5 py-2 rounded-xl" style={{ border: `1px solid ${C.border}` }}>
          {stepLabel(showPlacementStep ? 3 : 2, 'Quando')}
          <div className="flex flex-col gap-1">{whenSliders}</div>
          <div className="mt-auto flex flex-col gap-1 items-center">
            {generateBtn}
            {secondaryBtn}
            {advancedLink}
          </div>
        </div>
      </div>
    );
  }

  // ── VERTICAL: narrow column (edit-mode floating panel) ───────────────────
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className="flex items-center justify-between">
          {stepLabel(1, 'Visual')}
          {colorToggle}
        </div>
        {autoCard}
        <div className="mt-1.5">{chipRow}</div>
      </div>

      {showPlacementStep && (
        <div>
          {stepLabel(2, 'Onde aparece')}
          {areaButtons}
          {floatPosition && <div className="mt-1.5">{floatPosition}</div>}
          {splitHint}
        </div>
      )}

      <div>
        {stepLabel(showPlacementStep ? 3 : 2, 'Quando')}
        <div className="flex flex-col gap-1">{whenSliders}</div>
      </div>

      <div className="flex flex-col gap-1.5 items-center">
        {generateBtn}
        {secondaryBtn}
        {advancedLink}
      </div>
    </div>
  );
};
