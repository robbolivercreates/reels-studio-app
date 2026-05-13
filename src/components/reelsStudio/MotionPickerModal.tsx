import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  STYLE_PRESETS,
  NATIVE_PRESET_IDS,
  findStylePreset,
  type StylePresetId,
} from './motionStylePresets';
import {
  type MotionConfig,
  type MotionLayer,
  newMotionId,
} from './motionLibrary';
import { generateMotionHtml, buildFullHtmlDoc } from '../../services/motionService';
import type { ScriptBlock, MotionColorMode, AppTheme } from './types';
import { useTheme } from './useTheme';

interface Props {
  block: ScriptBlock;
  /** Cached brand identity from the reel; reused so motions stay visually consistent. */
  brandIdentity?: Record<string, unknown>;
  /** Called when generation produced a new brand (first motion of the reel). */
  onBrandLearned?: (brand: Record<string, unknown>) => void;
  /** Global reel color mode — used to bias generation + warn the user on dark presets. */
  motionColorMode: MotionColorMode;
  /** Setter for the reel-wide motion color mode. */
  onSetMotionColorMode: (mode: MotionColorMode) => void;
  /** App UI theme — modal chrome respects this. */
  appTheme: AppTheme;
  onClose: () => void;
  onSave: (motion: MotionConfig | undefined) => void;
}

interface RenderProgress {
  motion_id: string;
  stage: string;
  message: string;
  percent: number | null;
}

const deriveDefaultText = (blockText: string): string => {
  const t = blockText.trim();
  if (t.length <= 60) return t;
  const sentence = t.split(/[.!?]\s/)[0];
  if (sentence.length <= 80) return sentence;
  return sentence.slice(0, 60).split(' ').slice(0, -1).join(' ') + '…';
};

export const MotionPickerModal: React.FC<Props> = ({ block, brandIdentity, onBrandLearned, motionColorMode, onSetMotionColorMode, appTheme, onClose, onSave }) => {
  const tokens = useTheme(appTheme);
  // Existing motion or fresh draft.
  const initial: MotionConfig = useMemo(() => block.motion ?? {
    id: newMotionId(),
    presetId: 'editorial-clean',
    // Avatar blocks → split-bottom (50/50). B-roll blocks → replace (full-frame).
    layer: block.kind === 'broll' ? 'replace' : 'split-bottom',
    intent: '',
    text: deriveDefaultText(block.text),
    durationSec: 4,
    html: '',
    status: 'draft',
    createdAt: Date.now(),
  }, [block.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [motion, setMotion] = useState<MotionConfig>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [rationale, setRationale] = useState<string>('');
  const [previewMode, setPreviewMode] = useState<'live' | 'mp4'>('live');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Subscribe to render progress events from Rust.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<RenderProgress>('motion://render-progress', (e) => {
      if (e.payload.motion_id === motion.id) setProgress(e.payload);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [motion.id]);

  // Reset progress when switching motion id (creating new one).
  useEffect(() => { setProgress(null); }, [motion.id]);

  const patch = <K extends keyof MotionConfig>(key: K, value: MotionConfig[K]) => {
    setMotion(m => ({ ...m, [key]: value }));
  };

  const fullHtmlDoc = useMemo(
    () => motion.html ? buildFullHtmlDoc(motion, motion.canvasAspect, motionColorMode) : '',
    [motion.html, motion.id, motion.durationSec, motion.canvasAspect, motionColorMode],
  );

  // ─── Generate via Gemini ─────────────────────────────────────────────

  const handleGenerate = async () => {
    const isNative = NATIVE_PRESET_IDS.includes(motion.presetId);
    setError(null);
    setBusy(isNative ? 'Gerando motion nativo…' : 'Gemini lendo o bloco e criando o motion…');
    try {
      const result = await generateMotionHtml({
        presetId: motion.presetId,
        blockText: block.text,
        // Pass overrides only if user toggled advanced and edited them.
        // For native presets, always pass text so user can customise the command.
        intent: showAdvanced ? motion.intent : undefined,
        text: (isNative || showAdvanced) ? motion.text : undefined,
        secondaryText: motion.secondaryText,
        number: motion.number,
        durationSec: motion.durationSec,
        compositionId: motion.id,
        motionLayer: motion.layer,
        canvasAspect: motion.canvasAspect,
        existingBrand: brandIdentity as Parameters<typeof generateMotionHtml>[0]['existingBrand'],
        motionColorMode,
      });
      // First motion of the reel? Cache the brand so subsequent motions reuse it.
      if (result.brand && !brandIdentity && onBrandLearned) {
        onBrandLearned(result.brand as unknown as Record<string, unknown>);
      }
      setRationale(result.rationale);
      setMotion(m => ({
        ...m,
        intent: result.intent || m.intent,
        text: result.text || m.text,
        html: result.htmlBody,
        status: 'ready',
        generatedAt: Date.now(),
        errorMessage: undefined,
      }));
      setPreviewMode('live');
      setBusy(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gerar.');
      setBusy(null);
    }
  };

  // ─── Render via HyperFrames ──────────────────────────────────────────

  const handleRender = async () => {
    if (!motion.html) {
      setError('Gere o motion antes de renderizar.');
      return;
    }
    setError(null);
    setBusy('Renderizando MP4 com HyperFrames…');
    try {
      // 1. Save HTML to disk.
      await invoke('save_motion_html', { motionId: motion.id, html: fullHtmlDoc });
      // 2. Render.
      const result = await invoke<{ mp4_path: string; size_bytes: number }>(
        'render_motion', { motionId: motion.id },
      );
      setMotion(m => ({
        ...m,
        videoPath: result.mp4_path,
        status: 'ready',
        renderedAt: Date.now(),
        errorMessage: undefined,
      }));
      setPreviewMode('mp4');
      setBusy(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMotion(m => ({ ...m, status: 'error', errorMessage: msg }));
      setBusy(null);
    }
  };

  const handleSave = () => onSave(motion);
  const handleRemove = () => onSave(undefined);

  // ─── MP4 preview URL (load bytes via tauri invoke + objectURL) ───────

  const [mp4Url, setMp4Url] = useState<string | null>(null);
  useEffect(() => {
    let revokedUrl: string | null = null;
    if (previewMode === 'mp4' && motion.videoPath) {
      void (async () => {
        try {
          const bytes = await invoke<number[]>('read_motion_video_bytes', { motionId: motion.id });
          const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });
          const url = URL.createObjectURL(blob);
          revokedUrl = url;
          setMp4Url(url);
        } catch {
          setMp4Url(null);
        }
      })();
    } else {
      setMp4Url(null);
    }
    return () => { if (revokedUrl) URL.revokeObjectURL(revokedUrl); };
  }, [previewMode, motion.videoPath, motion.id, motion.renderedAt]);

  // ─── Live iframe — animation runs via GSAP timeline play loop ────────

  useEffect(() => {
    if (previewMode !== 'live') return;
    const iframe = iframeRef.current;
    if (!iframe || !fullHtmlDoc) return;
    iframe.srcdoc = fullHtmlDoc;
    const onLoad = () => {
      try {
        const win = iframe.contentWindow as any;
        const tryPlay = () => {
          const tl = win?.__timelines?.[motion.id];
          if (tl) {
            tl.repeat(-1).play();
          } else {
            setTimeout(tryPlay, 100);
          }
        };
        setTimeout(tryPlay, 200);
      } catch {/* ignore */}
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [fullHtmlDoc, previewMode, motion.id]);

  const preset = findStylePreset(motion.presetId);

  return (
    <div
      className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-[60] p-6"
      style={{ backgroundColor: appTheme === 'light' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.7)' }}
    >
      <div
        className="rounded-2xl shadow-2xl max-w-5xl w-full overflow-hidden flex flex-col max-h-[92vh]"
        style={{
          backgroundColor: tokens.bg.surface,
          border: `1px solid ${tokens.border.subtle}`,
          color: tokens.text.primary,
        }}
      >
        {/* Header */}
        <div
          className="px-6 pt-6 pb-4 flex items-start justify-between"
          style={{ borderBottom: `1px solid ${tokens.border.subtle}` }}
        >
          <div>
            <div className="text-base font-semibold mb-1" style={{ color: tokens.text.primary }}>Motion graphic</div>
            <div className="text-xs max-w-xl truncate" style={{ color: tokens.text.tertiary }}>"{block.text}"</div>
          </div>
          <button
            onClick={onClose}
            className="p-1 transition-colors"
            style={{ color: tokens.text.tertiary }}
            disabled={!!busy}
            onMouseEnter={e => e.currentTarget.style.color = tokens.text.primary}
            onMouseLeave={e => e.currentTarget.style.color = tokens.text.tertiary}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: form */}
          <div
            className="w-[440px] shrink-0 overflow-y-auto px-5 py-4 space-y-4"
            style={{ borderRight: `1px solid ${tokens.border.subtle}` }}
          >

            {/* Hint card — always-on AI explanation */}
            <div
              className="rounded-lg px-3 py-2.5"
              style={{
                backgroundColor: tokens.bg.hover,
                border: `1px solid ${tokens.border.subtle}`,
              }}
            >
              <div className="text-[12px] font-medium leading-tight" style={{ color: tokens.text.primary }}>
                A IA escolhe a ideia e a animação
              </div>
              <div className="text-[10.5px] mt-0.5 leading-snug" style={{ color: tokens.text.secondary }}>
                Pesquisa as cores da marca, classifica o bloco e gera a animação. Você pode trocar o estilo abaixo ou editar texto e ideia.
              </div>
            </div>

            {/* Motion color mode — global to the reel */}
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] mb-1.5" style={{ color: tokens.text.tertiary }}>
                Modo do reel
              </div>
              <div
                className="flex rounded-md p-0.5"
                style={{ backgroundColor: tokens.bg.hover }}
              >
                <button
                  onClick={() => onSetMotionColorMode('dark')}
                  className="flex-1 px-2 py-1.5 rounded text-[11px] flex items-center justify-center gap-1.5 transition-colors"
                  style={{
                    backgroundColor: motionColorMode === 'dark' ? tokens.bg.surface : 'transparent',
                    color: motionColorMode === 'dark' ? tokens.text.primary : tokens.text.secondary,
                  }}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                  Escuro
                </button>
                <button
                  onClick={() => onSetMotionColorMode('light')}
                  className="flex-1 px-2 py-1.5 rounded text-[11px] flex items-center justify-center gap-1.5 transition-colors"
                  style={{
                    backgroundColor: motionColorMode === 'light' ? tokens.bg.surface : 'transparent',
                    color: motionColorMode === 'light' ? tokens.text.primary : tokens.text.secondary,
                  }}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="4" />
                    <path strokeLinecap="round" d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
                  </svg>
                  Claro
                </button>
              </div>
              <div className="text-[10px] mt-1" style={{ color: tokens.text.tertiary }}>
                Vale para todas as motions deste reel.
              </div>
            </div>

            {/* Style preset — always visible, single source of truth */}
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] mb-2" style={{ color: tokens.text.tertiary }}>
                Estilo base
              </div>
              <div className="grid grid-cols-2 gap-2">
                {STYLE_PRESETS.map(p => {
                  const isSelected = motion.presetId === p.id;
                  const willInvert = motionColorMode === 'light' && p.bgType === 'dark';
                  const isWarm = p.bgType === 'warm';
                  return (
                    <button
                      key={p.id}
                      onClick={() => patch('presetId', p.id as StylePresetId)}
                      className="text-left px-3 py-2.5 rounded-lg transition-colors relative"
                      style={{
                        backgroundColor: isSelected ? tokens.bg.active : tokens.bg.hover,
                        border: `1px solid ${isSelected ? tokens.accent.focus : tokens.border.subtle}`,
                      }}
                      title={p.bestFor}
                    >
                      <div className="text-xs font-medium flex items-center gap-1.5" style={{ color: tokens.text.primary }}>
                        <span>{p.emoji}</span>
                        <span>{p.label}</span>
                      </div>
                      <div className="text-[10px] mt-0.5 leading-snug line-clamp-2" style={{ color: tokens.text.secondary }}>
                        {p.description}
                      </div>
                      {(willInvert || isWarm) && (
                        <div
                          className="absolute top-1.5 right-1.5 text-[9px] px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: tokens.bg.elevated,
                            color: tokens.text.tertiary,
                            border: `1px solid ${tokens.border.subtle}`,
                          }}
                        >
                          {willInvert ? '☀ invertido' : '⊙ quente'}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Editar texto e ideia — collapsed disclosure */}
            <div>
              <button
                onClick={() => setShowAdvanced(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors text-xs"
                style={{
                  color: tokens.text.secondary,
                  backgroundColor: tokens.bg.hover,
                  border: `1px solid ${tokens.border.subtle}`,
                }}
              >
                <span>Editar texto e ideia</span>
                <svg
                  className="w-3 h-3 transition-transform"
                  style={{ transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {showAdvanced && (
              <>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.18em] block mb-1.5" style={{ color: tokens.text.tertiary }}>
                    Ideia / o que mostrar
                  </label>
                  <textarea
                    value={motion.intent}
                    onChange={e => patch('intent', e.target.value)}
                    rows={3}
                    placeholder='Ex: "engrenagem girando + raio cruzando"'
                    className="w-full px-3 py-2 rounded-lg text-xs outline-none leading-relaxed resize-y"
                    style={{
                      backgroundColor: tokens.bg.hover,
                      color: tokens.text.primary,
                      border: `1px solid ${tokens.border.subtle}`,
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = tokens.accent.focus}
                    onBlur={e => e.currentTarget.style.borderColor = tokens.border.subtle}
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase tracking-[0.18em] block mb-1.5" style={{ color: tokens.text.tertiary }}>
                    Texto que aparece
                  </label>
                  <input
                    value={motion.text}
                    onChange={e => patch('text', e.target.value)}
                    placeholder="Frase curta que destaca no motion"
                    className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                    style={{
                      backgroundColor: tokens.bg.hover,
                      color: tokens.text.primary,
                      border: `1px solid ${tokens.border.subtle}`,
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = tokens.accent.focus}
                    onBlur={e => e.currentTarget.style.borderColor = tokens.border.subtle}
                  />
                </div>
              </>
            )}

            {/* When Gemini decided, show what it picked (read-only-ish) */}
            {!showAdvanced && motion.html && (motion.intent || motion.text) && (
              <div
                className="rounded-lg p-3 space-y-1.5 text-[11px]"
                style={{
                  backgroundColor: tokens.bg.hover,
                  border: `1px solid ${tokens.border.subtle}`,
                }}
              >
                {motion.intent && (
                  <div>
                    <span className="uppercase tracking-wider text-[9px]" style={{ color: tokens.text.tertiary }}>Ideia escolhida — </span>
                    <span style={{ color: tokens.text.primary }}>{motion.intent}</span>
                  </div>
                )}
                {motion.text && (
                  <div>
                    <span className="uppercase tracking-wider text-[9px]" style={{ color: tokens.text.tertiary }}>Texto destacado — </span>
                    <span className="font-medium" style={{ color: tokens.text.primary }}>{motion.text}</span>
                  </div>
                )}
              </div>
            )}

            {/* Duration + layer */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 block mb-1.5">
                  Duração
                </label>
                <select
                  value={motion.durationSec}
                  onChange={e => patch('durationSec', parseInt(e.target.value, 10))}
                  className="w-full px-2 py-1.5 rounded-md bg-black/40 border border-white/10 text-xs text-zinc-100 outline-none focus:border-violet-400/50"
                >
                  {[2, 3, 4, 5, 6, 8].map(s => (
                    <option key={s} value={s}>{s}s</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 block mb-1.5">
                  Camada
                </label>
                <div className="flex flex-col gap-1">
                  {([
                    { value: 'overlay',      label: 'Sobre o vídeo',     desc: 'screen blend — mistura com o avatar', icon: '🔀' },
                    { value: 'replace',      label: 'Frame inteiro',      desc: 'substitui tudo — sem avatar', icon: '🖼️' },
                    { value: 'split-bottom', label: 'Avatar cima / Motion baixo', desc: 'split 50/50 vertical', icon: '⬆️' },
                    { value: 'split-top',    label: 'Motion cima / Avatar baixo', desc: 'split 50/50 vertical', icon: '⬇️' },
                  ] as { value: MotionLayer; label: string; desc: string; icon: string }[]).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => patch('layer', opt.value)}
                      className={`text-left px-2.5 py-2 rounded-md border transition-colors flex items-center gap-2 ${
                        motion.layer === opt.value
                          ? 'bg-fuchsia-500/15 border-fuchsia-500/40 text-zinc-100'
                          : 'bg-black/20 border-white/10 hover:border-white/20 text-zinc-400'
                      }`}
                    >
                      <span className="text-base">{opt.icon}</span>
                      <div>
                        <div className="text-[11px] font-medium leading-tight">{opt.label}</div>
                        <div className="text-[9px] text-zinc-500 leading-tight">{opt.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Claude UI — command field (always visible for native preset) */}
            {NATIVE_PRESET_IDS.includes(motion.presetId) && (
              <div>
                <label className="text-[10px] uppercase tracking-[0.18em] block mb-1.5" style={{ color: tokens.text.tertiary }}>
                  Comando digitado
                </label>
                <input
                  value={motion.text}
                  onChange={e => patch('text', e.target.value)}
                  placeholder="Ex: Ultraplan: crie meu plano de conteúdo"
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                  style={{
                    backgroundColor: tokens.bg.hover,
                    color: tokens.text.primary,
                    border: `1px solid ${tokens.border.subtle}`,
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = tokens.accent.focus}
                  onBlur={e => e.currentTarget.style.borderColor = tokens.border.subtle}
                />
                <div className="text-[9.5px] mt-1" style={{ color: tokens.text.tertiary }}>
                  Deixe vazio para detectar automaticamente pelo texto do bloco.
                </div>
              </div>
            )}

            {/* Generate / Render buttons */}
            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={handleGenerate}
                disabled={!!busy}
                className="w-full py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_15px_rgba(124,58,237,0.4)] disabled:opacity-40 transition-all"
              >
                {NATIVE_PRESET_IDS.includes(motion.presetId)
                  ? (motion.html ? '↻ Regenerar (nativo)' : '⚡ Gerar (nativo)')
                  : (motion.html ? '↻ Regenerar com IA' : '✨ Gerar com IA')}
              </button>
              {motion.html && (
                <button
                  onClick={handleRender}
                  disabled={!!busy}
                  className="w-full py-2.5 rounded-lg bg-fuchsia-500 hover:bg-fuchsia-400 text-xs font-semibold text-white shadow-[0_0_15px_rgba(217,70,239,0.4)] disabled:opacity-40 transition-all"
                >
                  🎨 Renderizar pra MP4
                </button>
              )}
            </div>

            {/* Status / progress */}
            {busy && (
              <div className="text-[11px] text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded-lg p-2.5">
                {busy}
              </div>
            )}
            {progress && progress.stage !== 'done' && (
              <div className="text-[10.5px] text-zinc-400 bg-black/40 rounded-lg p-2 font-mono leading-snug">
                <div className="flex justify-between mb-1">
                  <span>{progress.stage}</span>
                  {progress.percent !== null && <span>{progress.percent.toFixed(0)}%</span>}
                </div>
                <div className="truncate">{progress.message}</div>
              </div>
            )}
            {rationale && (
              <div className="text-[11px] text-zinc-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5 leading-relaxed">
                <span className="text-emerald-300 font-medium">Por que escolhi assim:</span> {rationale}
              </div>
            )}
            {error && (
              <div className="text-[11px] text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 leading-relaxed">
                ⚠ {error}
              </div>
            )}
          </div>

          {/* Right: preview */}
          <div className="flex-1 flex flex-col bg-black">
            <div className="px-4 py-2 border-b border-white/5 flex items-center gap-2 text-[11px]">
              <span className="text-zinc-500 uppercase tracking-wider text-[9px]">Preview</span>
              <button
                onClick={() => setPreviewMode('live')}
                disabled={!motion.html}
                className={`px-2 py-1 rounded ${previewMode === 'live' ? 'bg-violet-500/20 text-violet-100 border border-violet-400/40' : 'text-zinc-400 hover:text-zinc-200 border border-transparent'} disabled:opacity-30`}
              >
                ✨ Ao vivo
              </button>
              <button
                onClick={() => setPreviewMode('mp4')}
                disabled={!motion.videoPath}
                className={`px-2 py-1 rounded ${previewMode === 'mp4' ? 'bg-fuchsia-500/20 text-fuchsia-100 border border-fuchsia-400/40' : 'text-zinc-400 hover:text-zinc-200 border border-transparent'} disabled:opacity-30`}
              >
                🎥 MP4 renderizado
              </button>
              <span className="ml-auto text-[10px] text-zinc-600">{preset.label} · {motion.durationSec}s</span>
            </div>
            <div className="flex-1 flex items-center justify-center p-5">
              {previewMode === 'live' && motion.html && (() => {
                const is45 = motion.canvasAspect === '4:5';
                const previewW = is45 ? 320 : 360;
                const previewH = is45 ? 400 : 640;
                const canvasH = is45 ? 1350 : 1920;
                const scale = previewW / 1080;
                return (
                  <div className="rounded-lg overflow-hidden border border-white/10 bg-black" style={{ width: previewW, height: previewH }}>
                    <iframe
                      ref={iframeRef}
                      title="motion preview"
                      sandbox="allow-scripts allow-same-origin"
                      style={{ width: 1080, height: canvasH, border: 'none', transform: `scale(${scale})`, transformOrigin: 'top left' }}
                    />
                  </div>
                );
              })()}
              {previewMode === 'mp4' && mp4Url && (() => {
                const is45 = motion.canvasAspect === '4:5';
                const previewW = is45 ? 320 : 360;
                const previewH = is45 ? 400 : 640;
                return (
                  <div className="rounded-lg overflow-hidden border border-white/10 bg-black" style={{ width: previewW, height: previewH }}>
                    <video src={mp4Url} controls autoPlay loop muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                );
              })()}
              {!motion.html && (
                <div className="text-zinc-500 text-sm text-center max-w-xs leading-relaxed">
                  Preencha a ideia + texto à esquerda e clique <span className="text-violet-300">✨ Gerar com IA</span> pra criar o motion.
                </div>
              )}
              {motion.html && previewMode === 'mp4' && !mp4Url && (
                <div className="text-zinc-500 text-sm">Renderize pra MP4 primeiro.</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex items-center gap-2">
          {block.motion && (
            <button
              onClick={handleRemove}
              disabled={!!busy}
              className="px-3 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-200 text-[11px] font-medium border border-red-500/30 transition-colors disabled:opacity-40"
            >
              Remover motion
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            disabled={!!busy}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[12px] text-zinc-300 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!!busy}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-40 text-[12px] font-semibold text-zinc-100 border border-white/15"
          >
            {motion.html ? 'Salvar motion' : 'Salvar configuração'}
          </button>
        </div>
      </div>
    </div>
  );
};
