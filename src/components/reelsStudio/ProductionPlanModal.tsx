import React, { useMemo, useState } from 'react';
import type { PersistedAnalysis, ScriptBlock } from './types';

interface Props {
  blocks: ScriptBlock[];
  analysis: PersistedAnalysis;
  projectName: string;
  onClose: () => void;
}

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

const fmtSeconds = (s: number) => {
  if (!s) return '—';
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toFixed(0).padStart(2, '0')}`;
};

const fmtTimestamp = (s: number) => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
};

const buildMarkdown = (blocks: ScriptBlock[], a: PersistedAnalysis, projectName: string): string => {
  const lines: string[] = [];
  lines.push(`# ${projectName}`);
  lines.push('');
  lines.push(`**Plano de gravação** · gerado em ${fmtDate(a.createdAt)}`);
  if (a.sourceFileName) lines.push(`Referência: ${a.sourceFileName}`);
  lines.push('');
  lines.push(`Idioma original: ${a.language} · Duração ~${a.durationSec}s · Formato: ${a.format}`);
  lines.push('');
  lines.push(`Hook do original: ${a.hookStyle}`);
  if (a.tone.length) lines.push(`Tom do original: ${a.tone.join(', ')}`);
  lines.push('');

  // Original transcript first — that's what the user explicitly asked for.
  const transcript = a.originalTranscript ?? [];
  const origBlocks = a.originalBlocks ?? [];
  if (transcript.length > 0) {
    lines.push('## O que a outra pessoa fez (transcrição original)');
    lines.push('');
    transcript.forEach(t => {
      lines.push(`**[${fmtTimestamp(t.start)} – ${fmtTimestamp(t.end)}]** ${t.text}`);
      lines.push('');
    });
  }

  if (a.production.setup || a.production.soundbed || a.production.watchOuts.length) {
    lines.push('## Setup');
    if (a.production.setup) lines.push(a.production.setup);
    if (a.production.soundbed) {
      lines.push('');
      lines.push(`**Áudio ambiente:** ${a.production.soundbed}`);
    }
    if (a.production.watchOuts.length) {
      lines.push('');
      lines.push('**Atenção:**');
      a.production.watchOuts.forEach(w => lines.push(`- ${w}`));
    }
    lines.push('');
  }

  lines.push('## Plano por bloco');
  lines.push('');
  blocks.forEach((b, i) => {
    const dir = a.directions.find(d => d.blockIndex === i);
    const orig = origBlocks[i];
    const dur = b.end - b.start;
    const kindLabel = b.kind === 'avatar' ? 'Avatar (você na câmera)' : 'B-roll (gravação de tela)';
    lines.push(`### Bloco ${i + 1} · ${kindLabel}${dur > 0 ? ` · ~${dur.toFixed(1)}s` : ''}`);
    lines.push('');

    if (orig && orig.text && orig.text.trim() !== b.text.trim()) {
      lines.push('**O que a outra pessoa disse:**');
      lines.push(`> ${orig.text}`);
      lines.push('');
      lines.push('**O que você vai gravar:**');
      lines.push(`> ${b.text}`);
    } else {
      lines.push(`> ${b.text}`);
    }

    if (dir) {
      lines.push('');
      if (dir.delivery)     lines.push(`**Entrega:** ${dir.delivery}`);
      if (dir.framing)      lines.push(`**Enquadramento:** ${dir.framing}`);
      if (dir.screenAction) lines.push(`**Tela:** ${dir.screenAction}`);
      if (dir.mood)         lines.push(`**Vibe:** ${dir.mood}`);
    }
    lines.push('');
  });

  lines.push('## Roteiro corrido (pra teleprompter)');
  lines.push('');
  blocks.forEach(b => { lines.push(b.text); lines.push(''); });

  return lines.join('\n').trim() + '\n';
};

type View = 'plan' | 'original';

export const ProductionPlanModal: React.FC<Props> = ({ blocks, analysis, projectName, onClose }) => {
  const [copyState, setCopyState] = useState<'idle' | 'all' | { blockIdx: number } | { origIdx: number }>('idle');
  const [view, setView] = useState<View>('plan');

  const markdown = useMemo(
    () => buildMarkdown(blocks, analysis, projectName),
    [blocks, analysis, projectName],
  );

  const totalDur = blocks.reduce((s, b) => s + (b.end - b.start), 0);
  // Backwards-compat: analyses persisted before these fields existed have them undefined.
  const transcript = analysis.originalTranscript ?? [];
  const originalBlocks = analysis.originalBlocks ?? [];
  const hasOriginal = transcript.length > 0 || originalBlocks.some(b => b.text.trim().length > 0);

  const copyToClipboard = async (text: string, key: typeof copyState) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(key);
      setTimeout(() => setCopyState('idle'), 1400);
    } catch {
      /* swallow */
    }
  };

  const downloadMd = () => {
    const safeName = projectName.replace(/[\/\\:*?"<>|]+/g, '_').trim() || 'plano-de-gravacao';
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const tabBtn = (id: View, label: string, hint?: string) => (
    <button
      type="button"
      onClick={() => setView(id)}
      className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
        view === id
          ? 'bg-violet-500/20 text-violet-100 border border-violet-400/40'
          : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-transparent'
      }`}
      title={hint}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center z-[60] p-6">
      <div className="bg-[#0F0F11] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.85)] max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-8 pt-7 pb-5 flex items-start justify-between border-b border-white/5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5">Plano de gravação</div>
            <h2 className="text-2xl font-semibold text-zinc-50 tracking-tight">{projectName}</h2>
            <div className="text-[12px] text-zinc-500 mt-1.5 flex items-center gap-3">
              <span>{blocks.length} blocos</span>
              <span className="text-zinc-700">·</span>
              <span>~{fmtSeconds(totalDur || analysis.durationSec)}</span>
              <span className="text-zinc-700">·</span>
              <span>{analysis.language}</span>
              {analysis.sourceFileName && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="truncate max-w-[280px]" title={analysis.sourceFileName}>📼 {analysis.sourceFileName}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 -mr-1 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* View tabs */}
        {hasOriginal && (
          <div className="px-8 pt-4 flex items-center gap-1.5 shrink-0">
            {tabBtn('plan', 'Seu plano', 'Sua versão + direção pra gravar')}
            {tabBtn('original', 'O original', 'Exatamente o que a outra pessoa fez')}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-7">
          {view === 'original' && hasOriginal && (
            <>
              <section>
                <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2">Vibe do original</div>
                {analysis.hookStyle && (
                  <div className="text-sm text-zinc-200 leading-relaxed mb-2">{analysis.hookStyle}</div>
                )}
                {analysis.tone.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.tone.map(t => (
                      <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/10 text-zinc-400">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* Transcript with timestamps */}
              {transcript.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Transcrição original</div>
                    <button
                      onClick={() => copyToClipboard(
                        transcript.map(t => `[${fmtTimestamp(t.start)}] ${t.text}`).join('\n'),
                        'all',
                      )}
                      className="text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors"
                    >
                      {copyState === 'all' ? '✓ copiado' : 'copiar tudo'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {transcript.map((t, i) => (
                      <div key={i} className="flex gap-3 group">
                        <span className="text-[10px] font-mono text-zinc-600 tabular-nums w-12 shrink-0 pt-0.5">
                          {fmtTimestamp(t.start)}
                        </span>
                        <span className="text-[14px] text-zinc-200 leading-relaxed flex-1">{t.text}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Original blocks (kind + text) */}
              {originalBlocks.length > 0 && (
                <section>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-3">Estrutura por bloco</div>
                  <div className="space-y-3">
                    {originalBlocks.map((b, i) => {
                      const isAvatar = b.kind === 'avatar';
                      const isCopiedOrig = typeof copyState === 'object' && 'origIdx' in copyState && copyState.origIdx === i;
                      return (
                        <div
                          key={i}
                          className="rounded-xl bg-white/[0.025] border border-white/[0.06] px-5 py-4 hover:border-white/[0.12] transition-colors group"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2.5">
                              <span className={`text-[10px] font-semibold tracking-wider uppercase ${
                                isAvatar ? 'text-violet-300' : 'text-emerald-300'
                              }`}>
                                {isAvatar ? 'Avatar' : 'B-roll'}
                              </span>
                              <span className="text-[10px] text-zinc-600 font-mono">#{i + 1}</span>
                            </div>
                            <button
                              onClick={() => copyToClipboard(b.text, { origIdx: i })}
                              className="opacity-0 group-hover:opacity-100 text-[10px] text-zinc-500 hover:text-zinc-200 transition-all"
                            >
                              {isCopiedOrig ? '✓ copiado' : 'copiar'}
                            </button>
                          </div>
                          <div className="text-[15px] text-zinc-100 leading-relaxed font-light">
                            {b.text}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}

          {view === 'plan' && (
            <>
              {(analysis.hookStyle || analysis.tone.length > 0) && (
                <section>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2">Vibe geral</div>
                  {analysis.hookStyle && (
                    <div className="text-sm text-zinc-200 leading-relaxed mb-2">{analysis.hookStyle}</div>
                  )}
                  {analysis.tone.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.tone.map(t => (
                        <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/10 text-zinc-400">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {(analysis.production.setup || analysis.production.soundbed || analysis.production.watchOuts.length > 0) && (
                <section>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2">Setup</div>
                  {analysis.production.setup && (
                    <div className="text-sm text-zinc-200 leading-relaxed mb-3">{analysis.production.setup}</div>
                  )}
                  {analysis.production.soundbed && (
                    <div className="text-[12px] text-zinc-400 mb-3">
                      <span className="text-zinc-500">Áudio ambiente — </span>{analysis.production.soundbed}
                    </div>
                  )}
                  {analysis.production.watchOuts.length > 0 && (
                    <ul className="space-y-1.5">
                      {analysis.production.watchOuts.map((w, i) => (
                        <li key={i} className="flex gap-2.5 text-[12.5px] text-zinc-300 leading-relaxed">
                          <span className="text-amber-400/70 shrink-0 mt-0.5">⚠</span>
                          <span>{w}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <section>
                <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-3">Blocos</div>
                <div className="space-y-3">
                  {blocks.map((b, i) => {
                    const dir = analysis.directions.find(d => d.blockIndex === i);
                    const orig = originalBlocks[i];
                    const dur = b.end - b.start;
                    const isAvatar = b.kind === 'avatar';
                    const isCopiedBlock = typeof copyState === 'object' && 'blockIdx' in copyState && copyState.blockIdx === i;
                    const showOriginal = orig && orig.text && orig.text.trim() !== b.text.trim();

                    return (
                      <div
                        key={b.id}
                        className="rounded-xl bg-white/[0.025] border border-white/[0.06] px-5 py-4 hover:border-white/[0.12] transition-colors group"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2.5">
                            <span className={`text-[10px] font-semibold tracking-wider uppercase ${
                              isAvatar ? 'text-violet-300' : 'text-emerald-300'
                            }`}>
                              {isAvatar ? 'Avatar' : 'B-roll'}
                            </span>
                            <span className="text-[10px] text-zinc-600 font-mono">#{i + 1}</span>
                            {dur > 0 && (
                              <span className="text-[10px] text-zinc-500 font-mono">~{dur.toFixed(1)}s</span>
                            )}
                          </div>
                          <button
                            onClick={() => copyToClipboard(b.text, { blockIdx: i })}
                            className="opacity-0 group-hover:opacity-100 text-[10px] text-zinc-500 hover:text-zinc-200 transition-all"
                            title="Copiar texto pra falar"
                          >
                            {isCopiedBlock ? '✓ copiado' : 'copiar texto'}
                          </button>
                        </div>

                        {showOriginal && (
                          <div className="mb-3 pl-3 border-l-2 border-zinc-700/40">
                            <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Original</div>
                            <div className="text-[13px] text-zinc-400 italic leading-relaxed font-light">
                              "{orig.text}"
                            </div>
                          </div>
                        )}

                        {showOriginal && (
                          <div className="text-[9px] uppercase tracking-wider text-zinc-600 mb-1">Sua versão</div>
                        )}
                        <div className="text-[15px] text-zinc-100 leading-relaxed mb-4 font-light">
                          {b.text}
                        </div>

                        {dir && (dir.delivery || dir.framing || dir.screenAction || dir.mood) && (
                          <div className="space-y-1.5 pl-3 border-l border-white/[0.07]">
                            {dir.delivery && (
                              <div className="text-[12px] text-zinc-400 leading-relaxed">
                                <span className="text-zinc-600">Entrega — </span>{dir.delivery}
                              </div>
                            )}
                            {dir.framing && (
                              <div className="text-[12px] text-zinc-400 leading-relaxed">
                                <span className="text-zinc-600">Enquadramento — </span>{dir.framing}
                              </div>
                            )}
                            {dir.screenAction && (
                              <div className="text-[12px] text-zinc-400 leading-relaxed">
                                <span className="text-zinc-600">Tela — </span>{dir.screenAction}
                              </div>
                            )}
                            {dir.mood && (
                              <div className="text-[12px] text-zinc-400 leading-relaxed">
                                <span className="text-zinc-600">Vibe — </span>{dir.mood}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-4 border-t border-white/5 flex items-center gap-2">
          <div className="flex-1 text-[11px] text-zinc-500">
            Cole no CapCut, Notion ou onde precisar.
          </div>
          <button
            onClick={downloadMd}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[12px] font-medium text-zinc-200 transition-colors"
          >
            Baixar .md
          </button>
          <button
            onClick={() => copyToClipboard(markdown, 'all')}
            className="px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-[12px] font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-all"
          >
            {copyState === 'all' ? '✓ Copiado' : 'Copiar plano completo'}
          </button>
        </div>
      </div>
    </div>
  );
};
