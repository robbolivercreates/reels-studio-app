import React, { useEffect, useRef, useState } from 'react';

interface Props {
  videoUrl: string;
  blockText: string;
  duration: number;
  onClose: () => void;
}

export const ClipPreviewLightbox: React.FC<Props> = ({ videoUrl, blockText, duration, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Auto-play on mount.
  useEffect(() => {
    videoRef.current?.play().catch((err) => {
      console.warn('[reels/lightbox] auto-play failed:', err);
    });
  }, []);

  const handleOpenInTab = () => {
    window.open(videoUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `avatar-clip-${Date.now()}.mp4`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[80] p-6" onClick={onClose}>
      <div className="relative max-w-md w-full" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 p-2 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-200 transition-colors"
          title="Fechar (ESC)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="rounded-2xl overflow-hidden bg-black shadow-[0_30px_80px_rgba(0,0,0,0.9)] border border-white/10">
          {errorMessage ? (
            <div className="aspect-[9/16] bg-black flex flex-col items-center justify-center p-6 gap-4">
              <div className="text-amber-400 text-3xl">⚠</div>
              <div className="text-sm text-zinc-200 text-center">Não consegui carregar o vídeo no player.</div>
              <div className="text-[11px] text-zinc-500 text-center font-mono break-all max-w-xs">{errorMessage}</div>
              <button
                onClick={handleOpenInTab}
                className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-400 text-xs font-semibold text-white transition-colors"
              >
                Abrir em nova aba ↗
              </button>
            </div>
          ) : (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              playsInline
              className="w-full aspect-[9/16] bg-black object-contain"
              onError={(e) => {
                const v = e.currentTarget as HTMLVideoElement;
                const code = v.error?.code;
                const msg = v.error?.message ?? 'unknown';
                console.error('[reels] Clip preview video error:', { videoUrl, code, message: msg });
                setErrorMessage(`Code ${code}: ${msg}`);
              }}
            />
          )}
          <div className="px-4 py-3 bg-[#141416] border-t border-white/5 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-zinc-100 truncate">{blockText.slice(0, 80)}{blockText.length > 80 ? '…' : ''}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">{duration.toFixed(1)}s · HeyGen</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={handleOpenInTab}
                className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-zinc-300 transition-colors"
                title="Abrir em nova aba"
              >
                ↗ Nova aba
              </button>
              <button
                onClick={handleDownload}
                className="px-3 py-1.5 rounded-md bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/40 text-[11px] font-medium text-blue-200 transition-colors"
                title="Baixar MP4"
              >
                ↓ Baixar
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 text-center text-[10px] text-zinc-500">
          Clique fora ou pressione <kbd className="px-1 py-0.5 rounded bg-white/10 text-zinc-400">ESC</kbd> pra fechar
        </div>
      </div>
    </div>
  );
};
