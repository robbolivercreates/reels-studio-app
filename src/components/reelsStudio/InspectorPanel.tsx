/**
 * InspectorPanel — Apple-style contextual block editor.
 *
 * Replaces the per-block "expanded inspector" that lived inline inside each
 * ScriptBlockCard. Selecting a block (from the sidebar OR the timeline) now
 * surfaces all of its configuration in one focused panel below the preview,
 * instead of forcing the user to scroll the sidebar and expand each card.
 *
 * Architecture:
 *   - Pure presentational. Receives a single ScriptBlock + the same handler
 *     set the sidebar already builds in `cardProps` — no reducer access here.
 *   - Local state limited to UI affordances: which tab is open, whether the
 *     body is collapsed. Both persist for the session via sessionStorage
 *     so collapse/expand survives an HMR reload.
 *   - When no block is selected (e.g. the user clicked the canvas to clear),
 *     renders a quiet placeholder — the layout slot never disappears.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { ScriptBlock, AppTheme, BlockLayout } from './types';
import { getTheme } from './theme';
import { LAYOUT_OPTIONS } from './layouts';
import { loadAvatarPhotos } from './avatarPhotosStore';
import { STYLE_PRESETS, findStylePreset, type StylePresetId, type StylePreset } from './motionStylePresets';
import { STYLE_PRESET_IDS, EFFECT_PRESET_IDS, isHidden } from './presetCategory';
import { detectEffect } from './effectDetector';

// Local mm:ss.cc formatter — formatTime in ReelsStudio.tsx isn't exported.
const formatTime = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) return '00:00.00';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

export type InspectorTab = 'motion' | 'avatar' | 'layout' | 'voz' | 'stats';

interface Props {
  block: ScriptBlock | null;
  appTheme: AppTheme | undefined;
  multiSelectCount?: number;
  aspect: '9:16' | '16:9' | '1:1' | 'carousel';
  defaultZoom: number;
  audioReady: boolean;
  onSetAvatarZoom?: (zoom: number) => void;
  onSetAvatarOffsetY?: (offset: number) => void;
  onSetAvatarVisibleSec?: (sec: number | undefined) => void;
  onSetLayout?: (layout: BlockLayout) => void;
  onSetAvatarPhoto?: (photoId: string | undefined) => void;
  onSetStylePreset?: (preset: StylePresetId | undefined) => void;
  onOpenMotion?: () => void;
  /** Fires the same auto-generation pipeline used by the timeline button. No modal. */
  onGenerateMotion?: () => void;
  /** True while a generation is in flight — disables buttons + shows status. */
  motionBusy?: string | null;
  /** Current colour scheme used by motion generation (dark backdrop vs. light). */
  motionColorMode?: 'dark' | 'light';
  /** Setter for the colour scheme. Inspector exposes a quick chip so users don't
   * have to dive into Settings or the overflow menu to flip it. */
  onSetMotionColorMode?: (mode: 'dark' | 'light') => void;
  onOpenAssetPicker?: () => void;
  onRegenAvatar?: () => void;
  /** Toggle the selected block's kind between 'avatar' and 'broll'. The
   * single most important per-block decision — surfaced in the Inspector
   * header so users don't have to dive into the sidebar card to flip it. */
  onToggleKind?: () => void;
  /** Zero-based position of the selected block in the reel — feeds the effect detector. */
  blockIndex?: number;
  /** Total blocks in the reel — feeds the effect detector. */
  blockTotal?: number;
  /** True when the reel has a researched brand identity with a logo SVG. */
  brandHasLogo?: boolean;
  /** True when the reel has any researched brand identity. */
  brandHasIdentity?: boolean;
  /** Word-count from state.audio.words for the selected block — feeds karaoke detection. */
  audioWordCount?: number;
}

const STORAGE_KEY_TAB = 'reels.inspector.tab';
const STORAGE_KEY_COLLAPSED = 'reels.inspector.collapsed';
const STORAGE_KEY_MOTION_GRID = 'reels.inspector.motionGridOpen';
const STORAGE_KEY_MOTION_CATEGORY = 'reels.inspector.motionCategory';

// ─── TabBodyShell — uniform-height container for every tab body ─────────
// All 5 tabs (Motion / Avatar / Layout / Voz / Stats) render inside this
// shell so the Inspector's height stays constant when the user switches
// tabs. Tabs whose content fits within the shell don't trigger scroll;
// the Motion tab with its disclosure open uses internal flex zones to
// keep the action buttons pinned while only the chip grid scrolls.
// Apple-grade: altura ABSOLUTA. Conteúdo se adapta — Inspector NUNCA pula.
// 280px: comporta a linha compacta do preset escolhido + 2 carrosséis com
// thumbs 9:16 grandes o suficiente pra receber preview animado real
// (Entrega C futura — slot interno já dimensionado pra <iframe>/<video>).
const INSPECTOR_TAB_BODY_HEIGHT = 280;
const STYLE_THUMB_WIDTH = 80; // 9:16 aspect → ~142px de altura. Cabe preview.
const TabBodyShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  // Height EXATA + overflow-hidden em ambos os eixos. Qualquer tab que
  // tente crescer é cortada — o conteúdo TEM que se adaptar. Esta é a
  // regra que impede a timeline embaixo de pular.
  <div
    style={{ height: INSPECTOR_TAB_BODY_HEIGHT }}
    className="overflow-hidden"
  >
    {children}
  </div>
);

// ─── Inline LayoutThumbnail (kept local to avoid circular imports) ──────
const LayoutThumb: React.FC<{ layout: BlockLayout; selected: boolean }> = ({ layout, selected }) => {
  const borderClass = selected ? 'border-violet-400 shadow-[0_0_8px_rgba(167,139,250,0.4)]' : 'border-white/10';
  return (
    <div className={`relative w-full aspect-[9/16] rounded border bg-zinc-900 overflow-hidden transition-all ${borderClass}`}>
      {layout === 'avatar-only' && (
        <div className="absolute inset-0 bg-gradient-to-b from-amber-400/70 to-amber-600/70 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-amber-200/90" />
        </div>
      )}
      {layout === 'media-only' && (
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-400/70 to-emerald-600/70" />
      )}
      {layout === 'avatar-top' && (
        <>
          <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-amber-400/70 to-amber-600/70 flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-amber-200/90" /></div>
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-emerald-400/70 to-emerald-600/70" />
        </>
      )}
      {layout === 'media-top' && (
        <>
          <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-emerald-400/70 to-emerald-600/70" />
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-amber-400/70 to-amber-600/70 flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-amber-200/90" /></div>
        </>
      )}
    </div>
  );
};

const PhotoPicker: React.FC<{
  currentPhotoId: string | undefined;
  onPick: (id: string | undefined) => void;
}> = ({ currentPhotoId, onPick }) => {
  const photos = loadAvatarPhotos();
  if (photos.length === 0) {
    return <div className="text-[11px] text-zinc-500">Nenhuma foto cadastrada — adicione em &quot;Gerar clipes de avatar&quot;.</div>;
  }
  const usingDefault = !currentPhotoId;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      <button
        onClick={() => onPick(undefined)}
        className={`shrink-0 w-12 h-12 rounded-md border flex items-center justify-center text-[9px] font-medium transition-colors ${
          usingDefault ? 'border-violet-400 bg-violet-500/15 text-violet-200' : 'border-white/10 bg-black/30 text-zinc-400 hover:bg-white/5'
        }`}
        title="Usar a foto padrão do projeto"
      >
        Padrão
      </button>
      {photos.map(p => {
        const selected = currentPhotoId === p.id;
        return (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            className={`shrink-0 w-12 h-12 rounded-md overflow-hidden border transition-colors ${
              selected ? 'border-violet-400' : 'border-white/10 hover:border-white/30'
            }`}
            title={p.name}
          >
            <img src={p.thumbnailBase64 || p.previewUrl || ''} alt={p.name} className="w-full h-full object-cover" />
          </button>
        );
      })}
    </div>
  );
};

// ─── DecidedPresetCard ─────────────────────────────────────────────────
// Hero card that surfaces the SINGLE preset currently driving the block's
// motion generation. Replaces the previous "grid of 19 chips" as the default
// view — chip grid still exists but lives behind a "Trocar manualmente"
// disclosure now. Two modes:
//   - source='auto'    → eyebrow "🤖 Sistema escolheu", purple border
//   - source='manual'  → eyebrow "Você escolheu", neutral border, reset link
const DecidedPresetCard: React.FC<{
  preset: StylePreset;
  source: 'auto' | 'manual';
  reason: string;
  onReset?: () => void;
  isLight: boolean;
  tokens: ReturnType<typeof getTheme>;
}> = ({ preset, source, reason, onReset, isLight, tokens }) => {
  const isAuto = source === 'auto';
  return (
    <div
      className="rounded-lg px-4 py-3 flex items-center gap-4 transition-colors"
      style={{
        backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isAuto ? '#A78BFA' : tokens.border.subtle}`,
        boxShadow: isAuto ? '0 0 0 3px rgba(167,139,250,0.10)' : 'none',
      }}
    >
      {/* Big emoji + label cluster */}
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-3xl leading-none" aria-hidden>{preset.emoji}</span>
        <div className="text-[15px] font-semibold leading-tight" style={{ color: tokens.text.primary }}>
          {preset.label}
        </div>
      </div>
      {/* Eyebrow + reason */}
      <div className="flex-1 min-w-0">
        <div
          className="text-[10px] uppercase tracking-wider font-semibold leading-none mb-1"
          style={{ color: isAuto ? '#A78BFA' : tokens.text.tertiary }}
        >
          {isAuto ? '🤖 Sistema escolheu' : 'Você escolheu'}
        </div>
        <div className="text-[11px] leading-snug truncate" style={{ color: tokens.text.secondary }}>
          {reason}
        </div>
      </div>
      {/* Reset to auto link — only when user has a manual override */}
      {!isAuto && onReset && (
        <button
          onClick={onReset}
          className="shrink-0 text-[11px] font-medium underline-offset-2 hover:underline transition-colors"
          style={{
            color: '#A78BFA',
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
          title="Limpar escolha manual e voltar para a decisão automática do sistema"
        >
          Voltar para automático
        </button>
      )}
    </div>
  );
};

// ─── DecidedPresetLine — compact version of DecidedPresetCard ─────────
// Used when the user opens "Trocar manualmente" — the full card would
// steal vertical space the carousel rows need, so we collapse it into a
// single horizontal line that still surfaces:
//   - source (🤖 auto / Você)
//   - preset emoji + label
//   - short reason
//   - reset link (only when manual)
// Apple pattern: keep the anchor visible at all times, just thinner.
const DecidedPresetLine: React.FC<{
  preset: StylePreset;
  source: 'auto' | 'manual';
  reason: string;
  onReset?: () => void;
  isLight: boolean;
  tokens: ReturnType<typeof getTheme>;
}> = ({ preset, source, reason, onReset, isLight, tokens }) => {
  const isAuto = source === 'auto';
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px]"
      style={{
        backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)',
        border: `1px solid ${tokens.border.subtle}`,
      }}
    >
      <span
        className="text-[9px] uppercase tracking-wider font-semibold shrink-0"
        style={{ color: isAuto ? '#A78BFA' : tokens.text.tertiary }}
      >
        {isAuto ? '🤖 Auto' : 'Manual'}
      </span>
      <span className="text-base leading-none shrink-0" aria-hidden>{preset.emoji}</span>
      <span className="font-semibold shrink-0" style={{ color: tokens.text.primary }}>
        {preset.label}
      </span>
      <span className="opacity-50 shrink-0">·</span>
      <span className="truncate min-w-0" style={{ color: tokens.text.secondary }}>
        {reason}
      </span>
      {!isAuto && onReset && (
        <button
          onClick={onReset}
          className="shrink-0 ml-auto text-[10px] font-medium underline-offset-2 hover:underline"
          style={{ color: '#A78BFA', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
          title="Limpar escolha manual e voltar para a decisão automática do sistema"
        >
          Voltar p/ auto
        </button>
      )}
    </div>
  );
};

// ─── CarouselRow — horizontal thumbnail row with auto-scroll to active ─
// When `activeId` changes (e.g. disclosure just opened OR user clicked a
// thumb), the container scrolls so the active thumb is centered in view.
// This is the "anchor" mechanic — user never loses sight of what's selected,
// even after browsing the carousel.
const CarouselRow: React.FC<{
  activeId: string | undefined;
  children: React.ReactNode;
}> = ({ activeId, children }) => {
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeId) return;
    const el = rowRef.current?.querySelector(`[data-preset-id="${activeId}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, [activeId]);
  return (
    <div
      ref={rowRef}
      className="flex gap-2 overflow-x-auto pb-1"
      style={{ scrollbarWidth: 'thin' }}
    >
      {children}
    </div>
  );
};

export const InspectorPanel: React.FC<Props> = ({
  block,
  appTheme,
  multiSelectCount = 0,
  aspect: _aspect,
  defaultZoom,
  audioReady,
  onSetAvatarZoom,
  onSetAvatarOffsetY,
  onSetAvatarVisibleSec,
  onSetLayout,
  onSetAvatarPhoto,
  onSetStylePreset,
  onOpenMotion,
  onGenerateMotion,
  motionBusy,
  motionColorMode,
  onSetMotionColorMode,
  onOpenAssetPicker: _onOpenAssetPicker,
  onRegenAvatar: _onRegenAvatar,
  onToggleKind,
  blockIndex,
  blockTotal,
  brandHasLogo,
  brandHasIdentity,
  audioWordCount,
}) => {
  const tokens = getTheme(appTheme ?? 'dark');
  const isLight = (appTheme ?? 'dark') === 'light';
  const [activeTab, setActiveTab] = useState<InspectorTab>(() => {
    try {
      const v = sessionStorage.getItem(STORAGE_KEY_TAB);
      if (v === 'motion' || v === 'avatar' || v === 'layout' || v === 'voz' || v === 'stats') return v;
    } catch { /* ignore */ }
    return 'motion';
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(STORAGE_KEY_COLLAPSED) === '1'; } catch { return false; }
  });
  // "Trocar manualmente" disclosure — hidden by default. When open, the
  // 19-chip grid is shown below the DecidedPresetCard. Persists across
  // tab switches and HMR via sessionStorage.
  const [showMotionGrid, setShowMotionGrid] = useState<boolean>(() => {
    try { return sessionStorage.getItem(STORAGE_KEY_MOTION_GRID) === '1'; } catch { return false; }
  });
  // Segmented control state — picks which of the two categories the carousel
  // shows when the disclosure is open. Persists per session so the user lands
  // on the same tab they left.
  const [motionCategory, setMotionCategory] = useState<'style' | 'effect'>(() => {
    try {
      const v = sessionStorage.getItem(STORAGE_KEY_MOTION_CATEGORY);
      if (v === 'style' || v === 'effect') return v;
    } catch { /* ignore */ }
    return 'style';
  });

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_TAB, activeTab); } catch { /* ignore */ }
  }, [activeTab]);
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_COLLAPSED, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_MOTION_GRID, showMotionGrid ? '1' : '0'); } catch { /* ignore */ }
  }, [showMotionGrid]);
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_MOTION_CATEGORY, motionCategory); } catch { /* ignore */ }
  }, [motionCategory]);

  const isEmpty = !block;
  const isMultiSelect = multiSelectCount > 1;
  const isAvatar = !!block && block.kind === 'avatar';
  const blockDuration = block ? Math.max(0, block.end - block.start) : 0;

  // If user is on a tab that doesn't apply (e.g. "voz" on a b-roll block),
  // silently fall back to "motion" so they never see a blank body.
  const effectiveTab: InspectorTab = (() => {
    if (!block) return activeTab;
    if ((activeTab === 'avatar' || activeTab === 'voz') && !isAvatar) return 'motion';
    return activeTab;
  })();

  const headerText = (() => {
    if (isMultiSelect) return `${multiSelectCount} blocos selecionados`;
    if (isEmpty) return 'Nenhum bloco selecionado';
    return `Editando · ${isAvatar ? 'avatar' : 'b-roll'}`;
  })();

  // ─── Tab bodies ─────────────────────────────────────────────────
  const motionBody = () => {
    if (!block) return null;
    const motionStatus = block.motion?.status;
    const isBusy = !!motionBusy;
    // Deterministic effect suggestion. Cheap (regex + bool checks) — no memo
    // needed; it runs on every render of this body, which only happens when
    // the user is actively looking at the Motion tab. Returns undefined when
    // no rule matches.
    const detected = detectEffect({
      block,
      index: blockIndex ?? 0,
      total: blockTotal ?? 1,
      brandHasLogo,
      brandHasIdentity,
      audioWordCount,
    });
    const motionLabel = (() => {
      if (isBusy) return motionBusy;
      if (!block.motion) return 'Sem motion · pronto para gerar';
      if (motionStatus === 'ready') return 'Motion pronto';
      if (motionStatus === 'generating') return 'Gerando…';
      if (motionStatus === 'rendering') return 'Renderizando…';
      if (motionStatus === 'error') return 'Erro · abra o editor pra ver';
      return 'Rascunho';
    })();
    // Resolve what the user is effectively going to render with — the manual
    // override if set, otherwise whatever the detector recommended, otherwise
    // a safe editorial fallback. This single id drives the DecidedPresetCard
    // AND the chip's "active" highlight in the carousel — keeping both in
    // sync so the user never sees two preset chips lit up at once.
    const isManualOverride = !!block.stylePresetOverride;
    const effectivePresetId: StylePresetId = isManualOverride
      ? (block.stylePresetOverride as StylePresetId)
      : (detected.recommendedEffect ?? 'editorial-clean');
    const effectivePreset = findStylePreset(effectivePresetId);
    const currentPresetId: string = effectivePresetId;
    const reasonText = isManualOverride
      ? effectivePreset.bestFor
      : (detected.recommendedEffect ? detected.reason : 'Editorial limpo · escolha padrão');
    return (
      // 220px shell: Zone 1 (top) + Zone 2 (middle, grows to fill) + Zone 3
      // (bottom, glued to floor). When disclosure opens, DecidedPresetCard
      // is hidden to free room for the carousels.
      <div className="h-full flex flex-col gap-3">
        {/* ─── Zone 1 (top): hero card + status strip ──────────────────
            DecidedPresetCard is hidden when the disclosure opens — the
            chosen preset is already implicit (user is actively browsing
            the carousel) and the card takes ~64px we need for the rows. */}
        <div className="shrink-0 space-y-3">
        {/* Closed state: big hero card. Open state: compact line — same
            information, ~40px shorter so the carousels have room. */}
        {!showMotionGrid ? (
          <DecidedPresetCard
            preset={effectivePreset}
            source={isManualOverride ? 'manual' : 'auto'}
            reason={reasonText}
            onReset={isManualOverride ? () => onSetStylePreset?.(undefined) : undefined}
            isLight={isLight}
            tokens={tokens}
          />
        ) : (
          <DecidedPresetLine
            preset={effectivePreset}
            source={isManualOverride ? 'manual' : 'auto'}
            reason={reasonText}
            onReset={isManualOverride ? () => onSetStylePreset?.(undefined) : undefined}
            isLight={isLight}
            tokens={tokens}
          />
        )}

        {/* Status strip — combines (left) status OR segmented control with
            (right) Dark/Light toggle + Esconder link. When the disclosure
            is closed, the left shows the motion status label. When open,
            the left becomes the [Estilo (8) | Efeito (11)] segmented
            control AND a discrete "Esconder ▴" appears on the far right. */}
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-3 min-w-0">
            {showMotionGrid ? (
              <div
                className="shrink-0 flex items-center gap-0.5 p-0.5 rounded-md"
                style={{ backgroundColor: isLight ? '#FFFFFF' : 'rgba(0,0,0,0.25)', border: `1px solid ${tokens.border.subtle}` }}
              >
                {([
                  { id: 'style' as const,  label: 'Estilo', count: STYLE_PRESET_IDS.filter(id => !isHidden(id)).length },
                  { id: 'effect' as const, label: 'Efeito', count: EFFECT_PRESET_IDS.filter(id => !isHidden(id)).length },
                ]).map(opt => {
                  const active = motionCategory === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setMotionCategory(opt.id)}
                      className="px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
                      style={{
                        backgroundColor: active ? (isLight ? '#F4F4F5' : 'rgba(255,255,255,0.10)') : 'transparent',
                        color: active ? tokens.text.primary : tokens.text.tertiary,
                        cursor: active ? 'default' : 'pointer',
                        border: 'none',
                      }}
                      title={opt.id === 'style' ? 'Visual mood do motion' : 'Componente / shot template — opcional'}
                    >
                      {opt.label} <span className="opacity-50">({opt.count})</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-[10px] font-medium truncate" style={{ color: tokens.text.tertiary }}>
                {motionLabel}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showMotionGrid && (
              <button
                onClick={() => setShowMotionGrid(false)}
                className="text-[11px] font-medium"
                style={{
                  color: tokens.text.secondary,
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
                title="Voltar pra visão principal"
              >
                Esconder ▴
              </button>
            )}
            {/* Dark/Light chip — controls how the NEXT generation paints
                backgrounds. */}
            {onSetMotionColorMode && (
              <div
                className="flex items-center gap-0.5 p-0.5 rounded-md"
                style={{ backgroundColor: isLight ? '#FFFFFF' : 'rgba(0,0,0,0.25)' }}
              >
                {(['light', 'dark'] as const).map(mode => {
                  const active = (motionColorMode ?? 'dark') === mode;
                  return (
                    <button
                      key={mode}
                      onClick={() => onSetMotionColorMode(mode)}
                      className="px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors"
                      style={{
                        backgroundColor: active ? (isLight ? '#F4F4F5' : 'rgba(255,255,255,0.1)') : 'transparent',
                        color: active ? tokens.text.primary : tokens.text.tertiary,
                        cursor: 'pointer',
                        border: 'none',
                      }}
                      title={mode === 'light' ? 'Motion com fundo claro' : 'Motion com fundo escuro'}
                    >
                      <span>{mode === 'light' ? '☀' : '🌙'}</span>
                      <span>{mode === 'light' ? 'Claro' : 'Escuro'}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        </div>
        {/* ─── Zone 2 (middle): disclosure + horizontal carousel ─────────
            flex column inside the flex-1 zone so the disclosure / segmented
            control stays ALWAYS visible at the top, and only the carousel
            below it gets cropped if vertical space runs out. */}
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">

        {/* Disclosure trigger — only shown when CLOSED. When open, the
            segmented control + "Esconder ▴" link live in the status strip
            above. This zone just contains the carousel. */}
        {!showMotionGrid && (
          <button
            onClick={() => {
              // Auto-pick the category that contains the current preset
              const cat = (EFFECT_PRESET_IDS as readonly string[]).includes(currentPresetId)
                ? 'effect'
                : 'style';
              setMotionCategory(cat);
              setShowMotionGrid(true);
            }}
            className="shrink-0 w-full text-center text-[11px] font-medium py-1.5 rounded transition-colors"
            style={{
              color: tokens.text.secondary,
              backgroundColor: 'transparent',
              border: `1px dashed ${tokens.border.subtle}`,
              cursor: 'pointer',
            }}
          >
            Trocar manualmente ▾
          </button>
        )}

        {/* Full chip carousel — hidden by default. When open, renders TWO
            horizontal scroll rows (Estilo + Efeito) with 9:16 mini-thumbnails.
            Horizontal scroll only — vertical height stays inside the shell. */}
        {showMotionGrid && (() => {
          // Render helper — one 9:16 mini-thumbnail per preset. Closure over
          // local props to keep the chip styling identical between rows.
          const renderThumb = (p: typeof STYLE_PRESETS[number], opts?: { autoBadge?: boolean }) => {
            const isActive = currentPresetId === p.id;
            const auto = !!opts?.autoBadge;
            const tip = auto
              ? `Sugerido: ${detected.reason}${isActive ? '' : ' — clique para aplicar'}`
              : p.bestFor;
            // Atmosphere-aware mini-background that hints at the preset's mood
            // without actually rendering the motion. baseBg + warmGlow give
            // each thumb its own personality before the user generates.
            const a = p.atmosphere;
            const thumbBg = `radial-gradient(circle at 30% 30%, ${a.warmGlow.color}${Math.round(a.warmGlow.alpha * 255).toString(16).padStart(2, '0')} 0%, transparent 55%), radial-gradient(circle at 75% 75%, ${a.coolGlow.color}${Math.round(a.coolGlow.alpha * 255).toString(16).padStart(2, '0')} 0%, transparent 55%), ${a.baseBg}`;
            return (
              <button
                key={p.id}
                data-preset-id={p.id}
                onClick={() => {
                  // glass-tech is the natural avatar default (effectDetector
                  // rule 12). Clicking it on an AVATAR block clears the
                  // override → falls back to that default cleanly. But on
                  // b-roll there's no rule recommending glass-tech, so
                  // clearing the override would bounce the user to the
                  // editorial-clean fallback — felt like a bug. So we only
                  // use the "clear" shortcut when the click matches the
                  // block's natural detected default; otherwise we set the
                  // override explicitly.
                  const isAvatarBlock = block.kind === 'avatar';
                  const isNaturalDefault = p.id === 'glass-tech' && isAvatarBlock;
                  onSetStylePreset?.(isNaturalDefault ? undefined : (p.id as StylePresetId));
                }}
                className="relative shrink-0 rounded-lg transition-all flex flex-col items-center overflow-hidden"
                style={{
                  width: STYLE_THUMB_WIDTH,
                  border: `2px solid ${isActive ? '#A78BFA' : (auto ? '#A78BFA80' : tokens.border.subtle)}`,
                  cursor: 'pointer',
                  boxShadow: isActive ? '0 0 0 3px rgba(167,139,250,0.18)' : 'none',
                  backgroundColor: isLight ? '#FFFFFF' : 'rgba(255,255,255,0.04)',
                }}
                title={tip}
              >
                {/* 9:16 mini canvas hint. Aspect ratio matches the real reel. */}
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '9 / 16',
                    background: thumbBg,
                    position: 'relative',
                  }}
                >
                  <span
                    className="absolute inset-0 flex items-center justify-center text-2xl leading-none"
                    aria-hidden
                  >
                    {p.emoji}
                  </span>
                  {auto && (
                    <span
                      className="absolute top-1 right-1 text-[8px] font-bold px-1 py-0.5 rounded-full leading-none"
                      style={{
                        backgroundColor: '#A78BFA',
                        color: '#fff',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                      }}
                    >
                      {isActive ? '✓' : 'auto'}
                    </span>
                  )}
                </div>
                <span
                  className="text-[9px] text-center leading-tight font-medium truncate w-full px-1 py-1"
                  style={{ color: isActive ? '#A78BFA' : tokens.text.secondary }}
                >
                  {p.label}
                </span>
              </button>
            );
          };
          const styleSet = new Set<string>(STYLE_PRESET_IDS);
          const effectSet = new Set<string>(EFFECT_PRESET_IDS);
          // Hide deprecated/WIP presets (e.g. karaoke-captions until it's
          // reimplemented as a native preset). Historical motions using them
          // still render correctly — they just don't appear in the picker.
          const styles  = STYLE_PRESETS.filter(p => styleSet.has(p.id) && !isHidden(p.id));
          const effects = STYLE_PRESETS.filter(p => effectSet.has(p.id) && !isHidden(p.id));
          // Active id for auto-scroll: respect manual override; otherwise
          // anchor on the detector's recommendation so the recommended thumb
          // is visible right after the user opens the carousel.
          const activeId = (block.stylePresetOverride ?? detected.recommendedEffect) as string | undefined;
          return (
            // Single carousel — shows only the category selected via the
            // segmented control above. activeId centers the active thumb in
            // view as soon as the category renders. flex-1 lets it earn
            // whatever vertical room is left after the segmented control.
            <div className="flex-1 min-h-0 overflow-hidden">
              <CarouselRow activeId={activeId}>
                {(motionCategory === 'style' ? styles : effects).map(p =>
                  renderThumb(p, { autoBadge: p.id === detected.recommendedEffect }),
                )}
              </CarouselRow>
            </div>
          );
        })()}
        </div>
        {/* ─── Zone 3 (bottom): action buttons (pinned to floor) ──────── */}
        {/* Primary: regenerate inline (no modal). Secondary: open advanced editor. */}
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={onGenerateMotion}
            disabled={isBusy}
            className="px-3 py-1.5 rounded-md text-xs font-medium transition-opacity"
            style={{
              backgroundColor: '#A78BFA',
              color: '#fff',
              border: 'none',
              cursor: isBusy ? 'wait' : 'pointer',
              opacity: isBusy ? 0.6 : 1,
            }}
          >
            {isBusy
              ? '⏳ Gerando…'
              : block.motion?.status === 'ready' ? '↻ Regerar motion' : '✨ Gerar motion'}
          </button>
          <button
            onClick={onOpenMotion}
            disabled={isBusy}
            className="px-3 py-1.5 rounded-md text-xs"
            style={{
              backgroundColor: 'transparent',
              color: tokens.text.secondary,
              border: `1px solid ${tokens.border.subtle}`,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              opacity: isBusy ? 0.5 : 1,
            }}
          >
            Edição avançada…
          </button>
        </div>
      </div>
    );
  };

  const avatarBody = () => {
    if (!isAvatar || !block) return null;
    const zoomMin = 1.0, zoomMax = 2.4, zoomStep = 0.02;
    const zoomValue = block.avatarZoom ?? defaultZoom;
    const clampedZoom = Math.max(zoomMin, Math.min(zoomMax, zoomValue));
    const atAuto = Math.abs(zoomValue - defaultZoom) < zoomStep;
    const offsetY = block.avatarOffsetY ?? 0;
    const visibleSec = block.avatarVisibleSec ?? blockDuration;
    const isPartial = block.avatarVisibleSec !== undefined && block.avatarVisibleSec < blockDuration - 0.05;
    return (
      // Centered vertically in the 220px shell.
      <div className="h-full flex items-center">
      <div className="grid grid-cols-3 gap-3 w-full">
        {/* Photo picker */}
        <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)' }}>
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: tokens.text.tertiary }}>Foto do avatar</div>
          <PhotoPicker currentPhotoId={block.avatarPhotoId} onPick={(id) => onSetAvatarPhoto?.(id)} />
        </div>

        {/* Zoom + offset */}
        <div className="rounded-lg px-3 py-2.5 space-y-2.5" style={{ backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)' }}>
          <div>
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: tokens.text.tertiary }} className="uppercase tracking-wider font-semibold">Zoom</span>
              <span className={`font-mono ${atAuto ? '' : 'text-violet-400'}`} style={atAuto ? { color: tokens.text.secondary } : undefined}>
                {zoomValue.toFixed(2)}x
                {atAuto && <span className="ml-1 opacity-60">preenche</span>}
              </span>
            </div>
            <input
              type="range" min={zoomMin} max={zoomMax} step={zoomStep}
              value={clampedZoom}
              onChange={(e) => onSetAvatarZoom?.(parseFloat(e.target.value))}
              onDoubleClick={() => onSetAvatarZoom?.(defaultZoom)}
              className="w-full h-1 accent-violet-400 cursor-pointer mt-1.5"
              title="Duplo-clique reseta"
            />
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: tokens.text.tertiary }} className="uppercase tracking-wider font-semibold">Posição</span>
              <span className="font-mono" style={{ color: tokens.text.secondary }}>
                {offsetY === 0 ? 'centro' : offsetY > 0 ? `+${(offsetY * 100).toFixed(0)}% ↓` : `${(offsetY * 100).toFixed(0)}% ↑`}
              </span>
            </div>
            <input
              type="range" min={-0.25} max={0.25} step={0.01}
              value={Math.max(-0.25, Math.min(0.25, offsetY))}
              onChange={(e) => onSetAvatarOffsetY?.(parseFloat(e.target.value))}
              onDoubleClick={() => onSetAvatarOffsetY?.(0)}
              className="w-full h-1 accent-violet-400 cursor-pointer mt-1.5"
            />
          </div>
        </div>

        {/* Visible cutoff */}
        <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)' }}>
          <div className="flex items-center justify-between text-[10px]">
            <span style={{ color: tokens.text.tertiary }} className="uppercase tracking-wider font-semibold">Avatar visível</span>
            <span className={`font-mono ${isPartial ? 'text-emerald-400' : ''}`} style={!isPartial ? { color: tokens.text.secondary } : undefined}>
              {visibleSec.toFixed(1)}s
              {isPartial && <span className="ml-1 opacity-70">+ broll {(blockDuration - visibleSec).toFixed(1)}s</span>}
            </span>
          </div>
          {audioReady && blockDuration > 0.5 ? (
            <input
              type="range" min={0.5} max={blockDuration} step={0.1}
              value={visibleSec}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                onSetAvatarVisibleSec?.(Math.abs(v - blockDuration) < 0.05 ? undefined : v);
              }}
              className="w-full h-1 accent-emerald-400 cursor-pointer mt-1.5"
            />
          ) : (
            <div className="text-[10px] mt-2" style={{ color: tokens.text.tertiary }}>
              Gere o áudio pra liberar o slider.
            </div>
          )}
        </div>
      </div>
      </div>
    );
  };

  const layoutBody = () => {
    if (!block) return null;
    const selectedLayout = (block.layout ?? 'avatar-only') as BlockLayout;
    return (
      // Centered vertically in the 220px shell.
      <div className="h-full flex items-center">
      <div className="rounded-lg px-3 py-2.5 w-full" style={{ backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)' }}>
        <div className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: tokens.text.tertiary }}>Layout do bloco</div>
        <div className="grid grid-cols-4 gap-2 max-w-md">
          {LAYOUT_OPTIONS.map(opt => {
            const selected = selectedLayout === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => onSetLayout?.(opt.id)}
                className="space-y-1"
                title={opt.label}
              >
                <LayoutThumb layout={opt.id} selected={selected} />
                <div className="text-[9px] text-center truncate" style={{ color: selected ? '#A78BFA' : tokens.text.tertiary }}>{opt.label}</div>
              </button>
            );
          })}
        </div>
      </div>
      </div>
    );
  };

  const statsBody = () => {
    if (!block) return null;
    const wordCount = block.text.trim().split(/\s+/).filter(Boolean).length;
    return (
      // Centered vertically in the 220px shell so the 4 stat cards don't
      // float at the top of dead space.
      <div className="h-full flex items-center">
      <div className="grid grid-cols-4 gap-3 text-[11px] w-full">
        <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)' }}>
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Início</div>
          <div className="font-mono mt-1" style={{ color: tokens.text.primary }}>{formatTime(block.start)}</div>
        </div>
        <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)' }}>
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Fim</div>
          <div className="font-mono mt-1" style={{ color: tokens.text.primary }}>{formatTime(block.end)}</div>
        </div>
        <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)' }}>
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Duração</div>
          <div className="font-mono mt-1" style={{ color: tokens.text.primary }}>{blockDuration.toFixed(1)}s</div>
        </div>
        <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)' }}>
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Palavras</div>
          <div className="font-mono mt-1" style={{ color: tokens.text.primary }}>{wordCount}</div>
        </div>
      </div>
      </div>
    );
  };

  const vozBody = () => (
    // Centralized empty-state — 220px shell otherwise leaves the text
    // floating at the top of a big void. Apple-pattern: icon + title +
    // subtitle in a vertically centered cluster.
    <div className="h-full flex flex-col items-center justify-center gap-2 px-4 text-center">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
        style={{
          backgroundColor: isLight ? 'rgba(167,139,250,0.10)' : 'rgba(167,139,250,0.15)',
          color: '#A78BFA',
        }}
        aria-hidden
      >
        🎙
      </div>
      <div className="text-[12px] font-medium" style={{ color: tokens.text.primary }}>
        Controles de voz por bloco
      </div>
      <div className="text-[11px]" style={{ color: tokens.text.tertiary }}>
        Em breve nesta tab: tom, velocidade e ênfase por bloco.
      </div>
    </div>
  );

  const renderTabBody = () => {
    if (isEmpty || isMultiSelect) return null;
    switch (effectiveTab) {
      case 'motion': return motionBody();
      case 'avatar': return avatarBody();
      case 'layout': return layoutBody();
      case 'voz':    return vozBody();
      case 'stats':  return statsBody();
    }
  };

  const tabs: { id: InspectorTab; label: string; disabled: boolean }[] = [
    { id: 'motion', label: 'Motion', disabled: false },
    { id: 'avatar', label: 'Avatar', disabled: !block || block.kind !== 'avatar' },
    { id: 'layout', label: 'Layout', disabled: !block },
    { id: 'voz',    label: 'Voz',    disabled: !block || block.kind !== 'avatar' },
    { id: 'stats',  label: 'Stats',  disabled: !block },
  ];

  return (
    <div
      className="shrink-0 px-5"
      style={{
        backgroundColor: tokens.bg.surface,
        borderTop: `1px solid ${tokens.border.subtle}`,
        transition: 'padding 0.18s ease',
      }}
    >
      <div
        className="flex items-center justify-between py-2.5 cursor-pointer select-none"
        onClick={() => !isEmpty && !isMultiSelect && setCollapsed(c => !c)}
        title={collapsed ? 'Expandir inspector' : 'Recolher inspector'}
      >
        <div className="flex items-center gap-2">
          {!isEmpty && !isMultiSelect && (
            <span
              className="inline-block transition-transform duration-200"
              style={{
                transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                color: tokens.text.tertiary,
                fontSize: 11,
                width: 12,
              }}
            >
              ▾
            </span>
          )}
          {(isEmpty || isMultiSelect) ? (
            <span
              className="text-[10px] uppercase font-semibold tracking-wider"
              style={{ color: tokens.text.tertiary }}
            >
              {headerText}
            </span>
          ) : (
            <>
              <span
                className="text-[10px] uppercase font-semibold tracking-wider"
                style={{ color: tokens.text.tertiary }}
              >
                Editando
              </span>
              {/* Kind toggle — single most important per-block decision.
                  Lives in the Inspector header so users don't have to dive
                  into the sidebar card to flip avatar ↔ b-roll. */}
              {onToggleKind && (
                <div
                  className="flex items-center gap-0.5 p-0.5 rounded-md"
                  style={{ backgroundColor: isLight ? '#FFFFFF' : 'rgba(0,0,0,0.25)', border: `1px solid ${tokens.border.subtle}` }}
                  onClick={e => e.stopPropagation()}
                >
                  {([
                    { kind: 'avatar' as const, label: 'Avatar', icon: '👤' },
                    { kind: 'broll'  as const, label: 'B-roll', icon: '🎞' },
                  ]).map(opt => {
                    const active = (block?.kind ?? 'avatar') === opt.kind;
                    return (
                      <button
                        key={opt.kind}
                        onClick={() => { if (!active) onToggleKind(); }}
                        className="px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors"
                        style={{
                          backgroundColor: active ? (isLight ? '#F4F4F5' : 'rgba(255,255,255,0.10)') : 'transparent',
                          color: active ? tokens.text.primary : tokens.text.tertiary,
                          cursor: active ? 'default' : 'pointer',
                          border: 'none',
                        }}
                        title={opt.kind === 'avatar' ? 'Bloco com avatar falando' : 'Bloco com B-roll (vídeo de apoio)'}
                      >
                        <span>{opt.icon}</span>
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {!isEmpty && !isMultiSelect && (
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-md"
            style={{ backgroundColor: tokens.bg.elevated }}
            onClick={e => e.stopPropagation()}
          >
            {tabs.map(t => {
              const active = effectiveTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => { if (t.disabled) return; setActiveTab(t.id); if (collapsed) setCollapsed(false); }}
                  disabled={t.disabled}
                  className="px-2.5 py-1 rounded text-[11px] font-medium transition-colors"
                  style={{
                    backgroundColor: active
                      ? (isLight ? '#FFFFFF' : tokens.bg.surface)
                      : 'transparent',
                    color: active ? tokens.text.primary : t.disabled ? tokens.text.tertiary : tokens.text.secondary,
                    boxShadow: active
                      ? (isLight ? '0 1px 2px rgba(0,0,0,0.08)' : '0 1px 3px rgba(0,0,0,0.4)')
                      : 'none',
                    border: active && isLight ? '1px solid rgba(0,0,0,0.06)' : 'none',
                    opacity: t.disabled ? 0.4 : 1,
                    cursor: t.disabled ? 'not-allowed' : 'pointer',
                  }}
                  title={t.disabled ? 'Indisponível pra este tipo de bloco' : undefined}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!collapsed && !isEmpty && !isMultiSelect && (
        <div className="pb-3 pt-1">
          <TabBodyShell>{renderTabBody()}</TabBodyShell>
        </div>
      )}
      {!collapsed && (isEmpty || isMultiSelect) && (
        <div className="pb-3 pt-0 text-[11px]" style={{ color: tokens.text.tertiary }}>
          {isMultiSelect
            ? 'Ações em lote disponíveis pelos botões da timeline.'
            : 'Selecione um bloco na timeline ou no painel da direita.'}
        </div>
      )}
    </div>
  );
};
