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
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ScriptBlock, AppTheme, BlockLayout } from './types';
import { getTheme } from './theme';
import { LAYOUT_OPTIONS } from './layouts';
import { loadAvatarPhotos } from './avatarPhotosStore';
import type { StylePresetId } from './motionStylePresets';
import type { MotionPlacement } from './motionLibrary';

// Local mm:ss.cc formatter — formatTime in ReelsStudio.tsx isn't exported.
const formatTime = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) return '00:00.00';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

export type InspectorTab = 'motion' | 'avatar' | 'layout' | 'voz' | 'assets' | 'stats';

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
  /** Unified placement setter — writes placement onto the block's motion
   * (creating a draft when no motion exists yet). */
  onSetMotionPlacement?: (placement: MotionPlacement) => void;
  /** Per-block motion model override (a MotionModelId, or undefined = global default). */
  motionModelOverride?: string;
  /** Setter for the per-block model override. undefined → revert to global default. */
  onSetMotionModel?: (model: string | undefined) => void;
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
  /** True when the project's asset folder has files but the selected block has
   *  none attached. Inspector blocks the Gerar/Regerar action and surfaces an
   *  amber "anexe um asset" status so the user fixes the gap before retrying. */
  requiresAsset?: boolean;
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
const INSPECTOR_TAB_BODY_HEIGHT = 220;
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
  const borderClass = selected ? 'border-blue-400 shadow-[0_0_8px_rgba(10,132,255,0.4)]' : 'border-white/10';
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
          usingDefault ? 'border-blue-400 bg-blue-500/15 text-blue-200' : 'border-white/10 bg-black/30 text-zinc-400 hover:bg-white/5'
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
              selected ? 'border-blue-400' : 'border-white/10 hover:border-white/30'
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
  onSetMotionPlacement,
  motionModelOverride,
  onSetMotionModel,
  onOpenMotion,
  onGenerateMotion,
  motionBusy,
  motionColorMode,
  onSetMotionColorMode,
  onOpenAssetPicker,
  onRegenAvatar: _onRegenAvatar,
  onToggleKind,
  blockIndex,
  blockTotal,
  brandHasLogo,
  brandHasIdentity,
  audioWordCount,
  requiresAsset = false,
}) => {
  const tokens = getTheme(appTheme ?? 'dark');
  const isLight = (appTheme ?? 'dark') === 'light';
  const [activeTab, setActiveTab] = useState<InspectorTab>(() => {
    // NOTE: 'motion' may still arrive from old sessionStorage — effectiveTab
    // redirects it to 'layout' below.
    try {
      const v = sessionStorage.getItem(STORAGE_KEY_TAB);
      if (v === 'motion' || v === 'avatar' || v === 'layout' || v === 'voz' || v === 'assets' || v === 'stats') return v;
    } catch { /* ignore */ }
    return 'layout';
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    // Collapsed by default (progressive disclosure): Avatar/Layout/Voz are
    // occasional adjustments — the screen breathes, the preview stays big.
    try { return sessionStorage.getItem(STORAGE_KEY_COLLAPSED) !== '0'; } catch { return true; }
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
  const [motionCategory, setMotionCategory] = useState<'template' | 'style' | 'effect'>(() => {
    try {
      const v = sessionStorage.getItem(STORAGE_KEY_MOTION_CATEGORY);
      if (v === 'template' || v === 'style' || v === 'effect') return v;
    } catch { /* ignore */ }
    return 'template';
  });
  // Inline per-block motion-model picker. The effective model is the block's
  // override when set, else the global default — and picking one writes the
  // per-block override (via onSetMotionModel), so each block can use its own.
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

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
    if ((activeTab === 'avatar' || activeTab === 'voz') && !isAvatar) return 'layout';
    if (activeTab === 'motion') return 'layout'; // legacy sessionStorage value
    return activeTab;
  })();

  const headerText = (() => {
    if (isMultiSelect) return `${multiSelectCount} blocos selecionados`;
    if (isEmpty) return 'Nenhum bloco selecionado';
    return `Editando · ${isAvatar ? 'avatar' : 'b-roll'}`;
  })();

  // ─── Tab bodies ─────────────────────────────────────────────────
  // motionBody removed — the Motion Dock in the right panel (Script column)
  // is the single home of motion configuration. See ReelsStudio.tsx
  // renderMotionDockSection.

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
              <span className={`font-mono ${atAuto ? '' : 'text-blue-400'}`} style={atAuto ? { color: tokens.text.secondary } : undefined}>
                {zoomValue.toFixed(2)}x
                {atAuto && <span className="ml-1 opacity-60">preenche</span>}
              </span>
            </div>
            <input
              type="range" min={zoomMin} max={zoomMax} step={zoomStep}
              value={clampedZoom}
              onChange={(e) => onSetAvatarZoom?.(parseFloat(e.target.value))}
              onDoubleClick={() => onSetAvatarZoom?.(defaultZoom)}
              className="w-full h-1 accent-blue-400 cursor-pointer mt-1.5"
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
              className="w-full h-1 accent-blue-400 cursor-pointer mt-1.5"
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
                <div className="text-[9px] text-center truncate" style={{ color: selected ? '#60A5FA' : tokens.text.tertiary }}>{opt.label}</div>
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
          backgroundColor: isLight ? 'rgba(10,132,255,0.10)' : 'rgba(10,132,255,0.15)',
          color: '#60A5FA',
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

  const assetsBody = () => {
    if (!block) return null;
    const assets = block.attachedAssets ?? [];
    const hasAny = assets.length > 0;
    return (
      <div className="h-full flex flex-col gap-2 py-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold" style={{ color: tokens.text.primary }}>
            {hasAny ? `${assets.length} asset${assets.length === 1 ? '' : 's'} neste bloco` : 'Sem assets anexados'}
          </div>
          {onOpenAssetPicker && (
            <button
              onClick={onOpenAssetPicker}
              className="px-2.5 py-1 rounded-md text-[10.5px] font-medium border transition-colors flex items-center gap-1.5"
              style={{
                backgroundColor: isLight ? 'rgba(10,132,255,0.10)' : 'rgba(10,132,255,0.18)',
                borderColor: 'rgba(10,132,255,0.40)',
                color: '#60A5FA',
              }}
            >
              <span>📎</span>
              <span>{hasAny ? 'Gerenciar' : 'Anexar asset'}</span>
            </button>
          )}
        </div>
        {hasAny ? (
          <div className="flex-1 overflow-y-auto -mx-1 px-1">
            <div className="grid grid-cols-4 gap-2">
              {assets.map((a, idx) => {
                const url = convertFileSrc(a.path);
                return (
                  <button
                    key={`${a.path}-${idx}`}
                    onClick={onOpenAssetPicker}
                    className="relative rounded-lg overflow-hidden border aspect-[9/16] group"
                    style={{
                      backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)',
                      borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.10)',
                    }}
                    title={`${idx + 1}. ${a.name}`}
                  >
                    {a.type === 'image' ? (
                      <img src={url} alt={a.name} className="w-full h-full object-cover" />
                    ) : (
                      <video src={url} muted playsInline className="w-full h-full object-cover" />
                    )}
                    <span className="absolute top-1 left-1 text-[9px] font-bold px-1 rounded bg-black/60 text-white">
                      {idx + 1}
                    </span>
                    <span className="absolute top-1 right-1 text-[9px] px-1 rounded bg-black/60 text-white">
                      {a.type === 'image' ? '🖼️' : '🎬'}
                    </span>
                    <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-gradient-to-t from-black/80 to-transparent">
                      <div className="text-[9px] text-white truncate">{a.name}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            {assets.length > 1 && (
              <div className="mt-2 text-[10px] text-center" style={{ color: tokens.text.tertiary }}>
                Múltiplos assets viram um carrossel automático dentro do bloco.
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
              style={{
                backgroundColor: isLight ? 'rgba(10,132,255,0.10)' : 'rgba(10,132,255,0.15)',
                color: '#60A5FA',
              }}
              aria-hidden
            >
              📎
            </div>
            <div className="text-[12px] font-medium" style={{ color: tokens.text.primary }}>
              Anexe uma imagem ou vídeo
            </div>
            <div className="text-[11px] max-w-[260px]" style={{ color: tokens.text.tertiary }}>
              O motion vai usar esse asset como peça central. Anexe vários e eles viram um carrossel sequencial dentro do bloco.
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTabBody = () => {
    if (isEmpty || isMultiSelect) return null;
    switch (effectiveTab) {
      // 'motion' no longer has a body here — the Motion Dock lives in the
      // right panel (Script column). Legacy sessionStorage value falls back.
      case 'motion': return layoutBody();
      case 'avatar': return avatarBody();
      case 'layout': return layoutBody();
      case 'voz':    return vozBody();
      case 'assets': return assetsBody();
      case 'stats':  return statsBody();
    }
  };

  // Motion tab removed — its home is the Motion Dock in the right panel.
  const tabs: { id: InspectorTab; label: string; disabled: boolean }[] = [
    { id: 'avatar', label: 'Avatar', disabled: !block || block.kind !== 'avatar' },
    { id: 'layout', label: 'Layout', disabled: !block },
    { id: 'voz',    label: 'Voz',    disabled: !block || block.kind !== 'avatar' },
    { id: 'assets', label: 'Assets', disabled: !block },
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
