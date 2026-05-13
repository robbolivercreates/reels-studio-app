/**
 * "Novo vídeo" form for the wizard's source 'video'. Combines URL input
 * (Instagram/TikTok via yt-dlp) + drag-and-drop file picker + progress bar.
 * Extracted from VideoReferenceModal's url+upload tabs.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { DownloadProgress } from '../referenceVideoStore';
import { fmtSize } from './format';

interface Props {
  url: string;
  onChangeUrl: (url: string) => void;
  pendingFile: File | null;
  onSelectFile: (file: File | null) => void;
  busyMessage: string | null;
  progress: DownloadProgress | null;
  error: string | null;
  onSubmitUrl: () => void;
  onSubmitFile: () => void;
}

export const VideoNewSourceForm: React.FC<Props> = ({
  url,
  onChangeUrl,
  pendingFile,
  onSelectFile,
  busyMessage,
  progress,
  error,
  onSubmitUrl,
  onSubmitFile,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Manage object URL for the preview <video>.
  useEffect(() => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (pendingFile) {
      const u = URL.createObjectURL(pendingFile);
      previewUrlRef.current = u;
      setPreviewUrl(u);
    } else {
      previewUrlRef.current = null;
      setPreviewUrl(null);
    }
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [pendingFile]);

  const handleFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith('video/')) return;
    onSelectFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="space-y-3">
      {/* Supported hosts badge */}
      <div className="px-3 py-2 rounded-lg bg-emerald-500/[0.08] border border-emerald-500/20 text-[10.5px] text-emerald-200 leading-snug">
        ✅ <strong className="text-emerald-100">Funciona com:</strong> Instagram, TikTok, YouTube, Facebook, X / Twitter, Vimeo e qualquer site suportado pelo yt-dlp. O vídeo é baixado direto pra <code className="text-emerald-100">~/Reels Studio/References/</code>.
      </div>

      {/* URL input + button */}
      <div>
        <label className="text-[10px] text-zinc-500 mb-1.5 block">Link do vídeo</label>
        <input
          type="url"
          value={url}
          onChange={e => onChangeUrl(e.target.value)}
          placeholder="https://www.instagram.com/reel/..."
          disabled={!!busyMessage}
          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 transition-colors disabled:opacity-50"
        />
        <button
          onClick={onSubmitUrl}
          disabled={!url.trim() || !!busyMessage}
          className="w-full mt-2 py-2 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(124,58,237,0.4)]"
        >
          {busyMessage ? busyMessage : 'Baixar e analisar'}
        </button>
      </div>

      {/* Progress bar */}
      {progress && (
        <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10 space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-400 capitalize">{progress.stage}</span>
            {typeof progress.percent === 'number' && (
              <span className="text-zinc-500 font-mono tabular-nums">{Math.round(progress.percent)}%</span>
            )}
          </div>
          {typeof progress.percent === 'number' && (
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-violet-400 transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          )}
          {progress.message && (
            <div className="text-[9px] text-zinc-500 font-mono truncate">{progress.message}</div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-white/5" />
        <span className="text-[9px] text-zinc-600">ou arraste um arquivo</span>
        <div className="flex-1 h-px bg-white/5" />
      </div>

      {/* Drag & drop / file picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/mov,video/webm,video/*"
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />

      {!pendingFile ? (
        <div
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`py-8 rounded-lg border-2 border-dashed transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 ${dragOver ? 'border-violet-500/60 bg-violet-500/10' : 'border-white/10 hover:border-white/20 bg-white/[0.02]'}`}
        >
          <span className="text-2xl">🎬</span>
          <div className="text-center">
            <div className="text-[12px] text-zinc-200">Solte um MP4 / MOV / WEBM aqui</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">ou clique para escolher · até 20 MB para análise inline</div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {previewUrl && (
            <video src={previewUrl} controls className="w-full max-h-[280px] rounded-lg bg-black" />
          )}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
            <span className="text-base shrink-0">🎞</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-zinc-200 truncate">{pendingFile.name}</div>
              <div className="text-[10px] text-zinc-500">{fmtSize(pendingFile.size)}</div>
            </div>
            <button
              onClick={() => onSelectFile(null)}
              disabled={!!busyMessage}
              className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] text-zinc-300 disabled:opacity-40"
            >
              Trocar
            </button>
          </div>
          <button
            onClick={onSubmitFile}
            disabled={!!busyMessage}
            className="w-full py-2 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(124,58,237,0.4)]"
          >
            {busyMessage ? busyMessage : 'Salvar na pasta e analisar'}
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
          <span className="text-red-400 text-[11px] mt-0.5">⚠</span>
          <p className="text-[10px] text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
};
