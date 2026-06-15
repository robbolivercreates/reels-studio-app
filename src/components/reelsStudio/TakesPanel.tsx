import React, { useState, useRef, useEffect } from 'react';
import { deleteTakeBlob } from './persistence';
import { confirmDialog } from './confirmService';
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

const formatRelative = (ts: number): string => {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  const h   = Math.floor(diff / 3_600_000);
  const d   = Math.floor(diff / 86_400_000);
  if (min < 1)   return 'agora mesmo';
  if (min < 60)  return `há ${min} min`;
  if (h   < 24)  return `há ${h}h`;
  if (d   === 1) return 'ontem';
  if (d   < 7)   return `há ${d} dias`;
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

/** Floating video player rendered at fixed position — avoids overflow clipping inside the dropdown. */
const FloatingPreview: React.FC<{ take: ScreenTake; onClose: () => void }> = ({ take, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.src = take.url;
    v.load();
  }, [take.url]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-[#0A0A0F] rounded-xl border border-white/10 shadow-2xl overflow-hidden"
        style={{ width: 360, maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
          <span className="text-[11px] font-medium text-zinc-300 truncate max-w-[260px]">{take.name}</span>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Video */}
        <video
          ref={videoRef}
          controls
          playsInline
          muted={false}
          preload="auto"
          className="w-full bg-black"
          style={{ maxHeight: '60vh', objectFit: 'contain', display: 'block' }}
        />

        {/* Meta */}
        <div className="px-3 py-2 border-t border-white/5 text-[10px] text-zinc-500 flex items-center gap-2">
          <span>{formatMs(take.durationMs)}</span>
          <span>·</span>
          <span>{take.source === 'upload' ? '⬆ importado' : '⏺ gravado'}</span>
          <span>·</span>
          <span>{formatRelative(take.createdAt)}</span>
        </div>
      </div>
    </div>
  );
};

export const TakesPanel: React.FC<Props> = ({
  takes, activeTakeId, onSelectTake, onRemoveTake, onRenameTake, onEditTake, onRecordNew,
}) => {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [previewTake, setPreviewTake] = useState<ScreenTake | null>(null);

  const startEdit = (take: ScreenTake) => {
    setEditingId(take.id);
    setEditValue(take.name);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) onRenameTake(editingId, editValue.trim());
    setEditingId(null);
  };

  const handleDelete = async (take: ScreenTake) => {
    if (!(await confirmDialog(`Remover "${take.name}"?`))) return;
    await deleteTakeBlob(take.id);
    URL.revokeObjectURL(take.url);
    onRemoveTake(take.id);
  };

  if (takes.length === 0) return null;

  const sorted = [...takes].sort((a, b) => b.createdAt - a.createdAt);
  const ordered = [
    ...sorted.filter(t => t.id === activeTakeId),
    ...sorted.filter(t => t.id !== activeTakeId),
  ];

  return (
    <>
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
          <>
            <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
            <div className="absolute top-full mt-1 right-0 w-80 bg-[#1C1C1F] border border-white/10 rounded-lg shadow-2xl py-1 z-30 max-h-[380px] overflow-y-auto">
              <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                  Gravações · mais recentes primeiro
                </span>
                <button
                  onClick={() => { onRecordNew(); setOpen(false); }}
                  className="text-[10px] text-emerald-300 hover:text-emerald-200 transition-colors"
                >
                  + Nova
                </button>
              </div>

              {ordered.map((take) => {
                const isActive = activeTakeId === take.id;
                const isEditing = editingId === take.id;

                return (
                  <div
                    key={take.id}
                    className={`group flex items-center gap-2 px-3 py-2 transition-colors ${isActive ? 'bg-emerald-500/10' : 'hover:bg-white/5'}`}
                  >
                    <button
                      onClick={() => onSelectTake(isActive ? null : take.id)}
                      className={`shrink-0 w-4 h-4 rounded-full border-2 transition-colors ${isActive ? 'border-emerald-400 bg-emerald-400' : 'border-zinc-600'}`}
                      title={isActive ? 'Desativar' : 'Usar este take'}
                    >
                      {isActive && <div className="w-1.5 h-1.5 bg-white rounded-full m-auto mt-[3px]" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="w-full bg-black/30 border border-emerald-400/40 rounded px-1.5 py-0.5 text-[11px] text-zinc-100 outline-none"
                        />
                      ) : (
                        <button
                          onDoubleClick={() => startEdit(take)}
                          className="text-[11px] font-medium text-zinc-200 truncate w-full text-left"
                        >
                          {take.name}
                          {isActive && <span className="ml-1.5 text-[9px] text-emerald-400 font-semibold">● ativo</span>}
                        </button>
                      )}
                      <div className="text-[9px] text-zinc-500 font-mono flex items-center gap-1.5">
                        <span>{formatMs(take.durationMs)}</span>
                        <span>·</span>
                        <span>{take.source === 'upload' ? '⬆' : '⏺'}</span>
                        <span>·</span>
                        <span>{formatRelative(take.createdAt)}</span>
                      </div>
                    </div>

                    {/* Preview button */}
                    <button
                      onClick={() => { setPreviewTake(take); setOpen(false); }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-cyan-300 transition-all"
                      title="Assistir gravação"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </button>

                    {onEditTake && (
                      <button
                        onClick={() => onEditTake(take.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-blue-300 transition-all"
                        title="Trim + cortar silêncios"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    )}

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
          </>
        )}
      </div>

      {/* Floating video preview — outside dropdown to avoid overflow clipping */}
      {previewTake && (
        <FloatingPreview take={previewTake} onClose={() => setPreviewTake(null)} />
      )}
    </>
  );
};
