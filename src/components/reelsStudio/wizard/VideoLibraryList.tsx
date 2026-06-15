/**
 * List of saved video references with re-analyze + delete actions.
 * Extracted from the deleted VideoReferenceModal so the wizard's source 'video'
 * "Saved" sub-tab can show the same list.
 */

import React from 'react';
import { revealReferencesDir, type ReferenceMeta } from '../referenceVideoStore';
import { fmtSize, fmtAgo } from './format';

interface Props {
  refs: ReferenceMeta[];
  folder: string;
  disabled?: boolean;
  onReanalyze: (meta: ReferenceMeta) => void;
  onDelete: (meta: ReferenceMeta) => void;
}

export const VideoLibraryList: React.FC<Props> = ({ refs, folder, disabled, onReanalyze, onDelete }) => {
  return (
    <div className="space-y-2">
      {/* Folder strip */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10 text-[10.5px]">
        <span className="text-zinc-500">📁 Pasta:</span>
        <span className="flex-1 truncate text-zinc-300 font-mono">{folder || '~/Reels Studio/References/'}</span>
        <button
          onClick={() => { void revealReferencesDir(); }}
          className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-200 text-[10px]"
        >
          Abrir
        </button>
      </div>

      {refs.length === 0 ? (
        <div className="px-3 py-6 text-center text-[11px] text-zinc-500 border border-dashed border-white/10 rounded-lg">
          Nenhuma referência ainda. Cole um link ou arraste um vídeo na aba "Novo".
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
          {refs.map(r => (
            <div key={r.fileName} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
              <span className="text-base shrink-0">🎬</span>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-zinc-200 truncate">{r.fileName}</div>
                <div className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                  <span>{fmtSize(r.sizeBytes)}</span>
                  <span>·</span>
                  <span>{fmtAgo(r.createdAt)}</span>
                </div>
              </div>
              <button
                onClick={() => onReanalyze(r)}
                disabled={disabled}
                className="px-2 py-1 rounded-md bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/40 text-[10px] text-blue-200 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                Re-analisar
              </button>
              <button
                onClick={() => onDelete(r)}
                disabled={disabled}
                className="px-2 py-1 rounded-md bg-white/5 hover:bg-red-500/20 hover:text-red-300 text-[10px] text-zinc-400 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                title="Excluir"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
