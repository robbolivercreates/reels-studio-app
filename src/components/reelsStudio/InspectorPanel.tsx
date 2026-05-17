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

import React, { useEffect, useState } from 'react';
import type { ScriptBlock, AppTheme, BlockLayout } from './types';
import { getTheme } from './theme';
import { LAYOUT_OPTIONS } from './layouts';
import { loadAvatarPhotos } from './avatarPhotosStore';
import { STYLE_PRESETS, type StylePresetId } from './motionStylePresets';

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
  onOpenAssetPicker?: () => void;
  onRegenAvatar?: () => void;
}

const STORAGE_KEY_TAB = 'reels.inspector.tab';
const STORAGE_KEY_COLLAPSED = 'reels.inspector.collapsed';

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
  onOpenAssetPicker: _onOpenAssetPicker,
  onRegenAvatar: _onRegenAvatar,
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

  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_TAB, activeTab); } catch { /* ignore */ }
  }, [activeTab]);
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY_COLLAPSED, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

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
    const currentPresetId = (block.stylePresetOverride ?? 'glass-tech') as string;
    const motionStatus = block.motion?.status;
    const isBusy = !!motionBusy;
    const motionLabel = (() => {
      if (isBusy) return motionBusy;
      if (!block.motion) return 'Sem motion · escolha um estilo abaixo';
      if (motionStatus === 'ready') return 'Motion pronto';
      if (motionStatus === 'generating') return 'Gerando…';
      if (motionStatus === 'rendering') return 'Renderizando…';
      if (motionStatus === 'error') return 'Erro · abra o editor pra ver';
      return 'Rascunho';
    })();
    return (
      <div className="space-y-3">
        {/* Style preset grid — replaces the dropdown that lived inside the card. */}
        <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)' }}>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>
              Estilo do motion
            </div>
            <div className="text-[10px]" style={{ color: tokens.text.tertiary }}>
              {motionLabel}
            </div>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {STYLE_PRESETS.filter(p => p.id !== 'claude-ui').map(p => {
              const isActive = currentPresetId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => onSetStylePreset?.(p.id === 'glass-tech' ? undefined : (p.id as StylePresetId))}
                  className="rounded-md px-2 py-2 transition-all flex flex-col items-center gap-1 border"
                  style={{
                    backgroundColor: isActive
                      ? (isLight ? 'rgba(167,139,250,0.12)' : 'rgba(167,139,250,0.18)')
                      : (isLight ? '#FFFFFF' : 'rgba(255,255,255,0.04)'),
                    borderColor: isActive ? '#A78BFA' : tokens.border.subtle,
                    cursor: 'pointer',
                  }}
                  title={p.bestFor}
                >
                  <span className="text-xl leading-none">{p.emoji}</span>
                  <span
                    className="text-[10px] text-center leading-tight font-medium truncate w-full"
                    style={{ color: isActive ? '#A78BFA' : tokens.text.secondary }}
                  >
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Primary: regenerate inline (no modal). Secondary: open advanced editor. */}
        <div className="flex items-center gap-2">
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
      <div className="grid grid-cols-3 gap-3">
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
    );
  };

  const layoutBody = () => {
    if (!block) return null;
    const selectedLayout = (block.layout ?? 'avatar-only') as BlockLayout;
    return (
      <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: isLight ? tokens.bg.elevated : 'rgba(255,255,255,0.03)' }}>
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
    );
  };

  const statsBody = () => {
    if (!block) return null;
    const wordCount = block.text.trim().split(/\s+/).filter(Boolean).length;
    return (
      <div className="grid grid-cols-4 gap-3 text-[11px]">
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
    );
  };

  const vozBody = () => (
    <div className="text-[11px]" style={{ color: tokens.text.tertiary }}>
      <em>Tab Voz · Onda 2 (próxima iteração) trará controles de voz por bloco aqui.</em>
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
          <span
            className="text-[10px] uppercase font-semibold tracking-wider"
            style={{ color: tokens.text.tertiary }}
          >
            {headerText}
          </span>
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
        <div className="pb-3 pt-1">{renderTabBody()}</div>
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
