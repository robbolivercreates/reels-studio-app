import React, { useEffect, useState } from 'react';
import {
  fetchHeyGenAvatars,
  importRemoteAvatar,
  loadAvatarPhotos,
  type RemoteHeyGenAvatar,
} from './avatarPhotosStore';

interface Props {
  onClose: () => void;
  onImported: () => void;
}

export const FetchHeyGenAvatarsModal: React.FC<Props> = ({ onClose, onImported }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteHeyGenAvatar[]>([]);
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchHeyGenAvatars();
        if (cancelled) return;
        setRemote(list);
        setExistingIds(new Set(loadAvatarPhotos().map(p => p.talkingPhotoId)));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Falha ao buscar');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const newOnes = remote.filter(r => !existingIds.has(r.talkingPhotoId));
  const allNewSelected = newOnes.length > 0 && newOnes.every(r => selected.has(r.talkingPhotoId));

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllNew = () => {
    if (allNewSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(newOnes.map(r => r.talkingPhotoId)));
    }
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setImportProgress(0);
    const targets = remote.filter(r => selected.has(r.talkingPhotoId));
    let done = 0;
    for (const r of targets) {
      try {
        await importRemoteAvatar(r);
      } catch (err) {
        console.warn('[fetch-heygen] failed to import', r.talkingPhotoId, err);
      }
      done++;
      setImportProgress(done);
    }
    setImporting(false);
    onImported();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[70] p-6">
      <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 pt-6 pb-4 flex items-start justify-between shrink-0 border-b border-white/5">
          <div>
            <div className="text-base font-semibold text-zinc-100 mb-1">Avatares no HeyGen</div>
            <div className="text-xs text-zinc-500">
              {loading ? 'Buscando...' : `${remote.length} encontrados · ${newOnes.length} novos`}
            </div>
          </div>
          <button onClick={onClose} disabled={importing} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors disabled:opacity-50">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-16 gap-3 text-zinc-500">
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm">Buscando seus avatares no HeyGen...</span>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
              ⚠ {error}
              <div className="mt-2 text-[11px] text-red-200/80">
                Verifique se HEYGEN_API_KEY está correta nas configurações.
              </div>
            </div>
          )}

          {!loading && !error && remote.length === 0 && (
            <div className="text-center py-16 text-zinc-500 text-sm">
              Nenhum avatar encontrado na sua conta HeyGen.<br/>
              <span className="text-[11px] text-zinc-600">Crie um Talking Photo em heygen.com primeiro.</span>
            </div>
          )}

          {!loading && !error && remote.length > 0 && (
            <>
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={selectAllNew}
                  disabled={newOnes.length === 0}
                  className="text-[11px] px-2 py-1 rounded-md bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {allNewSelected ? 'Desmarcar todos' : `Selecionar todos os ${newOnes.length} novos`}
                </button>
                <div className="text-[11px] text-zinc-500">{selected.size} selecionados</div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {remote.map(r => {
                  const already = existingIds.has(r.talkingPhotoId);
                  const isSelected = selected.has(r.talkingPhotoId);
                  return (
                    <button
                      key={r.talkingPhotoId}
                      onClick={() => !already && toggle(r.talkingPhotoId)}
                      disabled={already || importing}
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                        already
                          ? 'border-emerald-500/40 opacity-60 cursor-not-allowed'
                          : isSelected
                          ? 'border-blue-400 shadow-[0_0_24px_rgba(10,132,255,0.4)] scale-[1.02]'
                          : 'border-white/10 hover:border-white/30'
                      }`}
                    >
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-blue-700/20 flex items-center justify-center">
                        <span className="text-2xl font-bold text-blue-200">{r.name.slice(0, 1).toUpperCase()}</span>
                      </div>
                      {r.previewUrl && (
                        <img
                          src={r.previewUrl}
                          alt={r.name}
                          className="absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                        <div className="text-[10px] font-semibold text-white truncate text-left">{r.name}</div>
                        <div className="text-[9px] text-white/60 text-left uppercase tracking-wider">{r.source.replace('_', ' ')}</div>
                      </div>
                      {already && (
                        <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-emerald-500/90 text-[9px] font-bold text-white uppercase">
                          ✓ importado
                        </div>
                      )}
                      {!already && isSelected && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center shadow-lg">
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/5 bg-black/30 shrink-0">
          {importing ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>Importando...</span>
                <span>{importProgress} / {selected.size}</span>
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all" style={{ width: `${(importProgress / Math.max(selected.size, 1)) * 100}%` }}></div>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Fechar</button>
              <button
                onClick={handleImport}
                disabled={selected.size === 0 || loading}
                className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(10,132,255,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
              >
                Importar {selected.size > 0 ? `${selected.size} ` : ''}avatar{selected.size === 1 ? '' : 'es'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
