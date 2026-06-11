/**
 * Clip Rescue Modal.
 *
 * Surfaces avatar-clip Blobs that exist in IndexedDB but aren't referenced by
 * any block in the currently-open project. This happens when the reducer
 * assigns a clip to a new blockId (e.g. after `split-block`) without migrating
 * the IDB row, so the blob stays parked under the original blockId. Until the
 * underlying reducer bug is fixed, this modal is the user's escape hatch:
 *   - Preview each orphan video inline
 *   - Pick which current block to reassociate it with
 *   - The reassociation atomically renames the IDB key + dispatches a
 *     `clip-update` action so the running state matches
 */

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadAllClipBlobs, renameClipBlob, deleteClipBlob } from './persistence';
import { useModalChrome } from './modalChrome';
import type { AppTheme } from './theme';
import type { ScriptBlock, ReelsAction } from './types';

interface Props {
  open: boolean;
  onClose: () => void;
  blocks: ScriptBlock[];
  avatarClips: Record<string, { status: string }>;
  dispatch: React.Dispatch<ReelsAction>;
  appTheme: AppTheme | undefined;
}

interface OrphanClip {
  oldBlockId: string;
  blob: Blob;
  url: string;
  durationSec: number | null;
  /** Timestamp extracted from the blockId, or 0 if not parseable. */
  createdAt: number;
}

/** Extract Unix ms timestamp from a blockId like "block_1717850000000_abc". */
const tsFromId = (id: string): number => {
  const m = id.match(/_(\d{13})(?:_|$)/);
  return m ? parseInt(m[1], 10) : 0;
};

const fmtRelative = (ts: number): string => {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  const h   = Math.floor(diff / 3_600_000);
  const d   = Math.floor(diff / 86_400_000);
  if (min < 1)   return 'agora';
  if (min < 60)  return `${min}min atrás`;
  if (h   < 24)  return `${h}h atrás`;
  if (d   === 1) return 'ontem';
  if (d   < 7)   return `${d} dias atrás`;
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};

export const ClipRescueModal: React.FC<Props> = ({ open, onClose, blocks, avatarClips, dispatch, appTheme }) => {
  const chrome = useModalChrome(appTheme);
  const [loading, setLoading] = useState(false);
  const [orphans, setOrphans] = useState<OrphanClip[]>([]);
  const [pendingAssign, setPendingAssign] = useState<string | null>(null);

  // All avatar blocks (lets user reassign even when a block already has a
  // clip — useful when they assigned to the wrong block on a previous pass).
  // Blocks that already have a ready clip are tagged so the UI can warn before
  // overwriting.
  const candidateBlocks = useMemo(() => blocks.filter(b => b.kind === 'avatar'), [blocks]);
  const blocksWithClip = useMemo(() => {
    const s = new Set<string>();
    for (const [id, c] of Object.entries(avatarClips)) if (c.status === 'ready') s.add(id);
    return s;
  }, [avatarClips]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const all = await loadAllClipBlobs();
        const referencedIds = new Set(blocks.map(b => b.id));
        const items: OrphanClip[] = [];
        for (const [oldBlockId, blob] of Object.entries(all)) {
          if (referencedIds.has(oldBlockId)) continue;
          const url = URL.createObjectURL(blob);
          items.push({ oldBlockId, blob, url, durationSec: null, createdAt: tsFromId(oldBlockId) });
        }
        if (cancelled) {
          items.forEach(i => URL.revokeObjectURL(i.url));
          return;
        }
        // Most recent first
        items.sort((a, b) => b.createdAt - a.createdAt);
        setOrphans(items);
      } catch (err) {
        console.error('[ClipRescue] load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, blocks]);

  // Revoke object URLs on close.
  useEffect(() => {
    return () => {
      orphans.forEach(i => { try { URL.revokeObjectURL(i.url); } catch { /* ignore */ } });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAssign = async (oldBlockId: string, newBlockId: string, url: string) => {
    // If the target block already has a clip, warn before overwriting.
    if (blocksWithClip.has(newBlockId)) {
      const ok = confirm(
        'Este bloco já tem um clip atribuído. Reatribuir vai SUBSTITUIR o clip atual.\n\n' +
        'O clip antigo continua salvo no dispositivo e aparece aqui como órfão na próxima vez que abrir.\n\n' +
        'Deseja continuar?'
      );
      if (!ok) return;
    }
    setPendingAssign(oldBlockId);
    try {
      // If the target already has a clip, first move its blob to a parking key
      // so it shows up as an orphan instead of being silently deleted by the
      // rename below (which writes over whatever was at `newBlockId`).
      if (blocksWithClip.has(newBlockId)) {
        const parkKey = `orphan_${newBlockId}_${Date.now()}`;
        await renameClipBlob(newBlockId, parkKey);
      }
      await renameClipBlob(oldBlockId, newBlockId);
      // Tell the running state about the recovered clip — use the same URL so
      // no re-decode is needed; the IDB row was just renamed under the hood.
      dispatch({ type: 'clip-update', blockId: newBlockId, status: 'ready', videoUrl: url });
      setOrphans(prev => prev.filter(o => o.oldBlockId !== oldBlockId));
    } catch (err) {
      console.error('[ClipRescue] assign failed:', err);
      alert('Falhou ao reassociar: ' + (err instanceof Error ? err.message : 'desconhecido'));
    } finally {
      setPendingAssign(null);
    }
  };

  const handleDelete = async (oldBlockId: string, url: string) => {
    if (!confirm('Apagar este clip permanentemente do dispositivo?')) return;
    try {
      await deleteClipBlob(oldBlockId);
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      setOrphans(prev => prev.filter(o => o.oldBlockId !== oldBlockId));
    } catch (err) {
      console.error('[ClipRescue] delete failed:', err);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={chrome.backdrop}>
      <div className="w-full max-w-4xl max-h-[85vh] rounded-2xl flex flex-col" style={chrome.card}>
        <div className="flex items-center justify-between px-6 py-4" style={chrome.headerDivider}>
          <div>
            <div className="text-base font-semibold" style={chrome.textPrimary}>🎥 Recuperar clips de avatar</div>
            <div className="text-xs mt-0.5" style={chrome.textSecondary}>
              Clips que existem no dispositivo mas perderam o vínculo com algum bloco.
              Reassocie a um bloco do projeto atual para usá-los, ou apague.
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md hover:bg-white/5 text-sm"
            style={chrome.closeButton}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-12 text-center text-sm" style={chrome.textSecondary}>Carregando clips do IndexedDB…</div>
          ) : orphans.length === 0 ? (
            <div className="py-12 text-center text-sm" style={chrome.textSecondary}>
              ✓ Nenhum clip órfão. Tudo certo.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {orphans.map(o => (
                <div key={o.oldBlockId} className="rounded-xl p-3 border border-white/10 bg-white/5">
                  <video
                    src={o.url}
                    controls
                    muted
                    playsInline
                    preload="auto"
                    className="w-full rounded-lg bg-black aspect-video object-contain"
                    style={{ maxHeight: 240 }}
                  />
                  <div className="flex items-center gap-2 mt-2 text-[10px] opacity-70">
                    <span>{(o.blob.size / 1024 / 1024).toFixed(1)} MB</span>
                    {o.createdAt > 0 && (
                      <>
                        <span className="opacity-40">·</span>
                        <span>{fmtRelative(o.createdAt)}</span>
                      </>
                    )}
                  </div>
                  <div className="text-[9px] mt-0.5 font-mono opacity-30 truncate">{o.oldBlockId}</div>

                  <div className="mt-3 space-y-1">
                    {candidateBlocks.length === 0 ? (
                      <div className="text-xs opacity-60 italic">
                        Nenhum bloco do tipo avatar no projeto atual.
                      </div>
                    ) : (
                      <>
                        <div className="text-[10px] uppercase tracking-wide opacity-60 mb-1">Atribuir a:</div>
                        {candidateBlocks.map(b => {
                          const hasClip = blocksWithClip.has(b.id);
                          return (
                            <button
                              key={b.id}
                              disabled={pendingAssign !== null}
                              onClick={() => handleAssign(o.oldBlockId, b.id, o.url)}
                              className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs border disabled:opacity-40 ${
                                hasClip
                                  ? 'border-amber-400/30 hover:bg-amber-500/15'
                                  : 'border-white/10 hover:bg-blue-500/20'
                              }`}
                              title={hasClip ? 'Este bloco já tem um clip — vai substituir' : 'Atribuir este clip ao bloco'}
                            >
                              <span className="opacity-60">#{blocks.indexOf(b) + 1}</span>{' '}
                              <span className="font-medium">{b.text.slice(0, 60) || '(sem texto)'}</span>
                              {hasClip && (
                                <span className="ml-1.5 text-[10px] text-amber-300/80">· tem clip (substituir)</span>
                              )}
                            </button>
                          );
                        })}
                      </>
                    )}

                    <button
                      onClick={() => handleDelete(o.oldBlockId, o.url)}
                      disabled={pendingAssign !== null}
                      className="w-full text-center px-2.5 py-1 rounded-md text-[11px] text-red-300/80 hover:bg-red-500/10 mt-2 disabled:opacity-40"
                    >
                      Apagar permanentemente
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3 flex items-center justify-between text-xs" style={chrome.bodyDivider}>
          <div style={chrome.textSecondary}>
            {orphans.length > 0 && (
              <>
                {orphans.length} clip{orphans.length === 1 ? '' : 's'} órfão{orphans.length === 1 ? '' : 's'} ·{' '}
                {candidateBlocks.length} bloco{candidateBlocks.length === 1 ? '' : 's'} avatar no projeto
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-blue-500 hover:bg-blue-400 text-white font-medium"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
