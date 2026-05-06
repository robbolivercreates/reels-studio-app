import React, { useRef, useState } from 'react';
import { createTakeFromFile } from './uploadTake';
import type { ScreenTake } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  onTake: (take: ScreenTake) => void;
  onChooseRecord: () => void;
}

export const AddBrollModal: React.FC<Props> = ({ open, onClose, onTake, onChooseRecord }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  if (!open) return null;

  const handleFile = async (file: File) => {
    setError(null);
    setWarning(null);
    setUploading(true);
    try {
      const { take, warning } = await createTakeFromFile(file);
      if (warning) setWarning(warning);
      onTake(take);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao processar o arquivo');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-6" onClick={onClose}>
      <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-lg w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 flex items-start justify-between">
          <div>
            <div className="text-base font-semibold text-zinc-100 mb-1">Adicionar B-roll</div>
            <div className="text-xs text-zinc-500">Escolha um vídeo do disco ou grave a tela direto.</div>
          </div>
          <button onClick={onClose} disabled={uploading} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 pb-4 grid grid-cols-2 gap-3">
          {/* Upload (primary) */}
          <button
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            disabled={uploading}
            className={`relative aspect-square rounded-xl border-2 transition-all p-4 flex flex-col items-center justify-center gap-2 text-center ${
              dragOver
                ? 'border-violet-400 bg-violet-500/15 scale-[1.02]'
                : 'border-violet-400/40 bg-violet-500/[0.05] hover:bg-violet-500/10'
            } ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {uploading ? (
              <svg className="w-8 h-8 animate-spin text-violet-300" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <>
                <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center text-violet-200">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div className="text-sm font-semibold text-violet-100">Upload de vídeo</div>
                <div className="text-[10px] text-violet-300/70 leading-tight">
                  {dragOver ? 'Solte o arquivo aqui' : 'MP4 / MOV / WebM\nou arraste pra cá'}
                </div>
                <span className="absolute top-2 right-2 text-[8px] px-1.5 py-0.5 rounded bg-violet-500/30 text-violet-100 uppercase tracking-wider font-bold">recomendado</span>
              </>
            )}
          </button>

          {/* Record */}
          <button
            onClick={() => { onClose(); onChooseRecord(); }}
            disabled={uploading}
            className="aspect-square rounded-xl border-2 border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-red-400/40 transition-all p-4 flex flex-col items-center justify-center gap-2 text-center disabled:opacity-50"
          >
            <div className="w-12 h-12 rounded-xl bg-red-500/15 flex items-center justify-center text-red-300">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path strokeLinecap="round" d="M8 20h8M12 16v4" />
                <circle cx="12" cy="10" r="3" fill="currentColor" />
              </svg>
            </div>
            <div className="text-sm font-semibold text-zinc-100">Gravar tela</div>
            <div className="text-[10px] text-zinc-500 leading-tight">Direto do navegador</div>
          </button>

          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = '';
            }}
          />
        </div>

        <div className="px-6 pb-4 space-y-2">
          <div className="text-[11px] text-zinc-500 leading-relaxed">
            💡 <strong>Dica:</strong> grave externamente (ScreenStudio, Loom, OBS, QuickTime) pra mais qualidade e cursor highlight, depois faça upload aqui. O Reels Studio cuida do trim e cortes de silêncio.
          </div>
          {warning && <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">⚠ {warning}</div>}
          {error && <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">⚠ {error}</div>}
        </div>
      </div>
    </div>
  );
};
