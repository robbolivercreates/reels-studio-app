import React, { useEffect, useRef, useState } from 'react';
import {
  analyseReferenceBlob,
  analyseReferenceFromBytes,
  type VideoAnalysisResult,
} from '../../services/videoAnalysisService';
import {
  saveImportedVideo,
  downloadVideo,
  listReferences,
  deleteReference,
  readReferenceBytes,
  referencesDir,
  revealReferencesDir,
  onDownloadProgress,
  type ReferenceMeta,
  type DownloadProgress,
} from './referenceVideoStore';
import {
  ensureProfiles,
  setActiveProfileId,
  REWRITE_LABELS,
  LANGUAGE_OPTIONS,
  type VoiceProfile,
  type RewriteLevel,
} from './voiceProfile';
import { VoiceProfilesPanel } from './VoiceProfilesPanel';
import type { ScriptBlock } from './types';
import {
  generateReelFromContent,
  fetchArticleFromUrl,
  STYLE_OPTIONS,
  FRAMEWORK_OPTIONS,
  type ReelStyle,
  type Framework,
  type DurationTarget,
  type GeneratedReel,
} from '../../services/scriptFromContentService';

export interface ContentImportPayload {
  caption: string;
  hashtags: string[];
  frameworkUsed: string;
  rationale: string;
  estimatedDurationSec: number;
  sourceTitle?: string;
  sourceUrl?: string;
}

interface Props {
  onClose: () => void;
  onImported: (blocks: ScriptBlock[], analysis: VideoAnalysisResult, meta: ReferenceMeta) => void;
  /** Optional separate handler for content-derived imports (article / text / URL). */
  onContentImported?: (blocks: ScriptBlock[], payload: ContentImportPayload) => void;
}

type Tab = 'url' | 'upload' | 'library' | 'article';

const fmtSize = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);
const fmtAgo = (ts: number) => {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86400)}d atrás`;
};

export const VideoReferenceModal: React.FC<Props> = ({ onClose, onImported, onContentImported }) => {
  const [tab, setTab] = useState<Tab>('url');
  const [folder, setFolder] = useState<string>('');
  const [refs, setRefs] = useState<ReferenceMeta[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Voice profile state.
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<VoiceProfile | null>(null);
  /** Per-run rewrite override. null = use the profile default. */
  const [rewriteOverride, setRewriteOverride] = useState<RewriteLevel | null>(null);
  const [showProfilesPanel, setShowProfilesPanel] = useState(false);

  // Article / text tab state.
  const [articleSourceMode, setArticleSourceMode] = useState<'text' | 'url'>('url');
  const [articleUrl, setArticleUrl] = useState('');
  const [articleText, setArticleText] = useState('');
  const [articleTitle, setArticleTitle] = useState('');
  const [articleStyle, setArticleStyle] = useState<ReelStyle>('viral');
  const [articleFramework, setArticleFramework] = useState<Framework>('auto');
  const [articleDuration, setArticleDuration] = useState<DurationTarget>(30);
  const [articleExtraInstructions, setArticleExtraInstructions] = useState('');
  const articleFileRef = useRef<HTMLInputElement>(null);
  const [generatedPreview, setGeneratedPreview] = useState<GeneratedReel | null>(null);
  const [generatedSource, setGeneratedSource] = useState<{ title?: string; sourceUrl?: string } | null>(null);

  // On mount: load folder + library; subscribe to download progress; load voice profiles.
  useEffect(() => {
    void referencesDir().then(setFolder).catch(() => setFolder(''));
    void refreshLibrary();
    let unlisten: (() => void) | undefined;
    void onDownloadProgress(p => setProgress(p)).then(fn => { unlisten = fn; });

    const { profiles, activeId } = ensureProfiles();
    setProfiles(profiles);
    setActiveProfile(profiles.find(p => p.id === activeId) ?? profiles[0] ?? null);

    return () => { unlisten?.(); };
  }, []);

  /** Build the profile to send to Gemini, applying any per-run override. */
  const profileForCall = (): VoiceProfile | undefined => {
    if (!activeProfile) return undefined;
    if (!rewriteOverride || rewriteOverride === activeProfile.rewriteLevel) return activeProfile;
    return { ...activeProfile, rewriteLevel: rewriteOverride };
  };

  const refreshProfiles = (next: VoiceProfile) => {
    const { profiles } = ensureProfiles();
    setProfiles(profiles);
    setActiveProfile(next);
  };

  const handleSelectActive = (id: string) => {
    setActiveProfileId(id);
    const next = profiles.find(p => p.id === id);
    if (next) {
      setActiveProfile(next);
      setRewriteOverride(null);
    }
  };

  // Cleanup preview URL.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const refreshLibrary = async () => {
    try {
      const rows = await listReferences();
      setRefs(rows);
    } catch (e) {
      console.warn('[references] list failed', e);
    }
  };

  const setPreviewFromBlob = (blob: Blob) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const u = URL.createObjectURL(blob);
    previewUrlRef.current = u;
    setPreviewUrl(u);
  };

  const handleFiles = (files: FileList | null) => {
    setError(null);
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith('video/')) {
      setError('O arquivo precisa ser um vídeo (MP4, MOV, WEBM…).');
      return;
    }
    setPendingFile(f);
    setPreviewFromBlob(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleAnalyseUpload = async () => {
    if (!pendingFile) return;
    setError(null);
    try {
      setBusy('Salvando na pasta…');
      const meta = await saveImportedVideo(pendingFile, pendingFile.name);
      setBusy('Analisando com Gemini Flash-Lite…');
      const result = await analyseReferenceBlob(pendingFile, profileForCall());
      await refreshLibrary();
      onImported(result.blocks, result, meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao analisar.');
      setBusy(null);
    }
  };

  const handleDownloadAndAnalyse = async () => {
    setError(null);
    setProgress(null);
    try {
      setBusy('Baixando…');
      const meta = await downloadVideo(url.trim());
      setBusy('Lendo arquivo…');
      const bytes = await readReferenceBytes(meta.fileName);
      setBusy('Analisando com Gemini Flash-Lite…');
      const result = await analyseReferenceFromBytes(bytes, 'video/mp4', profileForCall());
      await refreshLibrary();
      onImported(result.blocks, result, meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao baixar / analisar.');
      setBusy(null);
    }
  };

  const handleReuse = async (meta: ReferenceMeta) => {
    setError(null);
    try {
      setBusy('Lendo arquivo da pasta…');
      const bytes = await readReferenceBytes(meta.fileName);
      setBusy('Analisando com Gemini Flash-Lite…');
      const result = await analyseReferenceFromBytes(bytes, 'video/mp4', profileForCall());
      onImported(result.blocks, result, meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na análise.');
      setBusy(null);
    }
  };

  const handleDelete = async (meta: ReferenceMeta) => {
    try {
      await deleteReference(meta.fileName);
      await refreshLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao apagar.');
    }
  };

  // ─── Article / text tab handlers ─────────────────────────────────────

  const handleArticleFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      setArticleText(text);
      if (!articleTitle) {
        const stem = file.name.replace(/\.(md|markdown|txt)$/i, '');
        setArticleTitle(stem);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao ler arquivo.');
    }
  };

  const handleGenerateFromContent = async () => {
    setError(null);
    setGeneratedPreview(null);

    let content = articleText.trim();
    let title = articleTitle.trim() || undefined;
    let sourceUrl: string | undefined;

    try {
      if (articleSourceMode === 'url') {
        if (!articleUrl.trim()) { setError('Cole uma URL.'); return; }
        setBusy('Buscando o artigo…');
        const fetched = await fetchArticleFromUrl(articleUrl.trim());
        content = fetched.text;
        title = fetched.title || title;
        sourceUrl = fetched.sourceUrl;
      } else {
        if (!content) { setError('Cole o texto do artigo / transcrição.'); return; }
      }

      setBusy(`Gerando reel de ${articleDuration}s…`);
      const result = await generateReelFromContent(
        { text: content, title, sourceUrl },
        {
          style: articleStyle,
          framework: articleFramework,
          durationSec: articleDuration,
          extraInstructions: articleExtraInstructions.trim() || undefined,
          voiceProfile: activeProfile ?? undefined,
        },
      );
      setGeneratedPreview(result);
      setGeneratedSource({ title, sourceUrl });
      setBusy(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gerar.');
      setBusy(null);
    }
  };

  const handleAcceptGenerated = () => {
    if (!generatedPreview) return;
    if (onContentImported) {
      onContentImported(generatedPreview.blocks, {
        caption: generatedPreview.caption,
        hashtags: generatedPreview.hashtags,
        frameworkUsed: generatedPreview.frameworkUsed,
        rationale: generatedPreview.rationale,
        estimatedDurationSec: generatedPreview.estimatedDurationSec,
        sourceTitle: generatedSource?.title,
        sourceUrl: generatedSource?.sourceUrl,
      });
    }
  };

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
        tab === id
          ? 'bg-violet-500/25 text-violet-100 border border-violet-400/40'
          : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-transparent'
      }`}
    >
      {label}
    </button>
  );

  const supportedHosts = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'X / Twitter', 'Vimeo'];

  if (showProfilesPanel) {
    return (
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
        <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-3xl w-full overflow-hidden flex flex-col">
          <div className="px-6 pt-5 pb-3 flex items-start justify-between shrink-0 border-b border-white/5">
            <div>
              <div className="text-base font-semibold text-zinc-100 mb-1">Perfis de voz e estilo</div>
              <div className="text-xs text-zinc-500">Configure idioma, nível de reescrita, instruções extras e o doc de voz em Markdown.</div>
            </div>
            <button onClick={() => setShowProfilesPanel(false)} className="p-1 text-zinc-500 hover:text-zinc-200">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <VoiceProfilesPanel
            onActiveChange={refreshProfiles}
            onClose={() => setShowProfilesPanel(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-6">
      <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-2xl w-full overflow-hidden flex flex-col max-h-[88vh]">
        <div className="px-6 pt-6 pb-4 flex items-start justify-between shrink-0">
          <div>
            <div className="text-base font-semibold text-zinc-100 mb-1">Importar de um vídeo de referência</div>
            <div className="text-xs text-zinc-500">Cola um link, arrasta um arquivo, ou reusa algo já salvo. Gemini 3.1 Flash-Lite gera o roteiro.</div>
          </div>
          <button onClick={onClose} disabled={!!busy} className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-40">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Folder strip */}
        <div className="mx-6 mb-2 px-3 py-2.5 rounded-lg bg-black/30 border border-white/5 flex items-center gap-3 text-[11px]">
          <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          <span className="text-zinc-400">Pasta:</span>
          <span className="text-zinc-200 font-mono text-[10px] truncate flex-1">{folder || '~/Reels Studio/References/'}</span>
          <button onClick={() => void revealReferencesDir()} className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-200 font-medium">
            Abrir
          </button>
        </div>

        {/* Voice profile bar */}
        {activeProfile && (
          <div className="mx-6 mb-3 px-3 py-2.5 rounded-lg bg-violet-500/[0.06] border border-violet-500/20 flex items-center gap-3 text-[11px]">
            <span className="text-violet-300">🎙</span>
            <span className="text-zinc-400">Perfil:</span>
            <select
              value={activeProfile.id}
              onChange={e => handleSelectActive(e.target.value)}
              disabled={!!busy}
              className="bg-black/30 border border-white/10 rounded px-2 py-1 text-zinc-100 text-[11px] outline-none focus:border-violet-400/50 disabled:opacity-50"
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <span className="text-zinc-500">·</span>
            <span className="text-zinc-300">
              {LANGUAGE_OPTIONS.find(l => l.value === activeProfile.outputLanguage)?.label ?? activeProfile.outputLanguage}
            </span>
            <span className="text-zinc-500">·</span>
            <select
              value={rewriteOverride ?? activeProfile.rewriteLevel}
              onChange={e => {
                const v = e.target.value as RewriteLevel;
                setRewriteOverride(v === activeProfile.rewriteLevel ? null : v);
              }}
              disabled={!!busy}
              className="bg-black/30 border border-white/10 rounded px-2 py-1 text-zinc-100 text-[11px] outline-none focus:border-violet-400/50 disabled:opacity-50"
              title={REWRITE_LABELS[rewriteOverride ?? activeProfile.rewriteLevel].hint}
            >
              {(['faithful', 'translate', 'adapt', 'reimagine'] as RewriteLevel[]).map(level => (
                <option key={level} value={level}>{REWRITE_LABELS[level].label}</option>
              ))}
            </select>
            <button
              onClick={() => setShowProfilesPanel(true)}
              disabled={!!busy}
              className="ml-auto px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-200 font-medium disabled:opacity-50"
            >
              Editar perfis
            </button>
          </div>
        )}

        <div className="px-6 flex items-center gap-1.5 mb-3 shrink-0">
          {tabBtn('url', '🔗 Link (Instagram, TikTok…)')}
          {tabBtn('upload', '⬇ Arrastar arquivo')}
          {tabBtn('article', '📰 Artigo / Texto')}
          {tabBtn('library', `📚 Salvos${refs.length ? ` (${refs.length})` : ''}`)}
        </div>

        <div className="px-6 flex-1 overflow-y-auto pb-2">
          {tab === 'url' && (
            <div className="space-y-3">
              <div className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                ✅ Funciona com: <strong>{supportedHosts.join(', ')}</strong> e qualquer site suportado pelo yt-dlp.
                O vídeo é baixado direto pra <span className="font-mono">~/Reels Studio/References/</span>.
              </div>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://www.instagram.com/reel/..."
                disabled={!!busy}
                className="w-full px-3 py-2.5 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-400/50 disabled:opacity-50"
              />
              <button
                onClick={handleDownloadAndAnalyse}
                disabled={!url.trim() || !!busy}
                className="w-full py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.5)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all"
              >
                {busy ? busy : 'Baixar e analisar'}
              </button>

              {progress && (
                <div className="px-3 py-2 rounded-lg bg-black/40 border border-white/5">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                    <span className="uppercase tracking-wider">{progress.stage}</span>
                    {progress.percent !== null && <span className="font-mono">{progress.percent.toFixed(0)}%</span>}
                  </div>
                  {progress.percent !== null && (
                    <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-violet-400 to-violet-500 transition-all"
                        style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
                      />
                    </div>
                  )}
                  <div className="text-[10px] text-zinc-500 font-mono truncate mt-1">{progress.message}</div>
                </div>
              )}
            </div>
          )}

          {tab === 'upload' && !pendingFile && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`rounded-xl border-2 border-dashed transition-colors px-6 py-10 text-center ${
                dragOver ? 'border-violet-400 bg-violet-500/10' : 'border-white/10 bg-black/20'
              }`}
            >
              <div className="text-3xl mb-2">🎬</div>
              <div className="text-sm font-medium text-zinc-200 mb-1">Solte um MP4 / MOV / WEBM aqui</div>
              <div className="text-[11px] text-zinc-500 mb-4">ou clique para escolher · até 20 MB para análise inline</div>
              <label className="inline-block px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 cursor-pointer text-xs font-medium text-zinc-200 border border-white/10">
                Escolher arquivo
                <input type="file" accept="video/*" className="hidden" onChange={e => handleFiles(e.target.files)} />
              </label>
            </div>
          )}

          {tab === 'upload' && pendingFile && previewUrl && (
            <div className="space-y-3">
              <div className="rounded-xl overflow-hidden bg-black border border-white/10">
                <video src={previewUrl} controls className="w-full max-h-[280px]" />
              </div>
              <div className="flex items-center gap-3 text-[11px] text-zinc-400">
                <span className="text-zinc-200 font-medium truncate flex-1">{pendingFile.name}</span>
                <span className="text-zinc-500 shrink-0">{fmtSize(pendingFile.size)}</span>
                <button
                  onClick={() => { setPendingFile(null); if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = null; setPreviewUrl(null); }}
                  disabled={!!busy}
                  className="text-zinc-400 hover:text-zinc-200 underline disabled:opacity-40"
                >
                  Trocar
                </button>
              </div>
              <button
                onClick={handleAnalyseUpload}
                disabled={!!busy}
                className="w-full py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.5)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {busy ? busy : 'Salvar na pasta e analisar'}
              </button>
            </div>
          )}

          {tab === 'article' && (
            <div className="space-y-4">
              {!generatedPreview && (
                <>
                  {/* Source selector */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setArticleSourceMode('url')}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                        articleSourceMode === 'url' ? 'bg-violet-500/20 text-violet-100 border border-violet-400/40' : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-transparent'
                      }`}
                    >
                      🔗 URL
                    </button>
                    <button
                      onClick={() => setArticleSourceMode('text')}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                        articleSourceMode === 'text' ? 'bg-violet-500/20 text-violet-100 border border-violet-400/40' : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-transparent'
                      }`}
                    >
                      ✍ Texto colado
                    </button>
                    <button
                      onClick={() => articleFileRef.current?.click()}
                      className="ml-auto text-[10px] text-zinc-400 hover:text-zinc-200 underline"
                    >
                      📄 Carregar .md / .txt
                    </button>
                    <input
                      ref={articleFileRef}
                      type="file"
                      accept=".md,.markdown,.txt"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) void handleArticleFile(f); }}
                    />
                  </div>

                  {articleSourceMode === 'url' && (
                    <input
                      value={articleUrl}
                      onChange={e => setArticleUrl(e.target.value)}
                      placeholder="https://exemplo.com/artigo"
                      disabled={!!busy}
                      className="w-full px-3 py-2.5 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-400/50 disabled:opacity-50"
                    />
                  )}

                  {articleSourceMode === 'text' && (
                    <>
                      <input
                        value={articleTitle}
                        onChange={e => setArticleTitle(e.target.value)}
                        placeholder="Título (opcional)"
                        disabled={!!busy}
                        className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-400/50 disabled:opacity-50"
                      />
                      <textarea
                        value={articleText}
                        onChange={e => setArticleText(e.target.value)}
                        placeholder="Cole o artigo, transcrição de vídeo longo, ou notas. O Gemini reduz pra reel de alta retenção."
                        disabled={!!busy}
                        rows={8}
                        className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-400/50 leading-relaxed resize-y disabled:opacity-50"
                      />
                      <div className="text-[10px] text-zinc-600 font-mono text-right">
                        {articleText.length.toLocaleString()} caracteres
                      </div>
                    </>
                  )}

                  {/* Style picker */}
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2">Estilo</div>
                    <div className="grid grid-cols-3 gap-2">
                      {STYLE_OPTIONS.map(s => (
                        <button
                          key={s.value}
                          onClick={() => setArticleStyle(s.value)}
                          className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                            articleStyle === s.value
                              ? 'bg-violet-500/15 border-violet-500/40'
                              : 'bg-black/20 border-white/10 hover:border-white/20'
                          }`}
                          title={s.hint}
                        >
                          <div className="text-xs font-medium text-zinc-100 flex items-center gap-1.5">
                            <span>{s.emoji}</span>
                            <span>{s.label}</span>
                          </div>
                          <div className="text-[10px] text-zinc-500 mt-0.5 leading-snug line-clamp-2">{s.hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Framework + duration */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5">Framework</div>
                      <select
                        value={articleFramework}
                        onChange={e => setArticleFramework(e.target.value as Framework)}
                        className="w-full px-2 py-2 rounded-lg bg-black/30 border border-white/10 text-xs text-zinc-100 outline-none focus:border-violet-400/50"
                      >
                        {FRAMEWORK_OPTIONS.map(f => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                      <div className="text-[10px] text-zinc-500 mt-1 leading-snug">
                        {FRAMEWORK_OPTIONS.find(f => f.value === articleFramework)?.hint}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5">Duração alvo</div>
                      <div className="grid grid-cols-5 gap-1">
                        {([15, 20, 30, 45, 60] as DurationTarget[]).map(d => (
                          <button
                            key={d}
                            onClick={() => setArticleDuration(d)}
                            className={`py-2 rounded-md text-[11px] font-mono transition-colors ${
                              articleDuration === d
                                ? 'bg-violet-500/20 text-violet-100 border border-violet-400/40'
                                : 'bg-black/20 text-zinc-400 hover:text-zinc-200 border border-white/10'
                            }`}
                          >
                            {d}s
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Extra instructions */}
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5">Instruções extras pro Gemini</div>
                    <textarea
                      value={articleExtraInstructions}
                      onChange={e => setArticleExtraInstructions(e.target.value)}
                      rows={2}
                      placeholder='Ex: "comece com pergunta provocativa", "termine com convite pra DM", "use a estrutura mostre-explique-conclua".'
                      className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-400/50 leading-relaxed resize-y"
                    />
                  </div>

                  <button
                    onClick={handleGenerateFromContent}
                    disabled={!!busy}
                    className="w-full py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.5)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all"
                  >
                    {busy ? busy : `✨ Reduzir pra reel de ${articleDuration}s`}
                  </button>
                </>
              )}

              {generatedPreview && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-violet-500/[0.06] border border-violet-400/30 p-3 space-y-1.5">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-violet-300">
                      ✨ Roteiro gerado · {generatedPreview.frameworkUsed} · ~{generatedPreview.estimatedDurationSec}s
                    </div>
                    {generatedPreview.rationale && (
                      <div className="text-[11px] text-zinc-300 leading-relaxed">{generatedPreview.rationale}</div>
                    )}
                  </div>

                  <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                    {generatedPreview.blocks.map((b, i) => {
                      const isAvatar = b.kind === 'avatar';
                      return (
                        <div key={b.id} className="px-3 py-2 rounded-lg bg-black/30 border border-white/5">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[9px] font-semibold tracking-wider uppercase ${isAvatar ? 'text-violet-300' : 'text-emerald-300'}`}>
                              {isAvatar ? 'Avatar' : 'B-roll'}
                            </span>
                            <span className="text-[9px] text-zinc-600 font-mono">#{i + 1}</span>
                          </div>
                          <div className="text-[12.5px] text-zinc-100 leading-relaxed">{b.text}</div>
                        </div>
                      );
                    })}
                  </div>

                  {(generatedPreview.caption || generatedPreview.hashtags.length > 0) && (
                    <div className="rounded-lg bg-black/30 border border-white/5 p-3 space-y-2">
                      {generatedPreview.caption && (
                        <div>
                          <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1">Caption sugerida</div>
                          <div className="text-[12px] text-zinc-200 leading-relaxed">{generatedPreview.caption}</div>
                        </div>
                      )}
                      {generatedPreview.hashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {generatedPreview.hashtags.map(h => (
                            <span key={h} className="text-[10px] text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded-full border border-violet-500/20">
                              {h.startsWith('#') ? h : `#${h}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setGeneratedPreview(null)}
                      className="flex-1 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-medium text-zinc-300 transition-colors"
                    >
                      ↻ Gerar outra versão
                    </button>
                    <button
                      onClick={handleAcceptGenerated}
                      className="flex-1 py-2 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-[11px] font-semibold text-white shadow-[0_0_15px_rgba(124,58,237,0.4)] transition-all"
                    >
                      Usar este roteiro →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'library' && (
            refs.length === 0 ? (
              <div className="text-center py-10 text-zinc-500 text-xs">
                Nenhuma referência ainda. Cole um link ou arraste um vídeo para começar.
              </div>
            ) : (
              <div className="space-y-2">
                {refs.map(r => (
                  <div key={r.absolutePath} className="px-3 py-2.5 rounded-lg bg-black/30 border border-white/5 flex items-center gap-3 hover:border-white/15 transition-colors">
                    <div className="text-xl shrink-0">🎬</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-200 truncate">{r.fileName}</div>
                      <div className="text-[10px] text-zinc-500 flex items-center gap-2">
                        <span>{fmtSize(r.sizeBytes)}</span>
                        <span>·</span>
                        <span>{fmtAgo(r.createdAt)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleReuse(r)}
                      disabled={!!busy}
                      className="px-2.5 py-1 rounded bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 text-[10px] font-medium disabled:opacity-40"
                    >
                      Re-analisar
                    </button>
                    <button
                      onClick={() => handleDelete(r)}
                      disabled={!!busy}
                      className="text-zinc-500 hover:text-red-300 text-[10px] disabled:opacity-40"
                    >
                      Excluir
                    </button>
                  </div>
                ))}
              </div>
            )
          )}

          {error && (
            <div className="mt-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-200">
              ⚠ {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/5 shrink-0">
          <button
            onClick={onClose}
            disabled={!!busy}
            className="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-50"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
