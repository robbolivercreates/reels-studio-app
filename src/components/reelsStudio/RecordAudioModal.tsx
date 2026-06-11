/**
 * "Começar com meu áudio" — record the user's voice (MediaRecorder) or pick
 * an audio file. Output is just a Blob + name handed to the caller
 * (processCreateFromAudio), which runs the Whisper pipeline and seeds the
 * project. No persistence here.
 */

import React, { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the final audio (recorded webm or picked file). */
  onConfirm: (blob: Blob, fileName: string) => void;
}

type RecState = 'idle' | 'recording' | 'recorded';

export const RecordAudioModal: React.FC<Props> = ({ open, onClose, onConfirm }) => {
  const [recState, setRecState] = useState<RecState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cleanup = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    window.clearInterval(timerRef.current);
    cancelAnimationFrame(rafRef.current);
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  };

  // Full reset when the modal closes/unmounts.
  useEffect(() => {
    if (!open) {
      cleanup();
      setRecState('idle');
      setElapsed(0);
      setLevel(0);
      setError(null);
      setRecordedBlob(null);
      setPreviewUrl(u => { if (u) URL.revokeObjectURL(u); return null; });
    }
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        setRecordedBlob(blob);
        setPreviewUrl(u => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(blob); });
        setRecState('recorded');
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        window.clearInterval(timerRef.current);
        cancelAnimationFrame(rafRef.current);
        setLevel(0);
      };
      rec.start(250);
      setElapsed(0);
      setRecState('recording');
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 200);

      // Simple input-level meter via AnalyserNode.
      const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let max = 0;
        for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i] - 128) / 128);
        setLevel(max);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      setError(e instanceof Error && e.name === 'NotAllowedError'
        ? 'Permissão de microfone negada — habilite nas configurações do sistema.'
        : `Não consegui acessar o microfone: ${e instanceof Error ? e.message : e}`);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const confirmRecorded = () => {
    if (!recordedBlob) return;
    const ext = (recordedBlob.type.includes('mp4') ? 'm4a' : 'webm');
    onConfirm(recordedBlob, `voz-gravada-${new Date().toISOString().slice(0, 10)}.${ext}`);
  };

  const onFilePicked = (f: File | null) => {
    if (!f) return;
    onConfirm(f, f.name);
  };

  if (!open) return null;

  const mm = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const ss = Math.floor(elapsed % 60).toString().padStart(2, '0');

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[75] p-6" onClick={onClose}>
      <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-2xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
        <div className="text-base font-semibold text-zinc-100">🎙 Começar com meu áudio</div>
        <div className="text-xs text-zinc-500 mt-1 leading-relaxed">
          Grave sua voz (ou suba um áudio). Ela vira o áudio do reel: transcrevemos com Whisper local,
          dividimos em blocos com o timing real e os avatares são gerados falando com a SUA voz.
        </div>

        {error && (
          <div className="mt-4 text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>
        )}

        <div className="mt-5 flex flex-col items-center gap-3">
          {recState === 'recording' ? (
            <>
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-2xl font-mono text-zinc-100">{mm}:{ss}</span>
              </div>
              {/* level meter */}
              <div className="w-48 h-1.5 rounded bg-zinc-800 overflow-hidden">
                <div className="h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.min(100, level * 130)}%` }} />
              </div>
              <button
                onClick={stopRecording}
                className="px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-sm font-bold text-white transition-colors"
              >
                ■ Parar
              </button>
            </>
          ) : recState === 'recorded' && previewUrl ? (
            <>
              <audio src={previewUrl} controls className="w-full" />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setRecState('idle'); setRecordedBlob(null); setPreviewUrl(u => { if (u) URL.revokeObjectURL(u); return null; }); }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-300 border border-white/10 hover:bg-white/5 transition-colors"
                >
                  ↺ Regravar
                </button>
                <button
                  onClick={confirmRecorded}
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90"
                  style={{ background: 'linear-gradient(180deg, #60A5FA, #2563EB)' }}
                >
                  ✓ Usar este áudio
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => void startRecording()}
              className="w-20 h-20 rounded-full bg-red-500/15 border-2 border-red-400/60 hover:bg-red-500/25 transition-colors flex items-center justify-center"
              title="Começar a gravar"
            >
              <span className="w-7 h-7 rounded-full bg-red-500" />
            </button>
          )}

          {recState === 'idle' && (
            <>
              <div className="text-[10px] uppercase tracking-widest text-zinc-600">ou</div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-zinc-200 border border-white/10 hover:bg-white/5 transition-colors"
              >
                📁 Subir arquivo de áudio
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                className="hidden"
                onChange={e => onFilePicked(e.target.files?.[0] ?? null)}
              />
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancelar</button>
        </div>
      </div>
    </div>
  );
};
