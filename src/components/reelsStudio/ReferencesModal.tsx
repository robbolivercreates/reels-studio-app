import React, { useEffect, useState } from 'react';
import {
  listReferences,
  deleteReference,
  revealReferencesDir,
  referencesDir,
  type ReferenceMeta,
} from './referenceVideoStore';
import type { PersistedAnalysis } from './types';

interface Props {
  analyses: PersistedAnalysis[];
  onClose: () => void;
  onOpenPlan: (analysis: PersistedAnalysis) => void;
  onRemoveAnalysis: (createdAt: number) => void;
  /** Trigger re-analysis of an existing reference file via the script preview pipeline. */
  onReanalyze?: (meta: ReferenceMeta) => void;
}

const fmtSize = (b: number) =>
  b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;

const fmtAgo = (ts: number) => {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86400)}d atrás`;
};

const fmtAgoMs = (msTs: number) => fmtAgo(Math.floor(msTs / 1000));

interface Row {
  meta: ReferenceMeta | null;     // file on disk (Rust)
  analysis: PersistedAnalysis | null; // analysis in memory
  /** Stable key for React + delete operations. */
  key: string;
}

export const ReferencesModal: React.FC<Props> = ({ analyses, onClose, onOpenPlan, onRemoveAnalysis, onReanalyze }) => {
  const [refs, setRefs] = useState<ReferenceMeta[]>([]);
  const [folder, setFolder] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, dir] = await Promise.all([listReferences(), referencesDir()]);
      setRefs(list);
      setFolder(dir);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao listar referências');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross videos (on disk) with analyses (in memory) by sourceFileName.
  // Show analyses without a file (file deleted) with a "arquivo removido" tag.
  const rows: Row[] = (() => {
    const byFile = new Map<string, PersistedAnalysis>();
    for (const a of analyses) {
      if (a.sourceFileName) byFile.set(a.sourceFileName, a);
    }
    const out: Row[] = refs.map(meta => ({
      meta,
      analysis: byFile.get(meta.fileName) ?? null,
      key: `file-${meta.fileName}`,
    }));
    // Orphan analyses (file no longer on disk).
    const seenFiles = new Set(refs.map(r => r.fileName));
    for (const a of analyses) {
      if (a.sourceFileName && !seenFiles.has(a.sourceFileName)) {
        out.push({ meta: null, analysis: a, key: `orphan-${a.createdAt}` });
      } else if (!a.sourceFileName) {
        out.push({ meta: null, analysis: a, key: `noref-${a.createdAt}` });
      }
    }
    return out;
  })();

  const handleDeleteFile = async (meta: ReferenceMeta, analysis: PersistedAnalysis | null) => {
    if (busy) return;
    if (!confirm(`Apagar "${meta.fileName}" do disco?${analysis ? ' A análise será mantida no histórico.' : ''}`)) return;
    setBusy(meta.fileName);
    try {
      await deleteReference(meta.fileName);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao apagar');
    } finally {
      setBusy(null);
    }
  };

  const handleRevealFolder = async () => {
    try {
      await revealReferencesDir();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir pasta');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
      <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5 flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold text-zinc-100 mb-0.5">Referências analisadas</div>
            <div className="text-xs text-zinc-500">
              Vídeos baixados e o que a IA achou de cada um. Até 20 análises ficam guardadas.
            </div>
            {folder && (
              <div className="mt-2 text-[10px] text-zinc-600 font-mono break-all">{folder}</div>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleRevealFolder}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-[11px] font-semibold text-emerald-200 transition-colors flex items-center gap-1.5"
              title="Abrir a pasta no Finder"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              Abrir pasta
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors"
              title="Fechar"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
          {loading && (
            <div className="text-center text-xs text-zinc-500 py-8">Carregando…</div>
          )}
          {error && (
            <div className="text-center text-xs text-red-400 py-3">{error}</div>
          )}
          {!loading && rows.length === 0 && (
            <div className="text-center py-12">
              <div className="text-3xl mb-2 opacity-50">📁</div>
              <div className="text-sm text-zinc-300 mb-1">Nenhuma referência ainda</div>
              <div className="text-xs text-zinc-500">Use "Importar de vídeo" no menu pra começar.</div>
            </div>
          )}

          {rows.map(({ meta, analysis, key }) => {
            const fileMissing = !meta && !!analysis;
            return (
              <div
                key={key}
                className={`rounded-xl border p-3.5 ${
                  fileMissing
                    ? 'border-amber-500/20 bg-amber-500/[0.03]'
                    : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                    meta?.source === 'url'
                      ? 'bg-violet-500/15 text-violet-300'
                      : meta?.source === 'upload'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-zinc-700/40 text-zinc-400'
                  }`}>
                    {meta?.source === 'url' ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    ) : meta?.source === 'upload' ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-zinc-100 truncate">
                          {meta?.fileName ?? analysis?.sourceFileName ?? '(sem arquivo)'}
                        </div>
                        <div className="text-[10.5px] text-zinc-500 mt-0.5 flex items-center gap-2 flex-wrap">
                          {meta && (
                            <>
                              <span>{fmtSize(meta.sizeBytes)}</span>
                              <span className="text-zinc-700">·</span>
                              <span>{fmtAgo(meta.createdAt)}</span>
                              {meta.sourceUrl && (
                                <>
                                  <span className="text-zinc-700">·</span>
                                  <a
                                    href={meta.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-violet-300 hover:text-violet-200 truncate max-w-[260px]"
                                    title={meta.sourceUrl}
                                  >
                                    {meta.sourceUrl}
                                  </a>
                                </>
                              )}
                            </>
                          )}
                          {!meta && analysis && (
                            <>
                              <span className="text-amber-400">arquivo removido</span>
                              <span className="text-zinc-700">·</span>
                              <span>análise feita {fmtAgoMs(analysis.createdAt)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {analysis && (
                          <button
                            onClick={() => onOpenPlan(analysis)}
                            className="px-2.5 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-[10.5px] font-semibold text-amber-200 transition-colors flex items-center gap-1"
                            title="Ver plano de gravação"
                          >
                            📋 Ver plano
                          </button>
                        )}
                        {meta && onReanalyze && (
                          <button
                            onClick={() => onReanalyze(meta)}
                            className="px-2.5 py-1 rounded-md bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-[10.5px] font-semibold text-violet-200 transition-colors flex items-center gap-1"
                            title="Re-analisar com revisão"
                          >
                            🔄 Re-analisar
                          </button>
                        )}
                        {meta && (
                          <button
                            onClick={() => handleDeleteFile(meta, analysis)}
                            disabled={busy === meta.fileName}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
                            title="Apagar arquivo do disco"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                            </svg>
                          </button>
                        )}
                        {!meta && analysis && (
                          <button
                            onClick={() => {
                              if (confirm('Remover essa análise do histórico?')) onRemoveAnalysis(analysis.createdAt);
                            }}
                            className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Remover análise"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Analysis summary */}
                    {analysis && (
                      <div className="mt-2.5 text-[10.5px] text-zinc-400 flex items-center gap-2 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-200 font-medium">
                          {analysis.format}
                        </span>
                        <span className="text-zinc-500">{analysis.hookStyle}</span>
                        <span className="text-zinc-700">·</span>
                        <span className="text-zinc-500">{analysis.durationSec.toFixed(0)}s</span>
                        <span className="text-zinc-700">·</span>
                        <span className="text-zinc-500">{analysis.directions.length} blocos</span>
                      </div>
                    )}
                    {!analysis && meta && (
                      <div className="mt-2.5 text-[10.5px] text-zinc-600 italic">
                        Sem análise ainda — abra "Importar de vídeo" pra rodar a IA.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/5 bg-black/30 flex items-center justify-between text-[10.5px] text-zinc-500">
          <span>{rows.length} {rows.length === 1 ? 'item' : 'itens'}</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
