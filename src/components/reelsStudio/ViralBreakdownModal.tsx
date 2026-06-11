import React, { useState } from 'react';
import type { ViralBreakdown, ViralMoment, ReconstructionScene } from '../../services/viralBreakdownService';
import type { AppTheme } from './types';
import { useModalChrome } from './modalChrome';

const fmtViews = (n?: number) => {
  if (n === undefined || n === null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};

interface Props {
  breakdown: ViralBreakdown;
  fileName: string;
  onClose: () => void;
  /** Optional: pre-fill the wizard with the replication prompt. */
  onCreateReel?: (prompt: string) => void;
  /** True when loaded from local cache — no credits spent. */
  cacheHit?: boolean;
  /** If provided, shows a re-analyze button (bypasses cache). */
  onReanalyze?: () => void;
  appTheme?: AppTheme;
}

const CATEGORY_COLORS: Record<ViralMoment['category'], { bg: string; text: string; label: string }> = {
  hook:         { bg: 'bg-red-500/15',     text: 'text-red-300',     label: 'Hook' },
  retention:    { bg: 'bg-amber-500/15',   text: 'text-amber-300',   label: 'Retenção' },
  value:        { bg: 'bg-emerald-500/15', text: 'text-emerald-300', label: 'Valor' },
  social_proof: { bg: 'bg-cyan-500/15',    text: 'text-cyan-300',    label: 'Prova Social' },
  cta:          { bg: 'bg-indigo-500/15',  text: 'text-indigo-300',  label: 'CTA' },
};

const scoreColor = (s: number) => {
  if (s >= 80) return '#22c55e'; // green
  if (s >= 60) return '#eab308'; // yellow
  if (s >= 40) return '#f97316'; // orange
  return '#ef4444';              // red
};

const fmtSec = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m > 0 ? `${m}:${sec.toString().padStart(2, '0')}` : `${sec}s`;
};

const fmtDuration = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  if (m > 0 && sec > 0) return `${m}min ${sec}s`;
  if (m > 0) return `${m}min`;
  return `${sec}s`;
};

const AttentionBar: React.FC<{ score: number }> = ({ score }) => (
  <div className="flex items-center gap-1.5">
    <div className="h-1.5 rounded-full bg-white/10 flex-1 overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${score * 10}%`, background: scoreColor(score * 10) }}
      />
    </div>
    <span className="text-[9px] font-semibold tabular-nums" style={{ color: scoreColor(score * 10) }}>
      {score}/10
    </span>
  </div>
);

const MomentCard: React.FC<{ moment: ViralMoment; highlight?: boolean }> = ({ moment, highlight }) => {
  const [expanded, setExpanded] = useState(false);
  const cat = CATEGORY_COLORS[moment.category];

  return (
    <div className={`rounded-lg border p-3 space-y-2 transition-colors ${
      highlight
        ? 'border-amber-500/30 bg-amber-500/[0.04]'
        : 'border-white/8 bg-white/[0.02]'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9.5px] font-mono text-zinc-500 shrink-0">
            {fmtSec(moment.startSec)}–{fmtSec(moment.endSec)}
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${cat.bg} ${cat.text}`}>
            {cat.label}
          </span>
          <span className="text-[10px] font-medium text-zinc-200">{moment.technique}</span>
          {highlight && <span className="text-[9px] text-amber-300">⭐ destaque</span>}
        </div>
      </div>

      <AttentionBar score={moment.attention_score} />

      <p className="text-[10.5px] text-zinc-300 leading-relaxed">{moment.description}</p>

      <button
        onClick={() => setExpanded(e => !e)}
        className="text-[9.5px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
      >
        {expanded ? '▲ Ocultar' : '▼ Por que funciona'}
      </button>

      {expanded && (
        <p className="text-[10px] text-zinc-400 italic leading-relaxed border-l-2 border-white/10 pl-2">
          {moment.why_it_works}
        </p>
      )}
    </div>
  );
};

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label = 'Copiar' }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[9.5px] text-zinc-300 hover:text-zinc-100 transition-colors flex items-center gap-1"
    >
      {copied ? (
        <>
          <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Copiado!
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
};

const SceneCard: React.FC<{ scene: ReconstructionScene }> = ({ scene }) => {
  const sceneText = [
    scene.speech ? `FALA: "${scene.speech}"` : '',
    `FÍSICO: ${scene.physical}`,
    `CÂMERA: ${scene.camera}`,
    `VISUAL: ${scene.visuals}`,
    `ÁUDIO: ${scene.audio}`,
    `DIREÇÃO: ${scene.director_note}`,
  ].filter(Boolean).join('\n');

  const rows: { label: string; value: string; accent: string }[] = [
    { label: 'Físico', value: scene.physical, accent: 'text-orange-300' },
    { label: 'Câmera', value: scene.camera, accent: 'text-sky-300' },
    { label: 'Visual', value: scene.visuals, accent: 'text-blue-300' },
    { label: 'Áudio', value: scene.audio, accent: 'text-emerald-300' },
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
      {/* Scene header */}
      <div className="px-3.5 py-2.5 border-b border-white/5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-zinc-300 shrink-0">
            {scene.scene_index}
          </span>
          <span className="text-[9.5px] font-mono text-zinc-500">
            {fmtSec(scene.startSec)} – {fmtSec(scene.endSec)}
            <span className="ml-1 text-zinc-600">({Math.round(scene.endSec - scene.startSec)}s)</span>
          </span>
        </div>
        <CopyButton text={sceneText} label="Copiar cena" />
      </div>

      <div className="px-3.5 py-3 space-y-2.5">
        {/* Speech — most prominent */}
        {scene.speech && (
          <div className="rounded-lg bg-white/[0.04] border border-white/8 px-3 py-2">
            <div className="text-[8.5px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">Fala</div>
            <p className="text-[11px] text-zinc-100 leading-relaxed">"{scene.speech}"</p>
          </div>
        )}

        {/* Detail rows */}
        {rows.map(row => (
          <div key={row.label} className="flex gap-2">
            <span className={`text-[9px] font-semibold uppercase tracking-wider shrink-0 w-12 mt-0.5 ${row.accent}`}>
              {row.label}
            </span>
            <p className="text-[10px] text-zinc-300 leading-relaxed">{row.value}</p>
          </div>
        ))}

        {/* Director note */}
        {scene.director_note && (
          <div className="flex gap-2 pt-1 border-t border-white/5">
            <span className="text-[9px] font-semibold uppercase tracking-wider shrink-0 w-12 mt-0.5 text-amber-400">
              Direção
            </span>
            <p className="text-[10px] text-amber-200/80 leading-relaxed italic">{scene.director_note}</p>
          </div>
        )}

        {/* Seedance prompt */}
        {scene.seedance_prompt && (
          <div className="pt-2 border-t border-white/5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-cyan-400">
                🎬 Prompt Seedance
              </span>
              <CopyButton text={scene.seedance_prompt} label="Copiar prompt" />
            </div>
            <pre className="text-[9.5px] text-cyan-100/80 bg-cyan-500/[0.05] border border-cyan-500/15 rounded-lg px-3 py-2.5 whitespace-pre-wrap font-mono leading-relaxed select-all overflow-x-auto">
              {scene.seedance_prompt}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export const ViralBreakdownModal: React.FC<Props> = ({
  breakdown,
  fileName,
  onClose,
  onCreateReel,
  cacheHit,
  onReanalyze,
  appTheme,
}) => {
  const chrome = useModalChrome(appTheme);
  const hasTranscript = (breakdown.transcript?.length ?? 0) > 0;
  const hasRoteiro = hasTranscript || (breakdown.reconstruction?.scenes?.length ?? 0) > 0;
  const [tab, setTab] = useState<'timeline' | 'blueprint' | 'transcript' | 'reconstruct'>('timeline');

  const keyFileNames = new Set(breakdown.key_moments.map(m => `${m.startSec}-${m.endSec}`));

  const { social_stats: ss } = breakdown;

  const fullReport = [
    `# Breakdown Viral — ${breakdown.title}`,
    `Arquivo: ${fileName}`,
    ss?.title ? `Título: ${ss.title}` : '',
    ss?.uploader ? `Criador: @${ss.uploader}` : '',
    ss?.view_count !== undefined ? `Views: ${fmtViews(ss.view_count)}` : '',
    ss?.like_count !== undefined ? `Likes: ${fmtViews(ss.like_count)}` : '',
    `Score de viralidade: ${breakdown.virality_score}/100`,
    `Duração: ${fmtSec(breakdown.duration_sec)}`,
    '',
    '## Por que viralizou',
    breakdown.virality_reasons.map(r => `• ${r}`).join('\n'),
    '',
    '## Fórmula',
    breakdown.formula,
    '',
    '## Estrutura',
    breakdown.structure.map(s => `• ${s}`).join('\n'),
    '',
    '## Template de Hook',
    breakdown.hook_template,
    '',
    breakdown.copy_analysis ? [
      '## Análise de Copy',
      `Hook: ${breakdown.copy_analysis.hook_breakdown}`,
      `Tom: ${breakdown.copy_analysis.tone.join(', ')}`,
      `Power words: ${breakdown.copy_analysis.power_words.join(', ')}`,
      `CTA: ${breakdown.copy_analysis.cta_formula}`,
      '',
    ].join('\n') : '',
    breakdown.visual_analysis ? [
      '## Análise Visual',
      `Ritmo de edição: ${breakdown.visual_analysis.edit_rhythm}`,
      `Câmera: ${breakdown.visual_analysis.camera_moves.join(', ')}`,
      `Textos na tela: ${breakdown.visual_analysis.text_overlays.join(' | ')}`,
      `B-roll: ${breakdown.visual_analysis.broll_types.join(', ')}`,
      '',
    ].join('\n') : '',
    '## Timeline',
    ...breakdown.timeline.map(m =>
      `[${fmtSec(m.startSec)}–${fmtSec(m.endSec)}] ${m.technique} (${m.category}) — Score ${m.attention_score}/10\n${m.description}${m.visual_detail ? `\nVisual: ${m.visual_detail}` : ''}\nPor que funciona: ${m.why_it_works}`
    ),
    breakdown.transcript?.length ? [
      '',
      '## Transcript',
      ...breakdown.transcript.map(t => `[${fmtSec(t.startSec)}–${fmtSec(t.endSec)}] ${t.text}`),
    ].join('\n') : '',
    breakdown.reconstruction ? [
      '',
      '## Reconstrução Cena a Cena',
      `Setup: ${breakdown.reconstruction.shooting_setup}`,
      `Equipamento: ${breakdown.reconstruction.equipment.join(', ')}`,
      '',
      ...breakdown.reconstruction.scenes.map(s => [
        `--- Cena ${s.scene_index} [${fmtSec(s.startSec)}–${fmtSec(s.endSec)}] ---`,
        s.speech ? `FALA: "${s.speech}"` : '',
        `FÍSICO: ${s.physical}`,
        `CÂMERA: ${s.camera}`,
        `VISUAL: ${s.visuals}`,
        `ÁUDIO: ${s.audio}`,
        `DIREÇÃO: ${s.director_note}`,
        s.seedance_prompt ? `\nSEEDANCE PROMPT:\n${s.seedance_prompt}` : '',
      ].filter(Boolean).join('\n')),
    ].join('\n') : '',
    '',
    '## Prompt de Replicação',
    breakdown.replication_prompt,
  ].filter(Boolean).join('\n');

  return (
    <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-[200] p-6" style={chrome.backdrop}>
      <div className="rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" style={chrome.card}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-base font-semibold text-zinc-100 truncate">
                🔬 {ss?.title || breakdown.title}
              </span>
              {cacheHit && (
                <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 shrink-0">
                  ✓ cache
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Virality score */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500">Viralidade</span>
                <span className="text-sm font-bold tabular-nums" style={{ color: scoreColor(breakdown.virality_score) }}>
                  {breakdown.virality_score}/100
                </span>
              </div>
              <span className="text-zinc-700">·</span>
              <span className="text-[10px] text-zinc-500">{fmtDuration(breakdown.duration_sec)}</span>
              {ss?.uploader && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="text-[10px] text-zinc-400">@{ss.uploader}</span>
                </>
              )}
              {ss?.view_count !== undefined && fmtViews(ss.view_count) && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="text-[10px] font-semibold text-emerald-400">{fmtViews(ss.view_count)} views</span>
                </>
              )}
              {ss?.like_count !== undefined && fmtViews(ss.like_count) && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="text-[10px] text-zinc-500">{fmtViews(ss.like_count)} likes</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Virality reasons pills */}
        <div className="px-5 py-3 border-b border-white/5 flex items-center gap-2 flex-wrap shrink-0">
          {breakdown.virality_reasons.map((r, i) => (
            <span key={i} className="px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9.5px] text-emerald-200">
              {r}
            </span>
          ))}
        </div>

        {/* Re-analyze banner */}
        {cacheHit && onReanalyze && (
          <div className="px-5 py-2.5 border-b border-amber-500/20 bg-amber-500/[0.06] flex items-center justify-between gap-3 shrink-0">
            <span className="text-[10px] text-amber-300/80">
              Resultado do cache — pode estar incompleto com o modelo antigo
            </span>
            <button
              onClick={onReanalyze}
              className="px-3 py-1.5 rounded-lg text-[10.5px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors shrink-0"
            >
              🔄 Re-analisar agora
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="px-5 pt-3 pb-0 flex items-center gap-1 shrink-0">
          {([
            { id: 'timeline', label: '⏱ Timeline' },
            { id: 'blueprint', label: '📋 Blueprint' },
            ...(hasRoteiro ? [{ id: 'transcript', label: '📜 Roteiro' }] : []),
            ...(breakdown.reconstruction ? [{ id: 'reconstruct', label: '🎭 Reconstrução' }] : []),
          ] as { id: typeof tab; label: string }[]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-[10.5px] font-semibold transition-colors ${
                tab === t.id
                  ? 'bg-white/10 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
              }`}
            >
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          <CopyButton text={fullReport} label="Copiar relatório" />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">

          {tab === 'timeline' && (
            <>
              {/* Key moments highlight */}
              {breakdown.key_moments.length > 0 && (
                <div className="mb-1">
                  <div className="text-[9px] font-semibold text-amber-400 uppercase tracking-wider mb-2">
                    ⭐ Momentos-chave
                  </div>
                  <div className="space-y-2">
                    {breakdown.key_moments.map((m, i) => (
                      <MomentCard key={`key-${i}`} moment={m} highlight />
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Timeline completa — {breakdown.timeline.length} momentos
              </div>
              {breakdown.timeline.map((m, i) => {
                const isKey = keyFileNames.has(`${m.startSec}-${m.endSec}`);
                return <MomentCard key={`t-${i}`} moment={m} highlight={isKey} />;
              })}
            </>
          )}

          {tab === 'blueprint' && (
            <div className="space-y-4">
              {/* Formula */}
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Fórmula</span>
                  <CopyButton text={breakdown.formula} />
                </div>
                <p className="text-[12px] font-medium text-zinc-100 leading-relaxed">{breakdown.formula}</p>
              </div>

              {/* Structure */}
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Estrutura</span>
                  <CopyButton text={breakdown.structure.join('\n')} />
                </div>
                <ol className="space-y-1">
                  {breakdown.structure.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-[10.5px] text-zinc-300">
                      <span className="shrink-0 w-4 h-4 rounded-full bg-white/10 flex items-center justify-center text-[8px] text-zinc-500 mt-0.5">
                        {i + 1}
                      </span>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>

              {/* Hook template */}
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Template de Hook</span>
                  <CopyButton text={breakdown.hook_template} />
                </div>
                <p className="text-[11.5px] text-zinc-200 italic leading-relaxed">"{breakdown.hook_template}"</p>
              </div>

              {/* Copy analysis (script mode) */}
              {breakdown.copy_analysis && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">📝 Análise de Copy</span>
                    <CopyButton text={[
                      `Hook: ${breakdown.copy_analysis.hook_breakdown}`,
                      `Tom: ${breakdown.copy_analysis.tone.join(', ')}`,
                      `Power words: ${breakdown.copy_analysis.power_words.join(', ')}`,
                      `CTA: ${breakdown.copy_analysis.cta_formula}`,
                    ].join('\n')} />
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase mb-1">Hook</div>
                    <p className="text-[10.5px] text-zinc-300 leading-relaxed">{breakdown.copy_analysis.hook_breakdown}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {breakdown.copy_analysis.power_words.map((w, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full bg-amber-500/10 text-[9.5px] text-amber-200 border border-amber-500/20">{w}</span>
                    ))}
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase mb-1">CTA</div>
                    <p className="text-[10.5px] text-zinc-300 italic">{breakdown.copy_analysis.cta_formula}</p>
                  </div>
                </div>
              )}

              {/* Visual analysis (visual mode) */}
              {breakdown.visual_analysis && (
                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.03] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider">🎬 Análise Visual</span>
                    <CopyButton text={[
                      `Ritmo: ${breakdown.visual_analysis.edit_rhythm}`,
                      `Câmera: ${breakdown.visual_analysis.camera_moves.join(', ')}`,
                      `Textos: ${breakdown.visual_analysis.text_overlays.join(' | ')}`,
                      `B-roll: ${breakdown.visual_analysis.broll_types.join(', ')}`,
                    ].join('\n')} />
                  </div>
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase mb-1">Ritmo de edição</div>
                    <p className="text-[10.5px] text-zinc-300">{breakdown.visual_analysis.edit_rhythm}</p>
                  </div>
                  {breakdown.visual_analysis.text_overlays.length > 0 && (
                    <div>
                      <div className="text-[9px] text-zinc-500 uppercase mb-1">Textos na tela</div>
                      <div className="flex flex-wrap gap-1.5">
                        {breakdown.visual_analysis.text_overlays.map((t, i) => (
                          <span key={i} className="px-2 py-0.5 rounded bg-white/5 text-[9.5px] text-zinc-300 border border-white/8">"{t}"</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-[9px] text-zinc-500 uppercase mb-1">B-roll</div>
                    <div className="flex flex-wrap gap-1.5">
                      {breakdown.visual_analysis.broll_types.map((b, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-[9.5px] text-indigo-200 border border-indigo-500/20">{b}</span>
                      ))}
                    </div>
                  </div>

                  {/* ── Study-creator extension (newer analyses only) ── */}
                  {breakdown.visual_analysis.hook_visual && (
                    <div>
                      <div className="text-[9px] text-zinc-500 uppercase mb-1">Hook visual (0–2s)</div>
                      <p className="text-[10.5px] text-zinc-300">{breakdown.visual_analysis.hook_visual}</p>
                    </div>
                  )}
                  {breakdown.visual_analysis.pacing && (
                    <div>
                      <div className="text-[9px] text-zinc-500 uppercase mb-1">Pacing</div>
                      <p className="text-[10.5px] text-zinc-300">{breakdown.visual_analysis.pacing}</p>
                    </div>
                  )}
                  {breakdown.visual_analysis.caption_style && (
                    <div>
                      <div className="text-[9px] text-zinc-500 uppercase mb-1">Legendas</div>
                      <p className="text-[10.5px] text-zinc-300">{breakdown.visual_analysis.caption_style}</p>
                    </div>
                  )}
                  {(breakdown.visual_analysis.transition_flavors?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[9px] text-zinc-500 uppercase mb-1">Transições</div>
                      <div className="flex flex-wrap gap-1.5">
                        {breakdown.visual_analysis.transition_flavors!.map((t, i) => (
                          <span key={i} className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-[9.5px] text-indigo-200 border border-indigo-500/20">{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(breakdown.visual_analysis.palette?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[9px] text-zinc-500 uppercase mb-1">Paleta</div>
                      <div className="flex gap-1.5">
                        {breakdown.visual_analysis.palette!.map((hex, i) => (
                          <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 border border-white/8">
                            <span className="w-3 h-3 rounded-sm border border-white/20" style={{ backgroundColor: hex }} />
                            <span className="text-[9px] text-zinc-400 font-mono">{hex}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {breakdown.visual_analysis.signature_move && (
                    <div>
                      <div className="text-[9px] text-zinc-500 uppercase mb-1">Assinatura do criador</div>
                      <p className="text-[10.5px] text-amber-200/90 italic">{breakdown.visual_analysis.signature_move}</p>
                    </div>
                  )}
                  {(breakdown.visual_analysis.what_to_steal?.length ?? 0) > 0 && (
                    <div>
                      <div className="text-[9px] text-zinc-500 uppercase mb-1">🎯 O que roubar</div>
                      <ul className="space-y-1">
                        {breakdown.visual_analysis.what_to_steal!.map((w, i) => (
                          <li key={i} className="text-[10.5px] text-emerald-200/90 flex gap-1.5">
                            <span className="shrink-0">→</span><span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Replication prompt */}
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">Prompt de Replicação</span>
                  <CopyButton text={breakdown.replication_prompt} />
                </div>
                <p className="text-[10.5px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {breakdown.replication_prompt}
                </p>
              </div>
            </div>
          )}

          {tab === 'transcript' && (breakdown.reconstruction || breakdown.transcript) && (() => {
            // Scene-primary view: iterate scenes, show all transcript lines within each
            const scenes = breakdown.reconstruction?.scenes ?? [];
            const transcript = breakdown.transcript ?? [];

            // Build copy-all text
            const allText = scenes.length > 0
              ? scenes.map((scene, si) => {
                  const phrases = transcript.filter(t => t.startSec < scene.endSec && t.endSec > scene.startSec);
                  return [
                    `═══ CENA ${si + 1} [${fmtSec(scene.startSec)}–${fmtSec(scene.endSec)}] (${Math.round(scene.endSec - scene.startSec)}s) ═══`,
                    phrases.length > 0 ? phrases.map(t => `[${fmtSec(t.startSec)}] "${t.text}"`).join('\n') : (scene.speech ? `"${scene.speech}"` : ''),
                    scene.physical    ? `FÍSICO: ${scene.physical}`    : '',
                    scene.camera      ? `CÂMERA: ${scene.camera}`      : '',
                    scene.visuals     ? `VISUAL: ${scene.visuals}`     : '',
                    scene.audio       ? `ÁUDIO: ${scene.audio}`        : '',
                    scene.director_note ? `DIREÇÃO: ${scene.director_note}` : '',
                    scene.seedance_prompt ? `\nSEEDANCE PROMPT:\n${scene.seedance_prompt}` : '',
                  ].filter(Boolean).join('\n');
                }).join('\n\n')
              : transcript.map(t => `[${fmtSec(t.startSec)}–${fmtSec(t.endSec)}] "${t.text}"`).join('\n');

            return (
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                    {scenes.length > 0
                      ? `${scenes.length} cenas Seedance • ${transcript.length} falas`
                      : `${transcript.length} falas`}
                  </span>
                  <CopyButton label="Copiar tudo" text={allText} />
                </div>

                {/* Scene-primary rendering */}
                {scenes.length > 0 ? scenes.map((scene, si) => {
                  const phrases = transcript.filter(t => t.startSec < scene.endSec && t.endSec > scene.startSec);
                  const detailRows: { label: string; value: string; accent: string }[] = [
                    ...(scene.physical ? [{ label: 'Físico',  value: scene.physical,  accent: 'text-orange-300' }] : []),
                    ...(scene.camera   ? [{ label: 'Câmera',  value: scene.camera,    accent: 'text-sky-300'    }] : []),
                    ...(scene.visuals  ? [{ label: 'Visual',  value: scene.visuals,   accent: 'text-blue-300' }] : []),
                    ...(scene.audio    ? [{ label: 'Áudio',   value: scene.audio,     accent: 'text-emerald-300'}] : []),
                  ];
                  const sceneCopyText = [
                    `═══ CENA ${si + 1} [${fmtSec(scene.startSec)}–${fmtSec(scene.endSec)}] ═══`,
                    phrases.length > 0 ? phrases.map(t => `[${fmtSec(t.startSec)}] "${t.text}"`).join('\n') : (scene.speech ? `"${scene.speech}"` : ''),
                    scene.physical    ? `FÍSICO: ${scene.physical}`    : '',
                    scene.camera      ? `CÂMERA: ${scene.camera}`      : '',
                    scene.visuals     ? `VISUAL: ${scene.visuals}`     : '',
                    scene.audio       ? `ÁUDIO: ${scene.audio}`        : '',
                    scene.director_note ? `DIREÇÃO: ${scene.director_note}` : '',
                    scene.seedance_prompt ? `\nSEEDANCE PROMPT:\n${scene.seedance_prompt}` : '',
                  ].filter(Boolean).join('\n');

                  return (
                    <div key={si} className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                      {/* Scene header */}
                      <div className="px-3.5 py-2.5 border-b border-white/5 flex items-center justify-between gap-2 bg-white/[0.015]">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[9px] font-bold text-zinc-400 shrink-0">
                            {si + 1}
                          </span>
                          <span className="text-[9.5px] font-mono text-zinc-500">
                            {fmtSec(scene.startSec)} – {fmtSec(scene.endSec)}
                            <span className="ml-1 text-zinc-600">({Math.round(scene.endSec - scene.startSec)}s)</span>
                          </span>
                        </div>
                        <CopyButton text={sceneCopyText} label="Copiar cena" />
                      </div>

                      <div className="px-3.5 py-3 space-y-2.5">
                        {/* All phrases in this scene — each with individual copy */}
                        {(phrases.length > 0 || scene.speech) && (
                          <div className="rounded-lg bg-white/[0.04] border border-white/8 overflow-hidden">
                            <div className="text-[8.5px] font-semibold text-zinc-500 uppercase tracking-wider px-3 pt-2 pb-1">
                              💬 Falas {phrases.length > 0 ? `(${phrases.length})` : ''}
                            </div>
                            {phrases.length > 0 ? (
                              <div className="divide-y divide-white/5">
                                {phrases.map((t, pi) => (
                                  <div key={pi} className="flex items-start gap-2 px-3 py-2 group">
                                    <span className="text-[8.5px] font-mono text-zinc-600 shrink-0 mt-0.5 min-w-[36px]">
                                      {fmtSec(t.startSec)}
                                    </span>
                                    <p className="text-[10.5px] text-zinc-100 leading-relaxed flex-1">"{t.text}"</p>
                                    <CopyButton text={t.text} label="Copiar" />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-start gap-2 px-3 py-2">
                                <p className="text-[10.5px] text-zinc-100 leading-relaxed">"{scene.speech}"</p>
                                <CopyButton text={scene.speech} label="Copiar" />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Detail rows */}
                        {detailRows.length > 0 && (
                          <div className="space-y-2">
                            {detailRows.map(row => (
                              <div key={row.label} className="flex gap-2.5">
                                <span className={`text-[9px] font-semibold uppercase tracking-wider shrink-0 w-12 mt-0.5 ${row.accent}`}>
                                  {row.label}
                                </span>
                                <p className="text-[10px] text-zinc-300 leading-relaxed">{row.value}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Director note */}
                        {scene.director_note && (
                          <div className="flex gap-2.5 pt-1 border-t border-white/5">
                            <span className="text-[9px] font-semibold uppercase tracking-wider shrink-0 w-12 mt-0.5 text-amber-400">
                              Direção
                            </span>
                            <p className="text-[10px] text-amber-200/80 leading-relaxed italic">{scene.director_note}</p>
                          </div>
                        )}

                        {/* Seedance prompt */}
                        {scene.seedance_prompt && (
                          <div className="pt-2 border-t border-white/5 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] font-semibold uppercase tracking-wider text-cyan-400">
                                🎬 Prompt Seedance ({Math.round(scene.endSec - scene.startSec)}s)
                              </span>
                              <CopyButton text={scene.seedance_prompt} label="Copiar prompt" />
                            </div>
                            <pre className="text-[9.5px] text-cyan-100/80 bg-cyan-500/[0.05] border border-cyan-500/15 rounded-lg px-3 py-2.5 whitespace-pre-wrap font-mono leading-relaxed select-all overflow-x-auto">
                              {scene.seedance_prompt}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }) : (
                  // Fallback: no reconstruction, show transcript-only
                  transcript.map((t, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-white/8 bg-white/[0.02] group">
                      <span className="text-[9px] font-mono text-zinc-500 shrink-0 mt-0.5 min-w-[56px]">
                        {fmtSec(t.startSec)}–{fmtSec(t.endSec)}
                      </span>
                      <p className="text-[11px] text-zinc-200 leading-relaxed flex-1">"{t.text}"</p>
                      <CopyButton text={t.text} label="Copiar" />
                    </div>
                  ))
                )}
              </div>
            );
          })()}

          {tab === 'reconstruct' && breakdown.reconstruction && (
            <div className="space-y-4">
              {/* Setup + equipment */}
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Setup geral</span>
                  <CopyButton text={[
                    breakdown.reconstruction.shooting_setup,
                    'Equipamento: ' + breakdown.reconstruction.equipment.join(', '),
                  ].join('\n')} />
                </div>
                <p className="text-[10.5px] text-zinc-300 leading-relaxed">{breakdown.reconstruction.shooting_setup}</p>
                <div className="flex flex-wrap gap-1.5">
                  {breakdown.reconstruction.equipment.map((e, i) => (
                    <span key={i} className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[9.5px] text-zinc-300">{e}</span>
                  ))}
                </div>
              </div>

              {/* Copy all scenes button */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                  {breakdown.reconstruction.scenes.length} cenas
                </span>
                <CopyButton label="Copiar roteiro completo" text={breakdown.reconstruction.scenes.map(s => [
                  `--- CENA ${s.scene_index} [${fmtSec(s.startSec)}–${fmtSec(s.endSec)}] ---`,
                  s.speech ? `FALA: "${s.speech}"` : '',
                  `FÍSICO: ${s.physical}`,
                  `CÂMERA: ${s.camera}`,
                  `VISUAL: ${s.visuals}`,
                  `ÁUDIO: ${s.audio}`,
                  `DIREÇÃO: ${s.director_note}`,
                  s.seedance_prompt ? `\nSEEDANCE PROMPT:\n${s.seedance_prompt}` : '',
                ].filter(Boolean).join('\n')).join('\n\n')} />
              </div>

              {/* Scene cards */}
              {breakdown.reconstruction.scenes.map((scene) => (
                <SceneCard key={scene.scene_index} scene={scene} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/5 bg-black/20 flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="text-[10.5px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Fechar
          </button>
          {onCreateReel && (
            <button
              onClick={() => { onCreateReel(breakdown.replication_prompt); onClose(); }}
              className="px-4 py-2 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, rgba(0,180,216,0.2), rgba(123,47,190,0.2))',
                border: '1px solid rgba(0,180,216,0.3)',
                color: '#67e8f9',
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Criar Reel baseado nisso
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
