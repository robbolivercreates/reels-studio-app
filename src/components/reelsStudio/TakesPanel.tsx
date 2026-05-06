import React, { useState } from 'react';
import { deleteTakeBlob } from './persistence';
import type { ScreenTake } from './types';

interface Props {
  takes: ScreenTake[];
  activeTakeId: string | null;
  onSelectTake: (id: string | null) => void;
  onRemoveTake: (id: string) => void;
  onRenameTake: (id: string, name: string) => void;
  onEditTake?: (id: string) => void;
  onRecordNew: () => void;
}

const formatMs = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const TakesPanel: React.FC<Props> = ({ takes, activeTakeId, onSelectTake, onRemoveTake, onRenameTake, onEditTake, onRecordNew }) => {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (take: ScreenTake) => {
    setEditingId(take.id);
    setEditValue(take.name);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      onRenameTake(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleDelete = async (take: ScreenTake) => {
    if (!confirm(`Remover "${take.name}"?`)) return;
    await deleteTakeBlob(take.id);
    URL.revokeObjectURL(take.url);
    onRemoveTake(take.id);
  };

  if (takes.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-[11px] font-medium text-emerald-200 transition-colors"
      >
        Takes ({takes.length})
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 w-80 bg-[#1C1C1F] border border-white/10 rounded-lg shadow-2xl py-1 z-30 max-h-[300px] overflow-y-auto">
          <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Suas gravações</span>
            <button onClick={() => { onRecordNew(); setOpen(false); }} className="text-[10px] text-emerald-300 hover:text-emerald-200 transition-colors">+ Nova</button>
          </div>

          {takes.map((take) => {
            const isActive = activeTakeId === take.id;
            const isEditing = editingId === take.id;
            return (
              <div
                key={take.id}
                className={`group flex items-center gap-2 px-3 py-2 transition-colors ${isActive ? 'bg-emerald-500/10' : 'hover:bg-white/5'}`}
              >
                <button
                  onClick={() => onSelectTake(isActive ? null : take.id)}
                  className={`shrink-0 w-4 h-4 rounded-full border-2 ${isActive ? 'border-emerald-400 bg-emerald-400' : 'border-zinc-600'}`}
                  title={isActive ? 'Desativar' : 'Usar este take'}
                >
                  {isActive && <div className="w-1.5 h-1.5 bg-white rounded-full m-auto mt-[3px]"></div>}
                </button>
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null); }}
                      className="w-full bg-black/30 border border-emerald-400/40 rounded px-1.5 py-0.5 text-[11px] text-zinc-100 outline-none"
                    />
                  ) : (
                    <button onDoubleClick={() => startEdit(take)} className="text-[11px] font-medium text-zinc-200 truncate w-full text-left" title="Clique duplo pra renomear">
                      {take.name}
                    </button>
                  )}
                  <div className="text-[9px] text-zinc-500 font-mono">
                    {formatMs(take.durationMs)} · {take.hasAudio ? '🔊 com áudio' : '🔇 sem áudio'}
                  </div>
                </div>
                {onEditTake && (
                  <button
                    onClick={() => onEditTake(take.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-violet-300 transition-all"
                    title="Trim + cortar silêncios"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={() => window.open(take.url, '_blank', 'noopener,noreferrer')}
                  className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-zinc-200 transition-all"
                  title="Ver gravação"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(take)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-all"
                  title="Remover"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
