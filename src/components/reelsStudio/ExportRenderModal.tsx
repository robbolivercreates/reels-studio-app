import React, { useEffect, useRef, useState } from 'react';
import { renderMp4, type RenderProgress, type RenderHandle } from './mp4Renderer';
import { saveExport, loadAudioBlob, type ExportRecord } from './persistence';
import { detectExportCapability } from './exportCapability';
import type { ReelsState } from './types';
import { copyText } from './clipboard';
import { generateInstagramCaption } from '../../services/captionService';

interface Props {
  open: boolean;
  state: ReelsState;
  audioBlob: Blob | null;
  onClose: () => void;
}

type Phase = 'config' | 'rendering' | 'done' | 'error';

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const formatTime = (s: number): string => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

export const ExportRenderModal: React.FC<Props> = ({ open, state, audioBlob: audioBlobProp, onClose }) => {
  const [phase, setPhase] = useState<Phase>('config');
  const [quality, setQuality] = useState<'high' | 'lite'>('high');
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [muxedOutputPath, setMuxedOutputPath] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const [captionLoading, setCaptionLoading] = useState(false);
  const [captionCopied, setCaptionCopied] = useState(false);

  // Build a single object URL for the result blob and reuse it across preview +
  // download. Revoke only when the blob changes or the modal closes — never
  // during an active download (was causing 'object can not be found here').
  useEffect(() => {
    if (!resultBlob) {
      setResultUrl(null);
      return;
    }
    const url = URL.createObjectURL(resultBlob);
    setResultUrl(url);
    return () => { URL.revokeObjectURL(url); };
  }, [resultBlob]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [capabilityChecked, setCapabilityChecked] = useState(false);
  const [unsupportedReason, setUnsupportedReason] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number>(0);
  const handleRef = useRef<RenderHandle | null>(null);
  const thumbCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) {
      // Reset on close.
      setPhase('config');
      setProgress(null);
      setResultBlob(null);
      setMuxedOutputPath(null);
      setCaption(null);
      setCaptionCopied(false);
      setErrorMsg(null);
      handleRef.current?.cancel();
      handleRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    detectExportCapability().then(cap => {
      setCapabilityChecked(true);
      if (!cap.webcodecs) setUnsupportedReason(cap.reason ?? 'WebCodecs não disponível');
    });
  }, [open]);

  // Paint live thumbnails into the modal canvas.
  useEffect(() => {
    if (!progress?.thumbnail) return;
    const canvas = thumbCanvasRef.current;
    if (!canvas) return;
    canvas.width = progress.thumbnail.width;
    canvas.height = progress.thumbnail.height;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(progress.thumbnail, 0, 0);
    // Free the bitmap after painting to release GPU memory.
    progress.thumbnail.close();
  }, [progress?.thumbnail]);

  const readyToRender =
    state.audio.status === 'ready' &&
    state.audio.url !== null &&
    state.blocks.length > 0;

  const startRender = async () => {
    if (!state.audio.url) return;
    setPhase('rendering');
    setStartedAt(Date.now());
    setErrorMsg(null);

    try {
      // Audio source priority differs based on whether cuts are applied:
      //   - cutsApplied=true → use the IN-MEMORY cut blob (state.audio.url),
      //     because IndexedDB still holds the pristine source. The blocks/duration
      //     in state are already on the compressed timeline, so no skip mapping needed.
      //   - cutsApplied=false → IndexedDB original, optionally with `silenceKeepSegments`
      //     so renderMp4 skips silences during composition (legacy preview mode).
      let audioBlob: Blob | null = null;
      // Prefer the module-level cut session if present — it's the source of
      // truth that survives HMR and reducer races. Fall back to state-based
      // detection only when no cuts have been applied this session.
      const { getCutSession } = await import('./cutSession');
      const cutSession = getCutSession();
      const cutsApplied = !!state.audio.cutsApplied || !!cutSession;

      if (cutSession) {
        console.log('[export] using cut session blob · size=', cutSession.audioBlob.size, '· duration=', cutSession.duration);
        audioBlob = cutSession.audioBlob;
      } else if (cutsApplied && state.audio.url) {
        console.log('[export] cutsApplied=true → fetching cut audio from object URL');
        try {
          const resp = await fetch(state.audio.url);
          audioBlob = await resp.blob();
          console.log('[export] cut audio blob size:', audioBlob.size);
        } catch (fetchErr) {
          console.error('[export] failed to read cut audio, falling back to original:', fetchErr);
        }
      }

      if (!audioBlob) {
        audioBlob = audioBlobProp;
        console.log('[export] audioBlobProp:', audioBlobProp?.size ?? 'null');
      }
      if (!audioBlob) {
        console.log('[export] trying IndexedDB...');
        audioBlob = await loadAudioBlob();
        console.log('[export] IndexedDB blob:', audioBlob?.size ?? 'null');
      }
      if (!audioBlob && state.audio.url) {
        try {
          const resp = await fetch(state.audio.url);
          audioBlob = await resp.blob();
        } catch (fetchErr) {
          console.error('[export] fetch failed:', fetchErr);
        }
      }
      if (!audioBlob) throw new Error('Áudio não encontrado. Gere o áudio novamente (o blob expirou).');

      // When using the cut session, also use its remapped blocks/duration
      // — the React state may not have caught up yet.
      const effectiveBlocks = cutSession ? cutSession.blocks : state.blocks;
      const effectiveDuration = cutSession ? cutSession.duration : state.audio.duration;
      const { invoke } = await import('@tauri-apps/api/core');

      // Render video-only via WebCodecs (audio encoding is broken on macOS
      // WebKit — AudioEncoder silently produces 0-channel AAC). ffmpeg will
      // mux the audio separately from the original MP3 blob.
      const handle = renderMp4(
        {
          blocks: effectiveBlocks,
          avatarClips: state.avatarClips,
          activeTake: state.takes.find(t => t.id === state.activeTakeId) ?? null,
          audioBlob,
          duration: effectiveDuration,
          aspect: state.aspect,
          quality,
          silenceKeepSegments: !cutsApplied && state.audio.silenceCut && state.audio.keepSegments.length > 0
            ? state.audio.keepSegments
            : undefined,
          videoOnly: true,
        },
        (p) => setProgress(p),
      );
      handleRef.current = handle;
      const silentVideoBlob = await handle.promise;
      console.log('[export] silent video blob · size=', silentVideoBlob.size);

      // Write silent video + audio to temp files, then mux via ffmpeg.
      setProgress({ phase: 'finalizing', framesDone: 0, totalFrames: 0, message: 'Muxando áudio via ffmpeg...' });
      const tmpBase = `/tmp/reels_export_${Date.now()}`;
      const videoTmpPath = `${tmpBase}_video.mp4`;
      const audioTmpPath = `${tmpBase}_audio.mp3`;
      const outputTmpPath = `${tmpBase}_final.mp4`;

      // Write video temp file.
      await invoke('truncate_file', { targetPath: videoTmpPath });
      const videoBytes = new Uint8Array(await silentVideoBlob.arrayBuffer());
      const CHUNK = 1024 * 1024;
      for (let off = 0; off < videoBytes.length; off += CHUNK) {
        const slice = videoBytes.subarray(off, Math.min(videoBytes.length, off + CHUNK));
        await invoke('append_chunk_to_file', { targetPath: videoTmpPath, base64Chunk: arrayBufferToBase64(slice) });
      }

      // Write audio temp file.
      await invoke('truncate_file', { targetPath: audioTmpPath });
      const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());
      for (let off = 0; off < audioBytes.length; off += CHUNK) {
        const slice = audioBytes.subarray(off, Math.min(audioBytes.length, off + CHUNK));
        await invoke('append_chunk_to_file', { targetPath: audioTmpPath, base64Chunk: arrayBufferToBase64(slice) });
      }

      // Call ffmpeg via Rust to mux.
      console.log('[export] calling ffmpeg mux · video=', videoTmpPath, '· audio=', audioTmpPath);
      await invoke('mux_video_audio_ffmpeg', {
        videoPath: videoTmpPath,
        audioPath: audioTmpPath,
        outputPath: outputTmpPath,
      });
      console.log('[export] ffmpeg mux done · output=', outputTmpPath);

      // Read the muxed file back as a blob for the result viewer + history.
      // We use read_reference_bytes (already available) or build the blob from chunks.
      // Simplest: the user downloads directly from the temp path via the save dialog.
      // Store a placeholder blob so the modal shows the "done" state with download button.
      const blob = silentVideoBlob; // placeholder — actual save reads from outputTmpPath

      // Persist to history.
      const id = `exp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const record: ExportRecord = {
        id,
        projectName: state.projectName,
        createdAt: Date.now(),
        durationSec: state.audio.duration,
        aspect: state.aspect,
        quality,
        fileSize: silentVideoBlob.size,
        blob,
      };
      saveExport(record).catch(e => console.warn('[export] saveExport skipped:', e));

      // Store the output path so downloadResult can use it.
      setMuxedOutputPath(outputTmpPath);
      setResultBlob(blob);
      setPhase('done');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha desconhecida';
      if (msg.toLowerCase().includes('cancelado')) {
        setPhase('config');
        return;
      }
      console.error('[reels/export] render failed:', err);
      setErrorMsg(msg);
      setPhase('error');
    }
  };

  const cancelRender = () => {
    if (!confirm('Cancelar exportação? O progresso será descartado.')) return;
    handleRef.current?.cancel();
  };

  const downloadResult = async () => {
    if (!resultBlob && !muxedOutputPath) return;
    const suggestedName = `${state.projectName.replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.mp4`;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{ path: string | null }>('pick_save_path', {
        suggestedName,
        extension: 'mp4',
      });
      if (!result.path) return;
      const targetPath = result.path;

      if (muxedOutputPath) {
        // ffmpeg already wrote the final file to a temp path — just copy it.
        console.log('[export] copying muxed file from', muxedOutputPath, 'to', targetPath);
        await invoke('copy_file', { srcPath: muxedOutputPath, dstPath: targetPath });
      } else if (resultBlob) {
        // Fallback: stream the blob (legacy path).
        console.log('[export] saving to', targetPath, 'size=', resultBlob.size);
        await invoke('truncate_file', { targetPath });
        const CHUNK = 1024 * 1024;
        const buffer = await resultBlob.arrayBuffer();
        const view = new Uint8Array(buffer);
        for (let off = 0; off < view.length; off += CHUNK) {
          const slice = view.subarray(off, Math.min(view.length, off + CHUNK));
          await invoke('append_chunk_to_file', { targetPath, base64Chunk: arrayBufferToBase64(slice) });
        }
      }
      console.log('[export] saved to', targetPath);

      try {
        await invoke('reveal_file_in_finder', { path: targetPath });
      } catch { /* noop */ }
    } catch (err) {
      console.warn('[export] native save failed:', err);
      if (resultUrl) {
        const a = document.createElement('a');
        a.href = resultUrl;
        a.download = suggestedName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
  };

  // Helper: encode a chunk of bytes to base64 without exceeding the call-stack
  // limit of `String.fromCharCode(...)` for large inputs.
  const arrayBufferToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const sub = 0x8000;
    for (let i = 0; i < bytes.length; i += sub) {
      binary += String.fromCharCode(...bytes.subarray(i, i + sub));
    }
    return btoa(binary);
  };

  const shareResult = async () => {
    if (!resultBlob) return;
    const file = new File([resultBlob], `reel-${Date.now()}.mp4`, { type: 'video/mp4' });
    const navAny = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
    if (navAny.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: state.projectName });
      } catch {
        // User cancelled — fine.
      }
    } else {
      downloadResult();
    }
  };

  const elapsed = startedAt > 0 ? (Date.now() - startedAt) / 1000 : 0;
  const eta = progress && progress.framesDone > 0 && progress.totalFrames > progress.framesDone
    ? Math.max(1, (elapsed / progress.framesDone) * (progress.totalFrames - progress.framesDone))
    : 0;
  const pct = progress && progress.totalFrames > 0
    ? Math.round((progress.framesDone / progress.totalFrames) * 100)
    : 0;

  if (!open) return null;

  // ─── UNSUPPORTED ────────────────────────────────────────────────────
  if (capabilityChecked && unsupportedReason) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[80] p-6">
        <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-2xl max-w-md w-full p-6">
          <div className="text-amber-400 text-3xl text-center mb-3">⚠</div>
          <div className="text-base font-semibold text-zinc-100 text-center mb-2">Export MP4 indisponível</div>
          <div className="text-xs text-zinc-400 text-center mb-4">{unsupportedReason}</div>
          <div className="rounded-lg bg-violet-500/[0.05] border border-violet-500/20 p-3 mb-4">
            <div className="text-[11px] text-violet-200 leading-relaxed">
              💡 <strong>Alternativa:</strong> exporte como pacote .zip (áudio + clipes separados) e monte em CapCut/Premiere/DaVinci. Em breve adicionaremos export FCPXML pra abrir tudo já posicionado.
            </div>
          </div>
          <button onClick={onClose} className="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Fechar</button>
        </div>
      </div>
    );
  }

  // ─── CONFIG ─────────────────────────────────────────────────────────
  if (phase === 'config') {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-6" onClick={onClose}>
        <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-6 pt-6 pb-4 flex items-start justify-between">
            <div>
              <div className="text-base font-semibold text-zinc-100 mb-1">Exportar MP4 final</div>
              <div className="text-xs text-zinc-500">Gera um único arquivo pronto pra postar.</div>
            </div>
            <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {!readyToRender && (
            <div className="px-6 pb-4">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-[11px] text-amber-200">
                ⚠ Gere o áudio primeiro (botão "Gerar áudio"). Sem áudio não dá pra renderizar.
              </div>
            </div>
          )}

          {readyToRender && (
            <>
              <div className="px-6 pb-4 space-y-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Qualidade</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setQuality('high')}
                      className={`px-3 py-3 rounded-lg border text-left transition-colors ${quality === 'high' ? 'bg-violet-500/15 border-violet-400/50' : 'bg-black/20 border-white/10'}`}
                    >
                      <div className="text-xs font-semibold text-zinc-100">1080p</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Reels/TikTok padrão · ~20MB</div>
                    </button>
                    <button
                      onClick={() => setQuality('lite')}
                      className={`px-3 py-3 rounded-lg border text-left transition-colors ${quality === 'lite' ? 'bg-violet-500/15 border-violet-400/50' : 'bg-black/20 border-white/10'}`}
                    >
                      <div className="text-xs font-semibold text-zinc-100">720p</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Mais leve · ~10MB</div>
                    </button>
                  </div>
                </div>

                <div className="rounded-lg bg-black/30 border border-white/5 p-3 space-y-1.5 text-xs">
                  {state.audio.silenceCut && state.audio.keepSegments.length > 0 ? (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Duração</span>
                      <span className="text-zinc-200 font-mono">
                        <span className="text-emerald-300">{formatTime(state.audio.keepSegments.reduce((s, k) => s + (k.end - k.start), 0))}</span>
                        <span className="text-zinc-600 line-through ml-1.5">{formatTime(state.audio.duration)}</span>
                      </span>
                    </div>
                  ) : (
                    <div className="flex justify-between"><span className="text-zinc-500">Duração</span><span className="text-zinc-200 font-mono">{formatTime(state.audio.duration)}</span></div>
                  )}
                  <div className="flex justify-between"><span className="text-zinc-500">Aspect</span><span className="text-zinc-200">{state.aspect}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Áudio</span><span className="text-zinc-200">Minimax (B-roll silenciado)</span></div>
                  {state.audio.silenceCut && state.audio.detectedSilenceSec >= 0.1 && (
                    <div className="flex justify-between"><span className="text-zinc-500">Cortes de silêncio</span><span className="text-violet-300">✂ −{state.audio.detectedSilenceSec.toFixed(1)}s ({state.audio.silencePreset})</span></div>
                  )}
                  <div className="flex justify-between"><span className="text-zinc-500">Tempo estimado</span><span className="text-zinc-200">~{Math.round(state.audio.duration * (quality === 'high' ? 1.0 : 0.6))}s</span></div>
                </div>
              </div>

              <div className="px-6 py-4 flex gap-2 border-t border-white/5 bg-black/30">
                <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300">Cancelar</button>
                <button onClick={startRender} className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.5)]">
                  Renderizar agora
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── RENDERING ──────────────────────────────────────────────────────
  if (phase === 'rendering') {
    return (
      <div className="fixed inset-0 bg-black/95 backdrop-blur-2xl flex items-center justify-center z-[90]">
        <div className="text-center max-w-md w-full px-6">
          <div className="text-[10px] uppercase tracking-widest text-violet-300/70 font-semibold mb-4">Renderizando seu reel</div>

          {/* Live thumbnail */}
          <div className="relative mx-auto mb-6 w-48 aspect-[9/16] rounded-xl overflow-hidden bg-zinc-900 border border-white/10 shadow-2xl">
            <canvas ref={thumbCanvasRef} className="absolute inset-0 w-full h-full object-contain" />
            {!progress?.thumbnail && (
              <div className="absolute inset-0 flex items-center justify-center text-zinc-700 text-[10px]">aguardando frames...</div>
            )}
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all" style={{ width: `${pct}%` }}></div>
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-zinc-500 font-mono">
              <span>{progress?.message ?? '...'}</span>
              <span>{pct}%</span>
            </div>
          </div>

          {eta > 0 && (
            <div className="text-[11px] text-zinc-500">
              ETA <span className="text-zinc-300 font-mono">{formatTime(eta)}</span> · decorrido <span className="text-zinc-300 font-mono">{formatTime(elapsed)}</span>
            </div>
          )}

          <button onClick={cancelRender} className="mt-8 text-xs text-zinc-500 hover:text-zinc-300 underline transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // ─── DONE ───────────────────────────────────────────────────────────
  if (phase === 'done' && resultBlob) {
    return (
      <div className="fixed inset-0 bg-black/85 backdrop-blur-xl flex items-center justify-center z-[80] p-6" onClick={onClose}>
        <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="px-6 pt-8 pb-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center" style={{ animation: 'reel-pop 0.6s cubic-bezier(0.16, 1, 0.3, 1)' }}>
              <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-base font-semibold text-zinc-100 mb-1">Reel pronto</div>
            <div className="text-xs text-zinc-500">{formatBytes(resultBlob.size)} · {formatTime(state.audio.duration)} · {state.aspect}</div>
          </div>

          {resultUrl && (
            <div className="flex justify-center bg-black px-4 py-2">
              <video
                src={resultUrl}
                controls
                playsInline
                className="max-h-[40vh] w-auto rounded-lg"
                style={{ aspectRatio: state.aspect === '9:16' ? '9/16' : state.aspect === '16:9' ? '16/9' : state.aspect === 'carousel' ? '4/5' : '1/1' }}
              />
            </div>
          )}

          {/* Caption generator */}
          <div className="px-6 pb-4 border-t border-white/5 pt-4">
            {!caption && (
              <button
                onClick={async () => {
                  setCaptionLoading(true);
                  try {
                    const text = await generateInstagramCaption(state.blocks, state.projectName);
                    setCaption(text);
                  } finally {
                    setCaptionLoading(false);
                  }
                }}
                disabled={captionLoading}
                className="w-full py-2.5 rounded-lg bg-pink-500/10 border border-pink-500/30 hover:bg-pink-500/20 text-xs font-semibold text-pink-300 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {captionLoading ? (
                  <><span className="animate-spin">⟳</span> Gerando descrição...</>
                ) : (
                  <><span>📸</span> Gerar descrição pro Instagram</>
                )}
              </button>
            )}
            {caption && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Descrição Instagram</span>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        setCaptionLoading(true);
                        try {
                          const text = await generateInstagramCaption(state.blocks, state.projectName);
                          setCaption(text);
                          setCaptionCopied(false);
                        } finally {
                          setCaptionLoading(false);
                        }
                      }}
                      disabled={captionLoading}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
                    >
                      {captionLoading ? '⟳' : '↺ Regerar'}
                    </button>
                    <button
                      onClick={() => {
                        copyText(caption);
                        setCaptionCopied(true);
                        setTimeout(() => setCaptionCopied(false), 2000);
                      }}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors font-semibold"
                    >
                      {captionCopied ? '✓ Copiado!' : 'Copiar'}
                    </button>
                  </div>
                </div>
                <div
                  className="bg-black/30 border border-white/5 rounded-lg p-3 text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto cursor-text select-text"
                  onClick={() => {
                    copyText(caption);
                    setCaptionCopied(true);
                    setTimeout(() => setCaptionCopied(false), 2000);
                  }}
                >
                  {caption}
                </div>
              </div>
            )}
          </div>

          <div className="px-6 py-4 flex gap-2 border-t border-white/5">
            <button onClick={shareResult} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors flex items-center justify-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Compartilhar
            </button>
            <button onClick={downloadResult} className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.5)] flex items-center justify-center gap-2">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Baixar MP4
            </button>
          </div>
          <button onClick={onClose} className="w-full py-2.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors border-t border-white/5">Fechar</button>
        </div>
        <style>{`
          @keyframes reel-pop {
            0% { opacity: 0; transform: scale(0.5); }
            60% { opacity: 1; transform: scale(1.1); }
            100% { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
    );
  }

  // ─── ERROR ──────────────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[80] p-6">
        <div className="bg-[#141416] border border-red-500/30 rounded-2xl shadow-2xl max-w-md w-full p-6">
          <div className="text-red-400 text-3xl text-center mb-3">⚠</div>
          <div className="text-base font-semibold text-zinc-100 text-center mb-2">Falha ao renderizar</div>
          <div className="text-[11px] text-red-300 text-center font-mono mb-4 break-all">{errorMsg}</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300">Fechar</button>
            <button onClick={() => setPhase('config')} className="flex-1 py-2.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-xs font-semibold text-white">Tentar de novo</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
