import React, { useReducer, useCallback, useEffect, useRef, useState } from 'react';
import type { ScriptBlock, BlockKind, ToneOption, LanguageOption, RegenerateContext, ContentMode } from './types';
import { suggestContentMode } from '../../services/contentMode';
import {
  generateCarouselScript,
  carouselSlidesToBlocks,
  CAROUSEL_TONE_OPTIONS,
  type CarouselTone,
} from '../../services/carouselScriptService';
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
import { importScriptWithAI, importScriptHeuristic } from './scriptImporter';
import { regenerateBlock, generateNewBlock } from '../../services/blockGeneratorService';
import {
  analyseReferenceBlob,
  analyseReferenceFromBytes,
  type VideoAnalysisResult,
  type AnalysisStatus,
} from '../../services/videoAnalysisService';
import {
  saveImportedVideo,
  downloadVideo,
  readReferenceBytes,
  deleteReference,
  onDownloadProgress,
  type ReferenceMeta,
  type DownloadProgress,
} from './referenceVideoStore';
import {
  ensureProfiles,
  setActiveProfileId,
  type VoiceProfile,
  type RewriteLevel,
} from './voiceProfile';
import { ScriptPreviewPanel, type BusyState } from './ScriptPreviewPanel';
import { VoiceProfileBar } from './wizard/VoiceProfileBar';
import { VoiceProfilesPanel } from './VoiceProfilesPanel';
import { VideoNewSourceForm } from './wizard/VideoNewSourceForm';
import { VideoLibraryList } from './wizard/VideoLibraryList';
import { useReferenceLibrary } from './wizard/useReferenceLibrary';
import { isYouTubeUrl } from './wizard/format';

// ─── TYPES ────────────────────────────────────────────────────────────────────

type WizardFormat = 'reel' | 'carousel';
type WizardSource = 'topic' | 'script' | 'video' | 'article';
type WizardStep = 'format' | 'source' | 'config' | 'preview';
type VideoTab = 'new' | 'saved';
type ArticleSourceMode = 'url' | 'text';

/** Article-mode content payload — preserved on confirm so caption/hashtags survive. */
export interface ContentImportPayload {
  caption: string;
  hashtags: string[];
  frameworkUsed: string;
  rationale: string;
  estimatedDurationSec: number;
  sourceTitle?: string;
  sourceUrl?: string;
  languageOverride?: LanguageOption;
}

interface VideoPreviewState {
  blocks: ScriptBlock[];
  analysis: VideoAnalysisResult;
  meta: ReferenceMeta;
  bytesGetter: () => Promise<{ bytes: Uint8Array; mimeType: string }>;
}

interface WizardState {
  step: WizardStep;
  format: WizardFormat;
  source: WizardSource | null;

  // Shared config
  extraInstr: string;
  extraOpen: boolean;

  // Reel topic config (style/framework/duration)
  reelStyle: ReelStyle;
  reelFramework: Framework;
  reelDuration: DurationTarget;

  // Carousel config
  slideCount: number;
  carouselTone: CarouselTone;

  // Source 'topic'
  topicText: string;

  // Source 'script'
  scriptText: string;
  useHeuristic: boolean;

  // Source 'video' — sub-tabs + inputs
  videoTab: VideoTab;
  videoUrl: string;
  videoFile: File | null;
  selectedSavedRef: ReferenceMeta | null;
  downloadProgress: DownloadProgress | null;
  busyMessage: string | null;

  // Source 'article'
  articleSourceMode: ArticleSourceMode;
  articleUrl: string;
  articleText: string;
  articleTitle: string;
  articleStyle: ReelStyle;
  articleFramework: Framework;
  articleDuration: DurationTarget;
  articleExtraInstr: string;

  // Voice profile (loaded on mount via ensureProfiles())
  voiceProfileId: string | null;
  languageOverride: LanguageOption;
  rewriteOverride: RewriteLevel | null;
  /** How to transform the source: compress (verbatim short), adapt (rewrite in voice), trailer (promise+glimpse+CTA-bait). */
  contentMode: ContentMode;
  /** True until the user changes contentMode manually — lets the auto-suggest update silently. */
  contentModeAuto: boolean;

  // Interactive preview (replaces the old static generatedBlocks)
  previewBlocks: ScriptBlock[] | null;
  previewBusy: BusyState | undefined;
  previewHeader: {
    format?: string;
    durationSec?: number;
    tone?: string[];
    hookStyle?: string;
    language?: string;
    framework?: string;
    rationale?: string;
  };
  /** For video source: cached bytes getter + analysis + meta (for persist). */
  videoPreview: VideoPreviewState | null;
  /** For article source: generated reel meta + content for regen. */
  articlePreview: {
    text: string;
    sourceUrl?: string;
    title?: string;
    generated: GeneratedReel;
  } | null;

  generating: boolean;
  error: string | null;
  profilesPanelOpen: boolean;
}

type WizardAction =
  | { type: 'set-format'; format: WizardFormat }
  | { type: 'set-source'; source: WizardSource }
  | { type: 'set-field'; key: keyof WizardState; value: unknown }
  | { type: 'start-generate' }
  | { type: 'generate-success'; blocks: ScriptBlock[]; header: WizardState['previewHeader']; videoPreview?: VideoPreviewState | null; articlePreview?: WizardState['articlePreview'] }
  | { type: 'set-preview-blocks'; blocks: ScriptBlock[] }
  | { type: 'set-preview-busy'; busy: BusyState | undefined }
  | { type: 'generate-error'; error: string }
  | { type: 'set-profiles'; profileId: string }
  | { type: 'jump-to-config'; source: WizardSource; format: WizardFormat; videoTab?: VideoTab; savedRef?: ReferenceMeta | null }
  | { type: 'back' };

const INITIAL: WizardState = {
  step: 'format',
  format: 'reel',
  source: null,
  extraInstr: '',
  extraOpen: false,
  reelStyle: 'viral',
  reelFramework: 'auto',
  reelDuration: 30,
  slideCount: 5,
  carouselTone: 'educativo',
  topicText: '',
  scriptText: '',
  useHeuristic: false,
  videoTab: 'new',
  videoUrl: '',
  videoFile: null,
  selectedSavedRef: null,
  downloadProgress: null,
  busyMessage: null,
  articleSourceMode: 'url',
  articleUrl: '',
  articleText: '',
  articleTitle: '',
  articleStyle: 'viral',
  articleFramework: 'auto',
  articleDuration: 30,
  articleExtraInstr: '',
  voiceProfileId: null,
  languageOverride: 'auto',
  rewriteOverride: null,
  contentMode: 'adapt',
  contentModeAuto: true,
  previewBlocks: null,
  previewBusy: undefined,
  previewHeader: {},
  videoPreview: null,
  articlePreview: null,
  generating: false,
  error: null,
  profilesPanelOpen: false,
};

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'set-format':
      return { ...state, format: action.format, step: 'source' };
    case 'set-source':
      return { ...state, source: action.source, step: 'config', error: null };
    case 'set-field':
      return { ...state, [action.key]: action.value };
    case 'start-generate':
      return { ...state, step: 'preview', generating: true, previewBlocks: null, error: null };
    case 'generate-success':
      return {
        ...state,
        generating: false,
        previewBlocks: action.blocks,
        previewHeader: action.header,
        videoPreview: action.videoPreview !== undefined ? action.videoPreview : state.videoPreview,
        articlePreview: action.articlePreview !== undefined ? action.articlePreview : state.articlePreview,
        busyMessage: null,
        downloadProgress: null,
      };
    case 'set-preview-blocks':
      return { ...state, previewBlocks: action.blocks };
    case 'set-preview-busy':
      return { ...state, previewBusy: action.busy };
    case 'generate-error':
      return { ...state, generating: false, error: action.error, busyMessage: null };
    case 'set-profiles':
      return { ...state, voiceProfileId: action.profileId, rewriteOverride: null };
    case 'jump-to-config':
      return {
        ...state,
        step: 'config',
        format: action.format,
        source: action.source,
        videoTab: action.videoTab ?? state.videoTab,
        selectedSavedRef: action.savedRef ?? state.selectedSavedRef,
        error: null,
      };
    case 'back':
      if (state.step === 'preview') return { ...state, step: 'config', error: null };
      if (state.step === 'config')  return { ...state, step: 'source', error: null };
      if (state.step === 'source')  return { ...state, step: 'format', error: null };
      return state;
    default:
      return state;
  }
}

// ─── PROPS ────────────────────────────────────────────────────────────────────

interface CreationWizardProps {
  open: boolean;
  existingBlockCount: number;
  /** Skip 'format' step, start at 'source' with this format preselected. */
  initialFormat?: WizardFormat;
  /** Open directly into source 'video' / saved sub-tab, auto-running reanalysis on this ref. */
  initialReanalyzeMeta?: ReferenceMeta;
  /** Hand-off from GuidedWizard: skip 'format' and 'source', land in 'config' with the URL prefilled. */
  initialVideoUrl?: string;
  onClose: () => void;
  onConfirm: (
    blocks: ScriptBlock[],
    format: WizardFormat,
    extras?: {
      languageOverride?: LanguageOption;
      analysis?: VideoAnalysisResult;
      meta?: ReferenceMeta;
      contentPayload?: ContentImportPayload;
    }
  ) => void;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const canGenerate = (ws: WizardState): boolean => {
  if (ws.generating) return false;
  switch (ws.source) {
    case 'topic':   return ws.topicText.trim().length > 3;
    case 'script':  return ws.scriptText.trim().length > 10;
    case 'video':
      if (ws.videoTab === 'saved') return !!ws.selectedSavedRef;
      // 'new' tab: the form button handles its own submit; the footer "Gerar" is disabled.
      return false;
    case 'article':
      return ws.articleSourceMode === 'url'
        ? ws.articleUrl.trim().length > 5
        : ws.articleText.trim().length > 10;
    default: return false;
  }
};

const DURATION_OPTIONS: { value: DurationTarget; label: string }[] = [
  { value: 15, label: '15s' },
  { value: 20, label: '20s' },
  { value: 30, label: '30s' },
  { value: 45, label: '45s' },
  { value: 60, label: '60s' },
];

const buildRegenContext = (
  previous: ScriptBlock[],
  extra: string,
  tone: ToneOption,
  language: LanguageOption,
  contentMode?: ContentMode,
): RegenerateContext => ({
  extraInstructions: extra || undefined,
  toneOverride: tone === 'current' ? undefined : tone,
  languageOverride: language === 'auto' ? undefined : language,
  previousAttempt: previous.map(b => ({ kind: b.kind, text: b.text })),
  contentMode,
});

/** For the FIRST generation (no previous attempt yet) we still want contentMode to flow through. */
const initialContextFor = (contentMode: ContentMode): RegenerateContext | undefined => {
  if (contentMode === 'adapt') return undefined; // default — service legacy path
  return { contentMode };
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export const CreationWizard: React.FC<CreationWizardProps> = ({
  open,
  existingBlockCount,
  initialFormat,
  initialReanalyzeMeta,
  initialVideoUrl,
  onClose,
  onConfirm,
}) => {
  const [ws, dispatch] = useReducer(
    wizardReducer,
    initialReanalyzeMeta
      ? {
          ...INITIAL,
          step: 'config' as const,
          format: 'reel' as const,
          source: 'video' as const,
          videoTab: 'saved' as const,
          selectedSavedRef: initialReanalyzeMeta,
        }
      : initialVideoUrl
        ? {
            ...INITIAL,
            step: 'config' as const,
            format: (initialFormat ?? 'reel') as WizardFormat,
            source: 'video' as const,
            videoTab: 'new' as const,
            videoUrl: initialVideoUrl,
          }
      : initialFormat
        ? { ...INITIAL, format: initialFormat, step: 'source' as const }
        : INITIAL,
  );
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const { refs: libraryRefs, folder: libraryFolder, refresh: refreshLibrary } = useReferenceLibrary();
  /** Guard so we only auto-run re-analyse once per modal open. */
  const initialReanalyzeFired = useRef(false);

  const set = useCallback((key: keyof WizardState, value: unknown) =>
    dispatch({ type: 'set-field', key, value }), []);

  // Load voice profiles on mount.
  const refreshProfiles = useCallback(() => {
    const { profiles, activeId } = ensureProfiles();
    setProfiles(profiles);
    if (!ws.voiceProfileId) {
      dispatch({ type: 'set-profiles', profileId: activeId });
    }
  }, [ws.voiceProfileId]);

  useEffect(() => {
    refreshProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to native download progress events.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void onDownloadProgress(p => set('downloadProgress', p)).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-suggest contentMode based on the current source size — but ONLY while
  // the user hasn't manually changed it (`contentModeAuto` is true). Trailer
  // mode for long-form, adapt for short. Cheap heuristic on word count / file size.
  useEffect(() => {
    if (!ws.contentModeAuto) return;
    let suggested: ContentMode = 'adapt';
    if (ws.source === 'video') {
      // Rough video duration heuristic from file size: ~1MB per 10s at typical mobile bitrates.
      const sizeMb = ws.videoFile ? ws.videoFile.size / 1024 / 1024 : 0;
      const estimatedSec = sizeMb * 10;
      if (estimatedSec > 90) suggested = 'trailer';
    } else if (ws.source === 'article') {
      const wordCount = ws.articleText.trim().split(/\s+/).filter(Boolean).length;
      suggested = suggestContentMode({ kind: 'article', wordCount });
    } else if (ws.source === 'script') {
      const wordCount = ws.scriptText.trim().split(/\s+/).filter(Boolean).length;
      suggested = suggestContentMode({ kind: 'script', wordCount });
    }
    if (suggested !== ws.contentMode) {
      dispatch({ type: 'set-field', key: 'contentMode', value: suggested });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.source, ws.videoFile, ws.articleText, ws.scriptText, ws.contentModeAuto]);

  const activeProfile: VoiceProfile | undefined = profiles.find(p => p.id === ws.voiceProfileId);

  /** Returns a profile clone with rewriteOverride + languageOverride applied. */
  const profileForCall = useCallback((): VoiceProfile | undefined => {
    if (!activeProfile) return undefined;
    return {
      ...activeProfile,
      rewriteLevel: ws.rewriteOverride ?? activeProfile.rewriteLevel,
      outputLanguage: ws.languageOverride === 'auto'
        ? activeProfile.outputLanguage
        : (ws.languageOverride as VoiceProfile['outputLanguage']),
    };
  }, [activeProfile, ws.rewriteOverride, ws.languageOverride]);

  // Word count for source 'script'.
  const scriptWordCount = ws.scriptText.trim().split(/\s+/).filter(Boolean).length;
  const scriptEstimatedSec = scriptWordCount / 2.5;

  // Sources where the VoiceProfileBar is shown.
  const showVoiceBar = ws.format !== 'carousel' && (ws.source === 'script' || ws.source === 'article' || ws.source === 'video');

  // ─── ANALYSIS STATUS MAPPER ─────────────────────────────────────────────

  const onAnalysisStatus = useCallback((s: AnalysisStatus) => {
    if (s.stage === 'uploading') set('busyMessage', `Enviando ${s.megabytes}MB ao Gemini…`);
    else if (s.stage === 'processing-upload') set('busyMessage', 'Gemini processando o vídeo…');
    else if (s.stage === 'analyzing') set('busyMessage', 'Analisando com Gemini…');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── VIDEO HANDLERS ─────────────────────────────────────────────────────

  const handleAnalyseUpload = useCallback(async () => {
    if (!ws.videoFile) return;
    dispatch({ type: 'start-generate' });
    set('busyMessage', 'Salvando na pasta…');
    set('downloadProgress', null);
    try {
      const meta = await saveImportedVideo(ws.videoFile, ws.videoFile.name);
      set('busyMessage', 'Preparando análise…');
      const result = await analyseReferenceBlob(ws.videoFile, profileForCall(), initialContextFor(ws.contentMode), onAnalysisStatus);
      void refreshLibrary();
      const mimeType = ws.videoFile.type || 'video/mp4';
      const bytesGetter = async () => {
        const fresh = await readReferenceBytes(meta.fileName);
        return { bytes: fresh, mimeType };
      };
      dispatch({
        type: 'generate-success',
        blocks: result.blocks,
        header: {
          format: result.format,
          durationSec: result.durationSec,
          tone: result.tone,
          hookStyle: result.hookStyle,
          language: result.language,
        },
        videoPreview: { blocks: result.blocks, analysis: result, meta, bytesGetter },
      });
    } catch (err) {
      dispatch({ type: 'generate-error', error: err instanceof Error ? err.message : 'Falha ao analisar.' });
    }
  }, [ws.videoFile, profileForCall, onAnalysisStatus, refreshLibrary, set]);

  const handleDownloadAndAnalyse = useCallback(async () => {
    if (!ws.videoUrl.trim()) return;
    dispatch({ type: 'start-generate' });
    set('busyMessage', 'Baixando…');
    set('downloadProgress', null);
    try {
      const meta = await downloadVideo(ws.videoUrl.trim());
      set('busyMessage', 'Lendo arquivo…');
      const bytes = await readReferenceBytes(meta.fileName);
      set('busyMessage', 'Preparando análise…');
      const result = await analyseReferenceFromBytes(bytes, 'video/mp4', profileForCall(), initialContextFor(ws.contentMode), onAnalysisStatus);
      void refreshLibrary();
      const bytesGetter = async () => {
        const fresh = await readReferenceBytes(meta.fileName);
        return { bytes: fresh, mimeType: 'video/mp4' };
      };
      dispatch({
        type: 'generate-success',
        blocks: result.blocks,
        header: {
          format: result.format,
          durationSec: result.durationSec,
          tone: result.tone,
          hookStyle: result.hookStyle,
          language: result.language,
        },
        videoPreview: { blocks: result.blocks, analysis: result, meta, bytesGetter },
      });
    } catch (err) {
      dispatch({ type: 'generate-error', error: err instanceof Error ? err.message : 'Falha ao baixar / analisar.' });
    }
  }, [ws.videoUrl, profileForCall, onAnalysisStatus, refreshLibrary, set]);

  const handleReuseSavedRef = useCallback(async (meta: ReferenceMeta) => {
    dispatch({ type: 'start-generate' });
    set('busyMessage', 'Lendo arquivo da pasta…');
    try {
      const bytes = await readReferenceBytes(meta.fileName);
      set('busyMessage', 'Preparando análise…');
      const result = await analyseReferenceFromBytes(bytes, 'video/mp4', profileForCall(), initialContextFor(ws.contentMode), onAnalysisStatus);
      const bytesGetter = async () => {
        const fresh = await readReferenceBytes(meta.fileName);
        return { bytes: fresh, mimeType: 'video/mp4' };
      };
      dispatch({
        type: 'generate-success',
        blocks: result.blocks,
        header: {
          format: result.format,
          durationSec: result.durationSec,
          tone: result.tone,
          hookStyle: result.hookStyle,
          language: result.language,
        },
        videoPreview: { blocks: result.blocks, analysis: result, meta, bytesGetter },
      });
    } catch (err) {
      dispatch({ type: 'generate-error', error: err instanceof Error ? err.message : 'Falha na análise.' });
    }
  }, [profileForCall, onAnalysisStatus, set]);

  const handleDeleteRef = useCallback(async (meta: ReferenceMeta) => {
    try {
      await deleteReference(meta.fileName);
      void refreshLibrary();
    } catch (err) {
      dispatch({ type: 'generate-error', error: err instanceof Error ? err.message : 'Falha ao apagar.' });
    }
  }, [refreshLibrary]);

  // Auto-fire reanalysis when wizard opens with initialReanalyzeMeta.
  useEffect(() => {
    if (!initialReanalyzeMeta) return;
    if (initialReanalyzeFired.current) return;
    if (!activeProfile) return;
    initialReanalyzeFired.current = true;
    void handleReuseSavedRef(initialReanalyzeMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReanalyzeMeta, activeProfile]);

  // ─── MAIN GENERATE (non-video paths) ────────────────────────────────────

  const handleGenerate = useCallback(async () => {
    // Video source uses dedicated handlers (above) — never reach here.
    if (ws.source === 'video') return;

    dispatch({ type: 'start-generate' });
    try {
      let blocks: ScriptBlock[];
      let header: WizardState['previewHeader'] = {};
      let articlePreview: WizardState['articlePreview'] | undefined;

      if (ws.format === 'carousel') {
        let content = '';
        if (ws.source === 'topic')  content = ws.topicText.trim();
        if (ws.source === 'script') content = ws.scriptText.trim();
        if (ws.source === 'article') {
          if (ws.articleSourceMode === 'text' && ws.articleText.trim()) {
            content = ws.articleText.trim();
          } else if (ws.articleUrl.trim()) {
            const fetched = await fetchArticleFromUrl(ws.articleUrl.trim());
            content = fetched.text;
          }
        }
        const result = await generateCarouselScript(content, ws.slideCount, ws.carouselTone);
        blocks = carouselSlidesToBlocks(result.slides);
        header = { format: `${blocks.length} slides`, durationSec: 0 };

      } else {
        // reel
        if (ws.source === 'script') {
          if (ws.useHeuristic) {
            blocks = importScriptHeuristic(ws.scriptText.trim());
          } else {
            blocks = await importScriptWithAI(ws.scriptText.trim(), initialContextFor(ws.contentMode), profileForCall());
          }
          const avatarCount = blocks.filter(b => b.kind === 'avatar').length;
          header = {
            durationSec: blocks.reduce((a, b) => a + ((b.end ?? 0) - (b.start ?? 0)), 0) || scriptEstimatedSec,
            language: ws.languageOverride === 'auto' ? activeProfile?.outputLanguage : ws.languageOverride,
            format: `${blocks.length} blocos · ${avatarCount} avatar / ${blocks.length - avatarCount} B-roll`,
          };

        } else if (ws.source === 'article') {
          let text = ws.articleText.trim();
          let sourceUrl: string | undefined;
          let title: string | undefined = ws.articleTitle.trim() || undefined;
          if (ws.articleSourceMode === 'url') {
            const fetched = await fetchArticleFromUrl(ws.articleUrl.trim());
            text = fetched.text;
            sourceUrl = fetched.sourceUrl;
            title = fetched.title || title;
          }
          const result = await generateReelFromContent(
            { text, sourceUrl, title },
            {
              style: ws.articleStyle,
              framework: ws.articleFramework,
              durationSec: ws.articleDuration,
              extraInstructions: ws.articleExtraInstr || undefined,
              voiceProfile: profileForCall(),
            },
            initialContextFor(ws.contentMode),
          );
          blocks = result.blocks;
          articlePreview = { text, sourceUrl, title, generated: result };
          header = {
            framework: result.frameworkUsed,
            rationale: result.rationale,
            durationSec: result.estimatedDurationSec,
          };

        } else {
          // topic
          const result = await generateReelFromContent(
            { text: ws.topicText.trim() },
            {
              style: ws.reelStyle,
              framework: ws.reelFramework,
              durationSec: ws.reelDuration,
              extraInstructions: ws.extraInstr || undefined,
              voiceProfile: profileForCall(),
            },
            initialContextFor(ws.contentMode),
          );
          blocks = result.blocks;
          header = {
            framework: result.frameworkUsed,
            rationale: result.rationale,
            durationSec: result.estimatedDurationSec,
          };
        }
      }

      if (!blocks || blocks.length === 0) {
        throw new Error('Nenhum bloco gerado. Tente novamente com um tema mais específico.');
      }
      dispatch({ type: 'generate-success', blocks, header, articlePreview });
    } catch (err) {
      console.error('[CreationWizard] handleGenerate error:', err);
      dispatch({ type: 'generate-error', error: err instanceof Error ? err.message : 'Falha ao gerar roteiro.' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, profileForCall, scriptEstimatedSec, activeProfile]);

  // ─── PREVIEW PANEL HANDLERS ────────────────────────────────────────────

  const handleRegenerateAll = async (extra: string, tone: ToneOption, language: LanguageOption) => {
    if (!ws.previewBlocks) return;
    dispatch({ type: 'set-preview-busy', busy: { kind: 'all' } });
    try {
      const regen = buildRegenContext(ws.previewBlocks, extra, tone, language, ws.contentMode);
      const profile = profileForCall();
      const profileWithLang = profile && language !== 'auto'
        ? { ...profile, outputLanguage: language as VoiceProfile['outputLanguage'] }
        : profile;

      if (ws.format === 'carousel') {
        let content = '';
        if (ws.source === 'topic')  content = ws.topicText.trim();
        if (ws.source === 'script') content = ws.scriptText.trim();
        if (ws.source === 'article') content = ws.articleText.trim() || ws.articleUrl.trim();
        const result = await generateCarouselScript(content, ws.slideCount, ws.carouselTone);
        dispatch({ type: 'set-preview-blocks', blocks: carouselSlidesToBlocks(result.slides) });

      } else if (ws.source === 'video' && ws.videoPreview) {
        const { bytes, mimeType } = await ws.videoPreview.bytesGetter();
        const result = await analyseReferenceFromBytes(bytes, mimeType, profileWithLang, regen, onAnalysisStatus);
        dispatch({
          type: 'generate-success',
          blocks: result.blocks,
          header: {
            format: result.format,
            durationSec: result.durationSec,
            tone: result.tone,
            hookStyle: result.hookStyle,
            language: result.language,
          },
          videoPreview: { ...ws.videoPreview, blocks: result.blocks, analysis: result },
        });

      } else if (ws.source === 'script') {
        const blocks = ws.useHeuristic
          ? importScriptHeuristic(ws.scriptText.trim())
          : await importScriptWithAI(ws.scriptText.trim(), regen, profileWithLang);
        dispatch({ type: 'set-preview-blocks', blocks });

      } else if (ws.source === 'article' && ws.articlePreview) {
        const meta = ws.articlePreview;
        const result = await generateReelFromContent(
          { text: meta.text, sourceUrl: meta.sourceUrl, title: meta.title },
          {
            style: ws.articleStyle,
            framework: ws.articleFramework,
            durationSec: ws.articleDuration,
            extraInstructions: extra || ws.articleExtraInstr || undefined,
            voiceProfile: profileWithLang,
          },
          regen,
        );
        dispatch({ type: 'set-preview-blocks', blocks: result.blocks });

      } else if (ws.source === 'topic') {
        const result = await generateReelFromContent(
          { text: ws.topicText.trim() },
          {
            style: ws.reelStyle,
            framework: ws.reelFramework,
            durationSec: ws.reelDuration,
            extraInstructions: extra || ws.extraInstr || undefined,
            voiceProfile: profileWithLang,
          },
          regen,
        );
        dispatch({ type: 'set-preview-blocks', blocks: result.blocks });
      }
    } catch (err) {
      console.error('[CreationWizard] regenerateAll error:', err);
      dispatch({ type: 'generate-error', error: err instanceof Error ? err.message : 'Falha ao regenerar.' });
    } finally {
      dispatch({ type: 'set-preview-busy', busy: undefined });
    }
  };

  const handleRegenerateBlock = async (blockId: string, extra: string, language: LanguageOption) => {
    if (!ws.previewBlocks) return;
    const idx = ws.previewBlocks.findIndex(b => b.id === blockId);
    if (idx < 0) return;
    dispatch({ type: 'set-preview-busy', busy: { kind: 'block', blockId } });
    try {
      const profile = profileForCall();
      const profileWithLang = profile && language !== 'auto'
        ? { ...profile, outputLanguage: language as VoiceProfile['outputLanguage'] }
        : profile;
      const block = ws.previewBlocks[idx];
      const next = await regenerateBlock(
        block,
        { prev: ws.previewBlocks[idx - 1], next: ws.previewBlocks[idx + 1] },
        profileWithLang,
        extra,
      );
      const updated = [...ws.previewBlocks];
      updated[idx] = next;
      dispatch({ type: 'set-preview-blocks', blocks: updated });
    } catch (err) {
      console.error('[CreationWizard] regenerateBlock error:', err);
      dispatch({ type: 'generate-error', error: err instanceof Error ? err.message : 'Falha ao regenerar bloco.' });
    } finally {
      dispatch({ type: 'set-preview-busy', busy: undefined });
    }
  };

  const handleAddBlock = async (kind: BlockKind, prompt: string, language: LanguageOption) => {
    if (!ws.previewBlocks) return;
    dispatch({ type: 'set-preview-busy', busy: { kind: 'add' } });
    try {
      const profile = profileForCall();
      const profileWithLang = profile && language !== 'auto'
        ? { ...profile, outputLanguage: language as VoiceProfile['outputLanguage'] }
        : profile;
      const last = ws.previewBlocks[ws.previewBlocks.length - 1];
      const newBlock = await generateNewBlock(kind, prompt, { prev: last }, profileWithLang);
      dispatch({ type: 'set-preview-blocks', blocks: [...ws.previewBlocks, newBlock] });
    } catch (err) {
      console.error('[CreationWizard] addBlock error:', err);
      dispatch({ type: 'generate-error', error: err instanceof Error ? err.message : 'Falha ao gerar bloco.' });
    } finally {
      dispatch({ type: 'set-preview-busy', busy: undefined });
    }
  };

  // Load .md/.txt for article source.
  const articleFileRef = useRef<HTMLInputElement>(null);
  const handleArticleFile = async (file: File) => {
    try {
      const text = await file.text();
      set('articleText', text);
      if (!ws.articleTitle) {
        const stem = file.name.replace(/\.(md|markdown|txt)$/i, '');
        set('articleTitle', stem);
      }
    } catch (err) {
      dispatch({ type: 'generate-error', error: err instanceof Error ? err.message : 'Falha ao ler arquivo.' });
    }
  };

  if (!open) return null;

  const STEP_LABELS = ['Formato', 'Fonte', 'Configurar', 'Revisar'];
  const stepIndex = (['format', 'source', 'config', 'preview'] as WizardStep[]).indexOf(ws.step);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className={`relative z-10 w-full ${ws.step === 'preview' ? 'max-w-3xl' : 'max-w-xl'} mx-4 bg-[#141416] border border-white/10 rounded-2xl shadow-[0_40px_120px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden max-h-[92vh]`}>

        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-white/5 flex items-center justify-between shrink-0">
          <div>
            <div className="text-sm font-semibold text-zinc-100">Criar conteúdo</div>
            <div className="flex items-center gap-1.5 mt-1">
              {STEP_LABELS.map((label, i) => (
                <React.Fragment key={label}>
                  <span className={`text-[10px] font-medium ${i === stepIndex ? 'text-violet-400' : i < stepIndex ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    {label}
                  </span>
                  {i < STEP_LABELS.length - 1 && (
                    <svg className="w-2.5 h-2.5 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-md bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* ── STEP 1: FORMAT ───────────────────────────────────────── */}
          {ws.step === 'format' && (
            <div className="space-y-3">
              <p className="text-[11px] text-zinc-500">O que você quer criar?</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  {
                    value: 'reel' as WizardFormat,
                    label: 'Reel',
                    sub: 'Vídeo vertical único',
                    icon: (
                      <div className="w-8 h-14 rounded-md border-2 border-violet-400/60 bg-violet-500/10 flex items-center justify-center">
                        <div className="w-3 h-3 rounded-full bg-violet-400/80" />
                      </div>
                    ),
                  },
                  {
                    value: 'carousel' as WizardFormat,
                    label: 'Carrossel',
                    sub: 'Slides individuais · 4:5',
                    icon: (
                      <div className="flex gap-1 items-end">
                        {[14, 12, 10].map((h, i) => (
                          <div key={i} className="w-5 rounded-sm border border-violet-400/60 bg-violet-500/10" style={{ height: `${h * 1.25}px` }} />
                        ))}
                      </div>
                    ),
                  },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => dispatch({ type: 'set-format', format: opt.value })}
                    className="flex flex-col items-center gap-3 p-5 rounded-xl border border-white/10 hover:border-violet-500/50 hover:bg-violet-500/[0.06] transition-all group"
                  >
                    {opt.icon}
                    <div className="text-center">
                      <div className="text-sm font-semibold text-zinc-100 group-hover:text-violet-200">{opt.label}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{opt.sub}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── STEP 2: SOURCE ───────────────────────────────────────── */}
          {ws.step === 'source' && (
            <div className="space-y-3">
              <p className="text-[11px] text-zinc-500">De onde vem o conteúdo?</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { value: 'topic'   as WizardSource, label: 'Tema',         sub: 'Descreva o assunto', emoji: '✏️' },
                  { value: 'script'  as WizardSource, label: 'Roteiro',      sub: 'Cole um roteiro pronto', emoji: '📋' },
                  { value: 'video'   as WizardSource, label: 'Vídeo',        sub: 'Link, upload ou salvos', emoji: '🎬' },
                  { value: 'article' as WizardSource, label: 'Artigo / URL', sub: 'URL ou texto', emoji: '🔗' },
                ]).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => dispatch({ type: 'set-source', source: opt.value })}
                    className="flex items-start gap-3 p-4 rounded-xl border border-white/10 hover:border-violet-500/50 hover:bg-violet-500/[0.06] transition-all text-left group"
                  >
                    <span className="text-xl mt-0.5">{opt.emoji}</span>
                    <div>
                      <div className="text-xs font-semibold text-zinc-100 group-hover:text-violet-200">{opt.label}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{opt.sub}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── STEP 3: CONFIG ───────────────────────────────────────── */}
          {ws.step === 'config' && (
            <div className="space-y-4">

              {/* Voice profile bar — shown for sources that use TTS / rewrite. */}
              {showVoiceBar && activeProfile && (
                <VoiceProfileBar
                  activeProfile={activeProfile}
                  profiles={profiles}
                  languageOverride={ws.languageOverride}
                  rewriteOverride={ws.rewriteOverride}
                  contentMode={ws.contentMode}
                  contentModeAuto={ws.contentModeAuto}
                  disabled={ws.generating}
                  onSelectProfile={(id) => {
                    setActiveProfileId(id);
                    dispatch({ type: 'set-profiles', profileId: id });
                  }}
                  onChangeLanguage={(lang) => set('languageOverride', lang)}
                  onChangeRewrite={(level) => set('rewriteOverride', level)}
                  onChangeContentMode={(mode) => {
                    dispatch({ type: 'set-field', key: 'contentMode', value: mode });
                    dispatch({ type: 'set-field', key: 'contentModeAuto', value: false });
                  }}
                  onEditProfiles={() => set('profilesPanelOpen', true)}
                />
              )}

              {/* ── Source: TOPIC ── */}
              {ws.source === 'topic' && (
                <div>
                  <label className="text-[10px] text-zinc-500 mb-1.5 block">Tema ou assunto</label>
                  <textarea
                    autoFocus
                    value={ws.topicText}
                    onChange={e => set('topicText', e.target.value)}
                    placeholder={ws.format === 'carousel' ? 'Ex: 5 erros que impedem você de perder peso…' : 'Ex: Como usar o Notion para organizar projetos…'}
                    rows={3}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-violet-500/50 transition-colors"
                  />
                </div>
              )}

              {/* ── Source: SCRIPT ── */}
              {ws.source === 'script' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/10">
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!ws.useHeuristic}
                          onChange={e => set('useHeuristic', !e.target.checked)}
                          className="w-3.5 h-3.5 accent-violet-500"
                        />
                        <span className="text-[11px] text-zinc-200">Marcar com IA</span>
                      </label>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 uppercase tracking-wider">Recomendado</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 truncate">
                      {ws.useHeuristic
                        ? 'Divide por parágrafos + palavras-chave.'
                        : 'IA detecta avatar vs B-roll com precisão.'}
                    </span>
                  </div>

                  <label className="text-[10px] text-zinc-500 mb-1.5 block">Cole o roteiro</label>
                  <textarea
                    autoFocus
                    value={ws.scriptText}
                    onChange={e => set('scriptText', e.target.value)}
                    placeholder="Cole aqui o roteiro completo…"
                    rows={6}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-violet-500/50 transition-colors"
                  />
                  {ws.scriptText.trim() && (
                    <div className="text-[10px] text-zinc-500 tabular-nums">
                      {scriptWordCount} palavra{scriptWordCount !== 1 ? 's' : ''} · estimado {scriptEstimatedSec.toFixed(0)}s de áudio
                    </div>
                  )}
                </div>
              )}

              {/* ── Source: VIDEO (sub-tabs Novo / Salvos) ── */}
              {ws.source === 'video' && (
                <div className="space-y-3">
                  {/* Sub-tabs */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => set('videoTab', 'new')}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${ws.videoTab === 'new' ? 'bg-violet-500/20 text-violet-100 border border-violet-400/40' : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-transparent'}`}
                    >
                      Novo
                    </button>
                    <button
                      onClick={() => set('videoTab', 'saved')}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${ws.videoTab === 'saved' ? 'bg-violet-500/20 text-violet-100 border border-violet-400/40' : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-transparent'}`}
                    >
                      Salvos {libraryRefs.length > 0 && <span className="opacity-60">({libraryRefs.length})</span>}
                    </button>
                  </div>

                  {ws.videoTab === 'new' && (
                    <VideoNewSourceForm
                      url={ws.videoUrl}
                      onChangeUrl={(u) => set('videoUrl', u)}
                      pendingFile={ws.videoFile}
                      onSelectFile={(f) => set('videoFile', f)}
                      busyMessage={ws.busyMessage}
                      progress={ws.downloadProgress}
                      error={null}
                      onSubmitUrl={handleDownloadAndAnalyse}
                      onSubmitFile={handleAnalyseUpload}
                    />
                  )}

                  {ws.videoTab === 'saved' && (
                    <VideoLibraryList
                      refs={libraryRefs}
                      folder={libraryFolder}
                      disabled={!!ws.busyMessage}
                      onReanalyze={handleReuseSavedRef}
                      onDelete={handleDeleteRef}
                    />
                  )}

                  {ws.videoUrl && isYouTubeUrl(ws.videoUrl) && (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <span className="text-amber-300 text-[11px] mt-0.5">⚠</span>
                      <p className="text-[10px] text-amber-200">YouTube usa yt-dlp automaticamente — funciona, mas pode demorar mais.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Source: ARTICLE (full form, replaces simple wizard article) ── */}
              {ws.source === 'article' && (
                <div className="space-y-3">
                  {/* Source mode toggle */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => set('articleSourceMode', 'url')}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${ws.articleSourceMode === 'url' ? 'bg-violet-500/20 text-violet-100 border border-violet-400/40' : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-transparent'}`}
                    >
                      🔗 URL
                    </button>
                    <button
                      onClick={() => set('articleSourceMode', 'text')}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors ${ws.articleSourceMode === 'text' ? 'bg-violet-500/20 text-violet-100 border border-violet-400/40' : 'bg-white/5 text-zinc-400 hover:bg-white/10 border border-transparent'}`}
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

                  {ws.articleSourceMode === 'url' ? (
                    <input
                      type="url"
                      value={ws.articleUrl}
                      onChange={e => set('articleUrl', e.target.value)}
                      placeholder="https://exemplo.com/artigo"
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 transition-colors"
                    />
                  ) : (
                    <>
                      <input
                        type="text"
                        value={ws.articleTitle}
                        onChange={e => set('articleTitle', e.target.value)}
                        placeholder="Título (opcional)"
                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 transition-colors"
                      />
                      <textarea
                        value={ws.articleText}
                        onChange={e => set('articleText', e.target.value)}
                        placeholder="Cole o artigo, transcrição de vídeo longo, ou notas. O Gemini reduz pra reel de alta retenção."
                        rows={6}
                        className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2.5 text-[12px] text-zinc-200 placeholder-zinc-600 resize-y focus:outline-none focus:border-violet-500/50 transition-colors"
                      />
                      <div className="text-[10px] text-zinc-600 font-mono text-right">
                        {ws.articleText.length.toLocaleString()} caracteres
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
                          onClick={() => set('articleStyle', s.value)}
                          className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                            ws.articleStyle === s.value
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
                        value={ws.articleFramework}
                        onChange={e => set('articleFramework', e.target.value as Framework)}
                        className="w-full px-2 py-2 rounded-lg bg-black/30 border border-white/10 text-xs text-zinc-100 outline-none focus:border-violet-500/50"
                      >
                        {FRAMEWORK_OPTIONS.map(f => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                      <div className="text-[10px] text-zinc-500 mt-1 leading-snug">
                        {FRAMEWORK_OPTIONS.find(f => f.value === ws.articleFramework)?.hint}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5">Duração alvo</div>
                      <div className="grid grid-cols-5 gap-1">
                        {([15, 20, 30, 45, 60] as DurationTarget[]).map(d => (
                          <button
                            key={d}
                            onClick={() => set('articleDuration', d)}
                            className={`py-2 rounded-md text-[11px] font-mono transition-colors ${
                              ws.articleDuration === d
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

                  <div>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1.5">Instruções extras pro Gemini</div>
                    <textarea
                      value={ws.articleExtraInstr}
                      onChange={e => set('articleExtraInstr', e.target.value)}
                      rows={2}
                      placeholder='Ex: "comece com pergunta provocativa", "termine com convite pra DM".'
                      className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 resize-y focus:outline-none focus:border-violet-500/50 transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* Carousel-specific config (slide count + tone) */}
              {ws.format === 'carousel' && (
                <div className="space-y-3 pt-1 border-t border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-400">Quantidade de slides</span>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => set('slideCount', Math.max(3, ws.slideCount - 1))} className="w-6 h-6 rounded bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold transition-colors flex items-center justify-center">−</button>
                      <span className="w-6 text-center text-[11px] font-mono text-zinc-100">{ws.slideCount}</span>
                      <button onClick={() => set('slideCount', Math.min(15, ws.slideCount + 1))} className="w-6 h-6 rounded bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold transition-colors flex items-center justify-center">+</button>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500 mb-1.5">Tom</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {CAROUSEL_TONE_OPTIONS.map(t => (
                        <button
                          key={t.value}
                          onClick={() => set('carouselTone', t.value)}
                          className={`text-[10px] px-2 py-1.5 rounded-md transition-colors text-left flex items-center gap-1 border ${ws.carouselTone === t.value ? 'bg-violet-500/25 text-violet-200 border-violet-500/40' : 'bg-white/5 text-zinc-400 hover:bg-white/10 border-transparent'}`}
                          title={t.hint}
                        >
                          <span>{t.emoji}</span>
                          <span className="truncate">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Reel topic: style/framework/duration pickers (kept for topic only) */}
              {ws.format === 'reel' && ws.source === 'topic' && (
                <div className="space-y-3 pt-1 border-t border-white/5">
                  <div>
                    <div className="text-[10px] text-zinc-500 mb-1.5">Estilo</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {STYLE_OPTIONS.map(s => (
                        <button
                          key={s.value}
                          onClick={() => set('reelStyle', s.value)}
                          className={`text-[10px] px-2 py-1.5 rounded-md transition-colors text-left flex items-center gap-1 border ${ws.reelStyle === s.value ? 'bg-violet-500/25 text-violet-200 border-violet-500/40' : 'bg-white/5 text-zinc-400 hover:bg-white/10 border-transparent'}`}
                          title={s.hint}
                        >
                          <span>{s.emoji}</span>
                          <span className="truncate">{s.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] text-zinc-500 mb-1.5">Estrutura</div>
                      <select
                        value={ws.reelFramework}
                        onChange={e => set('reelFramework', e.target.value as Framework)}
                        className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-[11px] text-zinc-200 focus:outline-none focus:border-violet-500/50 transition-colors"
                      >
                        {FRAMEWORK_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-500 mb-1.5">Duração alvo</div>
                      <div className="flex gap-1">
                        {DURATION_OPTIONS.map(d => (
                          <button
                            key={d.value}
                            onClick={() => set('reelDuration', d.value)}
                            className={`flex-1 py-1.5 rounded-md text-[9px] font-medium transition-colors border ${ws.reelDuration === d.value ? 'bg-violet-500/25 text-violet-200 border-violet-500/40' : 'bg-white/5 text-zinc-500 hover:bg-white/10 border-transparent'}`}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Topic-only extra instructions */}
              {ws.source === 'topic' && (
                <div className="space-y-2 pt-1 border-t border-white/5">
                  <button
                    onClick={() => set('extraOpen', !ws.extraOpen)}
                    className="w-full text-left text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                  >
                    <svg className={`w-2.5 h-2.5 transition-transform ${ws.extraOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                    Instruções extras
                  </button>
                  {ws.extraOpen && (
                    <textarea
                      value={ws.extraInstr}
                      onChange={e => set('extraInstr', e.target.value)}
                      placeholder="Ex: Foco em iniciantes, evitar jargão técnico…"
                      rows={2}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[11px] text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-violet-500/50 transition-colors"
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 4: PREVIEW (uses ScriptPreviewPanel) ─────────── */}
          {ws.step === 'preview' && (
            <>
              {ws.generating && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-[11px] text-zinc-400">
                    {ws.busyMessage ?? (ws.format === 'carousel' ? `Gerando ${ws.slideCount} slides…` : 'Gerando roteiro…')}
                  </p>
                  {ws.downloadProgress && (
                    <div className="w-full max-w-sm px-3 py-2 rounded-lg bg-black/40 border border-white/5">
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1">
                        <span className="uppercase tracking-wider">{ws.downloadProgress.stage}</span>
                        {ws.downloadProgress.percent !== null && <span className="font-mono">{ws.downloadProgress.percent.toFixed(0)}%</span>}
                      </div>
                      {ws.downloadProgress.percent !== null && (
                        <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-violet-400 to-violet-500 transition-all"
                            style={{ width: `${Math.min(100, Math.max(0, ws.downloadProgress.percent))}%` }}
                          />
                        </div>
                      )}
                      <div className="text-[10px] text-zinc-500 font-mono truncate mt-1">{ws.downloadProgress.message}</div>
                    </div>
                  )}
                </div>
              )}

              {ws.error && !ws.generating && (
                <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <span className="text-red-400 text-sm mt-0.5">⚠</span>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-red-300 mb-0.5">Erro ao gerar</div>
                    <p className="text-[10px] text-red-300/80">{ws.error}</p>
                    {ws.source === 'script' && !ws.useHeuristic && (
                      <button
                        onClick={() => {
                          set('useHeuristic', true);
                          setTimeout(() => handleGenerate(), 0);
                        }}
                        className="mt-2 text-[10px] text-violet-300 hover:text-violet-200 underline"
                      >
                        Importar sem IA (modo heurístico)
                      </button>
                    )}
                  </div>
                </div>
              )}

              {ws.previewBlocks && !ws.generating && (
                <ScriptPreviewPanel
                  mode={ws.source === 'video' ? 'video' : ws.source === 'article' ? 'article' : 'script'}
                  blocks={ws.previewBlocks}
                  detectedHeader={ws.previewHeader}
                  onBlocksChange={(blocks) => dispatch({ type: 'set-preview-blocks', blocks })}
                  onRegenerateAll={handleRegenerateAll}
                  onRegenerateBlock={handleRegenerateBlock}
                  onAddBlock={handleAddBlock}
                  onApprove={(language) => {
                    const extras: Parameters<typeof onConfirm>[2] = {
                      languageOverride: language === 'auto' ? undefined : language,
                    };
                    if (ws.videoPreview) {
                      extras.analysis = ws.videoPreview.analysis;
                      extras.meta = ws.videoPreview.meta;
                    }
                    if (ws.articlePreview) {
                      extras.contentPayload = {
                        caption: ws.articlePreview.generated.caption,
                        hashtags: ws.articlePreview.generated.hashtags,
                        frameworkUsed: ws.articlePreview.generated.frameworkUsed,
                        rationale: ws.articlePreview.generated.rationale,
                        estimatedDurationSec: ws.articlePreview.generated.estimatedDurationSec,
                        sourceTitle: ws.articlePreview.title,
                        sourceUrl: ws.articlePreview.sourceUrl,
                        languageOverride: language === 'auto' ? undefined : language,
                      };
                    }
                    onConfirm(ws.previewBlocks!, ws.format, extras);
                  }}
                  onCancel={() => dispatch({ type: 'back' })}
                  busy={ws.previewBusy}
                  initialLanguage={ws.languageOverride}
                />
              )}
            </>
          )}

        </div>

        {/* Footer */}
        {ws.step !== 'preview' && (
          <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between shrink-0">
            <button
              onClick={() => {
                if (ws.step === 'format') { onClose(); return; }
                dispatch({ type: 'back' });
              }}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
              {ws.step === 'format' ? 'Cancelar' : 'Voltar'}
            </button>

            {ws.step === 'config' && ws.source !== 'video' && (
              <button
                onClick={handleGenerate}
                disabled={!canGenerate(ws)}
                className="px-5 py-2 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-[0_0_20px_rgba(124,58,237,0.4)]"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                Gerar
              </button>
            )}
          </div>
        )}

        {ws.step === 'preview' && existingBlockCount > 0 && ws.previewBlocks && !ws.generating && (
          <div className="px-6 py-2 border-t border-white/5 bg-amber-500/[0.08]">
            <div className="flex items-center gap-2 text-[10px] text-amber-200">
              <span>⚠</span>
              Isso vai substituir {existingBlockCount} bloco{existingBlockCount !== 1 ? 's' : ''} existente{existingBlockCount !== 1 ? 's' : ''}.
            </div>
          </div>
        )}
      </div>

      {ws.profilesPanelOpen && (
        <VoiceProfilesPanel
          onActiveChange={refreshProfiles}
          onClose={() => set('profilesPanelOpen', false)}
        />
      )}
    </div>
  );
};
