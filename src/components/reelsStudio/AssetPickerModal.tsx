import React, { useEffect, useRef, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type { AttachedAsset } from './types';

interface ProjectAsset {
  name: string;
  path: string;
  ext: string;
  size_bytes: number;
  kind: 'image' | 'video';
}

interface Props {
  projectName: string;
  /** Ordered list of assets currently attached to the block (carousel order). */
  currentAssets: AttachedAsset[];
  /** True when the asset gate is currently locking this block (project has
   *  files in Assets/ but this block has none attached). Surfaces the
   *  "Continuar sem asset" bypass button at the bottom. */
  gateActive?: boolean;
  /** Toggle the per-block opt-out from the gate. Called when the user clicks
   *  "Continuar sem asset" — flips block.skipAssetGate to true and closes. */
  onSkipGate?: () => void;
  onClose: () => void;
  /** Append an asset to the carousel. The reducer dedupes by path. */
  onAdd: (asset: AttachedAsset) => void;
  /** Remove the asset at the given carousel index. */
  onRemove: (index: number) => void;
  /** Reorder the carousel by moving fromIndex → toIndex. */
  onReorder: (fromIndex: number, toIndex: number) => void;
}

/** Soft cap on carousel size. The prompt + render budget gets unwieldy past this. */
const MAX_CAROUSEL_SIZE = 6;

const SUPPORTED_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm'];

const detectKind = (filename: string): 'image' | 'video' | null => {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm'].includes(ext)) return 'video';
  return null;
};

const arrayBufferToBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
};

export const AssetPickerModal: React.FC<Props> = ({ projectName, currentAssets, gateActive = false, onSkipGate, onClose, onAdd, onRemove, onReorder }) => {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState<{ name: string; pct: number } | null>(null);
  // Index of the carousel item being dragged for reorder. -1 = no drag.
  const [reorderingIndex, setReorderingIndex] = useState<number>(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Build a path → carousel-index lookup so the grid can show a numbered
  // badge ("1", "2", "3"…) on already-attached assets.
  const carouselIndexByPath = new Map(currentAssets.map((a, i) => [a.path, i]));
  const atCap = currentAssets.length >= MAX_CAROUSEL_SIZE;

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      await invoke('ensure_assets_dir', { projectName });
      const list = await invoke<ProjectAsset[]>('list_project_assets', { projectName });
      setAssets(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, [projectName]);

  const openFolder = async () => {
    try { await invoke('reveal_assets_dir', { projectName }); } catch { /* noop */ }
  };

  // Import a single dropped/picked file: copy bytes → reload list → return path.
  // Small files (<5MB) go in a single shot, larger ones stream in 1MB chunks
  // to dodge Tauri IPC's size cliff for base64 payloads.
  const importFile = async (file: File) => {
    setError(null);
    const kind = detectKind(file.name);
    if (!kind) {
      setError(`Tipo de arquivo não suportado. Use: ${SUPPORTED_EXT.join(', ')}`);
      return;
    }
    setImporting({ name: file.name, pct: 0 });
    try {
      const SMALL_LIMIT = 5 * 1024 * 1024; // 5 MB
      if (file.size <= SMALL_LIMIT) {
        const buf = await file.arrayBuffer();
        await invoke('write_asset_bytes', {
          projectName,
          filename: file.name,
          base64Bytes: arrayBufferToBase64(buf),
        });
        setImporting({ name: file.name, pct: 100 });
      } else {
        const CHUNK = 1024 * 1024; // 1 MB
        let offset = 0;
        let truncated = false;
        while (offset < file.size) {
          const slice = file.slice(offset, Math.min(offset + CHUNK, file.size));
          const buf = await slice.arrayBuffer();
          await invoke('append_asset_chunk', {
            projectName,
            filename: file.name,
            base64Chunk: arrayBufferToBase64(buf),
            truncate: !truncated,
          });
          truncated = true;
          offset += CHUNK;
          setImporting({ name: file.name, pct: Math.min(100, Math.round((offset / file.size) * 100)) });
        }
      }
      await reload();
    } catch (e) {
      setError(`Erro ao importar ${file.name}: ${String(e)}`);
    } finally {
      setImporting(null);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const f of files) {
      // Sequential — Tauri IPC is single-threaded, parallel just queues anyway.
      // eslint-disable-next-line no-await-in-loop
      await importFile(f);
    }
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const f of files) {
      // eslint-disable-next-line no-await-in-loop
      await importFile(f);
    }
    e.target.value = '';
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-3xl max-h-[80vh] bg-[#0F0F11] border rounded-2xl shadow-2xl flex flex-col transition-all relative ${
          dragOver ? 'border-violet-400 ring-4 ring-violet-400/30' : 'border-white/10'
        }`}
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => {
          // Only hide overlay when leaving the modal itself, not crossing children.
          if (e.currentTarget === e.target) setDragOver(false);
        }}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="absolute inset-0 bg-violet-500/10 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center pointer-events-none z-10">
            <div className="w-16 h-16 rounded-2xl bg-violet-500/30 border-2 border-violet-300 border-dashed flex items-center justify-center mb-3">
              <svg className="w-8 h-8 text-violet-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div className="text-sm font-semibold text-violet-100">Solte os arquivos aqui</div>
            <div className="text-[11px] text-violet-200/70 mt-1">PNG · JPG · WebP · GIF · MP4 · MOV · WebM</div>
          </div>
        )}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">📎 Anexar asset ao bloco</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Arraste arquivos aqui · ou escolhe um já existente abaixo
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-white/5 rounded-md transition-colors"
            title="Fechar (Esc)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between gap-3">
          <div className="text-[11px] text-zinc-400 truncate">
            Pasta: <code className="text-zinc-300">~/Reels Studio/Projects/{projectName}/Assets</code>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!!importing}
              className="px-2.5 py-1 text-[11px] rounded-md bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/40 text-violet-100 transition-colors disabled:opacity-50"
              title="Selecionar arquivo do disco"
            >
              + Importar
            </button>
            <button
              onClick={openFolder}
              className="px-2.5 py-1 text-[11px] rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 transition-colors"
              title="Abrir no Finder"
            >
              📂 Pasta
            </button>
            <button
              onClick={reload}
              className="px-2.5 py-1 text-[11px] rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 transition-colors"
              title="Recarregar lista"
            >
              ↻
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm,image/*,video/*"
            multiple
            className="hidden"
            onChange={handleFilePick}
          />
        </div>

        {importing && (
          <div className="px-5 py-2 border-b border-white/5 bg-violet-500/[0.06]">
            <div className="flex items-center justify-between text-[11px] text-violet-200 mb-1">
              <span className="truncate">Importando: {importing.name}</span>
              <span className="font-mono">{importing.pct}%</span>
            </div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-violet-400 transition-all" style={{ width: `${importing.pct}%` }}></div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="text-center py-12 text-zinc-500 text-sm">Carregando…</div>
          )}
          {error && (
            <div className="text-center py-12 text-red-400 text-sm">Erro: {error}</div>
          )}
          {!loading && !error && assets.length === 0 && (
            <div className="text-center py-12">
              <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border-2 border-violet-400/30 border-dashed flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-violet-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <div className="text-sm font-medium text-zinc-300 mb-1">Nenhum asset por enquanto</div>
              <div className="text-[11px] text-zinc-500">Arraste arquivos aqui ou clica em <span className="text-violet-300">+ Importar</span>.</div>
            </div>
          )}
          {!loading && !error && assets.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {assets.map(a => {
                const carouselIdx = carouselIndexByPath.get(a.path);
                const isAttached = carouselIdx !== undefined;
                const url = convertFileSrc(a.path);
                const handleClick = () => {
                  if (isAttached) {
                    onRemove(carouselIdx!);
                  } else if (!atCap) {
                    onAdd({ name: a.name, path: a.path, type: a.kind });
                  }
                };
                return (
                  <button
                    key={a.path}
                    onClick={handleClick}
                    disabled={!isAttached && atCap}
                    className={`group relative rounded-lg overflow-hidden border transition-all ${
                      isAttached
                        ? 'border-violet-400 ring-2 ring-violet-400/40 shadow-[0_0_16px_rgba(167,139,250,0.35)]'
                        : atCap
                          ? 'border-white/5 opacity-40 cursor-not-allowed'
                          : 'border-white/10 hover:border-white/30'
                    }`}
                    title={isAttached ? `Slot ${carouselIdx! + 1} · clique pra remover` : atCap ? `Limite de ${MAX_CAROUSEL_SIZE} slides atingido` : `Adicionar como slot ${currentAssets.length + 1}`}
                  >
                    <div className="aspect-square bg-black/40 flex items-center justify-center">
                      {a.kind === 'image' ? (
                        <img src={url} alt={a.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="relative w-full h-full">
                          <video src={url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition-colors">
                            <span className="text-2xl">▶</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="px-2 py-1.5 bg-black/60 backdrop-blur-sm">
                      <div className="text-[10.5px] text-zinc-200 truncate">{a.name}</div>
                      <div className="text-[9px] text-zinc-500 uppercase">{a.kind} · {a.ext}</div>
                    </div>
                    {isAttached && (
                      <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-violet-500 text-white text-[11px] font-bold flex items-center justify-center shadow-lg">
                        {carouselIdx! + 1}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Carousel order strip — visible whenever there's at least 1 attached. */}
        {currentAssets.length > 0 && (
          <div className="px-5 py-3 border-t border-white/5 bg-black/30">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Slides do bloco · {currentAssets.length} {currentAssets.length === 1 ? 'item' : 'itens'}
              </div>
              {currentAssets.length > 1 && (
                <div className="text-[10px] text-zinc-500">
                  Arraste pra reordenar · cada slide ~{(100 / currentAssets.length).toFixed(0)}% do bloco
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {currentAssets.map((asset, idx) => {
                const url = convertFileSrc(asset.path);
                const isDragging = reorderingIndex === idx;
                return (
                  <div
                    key={`${asset.path}-${idx}`}
                    draggable
                    onDragStart={() => setReorderingIndex(idx)}
                    onDragEnd={() => setReorderingIndex(-1)}
                    onDragOver={(e) => { e.preventDefault(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (reorderingIndex >= 0 && reorderingIndex !== idx) {
                        onReorder(reorderingIndex, idx);
                      }
                      setReorderingIndex(-1);
                    }}
                    className={`shrink-0 relative w-20 rounded-md border bg-zinc-900 overflow-hidden cursor-move transition-all ${
                      isDragging ? 'opacity-40 scale-95' : 'border-violet-400/40 hover:border-violet-300'
                    }`}
                    title={`Slot ${idx + 1}: ${asset.name}`}
                  >
                    <div className="aspect-square">
                      {asset.type === 'image' ? (
                        <img src={url} alt={asset.name} className="w-full h-full object-cover" />
                      ) : (
                        <video src={url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                      )}
                    </div>
                    <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-violet-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {idx + 1}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 hover:bg-red-500/80 text-white text-xs flex items-center justify-center transition-colors"
                      title="Remover"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between">
          <div className="text-[11px] text-zinc-500">
            {currentAssets.length === 0
              ? 'Nenhum slide anexado · clique numa thumb pra começar'
              : currentAssets.length === 1
                ? `1 slide: ${currentAssets[0].name}`
                : `${currentAssets.length} slides em sequência`}
            {atCap && <span className="ml-2 text-amber-300/80">· limite atingido ({MAX_CAROUSEL_SIZE})</span>}
          </div>
          <div className="flex items-center gap-2">
            {gateActive && onSkipGate && currentAssets.length === 0 && (
              <button
                onClick={onSkipGate}
                className="px-3 py-1.5 text-[11px] rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 font-semibold transition-colors border border-white/10"
                title="Este bloco será gerado sem nenhum asset anexado, mesmo com a pasta do projeto cheia."
              >
                Continuar sem asset
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[11px] rounded-md bg-violet-500 hover:bg-violet-400 text-white font-semibold transition-colors"
            >
              Concluído
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
