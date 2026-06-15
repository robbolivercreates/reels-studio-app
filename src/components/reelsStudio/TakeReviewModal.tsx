import React, { useEffect, useRef, useState } from 'react';
import { detectKeepSegments, computeEffectiveDuration, DEFAULT_DETECTION } from './silenceDetector';
import { loadTakeBlob } from './persistence';
import type { ScreenTake } from './types';

interface Props {
  take: ScreenTake;
  onClose: () => void;
  onSave: (patch: Partial<ScreenTake>) => void;
}

const formatSec = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = (s % 60);
  const whole = Math.floor(sec);
  const dec = Math.floor((sec - whole) * 10);
  return `${m}:${String(whole).padStart(2, '0')}.${dec}`;
};

export const TakeReviewModal: React.FC<Props> = ({ take, onClose, onSave }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [trimStart, setTrimStart] = useState(take.trimStart);
  const [trimEnd, setTrimEnd] = useState(take.trimEnd > 0 ? take.trimEnd : take.durationMs / 1000);
  const [cutSilence, setCutSilence] = useState(take.cutSilence);
  const [keepSegments, setKeepSegments] = useState(take.keepSegments);
  const [silenceTotal, setSilenceTotal] = useState(take.detectedSilenceSec);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(take.keepSegments.length > 0);
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null);

  const durationSec = take.durationMs / 1000;

  // Run silence detection on mount if not done yet.
  useEffect(() => {
    if (analyzed || analyzing) return;
    let cancelled = false;
    (async () => {
      setAnalyzing(true);
      try {
        const blob = await loadTakeBlob(take.id);
        if (cancelled || !blob) return;
        const result = await detectKeepSegments(blob, DEFAULT_DETECTION);
        if (cancelled) return;
        setKeepSegments(result.keep);
        setSilenceTotal(result.totalSilent);
        setAnalyzed(true);
      } catch (err) {
        console.warn('[reels/review] silence detection failed:', err);
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [take.id, analyzed, analyzing]);

  // Drag handle logic.
  useEffect(() => {
    if (!draggingHandle) return;
    const onMove = (e: MouseEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = ratio * durationSec;
      if (draggingHandle === 'start') {
        setTrimStart(Math.min(t, trimEnd - 0.2));
      } else {
        setTrimEnd(Math.max(t, trimStart + 0.2));
      }
    };
    const onUp = () => setDraggingHandle(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingHandle, durationSec, trimStart, trimEnd]);

  const effectiveDuration = computeEffectiveDuration(durationSec, trimStart, trimEnd, cutSilence, silenceTotal);
  const startPct = (trimStart / durationSec) * 100;
  const endPct = (trimEnd / durationSec) * 100;
  const widthPct = endPct - startPct;

  const handleSave = () => {
    onSave({
      trimStart,
      trimEnd,
      cutSilence,
      keepSegments,
      detectedSilenceSec: silenceTotal,
    });
    onClose();
  };

  const handlePreview = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = trimStart;
    v.play().catch(() => {});
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[70] p-6" onClick={onClose}>
      <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.9)] max-w-4xl w-full overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-white/5">
          <div>
            <div className="text-base font-semibold text-zinc-100 mb-0.5">Revisar take</div>
            <div className="text-xs text-zinc-500">{take.name} · {formatSec(durationSec)} {take.source === 'upload' ? '· upload' : '· gravado'}</div>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Video */}
          <div className="rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
            <video
              ref={videoRef}
              src={take.url}
              controls
              playsInline
              className="max-w-full max-h-full"
            />
          </div>

          {/* Trim track */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Cortar bordas</div>
              <button onClick={handlePreview} className="text-[10px] text-blue-300 hover:text-blue-200 transition-colors">
                ▶ Preview do trecho
              </button>
            </div>
            <div ref={trackRef} className="relative h-12 rounded-lg bg-zinc-800/50 border border-white/5 select-none">
              {/* Silent regions (dimmed) */}
              {analyzed && cutSilence && keepSegments.length > 0 && (
                <div className="absolute inset-0 rounded-lg overflow-hidden">
                  <div className="absolute inset-0 bg-red-500/15"></div>
                  {keepSegments.map((seg, i) => {
                    const left = (seg.start / durationSec) * 100;
                    const width = ((seg.end - seg.start) / durationSec) * 100;
                    return <div key={i} className="absolute top-0 bottom-0 bg-emerald-500/20" style={{ left: `${left}%`, width: `${width}%` }}></div>;
                  })}
                </div>
              )}

              {/* Active range (between trim handles) */}
              <div
                className="absolute top-0 bottom-0 bg-blue-500/20 border-y-2 border-blue-400/60"
                style={{ left: `${startPct}%`, width: `${widthPct}%` }}
              ></div>

              {/* Start handle */}
              <button
                onMouseDown={(e) => { e.preventDefault(); setDraggingHandle('start'); }}
                className="absolute top-0 bottom-0 w-2 -ml-1 bg-blue-400 hover:bg-blue-300 cursor-ew-resize rounded shadow-[0_0_12px_rgba(10,132,255,0.6)]"
                style={{ left: `${startPct}%` }}
                title="Início"
              ></button>

              {/* End handle */}
              <button
                onMouseDown={(e) => { e.preventDefault(); setDraggingHandle('end'); }}
                className="absolute top-0 bottom-0 w-2 -ml-1 bg-blue-400 hover:bg-blue-300 cursor-ew-resize rounded shadow-[0_0_12px_rgba(10,132,255,0.6)]"
                style={{ left: `${endPct}%` }}
                title="Fim"
              ></button>

              {/* Time labels */}
              <div className="absolute -top-5 text-[9px] font-mono text-blue-300 -translate-x-1/2" style={{ left: `${startPct}%` }}>{formatSec(trimStart)}</div>
              <div className="absolute -top-5 text-[9px] font-mono text-blue-300 -translate-x-1/2" style={{ left: `${endPct}%` }}>{formatSec(trimEnd)}</div>
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500 font-mono">
              <span>0:00</span>
              <span>{formatSec(durationSec)}</span>
            </div>
          </div>

          {/* Silence removal */}
          <div className="rounded-xl bg-black/30 border border-white/5 p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <button
                type="button"
                onClick={() => setCutSilence(v => !v)}
                disabled={!analyzed || silenceTotal < 0.1}
                className={`relative shrink-0 w-9 h-5 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cutSilence ? 'bg-emerald-500' : 'bg-zinc-700'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-all ${cutSilence ? 'left-[18px]' : 'left-0.5'}`}></div>
              </button>
              <div className="flex-1">
                <div className="text-xs font-medium text-zinc-200 flex items-center gap-2">
                  Remover silêncios automaticamente
                  {analyzing && <span className="text-[10px] text-blue-300">analisando áudio...</span>}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  {analyzed && silenceTotal > 0.1 ? (
                    <>Detectei <span className="text-emerald-300 font-semibold">{silenceTotal.toFixed(1)}s</span> em pausas longas (&gt;{Math.round(DEFAULT_DETECTION.minSilenceMs / 100) / 10}s). Ativar acelera o ritmo do reel.</>
                  ) : analyzed && silenceTotal <= 0.1 ? (
                    <>Sem pausas longas detectadas — você já fala fluido.</>
                  ) : (
                    <>Vou analisar o áudio pra encontrar pausas longas e oferecer cortar automático.</>
                  )}
                </div>
              </div>
            </label>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">Duração original</div>
              <div className="text-sm font-bold text-zinc-200 mt-1 font-mono">{formatSec(durationSec)}</div>
            </div>
            <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">Após cortes</div>
              <div className="text-sm font-bold text-emerald-300 mt-1 font-mono">{formatSec(effectiveDuration)}</div>
            </div>
            <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">Economizou</div>
              <div className="text-sm font-bold text-blue-300 mt-1 font-mono">−{formatSec(durationSec - effectiveDuration)}</div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/5 bg-black/30 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Cancelar</button>
          <button onClick={handleSave} className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(10,132,255,0.5)] transition-all">
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
};
