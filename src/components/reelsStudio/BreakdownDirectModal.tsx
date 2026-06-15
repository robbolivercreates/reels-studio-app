/**
 * BreakdownDirectModal — paste a URL, pick modes, get a viral breakdown.
 * Downloads via yt-dlp (existing Tauri command), optionally fetches social stats,
 * then runs Gemini analysis. Shows result in ViralBreakdownModal.
 */

import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AppTheme } from './types';
import { useModalChrome } from './modalChrome';
import { downloadVideo, readReferenceBytes } from './referenceVideoStore';
import {
  generateViralBreakdown,
  type ViralBreakdown,
  type VideoSocialStats,
  type BreakdownMode,
  type BreakdownStatus,
} from '../../services/viralBreakdownService';
import {
  listBreakdownRecords,
  saveBreakdownRecord,
  findBreakdownRecord,
  deleteBreakdownRecord,
  newBreakdownId,
  type BreakdownRecord,
} from '../../services/viralBreakdownHistory';
import { ViralBreakdownModal } from './ViralBreakdownModal';

interface Props {
  onClose: () => void;
  onCreateReel?: (prompt: string) => void;
  appTheme?: AppTheme;
}

interface RustVideoInfo {
  title: string;
  uploader: string;
  view_count?: number;
  like_count?: number;
  duration_sec: number;
  upload_date?: string;
  platform?: string;
  webpage_url: string;
}

const MODE_OPTIONS: { id: BreakdownMode; label: string; desc: string; emoji: string }[] = [
  { id: 'script',      label: 'Roteiro',      emoji: '📝', desc: 'Transcript verbatim, copy, hook, tom, CTAs' },
  { id: 'visual',      label: 'Visual',       emoji: '🎬', desc: 'Edição, câmera, textos na tela, B-roll' },
  { id: 'reconstruct', label: 'Reconstrução', emoji: '🎭', desc: 'Cena a cena: falas, postura, iluminação, câmera — para refilmar do zero' },
  { id: 'full',        label: 'Completo',     emoji: '🔬', desc: 'Tudo: roteiro, visual, reconstrução cena a cena + prompts Seedance + fórmula copiável' },
];

const fmtViews = (n?: number) => {
  if (n === undefined || n === null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};

const fmtDate = (s?: string) => {
  if (!s || s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

const fmtAgo = (ms: number) => {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86400)}d atrás`;
};

const scoreColor = (n: number) => {
  if (n >= 80) return '#22c55e';
  if (n >= 60) return '#eab308';
  if (n >= 40) return '#f97316';
  return '#ef4444';
};

export const BreakdownDirectModal: React.FC<Props> = ({ onClose, onCreateReel, appTheme }) => {
  const chrome = useModalChrome(appTheme);
  const [url, setUrl] = useState('');
  const [modes, setModes] = useState<Set<BreakdownMode>>(new Set(['full']));
  const [stage, setStage] = useState<'idle' | 'fetching-info' | 'downloading' | 'analyzing' | 'done' | 'error'>('idle');
  const [dlProgress, setDlProgress] = useState<string>('');
  const [analysisStatus, setAnalysisStatus] = useState<BreakdownStatus | null>(null);
  const [socialStats, setSocialStats] = useState<VideoSocialStats | null>(null);
  const [breakdown, setBreakdown] = useState<ViralBreakdown | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cacheHit, setCacheHit] = useState(false);

  // History
  const [history, setHistory] = useState<BreakdownRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<BreakdownRecord | null>(null);

  useEffect(() => {
    setHistory(listBreakdownRecords());
  }, []);

  const refreshHistory = () => setHistory(listBreakdownRecords());

  const toggleMode = (m: BreakdownMode) => {
    setModes(prev => {
      const next = new Set(prev);
      if (next.has(m)) {
        if (next.size > 1) next.delete(m);
      } else {
        next.add(m);
      }
      return next;
    });
  };

  const statusLabel = (() => {
    if (stage === 'fetching-info') return 'Buscando informações do vídeo…';
    if (stage === 'downloading') return dlProgress || 'Baixando vídeo…';
    if (stage === 'analyzing') {
      if (!analysisStatus) return 'Analisando…';
      if (analysisStatus.stage === 'uploading') return `Enviando ${analysisStatus.megabytes}MB para o Gemini…`;
      if (analysisStatus.stage === 'processing-upload') return 'Gemini processando upload…';
      return 'Gemini assistindo o vídeo…';
    }
    return '';
  })();

  const handleAnalyze = async (forceReanalyze = false) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    // ── Cache check ──────────────────────────────────────────────────────────
    if (!forceReanalyze) {
      const cached = findBreakdownRecord(trimmedUrl);
      if (cached) {
        setCacheHit(true);
        setBreakdown(cached.breakdown);
        setFileName(cached.fileName);
        if (cached.breakdown.social_stats) setSocialStats(cached.breakdown.social_stats);
        setStage('done');
        return;
      }
    } else {
      // Delete cached entry so we can save the fresh result
      const cached = findBreakdownRecord(trimmedUrl);
      if (cached) deleteBreakdownRecord(cached.id);
    }
    setCacheHit(false);

    setError(null);
    setStage('fetching-info');
    setSocialStats(null);
    setBreakdown(null);

    // 1. Fetch social stats (fire-and-forget, non-blocking)
    let stats: VideoSocialStats | null = null;
    try {
      const info = await invoke<RustVideoInfo>('fetch_video_info', { url: trimmedUrl });
      stats = {
        title: info.title,
        uploader: info.uploader,
        view_count: info.view_count,
        like_count: info.like_count,
        duration_sec: info.duration_sec,
        upload_date: info.upload_date,
        platform: info.platform,
      };
      setSocialStats(stats);
    } catch {
      // Not fatal — continue without stats
    }

    // 2. Download video
    setStage('downloading');
    let meta;
    try {
      const unlisten = await listen<{ stage: string; message: string; percent?: number }>(
        'reference://download-progress',
        ev => {
          const { stage: s, message, percent } = ev.payload;
          if (s === 'downloading' && percent !== undefined) {
            setDlProgress(`Baixando… ${percent.toFixed(0)}%`);
          } else if (s === 'info') {
            setDlProgress(message.slice(0, 60));
          }
        }
      );
      meta = await downloadVideo(trimmedUrl);
      unlisten();
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      setError(msg || 'Falha ao baixar o vídeo.');
      setStage('error');
      return;
    }

    setFileName(meta.fileName);
    setStage('analyzing');

    // 3. Read bytes and run Gemini breakdown
    try {
      const bytes = await readReferenceBytes(meta.fileName);
      const result = await generateViralBreakdown(
        bytes,
        undefined,
        s => setAnalysisStatus(s),
        Array.from(modes),
      );
      const withStats: ViralBreakdown = stats ? { ...result, social_stats: stats } : result;
      setBreakdown(withStats);
      setStage('done');

      // ── Persist to history ───────────────────────────────────────────────
      saveBreakdownRecord({
        id: newBreakdownId(),
        url: trimmedUrl,
        fileName: meta.fileName,
        title: stats?.title || result.title,
        platform: stats?.platform,
        view_count: stats?.view_count,
        virality_score: result.virality_score,
        breakdown: withStats,
        analyzedAt: Date.now(),
      });
      refreshHistory();
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      setError(msg || 'Falha na análise do Gemini.');
      setStage('error');
    }
  };

  const busy = stage === 'fetching-info' || stage === 'downloading' || stage === 'analyzing';

  if (selectedRecord) {
    return (
      <ViralBreakdownModal
        breakdown={selectedRecord.breakdown}
        fileName={selectedRecord.fileName}
        cacheHit
        onClose={() => setSelectedRecord(null)}
        onCreateReel={onCreateReel}
        appTheme={appTheme}
        onReanalyze={selectedRecord.url ? () => {
          const recUrl = selectedRecord.url!;
          deleteBreakdownRecord(selectedRecord.id);
          refreshHistory();
          setSelectedRecord(null);
          setUrl(recUrl);
          setBreakdown(null);
          setStage('idle');
        } : undefined}
      />
    );
  }

  if (stage === 'done' && breakdown) {
    return (
      <ViralBreakdownModal
        breakdown={breakdown}
        fileName={fileName}
        cacheHit={cacheHit}
        onClose={() => { setBreakdown(null); setStage('idle'); }}
        onCreateReel={onCreateReel}
        appTheme={appTheme}
        onReanalyze={cacheHit ? () => {
          setBreakdown(null);
          setStage('idle');
          handleAnalyze(true);
        } : undefined}
      />
    );
  }

  return (
    <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-[150] p-6" style={chrome.backdrop}>
      <div className="rounded-2xl max-w-lg w-full overflow-hidden flex flex-col" style={chrome.card}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div>
            <div className="text-base font-semibold text-zinc-100">🔬 Breakdown viral</div>
            <div className="text-xs text-zinc-500 mt-0.5">Cole um link → escolha o ângulo → relatório copiável</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* URL input */}
          <div>
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
              Link do vídeo
            </label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !busy) handleAnalyze(); }}
              placeholder="https://instagram.com/p/… ou tiktok.com/… ou youtu.be/…"
              spellCheck={false}
              autoCorrect="off"
              autoComplete="off"
              disabled={busy}
              className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/40 transition-colors disabled:opacity-50"
            />
            <div className="mt-1 text-[9px] text-zinc-600">Instagram, TikTok, YouTube, Facebook, X — qualquer plataforma suportada pelo yt-dlp</div>
          </div>

          {/* Mode selector */}
          <div>
            <label className="block text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
              Ângulo de análise
            </label>
            <div className="space-y-1.5">
              {MODE_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => toggleMode(opt.id)}
                  disabled={busy}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all text-left disabled:opacity-50 ${
                    modes.has(opt.id)
                      ? 'border-cyan-500/40 bg-cyan-500/[0.07]'
                      : 'border-white/8 bg-white/[0.02] hover:border-white/15'
                  }`}
                >
                  <div className={`w-4 h-4 rounded border shrink-0 mt-0.5 flex items-center justify-center transition-colors ${
                    modes.has(opt.id) ? 'bg-cyan-500 border-cyan-500' : 'border-white/20'
                  }`}>
                    {modes.has(opt.id) && (
                      <svg className="w-2.5 h-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <span className="text-[11px] font-semibold text-zinc-200">{opt.emoji} {opt.label}</span>
                    <span className="block text-[9.5px] text-zinc-500 mt-0.5">{opt.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Social stats preview (if fetched) */}
          {socialStats && (
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 space-y-1.5">
              <div className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                Informações do vídeo
              </div>
              <div className="text-[11px] font-medium text-zinc-200 truncate">{socialStats.title}</div>
              <div className="flex items-center gap-3 text-[10px] text-zinc-500 flex-wrap">
                {socialStats.uploader && <span>@{socialStats.uploader}</span>}
                {fmtViews(socialStats.view_count) && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="text-emerald-400 font-semibold">{fmtViews(socialStats.view_count)} views</span>
                  </>
                )}
                {fmtViews(socialStats.like_count) && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span>{fmtViews(socialStats.like_count)} likes</span>
                  </>
                )}
                {fmtDate(socialStats.upload_date) && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span>{fmtDate(socialStats.upload_date)}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Progress */}
          {busy && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-cyan-500/[0.06] border border-cyan-500/20">
              <div className="w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin shrink-0" />
              <span className="text-[10.5px] text-cyan-300">{statusLabel}</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-[10.5px] text-red-300">
              {error}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                <span>Histórico ({history.length})</span>
                <span className="text-[9px] text-zinc-600 normal-case font-normal">Clique para abrir sem gastar créditos</span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {history.map(rec => (
                  <div
                    key={rec.id}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-white/8 bg-white/[0.02] hover:bg-white/[0.04] transition-colors group cursor-pointer"
                    onClick={() => setSelectedRecord(rec)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[10.5px] text-zinc-200 truncate">{rec.title}</div>
                      <div className="flex items-center gap-1.5 text-[9px] text-zinc-600 flex-wrap">
                        {rec.platform && <span>{rec.platform}</span>}
                        {rec.view_count !== undefined && <><span>·</span><span className="text-emerald-500">{fmtViews(rec.view_count)} views</span></>}
                        <span>·</span>
                        <span>{fmtAgo(rec.analyzedAt)}</span>
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-bold tabular-nums shrink-0"
                      style={{ color: scoreColor(rec.virality_score) }}
                    >
                      {rec.virality_score}/100
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); deleteBreakdownRecord(rec.id); refreshHistory(); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-zinc-600 hover:text-red-400 shrink-0"
                      title="Remover do histórico"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Analyze button */}
          <button
            onClick={() => handleAnalyze()}
            disabled={busy || !url.trim()}
            className="w-full py-2.5 rounded-xl text-[11.5px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            style={{
              background: 'linear-gradient(135deg, rgba(0,180,216,0.2), rgba(16,185,129,0.15))',
              border: '1px solid rgba(0,180,216,0.35)',
              color: busy ? '#94a3b8' : '#67e8f9',
            }}
          >
            {busy ? (
              <>
                <div className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
                {stage === 'downloading' ? 'Baixando…' : stage === 'analyzing' ? 'Analisando…' : 'Buscando…'}
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Analisar vídeo
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
