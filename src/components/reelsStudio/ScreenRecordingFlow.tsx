import React, { useEffect, useRef, useState } from 'react';
import { startScreenRecording, supportsSystemAudio, type ActiveRecorder } from './screenRecorder';
import { saveTakeBlob } from './persistence';
import type { ScreenTake } from './types';

type Phase = 'idle' | 'pre' | 'countdown' | 'recording' | 'finalizing';

interface Props {
  open: boolean;
  onClose: () => void;
  onTakeRecorded: (take: ScreenTake) => void;
}

const formatMs = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const ScreenRecordingFlow: React.FC<Props> = ({ open, onClose, onTakeRecorded }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [withAudio, setWithAudio] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<ActiveRecorder | null>(null);
  const audioCapable = supportsSystemAudio();

  // Open → enter pre-record phase.
  useEffect(() => {
    if (open && phase === 'idle') {
      setPhase('pre');
      setError(null);
    }
    if (!open) {
      setPhase('idle');
      recorderRef.current?.cancel();
      recorderRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Countdown ticker.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      void beginRecording();
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  const beginRecording = async () => {
    try {
      const recorder = await startScreenRecording({
        withAudio,
        onTick: (ms) => setElapsedMs(ms),
        onStop: async (blob, durationMs) => {
          console.log('[reels/screen] onStop received', { sizeMB: (blob.size / 1024 / 1024).toFixed(2), durationMs });
          setPhase('finalizing');
          const id = `take_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

          // Show progress / timeout watchdog so the user is never stuck on "Salvando...".
          const watchdog = setTimeout(() => {
            console.error('[reels/screen] save timeout (30s)');
            setError('A gravação ficou grande demais. Tente uma gravação mais curta.');
            setPhase('pre');
          }, 30_000);

          try {
            console.log('[reels/screen] saving to IndexedDB...');
            await saveTakeBlob(id, blob);
            console.log('[reels/screen] IndexedDB save OK');
            clearTimeout(watchdog);

            const url = URL.createObjectURL(blob);
            const take: ScreenTake = {
              id,
              name: `Take ${new Date().toLocaleTimeString().slice(0, 5)}`,
              durationMs,
              url,
              hasAudio: withAudio,
              createdAt: Date.now(),
              source: 'recording',
              trimStart: 0,
              trimEnd: durationMs / 1000,
              cutSilence: false,
              keepSegments: [],
              detectedSilenceSec: 0,
            };
            console.log('[reels/screen] take ready, calling onTakeRecorded');
            onTakeRecorded(take);
            // Defer onClose to next tick so React commits the dispatch first.
            setTimeout(() => onClose(), 50);
          } catch (err) {
            clearTimeout(watchdog);
            console.error('[reels/screen] failed to persist take:', err);
            const msg = err instanceof Error ? err.message : 'Erro desconhecido';
            setError(`Não consegui salvar: ${msg}`);
            setPhase('pre');
            return;
          }
        },
        onError: (err) => {
          console.error('[reels/screen] recorder error:', err);
          setError(err.message);
          setPhase('pre');
        },
      });
      recorderRef.current = recorder;
      setPhase('recording');
      setElapsedMs(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao iniciar gravação';
      console.error('[reels/screen] beginRecording threw:', err);
      setError(msg);
      setPhase('pre');
      setCountdown(3);
    }
  };

  const handleStartCountdown = () => {
    setError(null);
    setCountdown(3);
    setPhase('countdown');
  };

  const handleStopRecording = () => {
    recorderRef.current?.stop();
  };

  const handleCancel = () => {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setPhase('pre');
  };

  if (!open) return null;

  // ─── PRE-RECORD MODAL ────────────────────────────────────────────────
  if (phase === 'pre' || phase === 'finalizing') {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
        <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-md w-full overflow-hidden">
          <div className="px-6 pt-6 pb-4 flex items-start justify-between">
            <div>
              <div className="text-base font-semibold text-zinc-100 mb-1">Gravar tela</div>
              <div className="text-xs text-zinc-500">Você vai escolher qual janela ou tela compartilhar.</div>
            </div>
            <button onClick={onClose} disabled={phase === 'finalizing'} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-50">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-6 pb-4 space-y-3">
            <label className={`flex items-start gap-3 ${audioCapable ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
              <button
                type="button"
                onClick={() => audioCapable && setWithAudio(v => !v)}
                disabled={!audioCapable}
                className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${withAudio ? 'bg-emerald-500' : 'bg-zinc-700'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-md transition-all ${withAudio ? 'left-[18px]' : 'left-0.5'}`}></div>
              </button>
              <div className="flex-1">
                <div className="text-xs font-medium text-zinc-200">Capturar áudio do sistema</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {audioCapable
                    ? 'Inclui o som de outras abas/apps. Você pode silenciar depois ao usar o take.'
                    : 'Disponível só no Chrome/Edge desktop.'}
                </div>
              </div>
            </label>

            <div className="rounded-lg bg-violet-500/[0.05] border border-violet-500/20 p-3">
              <div className="text-[11px] text-violet-200 leading-relaxed">
                💡 <strong>Pode gravar mais que precisa</strong> — você corta as bordas depois com facilidade. A próxima fase vai oferecer remoção automática de pausas longas pra deixar dinâmico.
              </div>
            </div>

            {error && <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">⚠ {error}</div>}
          </div>

          <div className="px-6 py-4 flex gap-2 border-t border-white/5 bg-black/30">
            <button onClick={onClose} disabled={phase === 'finalizing'} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-50">Cancelar</button>
            <button
              onClick={handleStartCountdown}
              disabled={phase === 'finalizing'}
              className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {phase === 'finalizing' ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" /><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Salvando...
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-white"></span>
                  Começar (3-2-1)
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── COUNTDOWN OVERLAY ──────────────────────────────────────────────
  if (phase === 'countdown') {
    return (
      <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-[80]">
        <div className="text-center">
          <div className="text-zinc-400 text-sm uppercase tracking-widest mb-6">Prepare-se · escolha a tela</div>
          <div
            key={countdown}
            className="text-white font-bold tabular-nums"
            style={{
              fontSize: countdown > 0 ? '12rem' : '6rem',
              lineHeight: 1,
              animation: 'countdown-pulse 1s ease-out',
            }}
          >
            {countdown > 0 ? countdown : 'GO!'}
          </div>
          <button
            onClick={() => { setPhase('pre'); setCountdown(3); }}
            className="mt-12 text-zinc-500 hover:text-zinc-300 text-xs underline transition-colors"
          >
            Cancelar
          </button>
        </div>
        <style>{`
          @keyframes countdown-pulse {
            0% { opacity: 0; transform: scale(1.4); }
            30% { opacity: 1; transform: scale(1); }
            100% { opacity: 0.4; transform: scale(0.95); }
          }
        `}</style>
      </div>
    );
  }

  // ─── RECORDING HUD ──────────────────────────────────────────────────
  if (phase === 'recording') {
    return (
      <div className="fixed top-4 right-4 z-[80] flex items-center gap-3 px-4 py-3 rounded-2xl bg-red-500/20 backdrop-blur-xl border border-red-400/40 shadow-[0_10px_40px_rgba(239,68,68,0.3)]">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
        <div className="text-sm font-bold text-red-100 tabular-nums">{formatMs(elapsedMs)}</div>
        <div className="h-5 w-px bg-red-400/30"></div>
        <button
          onClick={handleStopRecording}
          className="px-3 py-1.5 rounded-md bg-white text-red-600 text-xs font-bold hover:bg-red-50 active:scale-95 transition-all flex items-center gap-1.5"
        >
          <span className="w-2 h-2 bg-red-600 rounded-sm"></span>
          Parar
        </button>
        <button
          onClick={handleCancel}
          className="text-[11px] text-red-200/70 hover:text-red-100 underline transition-colors"
          title="Descartar gravação"
        >
          Descartar
        </button>
      </div>
    );
  }

  return null;
};
