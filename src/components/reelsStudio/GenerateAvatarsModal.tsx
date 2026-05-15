import React, { useState, useRef } from 'react';
import {
  loadAvatarPhotos,
  uploadAvatarPhotoFromFile,
  importAvatarPhotoByTalkingId,
  deleteAvatarPhoto,
  type AvatarPhoto,
} from './avatarPhotosStore';
import { FetchHeyGenAvatarsModal } from './FetchHeyGenAvatarsModal';
import type { HeyGenModelChoice } from './types';

interface Props {
  totalAvatarSeconds: number;
  clipCount: number;
  initialPhotoId: string | null;
  initialModel: HeyGenModelChoice;
  onClose: () => void;
  onConfirm: (photoId: string, model: HeyGenModelChoice) => void;
}

const PRICE_PER_SECOND: Record<HeyGenModelChoice, number> = {
  avatar3: 0.030, // estimated
  avatar4: 0.058,
  // HeyGen reports Avatar V uses the same credit pool as IV (no
  // explicit upcharge for the engine itself). Treat as IV for the
  // cost estimate; if pricing diverges in the future we can split it.
  avatar5: 0.058,
};

export const GenerateAvatarsModal: React.FC<Props> = ({
  totalAvatarSeconds, clipCount, initialPhotoId, initialModel, onClose, onConfirm,
}) => {
  const [photos, setPhotos] = useState<AvatarPhoto[]>(() => loadAvatarPhotos());
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(
    initialPhotoId ?? photos[0]?.id ?? null,
  );
  const [model, setModel] = useState<HeyGenModelChoice>(initialModel);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteId, setPasteId] = useState('');
  const [pasteName, setPasteName] = useState('');
  const [fetchOpen, setFetchOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => setPhotos(loadAvatarPhotos());
  const selected = photos.find(p => p.id === selectedPhotoId) ?? null;
  const cost = totalAvatarSeconds * PRICE_PER_SECOND[model];
  const canGenerate = selected !== null && clipCount > 0 && !uploading;

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const defaultName = file.name.replace(/\.[^/.]+$/, '').slice(0, 32);
      const photo = await uploadAvatarPhotoFromFile(file, defaultName);
      refresh();
      setSelectedPhotoId(photo.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Falha no upload');
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = () => {
    if (!pasteId.trim()) return;
    const photo = importAvatarPhotoByTalkingId(pasteId, pasteName);
    refresh();
    setSelectedPhotoId(photo.id);
    setPasteOpen(false);
    setPasteId('');
    setPasteName('');
  };

  const handleDelete = (id: string) => {
    if (!confirm('Remover esta foto?')) return;
    deleteAvatarPhoto(id);
    refresh();
    if (selectedPhotoId === id) setSelectedPhotoId(null);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
      <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 pt-6 pb-4 flex items-start justify-between shrink-0">
          <div>
            <div className="text-base font-semibold text-zinc-100 mb-1">Gerar clipes de avatar</div>
            <div className="text-xs text-zinc-500">{clipCount} clipes · {totalAvatarSeconds.toFixed(1)}s no total</div>
          </div>
          <button onClick={onClose} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 flex-1 overflow-y-auto space-y-5">
          {/* Photos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Sua foto</div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setFetchOpen(true)}
                  className="text-[10px] px-2 py-1 rounded-md bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-200 transition-colors flex items-center gap-1"
                  title="Buscar avatares cadastrados no HeyGen"
                >
                  🔄 Buscar do HeyGen
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="text-[10px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 transition-colors disabled:opacity-50"
                >
                  📤 Upload
                </button>
              </div>
            </div>
            {photos.length === 0 ? (
              <div className="px-4 py-6 rounded-xl border border-dashed border-white/10 text-center">
                <div className="text-xs text-zinc-400 mb-3">Nenhuma foto cadastrada ainda.</div>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="px-3 py-1.5 rounded-md bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-xs font-medium text-violet-200 transition-colors disabled:opacity-50"
                  >
                    {uploading ? '⏳ Enviando...' : '📤 Upload de foto'}
                  </button>
                  <button
                    onClick={() => setPasteOpen(true)}
                    className="px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-zinc-300 transition-colors"
                  >
                    Colar talking_photo_id
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {photos.map(p => {
                  const isSelected = selectedPhotoId === p.id;
                  return (
                    <div key={p.id} className="relative group">
                      <button
                        onClick={() => setSelectedPhotoId(p.id)}
                        className={`relative w-full aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                          isSelected
                            ? 'border-violet-400 shadow-[0_0_24px_rgba(167,139,250,0.4)] scale-[1.02]'
                            : 'border-white/10 hover:border-white/30'
                        }`}
                      >
                        {p.thumbnailBase64 || p.previewUrl ? (
                          <img
                            src={p.thumbnailBase64 || p.previewUrl}
                            alt={p.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : null}
                        {!p.thumbnailBase64 && !p.previewUrl && (
                          <div className="w-full h-full bg-gradient-to-br from-violet-500/20 to-violet-700/20 flex items-center justify-center">
                            <span className="text-xl font-bold text-violet-200">{p.name.slice(0, 1).toUpperCase()}</span>
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                          <div className="text-[10px] font-semibold text-white truncate text-left">{p.name}</div>
                        </div>
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center shadow-lg">
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                          </div>
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-zinc-900 border border-white/10 opacity-0 group-hover:opacity-100 flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        title="Remover"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  );
                })}
                {/* Add new */}
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="aspect-square rounded-lg border-2 border-dashed border-white/15 hover:border-violet-400/50 hover:bg-violet-500/5 transition-all flex flex-col items-center justify-center gap-1 text-zinc-500 hover:text-violet-300 disabled:opacity-50"
                >
                  {uploading ? (
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" /><path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                      <span className="text-[10px] font-medium">Nova foto</span>
                    </>
                  )}
                </button>
              </div>
            )}
            {photos.length > 0 && (
              <button
                onClick={() => setPasteOpen(true)}
                className="mt-2 text-[10px] text-zinc-500 hover:text-violet-300 underline transition-colors"
              >
                Ou colar um talking_photo_id existente do HeyGen
              </button>
            )}
            {uploadError && <div className="mt-2 text-[10px] text-red-400">⚠ {uploadError}</div>}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = '';
              }}
            />
          </div>

          {/* Paste talking_photo_id */}
          {pasteOpen && (
            <div className="rounded-lg bg-black/30 border border-violet-500/30 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-violet-300 font-semibold">Colar talking_photo_id</div>
              <input
                value={pasteName}
                onChange={e => setPasteName(e.target.value)}
                placeholder="Nome (ex: Rob v2)"
                className="w-full px-2.5 py-1.5 rounded-md bg-black/40 border border-white/10 text-xs text-zinc-100 outline-none focus:border-violet-400/50"
              />
              <input
                value={pasteId}
                onChange={e => setPasteId(e.target.value)}
                placeholder="talking_photo_id do HeyGen"
                className="w-full px-2.5 py-1.5 rounded-md bg-black/40 border border-white/10 text-xs text-zinc-100 outline-none focus:border-violet-400/50 font-mono"
              />
              <div className="flex gap-2 pt-1">
                <button onClick={() => setPasteOpen(false)} className="flex-1 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-[11px] text-zinc-300 transition-colors">Cancelar</button>
                <button onClick={handlePaste} disabled={!pasteId.trim()} className="flex-1 py-1.5 rounded-md bg-violet-500 hover:bg-violet-400 text-[11px] font-semibold text-white transition-colors disabled:opacity-40">Adicionar</button>
              </div>
            </div>
          )}

          {/* Model picker */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Modelo</div>
            <div className="space-y-1.5">
              <button
                onClick={() => setModel('avatar5')}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                  model === 'avatar5' ? 'bg-violet-500/15 border-violet-400/50' : 'bg-black/20 border-white/10 hover:border-white/20'
                }`}
              >
                <div className={`shrink-0 w-4 h-4 rounded-full border-2 mt-0.5 ${model === 'avatar5' ? 'border-violet-400 bg-violet-400' : 'border-zinc-500'}`}>
                  {model === 'avatar5' && <div className="w-1.5 h-1.5 bg-white rounded-full m-auto mt-[3px]"></div>}
                </div>
                <div className="text-left flex-1">
                  <div className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                    Avatar V <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 uppercase tracking-wider">Novo</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">Mais realista · sem drift em vídeos longos · 1080p · ${PRICE_PER_SECOND.avatar5.toFixed(3)}/s · requer foto compatível</div>
                </div>
              </button>
              <button
                onClick={() => setModel('avatar4')}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                  model === 'avatar4' ? 'bg-violet-500/15 border-violet-400/50' : 'bg-black/20 border-white/10 hover:border-white/20'
                }`}
              >
                <div className={`shrink-0 w-4 h-4 rounded-full border-2 mt-0.5 ${model === 'avatar4' ? 'border-violet-400 bg-violet-400' : 'border-zinc-500'}`}>
                  {model === 'avatar4' && <div className="w-1.5 h-1.5 bg-white rounded-full m-auto mt-[3px]"></div>}
                </div>
                <div className="text-left flex-1">
                  <div className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                    Avatar 4 <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 uppercase tracking-wider">Recomendado</span>
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">Mais novo · expressões naturais · 1080p · ${PRICE_PER_SECOND.avatar4.toFixed(3)}/s</div>
                </div>
              </button>
              <button
                onClick={() => setModel('avatar3')}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                  model === 'avatar3' ? 'bg-violet-500/15 border-violet-400/50' : 'bg-black/20 border-white/10 hover:border-white/20'
                }`}
              >
                <div className={`shrink-0 w-4 h-4 rounded-full border-2 mt-0.5 ${model === 'avatar3' ? 'border-violet-400 bg-violet-400' : 'border-zinc-500'}`}>
                  {model === 'avatar3' && <div className="w-1.5 h-1.5 bg-white rounded-full m-auto mt-[3px]"></div>}
                </div>
                <div className="text-left flex-1">
                  <div className="text-xs font-semibold text-zinc-100">Avatar 3</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">Mais rápido · custo menor · ${PRICE_PER_SECOND.avatar3.toFixed(3)}/s</div>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* Summary + actions */}
        <div className="px-6 py-4 mt-4 border-t border-white/5 bg-black/30 shrink-0">
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="text-zinc-500">Total estimado</span>
            <span className="text-violet-300 font-bold text-sm">${cost.toFixed(2)}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Cancelar</button>
            <button
              onClick={() => selected && onConfirm(selected.id, model)}
              disabled={!canGenerate}
              className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            >
              Gerar agora
            </button>
          </div>
          {!selected && photos.length > 0 && <div className="mt-2 text-[10px] text-amber-400 text-center">Selecione uma foto</div>}
        </div>
      </div>

      {fetchOpen && (
        <FetchHeyGenAvatarsModal
          onClose={() => setFetchOpen(false)}
          onImported={() => {
            refresh();
            setFetchOpen(false);
            // Auto-select the newest if nothing was selected before.
            const all = loadAvatarPhotos();
            if (!selectedPhotoId && all.length > 0) {
              setSelectedPhotoId(all[0].id);
            }
          }}
        />
      )}
    </div>
  );
};
