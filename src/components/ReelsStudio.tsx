import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { reducer, INITIAL_STATE } from './reelsStudio/reducer';
import { useHistoryReducer } from './reelsStudio/useHistoryReducer';
import { generateProjectAudio, estimateScriptDuration, computePeaks } from './reelsStudio/audioEngine';
import { createTakeFromFile } from './reelsStudio/uploadTake';
import { importWhisperTranscript } from './reelsStudio/transcriptImport';
import { notifyDone } from './reelsStudio/notify';
import { saveAudioBlob, saveClipBlob, saveNamedProject, listNamedProjects, loadNamedProject, deleteNamedProject, renameNamedProject, loadAudioBlob, loadAllClipBlobs, loadAllTakeBlobs, type NamedProjectMeta } from './reelsStudio/persistence';
import { buildStateFromSnapshot } from './reelsStudio/useReelsPersistence';
import { VOICE_OPTIONS, getVoice } from './reelsStudio/voices';
import type { ScriptBlock, ScreenTake } from './reelsStudio/types';
import {
  loadClonedVoices,
  deleteClonedVoice,
  touchClonedVoice,
  type ClonedVoice,
} from '../services/minimaxService';
import { SaveVoiceModal } from './reelsStudio/SaveVoiceModal';
import { ReferencesModal } from './reelsStudio/ReferencesModal';
import { BreakdownDirectModal } from './reelsStudio/BreakdownDirectModal';
import type { PersistedAnalysis } from './reelsStudio/types';
import { ProductionPlanModal } from './reelsStudio/ProductionPlanModal';
import { ClipRescueModal } from './reelsStudio/ClipRescueModal';
import { InspectorPanel } from './reelsStudio/InspectorPanel';
import { LandingScreen } from './reelsStudio/LandingScreen';
import { RecordAudioModal } from './reelsStudio/RecordAudioModal';
import { confirmDialog } from './reelsStudio/confirmService';
import { GuidedWizard, type GuidedExtras } from './reelsStudio/GuidedWizard';
import { MontarBar } from './reelsStudio/MontarBar';
import { MotionPickerModal } from './reelsStudio/MotionPickerModal';
import { AssetPickerModal } from './reelsStudio/AssetPickerModal';
import { MotionLayerOverlay } from './reelsStudio/MotionLayerOverlay';
import { MotionDock } from './reelsStudio/MotionDock';
import { createMotionFromBlock, isMotionAssetsStale, placementOfElement, placementOfMotion, layerOfPlacement, defaultPlacementFor, resolveMotionPlacement, type MotionConfig, type MotionPlacement } from './reelsStudio/motionLibrary';
import { requiresAssetAttachment } from './reelsStudio/motionGating';
import { STYLE_PRESETS, type StylePresetId, findStylePreset } from './reelsStudio/motionStylePresets';
import { isHidden } from './reelsStudio/presetCategory';
import { generateMotionHtml, buildFullHtmlDoc, routeTemplateForBlock, getActiveMotionModel, getMotionModelLabel, MOTION_MODEL_OPTIONS } from '../services/motionService';
import { planMotionsForScript, type DirectorPlanItem } from '../services/motionDirector';
import { OVERLAY_SAFE_TEMPLATE_IDS } from '../services/motionTemplates';
import { generateInstagramCaption } from '../services/captionService';
import { calculateActualCost } from '../services/costPredictor';
import { copyText } from './reelsStudio/clipboard';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { GenerateAvatarsModal } from './reelsStudio/GenerateAvatarsModal';
import { SilenceWarningModal } from './reelsStudio/SilenceWarningModal';
import { ClipPreviewLightbox } from './reelsStudio/ClipPreviewLightbox';
import { useReelsPersistence } from './reelsStudio/useReelsPersistence';
import { useAgentSnapshotPublisher } from './agent/useAgentSnapshotPublisher';
import { useAgentToolBridge } from './agent/useAgentToolBridge';
import { AgentPanel } from './agent/AgentPanel';
import { ScreenRecordingFlow } from './reelsStudio/ScreenRecordingFlow';
import { TakesPanel } from './reelsStudio/TakesPanel';
import { AddBrollModal } from './reelsStudio/AddBrollModal';
import { TakeReviewModal } from './reelsStudio/TakeReviewModal';
import { TakeVideoPlayer } from './reelsStudio/TakeVideoPlayer';
import { ExportRenderModal } from './reelsStudio/ExportRenderModal';
import { SettingsModal } from './SettingsModal';
import { buildCapcutPackage, downloadPackage, openCapcutDraft, revealCapcutFolder } from './reelsStudio/packageBuilder';
import { detectKeepSegments, PRESET_OPTIONS } from './reelsStudio/silenceDetector';
import { cutAudioByKeepSegments } from './reelsStudio/audioCutter';
import { applyLipsyncRule, remapBlocks, remapWords } from './reelsStudio/silenceCutMath';
import { resplitBlocksByDuration, remapWordsToBlocks } from './reelsStudio/scriptResplit';
import { splitLongBlocks } from './reelsStudio/scriptSplitter';
import { getMaxBlockSec } from './agent/agentPrefs';
import { setCutSession, clearCutSession, getCutSession, syncCutSessionBlocks } from './reelsStudio/cutSession';
import { SilenceCutControl } from './reelsStudio/SilenceCutControl';
import { computeLayout, hitTest, projectToSourceTime } from './reelsStudio/timeline';
import { getLayoutSlots, LAYOUT_OPTIONS, defaultAvatarZoom } from './reelsStudio/layouts';
import type { SilencePreset, BlockLayout, BlockTransition, LanguageOption, ReelsState, HeyGenModelChoice, ToneOption, BlockKind } from './reelsStudio/types';
import { ensureProfiles, activeProfileWithSpeechStyle, outputLanguageToTts, type OutputLanguage } from './reelsStudio/voiceProfile';
import { loadUserIdentity } from './reelsStudio/userIdentity';
import { ScriptPreviewPanel, type BusyState } from './reelsStudio/ScriptPreviewPanel';
import { regenerateBlock, generateNewBlock } from '../services/blockGeneratorService';
import { sliceAudioByBlocks } from './reelsStudio/audioSlicer';
import { generateAvatarClips } from './reelsStudio/avatarGenerator';
import { loadAvatarPhotos } from './reelsStudio/avatarPhotosStore';
import { generateMockClip } from './reelsStudio/mockClipGenerator';
import { renderMp4 } from './reelsStudio/mp4Renderer';
import JSZip from 'jszip';
import { CreationWizard } from './reelsStudio/CreationWizard';
import { useTheme } from './reelsStudio/useTheme';

const PRICE_PER_AVATAR_SECOND = 0.058;
// Per-model pricing (used by the single-block regen confirm modal so the user
// sees an accurate cost estimate when choosing a different HeyGen model for
// the retry). Mirrors PRICE_PER_SECOND in GenerateAvatarsModal.tsx — if those
// numbers ever change, update both.
const PRICE_PER_SECOND_BY_MODEL: Record<HeyGenModelChoice, number> = {
  avatar3: 0.030,
  avatar4: 0.058,
  avatar5: 0.058,
};
const PRICE_AUDIO = 0.04;

const formatTime = (s: number): string => {
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

const formatRelativeTime = (ts: number): string => {
  const elapsed = Date.now() - ts;
  if (elapsed < 5_000) return 'agora';
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s atrás`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}min atrás`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h atrás`;
  return `${Math.floor(elapsed / 86_400_000)}d atrás`;
};

export const ReelsStudio: React.FC = () => {
  const [state, dispatch, history] = useHistoryReducer(reducer, INITIAL_STATE);
  const { blocks, audio, selectedVoiceId, aspect, projectName, emotion, voiceSpeed } = state;

  // Keep the Rust MCP server's snapshot in sync so the embedded agent can
  // answer `list_blocks` / `read_block` without a roundtrip back to React.
  useAgentSnapshotPublisher(state, projectName);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  /** Multi-selection. UI-only (not persisted). Shift/Cmd+click adds/ranges. ESC clears. */
  const [multiSelectIds, setMultiSelectIds] = useState<Set<string>>(() => new Set());
  // ESC clears multi-select. Doesn't conflict with other ESC handlers because
  // it only fires when there IS a selection to clear.
  useEffect(() => {
    if (multiSelectIds.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMultiSelectIds(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [multiSelectIds.size]);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);

  const [scriptOpen, setScriptOpen] = useState(true);
  /** True when the "Editar tudo" overlay is open — reopens the ScriptPreviewPanel with current blocks. */
  const [editAllOpen, setEditAllOpen] = useState(false);
  const [editAllBlocks, setEditAllBlocks] = useState<ScriptBlock[]>([]);
  const [editAllBusy, setEditAllBusy] = useState<BusyState | undefined>(undefined);
  const [vibeExpanded, setVibeExpanded] = useState(false);
  const [audioSectionExpanded, setAudioSectionExpanded] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  // 'new' = positive framing ("começar projeto novo"), 'clear' = destructive
  // ("limpar tudo"). Both run the same wipe; only the dialog copy changes.
  const [confirmClearMode, setConfirmClearMode] = useState<'new' | 'clear'>('clear');
  const [clearing, setClearing] = useState(false);
  // "Novo projeto" confirmation when there's existing work — gives the user
  // an explicit save vs delete choice for the current project before opening
  // the guided wizard.
  const [newProjectConfirmOpen, setNewProjectConfirmOpen] = useState(false);
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [clipRescueOpen, setClipRescueOpen] = useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saveVoiceModalOpen, setSaveVoiceModalOpen] = useState(false);
  const [referencesModalOpen, setReferencesModalOpen] = useState(false);
  const [breakdownDirectOpen, setBreakdownDirectOpen] = useState(false);
  const [reanalyzeMeta, setReanalyzeMeta] = useState<import('./reelsStudio/referenceVideoStore').ReferenceMeta | null>(null);
  /**
   * Last per-generation language override set by the preview panel. When set,
   * `handleGenerate` uses it for TTS instead of the active voice profile's language.
   * Cleared whenever blocks change via a normal edit (so it doesn't stick forever).
   */
  const [ttsLanguageOverride, setTtsLanguageOverride] = useState<OutputLanguage | null>(null);
  const [planAnalysis, setPlanAnalysis] = useState<PersistedAnalysis | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [motionPickerBlockId, setMotionPickerBlockId] = useState<string | null>(null);
  const [assetPickerBlockId, setAssetPickerBlockId] = useState<string | null>(null);
  const [motionBusyByBlock, setMotionBusyByBlock] = useState<Record<string, string>>({});
  // Batch progress for the "Gerar todos os motions" run. Surfaced on the
  // toolbar button so the user sees "Bloco 2 de 5" advancing instead of
  // wondering whether the loop hung after the first block finished. Each
  // motion takes ~30s (Gemini + HyperFrames render); without this, the
  // gap between blocks looks like the batch died.
  const [batchMotionProgress, setBatchMotionProgress] = useState<{
    current: number;
    total: number;
    blockId: string;
  } | null>(null);
  // How many files live in the project's assets folder on disk. Used to gate
  // motion generation: when this is > 0, every block must have an explicitly
  // attached asset before generation runs. Refreshed on mount, after the
  // AssetPicker closes (user may have added files), and after "Abrir pasta
  // de assets" (Finder window opened — user often drops files in then).
  const [projectAssetsCount, setProjectAssetsCount] = useState(0);
  // Confirmation gate for per-block avatar regeneration. The timeline button
  // sets this id; clicking "Regerar" in the modal kicks off runRegenerateOneClip
  // and clears it. Costs HeyGen credits — worth a confirm step.
  const [regenAvatarBlockId, setRegenAvatarBlockId] = useState<string | null>(null);
  // Per-regen model override. Initialized lazily to state.avatarModel when the
  // modal opens (see the JSX block). Allows trying a different HeyGen version
  // for a single problematic block without changing the project-wide default.
  const [regenAvatarModel, setRegenAvatarModel] = useState<HeyGenModelChoice | null>(null);
  const [avatarsModalOpen, setAvatarsModalOpen] = useState(false);
  const [generatingClips, setGeneratingClips] = useState(false);
  // When the user clicks "Gerar clipes" but silence is detected and not
  // cut yet, we park the request here and show a confirmation modal so
  // the user can choose: apply-and-go, go-anyway, or cancel. Without
  // this the HeyGen avatar bakes lipsync around silences that the
  // export later strips → desync. See Onda 8 in the plan.
  const [pendingClipGen, setPendingClipGen] = useState<{ photoId: string; model: HeyGenModelChoice } | null>(null);
  // Re-split preview: when the user clicks "Quebrar blocos longos" we
  // compute the new block list, show a confirmation modal (especially
  // important when avatar clips would be discarded), and only then
  // dispatch. Holds the precomputed payload so the modal can show
  // counts without re-running the split.
  const [pendingResplit, setPendingResplit] = useState<null | {
    newBlocks: import('./reelsStudio/types').ScriptBlock[];
    newWords: import('./reelsStudio/types').WordTimestamp[];
    removedIds: string[];
    oldIdToHeadId: Record<string, string>;
    clipsAtRisk: number;
  }>(null);
  // Per-session "I know the risk" flag — once the user accepts to
  // generate without cutting, we don't nag again on this audio.
  const skipSilenceWarningRef = useRef(false);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [addBrollOpen, setAddBrollOpen] = useState(false);
  const [screenRecOpen, setScreenRecOpen] = useState(false);
  const [reviewTakeId, setReviewTakeId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [capcutExportStatus, setCapcutExportStatus] = useState<string | null>(null);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionText, setCaptionText] = useState<string | null>(null);
  const [captionLoading, setCaptionLoading] = useState(false);
  const [captionCopied, setCaptionCopied] = useState(false);
  const capcutLastFolderRef = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'api-keys' | 'voice'>('api-keys');
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [savedProjects, setSavedProjects] = useState<NamedProjectMeta[]>([]);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [carouselExportStatus, setCarouselExportStatus] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardInitialFormat, setWizardInitialFormat] = useState<'reel' | 'carousel' | undefined>(undefined);
  /** When the GuidedWizard detects a video URL and hands off, this carries the
   *  URL straight into CreationWizard so it skips its own source-picker step. */
  const [wizardInitialVideoUrl, setWizardInitialVideoUrl] = useState<string | undefined>(undefined);
  const [carouselPreviewId, setCarouselPreviewId] = useState<string | null>(null);
  // Onboarding routing: show the landing screen on a genuine cold start (no
  // previously-active project in localStorage); returning users skip straight
  // to the editor. The landing renders as an overlay (z-[90]) over the editor,
  // below the app modals (z-[100]).
  const [appView, setAppView] = useState<'landing' | 'editor'>(() => {
    try { return window.localStorage.getItem('reels.activeProjectId') ? 'editor' : 'landing'; }
    catch { return 'landing'; }
  });
  // True when the landing was opened mid-session (via the top-bar "Início"
  // button) — then it's closeable (✕ / Esc) back to the editor. False on the
  // first cold-start welcome, where the user must pick an action.
  const [landingDismissible, setLandingDismissible] = useState(false);
  // The light 3-step guided creation modal (opened from the landing "Novo").
  const [guidedOpen, setGuidedOpen] = useState(false);
  const [recordAudioOpen, setRecordAudioOpen] = useState(false);
  // Populate the saved-project count so the landing "Abrir" card can show it
  // (without opening the full projects modal). Runs once on mount.
  useEffect(() => {
    if (appView === 'landing') {
      listNamedProjects().then(setSavedProjects).catch(() => { /* non-fatal */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag-to-reorder timeline blocks (by id). dragOverIndex = where to drop in
  // the avatar+broll combined sequence. Both null when not dragging.
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragGhostX, setDragGhostX] = useState<number | null>(null);
  // Open a transition popover for the gap between block index N and N+1.
  const [transitionPopoverIdx, setTransitionPopoverIdx] = useState<number | null>(null);

  const handleCapcutExport = async () => {
    if (audio.status !== 'ready') {
      alert('Gere o áudio antes de exportar pra CapCut.');
      return;
    }
    setExportMenuOpen(false);
    setCapcutExportStatus('Iniciando...');
    try {
      // Cut session lives in a module-level singleton (cutSession.ts) so HMR
      // remounts, persistence rehydration, and reducer races can't blank it.
      // The session captures audio + remapped block timings at the moment cuts
      // were applied — but motions/clips generated AFTER that point live only
      // in `state.blocks`. We merge: keep the cut timings (start/end) from the
      // session but pull `motion`/`attachedAsset` from current state by id.
      const session = getCutSession();
      type SessionBlocks = NonNullable<ReturnType<typeof getCutSession>>['blocks'];
      let cutOverride: { audioBlob: Blob; blocks: SessionBlocks; duration: number } | undefined;
      if (session) {
        const stateBlockById = new Map(blocks.map(b => [b.id, b]));
        const mergedBlocks = session.blocks.map(sb => {
          const current = stateBlockById.get(sb.id);
          if (!current) return sb;
          // Keep cut-remapped timings from the session, but inherit motion +
          // attached asset (and any other live edits like text) from state.
          return {
            ...current,
            start: sb.start,
            end: sb.end,
          };
        });
        cutOverride = { audioBlob: session.audioBlob, blocks: mergedBlocks, duration: session.duration };
      }
      const motionsCount = cutOverride ? cutOverride.blocks.filter(b => b.motion?.status === 'ready').length : blocks.filter(b => b.motion?.status === 'ready').length;
      console.log('[capcut-export] cutOverride present?', !!cutOverride, 'cutDur=', session?.duration ?? null, '· readyMotions=', motionsCount);
      const result = await openCapcutDraft(state, (p) => setCapcutExportStatus(p.message), cutOverride);
      setCapcutExportStatus('✓ Projeto pronto no CapCut · veja em "Recentes"');
      // Stash media folder so the fallback UI can reveal it if needed.
      capcutLastFolderRef.current = result.mediaPath;
      setTimeout(() => setCapcutExportStatus(null), 5000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao exportar';
      console.error('[reels/capcut-export]', err);
      const isCapCutMissing = /CapCut não encontrado|Pasta de projetos do CapCut/i.test(msg);
      if (isCapCutMissing && capcutLastFolderRef.current) {
        try {
          await revealCapcutFolder(capcutLastFolderRef.current);
          setCapcutExportStatus('⚠ CapCut não encontrado · pasta aberta');
        } catch {
          setCapcutExportStatus(`⚠ ${msg}`);
        }
      } else {
        setCapcutExportStatus(`⚠ ${msg}`);
      }
      setTimeout(() => setCapcutExportStatus(null), 6000);
    }
  };

  // Web-only fallback: download the zip bundle (when running outside Tauri or
  // when the user explicitly wants the offline package).
  const handleCapcutDownloadZip = async () => {
    if (audio.status !== 'ready') {
      alert('Gere o áudio antes de exportar pra CapCut.');
      return;
    }
    setExportMenuOpen(false);
    setCapcutExportStatus('Iniciando...');
    try {
      const pkg = await buildCapcutPackage(state, (p) => setCapcutExportStatus(p.message));
      downloadPackage(pkg);
      setCapcutExportStatus(`✓ Baixado · ${(pkg.size / 1024 / 1024).toFixed(1)}MB`);
      setTimeout(() => setCapcutExportStatus(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao exportar';
      console.error('[reels/capcut-export-zip]', err);
      setCapcutExportStatus(`⚠ ${msg}`);
      setTimeout(() => setCapcutExportStatus(null), 6000);
    }
  };

  const handleCarouselExport = async () => {
    if (blocks.length === 0) { alert('Adicione blocos antes de exportar o carrossel.'); return; }
    setExportMenuOpen(false);
    setCarouselExportStatus('Preparando...');
    try {
      // Resolve audio blob — same priority order as ExportRenderModal.
      const { getCutSession } = await import('./reelsStudio/cutSession');
      const cutSession = getCutSession();
      const { loadAudioBlob } = await import('./reelsStudio/persistence');
      let audioBlob: Blob | null = null;
      if (cutSession) {
        audioBlob = cutSession.audioBlob;
      } else if (state.audio.url) {
        try { audioBlob = await fetch(state.audio.url).then(r => r.blob()); } catch { /* fall through */ }
      }
      if (!audioBlob) audioBlob = await loadAudioBlob();
      if (!audioBlob && state.audio.url) {
        try { audioBlob = await fetch(state.audio.url).then(r => r.blob()); } catch { /* ignore */ }
      }

      const effectiveBlocks = cutSession ? cutSession.blocks : state.blocks;
      const activeTake = state.takes.find(t => t.id === state.activeTakeId) ?? null;

      // Pre-slice audio into per-block WAV blobs using the existing audioSlicer utility.
      let audioSlices: import('./reelsStudio/audioSlicer').AudioSlice[] = [];
      if (audioBlob) {
        try {
          const { sliceAudioByBlocks: sliceAudio } = await import('./reelsStudio/audioSlicer');
          audioSlices = await sliceAudio(
            audioBlob,
            effectiveBlocks.map(b => ({ blockId: b.id, start: b.start, end: b.end })),
          );
        } catch { /* render without per-block audio if slice fails */ }
      }

      const zip = new JSZip();
      const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');

      const arrayBufferToBase64 = (buf: Uint8Array): string => {
        let binary = '';
        for (let b = 0; b < buf.length; b++) binary += String.fromCharCode(buf[b]);
        return btoa(binary);
      };
      const CHUNK = 1024 * 1024;

      const writeFile = async (path: string, blob: Blob) => {
        await tauriInvoke('truncate_file', { targetPath: path });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        for (let off = 0; off < bytes.length; off += CHUNK) {
          await tauriInvoke('append_chunk_to_file', { targetPath: path, base64Chunk: arrayBufferToBase64(bytes.subarray(off, Math.min(bytes.length, off + CHUNK))) });
        }
      };

      for (let i = 0; i < effectiveBlocks.length; i++) {
        const block = effectiveBlocks[i];
        const blockDuration = block.end - block.start;
        if (blockDuration <= 0) continue;

        setCarouselExportStatus(`Renderizando slide ${i + 1}/${effectiveBlocks.length}...`);

        // Remap block to start at 0 for the renderer.
        const singleBlock = { ...block, start: 0, end: blockDuration };
        const blockAudioBlob = audioSlices.find(s => s.blockId === block.id)?.blob ?? audioBlob;

        const handle = renderMp4(
          {
            blocks: [singleBlock],
            avatarClips: state.avatarClips,
            activeTake,
            audioBlob: blockAudioBlob ?? new Blob(),
            duration: blockDuration,
            aspect: 'carousel',
            quality: 'high',
            videoOnly: true,
          },
          () => {},
        );
        const silentBlob = await handle.promise;

        const slideNum = String(i + 1).padStart(2, '0');
        const tmpBase = `/tmp/carousel_${Date.now()}_s${i}`;
        const videoPath = `${tmpBase}_video.mp4`;
        const audioPath = `${tmpBase}_audio.wav`;
        const outputPath = `${tmpBase}_final.mp4`;

        await writeFile(videoPath, silentBlob);

        if (blockAudioBlob) {
          await writeFile(audioPath, blockAudioBlob);
          await tauriInvoke('mux_video_audio_ffmpeg', { videoPath, audioPath, outputPath });
          const muxedBytes: number[] = await tauriInvoke('read_reference_bytes', { referencePath: outputPath });
          zip.file(`slide_${slideNum}.mp4`, new Uint8Array(muxedBytes));
        } else {
          zip.file(`slide_${slideNum}.mp4`, silentBlob);
        }
      }

      setCarouselExportStatus('Comprimindo zip...');
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${state.projectName || 'carrossel'}_slides.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setCarouselExportStatus(`✓ ${effectiveBlocks.length} slides baixados`);
      setTimeout(() => setCarouselExportStatus(null), 5000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao exportar carrossel';
      console.error('[reels/carousel-export]', err);
      setCarouselExportStatus(`⚠ ${msg}`);
      setTimeout(() => setCarouselExportStatus(null), 8000);
    }
  };

  const handleNewTake = (take: ScreenTake) => {
    dispatch({ type: 'add-take', take });
    // Auto-open the review modal so the user can trim + cut silence right away.
    setReviewTakeId(take.id);
  };

  const { hydrated, savedAt, saving, clearProject } = useReelsPersistence({ state, dispatch });

  const handleOpenProjects = async () => {
    const list = await listNamedProjects();
    setSavedProjects(list);
    setProjectsOpen(true);
  };

  /** Revoke all object URLs currently held by the in-memory state so the next project starts clean. */
  const revokeStateUrls = (s: ReelsState) => {
    try { if (s.audio.url?.startsWith('blob:')) URL.revokeObjectURL(s.audio.url); } catch { /* ignore */ }
    for (const c of Object.values(s.avatarClips)) {
      try { if (c.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(c.videoUrl); } catch { /* ignore */ }
    }
    for (const t of s.takes) {
      try { if (t.url?.startsWith('blob:')) URL.revokeObjectURL(t.url); } catch { /* ignore */ }
    }
  };

  const handleLoadNamedProject = async (id: string) => {
    if (id === state.activeProjectId) {
      setProjectsOpen(false);
      return;
    }
    setLoadingProjectId(id);
    try {
      const data = await loadNamedProject(id);
      if (!data) { alert('Projeto não encontrado.'); return; }
      const { snapshot, audioBlob } = data;

      const clipBlobs = await loadAllClipBlobs();
      const takeBlobs = await loadAllTakeBlobs();
      const restoredState = await buildStateFromSnapshot(snapshot, id, audioBlob, clipBlobs, takeBlobs);

      revokeStateUrls(state);
      // Cross-project bleed prevention: STORE_AUDIO and the cutSession singleton
      // are project-agnostic. If we leave them as-is, silence cut / export on the
      // newly-opened project will keep reading the previous project's audio.
      audioBlobRef.current = audioBlob;
      clearCutSession();
      if (audioBlob) {
        // Sync STORE_AUDIO['current'] to this project's audio so any caller
        // that still uses loadAudioBlob() (e.g. ExportRenderModal) gets the right one.
        try { await saveAudioBlob(audioBlob); } catch { /* non-fatal */ }
      } else {
        try { const { clearAudioBlob } = await import('./reelsStudio/persistence'); await clearAudioBlob(); } catch { /* non-fatal */ }
      }
      try { window.localStorage.setItem('reels.activeProjectId', id); } catch { /* ignore */ }
      dispatch({ type: 'hydrate', state: restoredState });
      setProjectsOpen(false);
      setAppView('editor');
    } catch (err) {
      console.error('[reels/load-named]', err);
      alert('Erro ao abrir projeto: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoadingProjectId(null);
    }
  };

  // ─── "Editar vídeo pronto" — upload → extract audio → Whisper → blocks ──
  const editVideoInputRef = useRef<HTMLInputElement | null>(null);
  const editVideoProcessingRef = useRef(false);
  const [editVideoStatus, setEditVideoStatus] = useState<string | null>(null);
  // Selected overlay element (edit-video) for highlight in the elements panel.
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  // Overlay generation state — driven by the Motion Dock (unified surface).
  const [editDockValue, setEditDockValue] = useState<import('./reelsStudio/MotionDock').MotionDockValue>({
    visual: 'auto',
    placement: { area: 'float', y: 0.58, height: 0.22, startOffsetSec: 0 },
  });
  const [overlayGenerating, setOverlayGenerating] = useState(false);
  const [overlayBusy, setOverlayBusy] = useState<Record<string, string>>({});
  // Batch cancellation flags — checked between iterations: the in-flight
  // generation finishes, the loop just doesn't start the next block.
  const overlayCancelRef = useRef(false);
  const batchMotionCancelRef = useRef(false);

  /**
   * Generate motion overlays for the given transcript blocks using the Motion
   * Dock's current visual + placement. 'auto' visual routes each block through
   * the LLM template router (overlay-safe catalog when floating); a concrete
   * preset id applies to every target. Same unified pipeline as creation.
   */
  const handleGenerateOverlays = async (
    targets: ScriptBlock[],
    visual: 'auto' | StylePresetId,
    placement: MotionPlacement,
  ) => {
    if (targets.length === 0) return;
    setOverlayGenerating(true);
    overlayCancelRef.current = false;
    const colorMode = state.motionColorMode ?? 'dark';

    // Per-fala role: a block marked 🖥️ B-roll forces full-frame — the motion
    // IS the content during that segment. 🎥 Vídeo blocks use the block's own
    // saved setup ("marcar pra gerar") when present, else the Dock's current
    // placement.
    const placementForBlock = (block: ScriptBlock): MotionPlacement =>
      block.kind === 'broll'
        ? { area: 'full', startOffsetSec: 0, durationSec: block.end - block.start }
        : (block.motionSetup?.placement ?? placement);
    const visualForBlock = (block: ScriptBlock): 'auto' | StylePresetId =>
      block.motionSetup?.visual ?? visual;

    // ── Scene director (same workflow as creation): ONE planning call over
    // the video's transcription — visual per speech segment. In edit mode
    // coverage is CONTINUOUS: every fala is covered start-to-end (outside a
    // motion there's only raw footage = ugly gap); dynamism comes from beats
    // INSIDE the motion, anchored at the words.
    let ovPlan = new Map<string, DirectorPlanItem>();
    if (visual === 'auto' && targets.length > 1) {
      try {
        ovPlan = await planMotionsForScript({
          scriptText: targets.map(t => t.text).join('\n'),
          blocks: targets.map(t => ({
            id: t.id,
            // Real per-fala role: 'broll' → full-frame + templates allowed;
            // 'avatar' (🎥 Vídeo) → freeform art over the person.
            kind: t.kind,
            text: t.text,
            startSec: t.start,
            durationSec: t.end - t.start,
            words: state.audio.words.length > 0
              ? state.audio.words
                  .filter(w => w.blockId === t.id)
                  .map(w => ({ word: w.word, start: Math.max(0, w.start - t.start), end: Math.max(0, w.end - t.start) }))
                  .filter(w => w.end > w.start)
              : undefined,
          })),
          continuousCoverage: true,
          outputLanguage: state.audio.words.length > 0 ? 'pt-BR' : undefined,
        });
        console.log('[overlay/director] plano:', ovPlan.size, 'falas planejadas de', targets.length);
      } catch (e) { console.warn('[overlay/director] planejamento pulado:', e); }
    }

    for (const block of targets) {
      if (overlayCancelRef.current) {
        console.log('[overlay-gen] cancelado pelo usuário — parando antes do próximo bloco');
        break;
      }
      const elId = `ovmot_${block.id}`;
      const blockDur = block.end - block.start;
      const plan = ovPlan.get(block.id);
      const blockPlacement = placementForBlock(block);
      const isFloat = blockPlacement.area === 'float';
      // Legacy mode kept in sync for old-renderer compatibility.
      const legacyMode = blockPlacement.area === 'full' ? 'fullscreen'
        : blockPlacement.area === 'top-half' ? 'split-top'
        : blockPlacement.area === 'bottom-half' ? 'split-bottom'
        : 'overlay';
      // CONTINUOUS COVERAGE: the element spans the whole fala — no window,
      // no gap of raw footage. The motion's internal beats provide change.
      const effectiveDur = blockDur;
      const elPlacement: MotionPlacement = { ...blockPlacement, startOffsetSec: 0, durationSec: effectiveDur };
      // Block-local word timestamps → beats synced to the speech ("something
      // changes every 2-4s"). Creation always passed these; edit was missing
      // them, which is why edit overlays felt static.
      const blockWords = state.audio.words.length > 0
        ? state.audio.words
            .filter(w => w.blockId === block.id)
            .map(w => ({ word: w.word, start: Math.max(0, w.start - block.start), end: Math.max(0, w.end - block.start) }))
            .filter(w => w.end > w.start)
        : undefined;
      try {
        // Resolve the visual per block: setup salvo → director plan → router.
        const blockVisual = visualForBlock(block);
        let presetId: StylePresetId = blockVisual === 'auto' ? 'bold-pop' : blockVisual;
        let templateVars: Record<string, string> | undefined;
        if (blockVisual === 'auto' && plan) {
          if (plan.templateId) {
            presetId = plan.templateId as StylePresetId;
            templateVars = plan.variables;
            console.log('[overlay/director] template:', plan.templateId, '·', plan.rationale);
          } else if (plan.styleHint) {
            presetId = plan.styleHint as StylePresetId;
            console.log('[overlay/director] estilo:', plan.styleHint, '·', plan.rationale);
          }
        } else if (blockVisual === 'auto') {
          setOverlayBusy(prev => ({ ...prev, [elId]: 'Escolhendo template…' }));
          try {
            const route = await routeTemplateForBlock({
              blockText: block.text,
              durationSec: effectiveDur,
              overlayContext: blockPlacement.area !== 'full',
            });
            if (route) {
              presetId = route.templateId as StylePresetId;
              templateVars = route.vars;
              console.log('[overlay/router] template hit:', route.templateId, '·', route.rationale);
            }
          } catch (e) { console.warn('[overlay/router] routing skipped:', e); }
        }
        setOverlayBusy(prev => ({ ...prev, [elId]: 'Gerando…' }));
        // Remove existing overlay for this block if any, then placeholder.
        if ((state.overlayElements ?? []).some(e => e.id === elId)) {
          dispatch({ type: 'remove-overlay-element', id: elId });
        }
        dispatch({ type: 'add-overlay-element', element: {
          id: elId, kind: 'motion', text: block.text.slice(0, 60),
          startSec: block.start, durationSec: effectiveDur,
          mode: legacyMode, y: blockPlacement.y ?? 0.58, overlayH: blockPlacement.height ?? 0.22,
          placement: elPlacement,
        } });
        const result = await generateMotionHtml({
          presetId,
          templateVars,
          blockText: block.text,
          durationSec: effectiveDur,
          compositionId: elId,
          motionLayer: layerOfPlacement(blockPlacement),
          overlayMode: isFloat,
          motionColorMode: colorMode,
          wordTimestamps: blockWords,
          existingBrand: state.brandIdentity as Parameters<typeof generateMotionHtml>[0]['existingBrand'],
          outputLanguage: state.audio.words.length > 0 ? 'pt-BR' : undefined,
        });
        const motion: MotionConfig = {
          id: elId,
          presetId,
          layer: layerOfPlacement(blockPlacement),
          placement: elPlacement,
          intent: block.text.slice(0, 120),
          text: result.text ?? block.text.slice(0, 60),
          durationSec: effectiveDur,
          html: (result as unknown as { htmlBody?: string }).htmlBody ?? '',
          status: 'rendering',
          createdAt: Date.now(),
          canvasAspect: '9:16',
          // Float compositor blend: dark→screen, light→multiply.
          authoredMode: colorMode,
          modelUsed: result.modelUsed,
        };
        const fullHtml = buildFullHtmlDoc(motion, '9:16', colorMode);
        await invoke('save_motion_html', { motionId: elId, html: fullHtml });
        setOverlayBusy(prev => ({ ...prev, [elId]: 'Renderizando…' }));
        const rendered = await invoke<{ mp4_path: string; size_bytes: number }>('render_motion', { motionId: elId });
        motion.videoPath = rendered.mp4_path;
        motion.status = 'ready';
        motion.renderedAt = Date.now();
        dispatch({ type: 'set-overlay-motion', id: elId, motion });
        // Setup consumido — limpa a marca 🏷 do bloco.
        if (block.motionSetup) dispatch({ type: 'set-block-motion-setup', id: block.id, setup: null });
        setOverlayBusy(prev => { const n = { ...prev }; delete n[elId]; return n; });
      } catch (err) {
        console.error('[overlay-gen] failed for block', block.id, err);
        setOverlayBusy(prev => ({ ...prev, [elId]: '❌ Erro' }));
      }
    }
    setOverlayGenerating(false);
  };

  // Live progress from the Rust pipeline (ffmpeg + whisper stderr). Subscribe
  // once; only reflect messages while a process is actually running.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ stage: string; message: string }>('transcription://progress', (e) => {
        if (editVideoProcessingRef.current) setEditVideoStatus(e.payload.message || 'Processando…');
      }).then(fn => { unlisten = fn; });
    });
    return () => { if (unlisten) unlisten(); };
  }, []);

  /**
   * Motion Dock section for the RIGHT panel (Script column) — the single home
   * of motion configuration in BOTH modes, exactly like the approved mockup
   * (preview stays big in the center; the dock lives in the right column).
   *
   * Creation: operates on the selected block via the auto pipeline.
   * Edit-video: operates on the selected speech segment via overlays, and
   * includes the generated-elements list below the dock.
   */
  const renderMotionDockSection = (b: ScriptBlock) => {
    const isEdit = state.projectMode === 'edit';
    const busyMsg = isEdit
      ? (overlayGenerating ? 'Gerando…' : null)
      : (motionBusyByBlock[b.id] ?? null);
    const isBusy = !!busyMsg || (isEdit && overlayGenerating);
    const requiresAsset = isEdit ? false : requiresAssetAttachment(b, projectAssetsCount);
    const blockDur = Math.max(1, b.end - b.start);
    const m = b.motion;
    const statusLabel = busyMsg
      ? busyMsg
      : requiresAsset ? '⚠ Anexe um asset antes de gerar'
      : isEdit ? ''
      : !m ? 'Sem motion · pronto pra gerar'
      : m.status === 'ready' ? 'Motion pronto'
      : m.status === 'generating' ? 'Gerando…'
      : m.status === 'rendering' ? 'Renderizando…'
      : m.status === 'error' ? 'Erro · veja no avançado'
      : 'Rascunho';

    // Same default the generation pipeline resolves (defaultPlacementFor) —
    // what the Dock shows selected IS what generates. In edit mode, a fala
    // marked 🖥️ B-roll forces full-frame (the motion IS the content during
    // that segment) — same product rule as creation b-roll.
    const dockValue = isEdit
      ? (b.kind === 'broll'
          ? { visual: editDockValue.visual, placement: { area: 'full' as const, startOffsetSec: 0, durationSec: blockDur } }
          : editDockValue)
      : {
          visual: (b.stylePresetOverride as StylePresetId | undefined) ?? 'auto' as const,
          placement: (b.kind === 'broll'
            ? defaultPlacementFor('broll', state.projectMode, blockDur)
            : m?.placement ?? (m ? placementOfMotion(m) : defaultPlacementFor(b.kind, state.projectMode, blockDur))),
        };

    // Placement choices by context (product rule): a b-roll block's motion IS
    // the content → full only (the ② step hides entirely) — in BOTH modes.
    // Avatar/Vídeo blocks get the full set.
    const allowedAreas: MotionPlacement['area'][] = b.kind === 'broll'
      ? ['full']
      : ['float', 'top-half', 'bottom-half', 'full'];

    const autoTargets = isEdit
      ? blocks.filter(x => (x.end - x.start) >= 1.0)
      : blocks.filter(x => !x.motion?.html && !requiresAssetAttachment(x, projectAssetsCount));

    return (
      <div className="mx-0 my-2 rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.09)', backgroundColor: 'rgba(0,0,0,0.25)' }}>
        {/* Status line: label + model picker */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] uppercase tracking-[0.15em] font-bold text-zinc-500 shrink-0">Motion</span>
          <span className="text-[10px] truncate" style={{ color: requiresAsset ? 'rgb(252,211,77)' : 'rgba(161,161,170,0.9)' }}>
            {statusLabel}
          </span>
          {!isEdit && m?.html && (
            <span
              className="shrink-0 text-[8.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-semibold"
              style={{ backgroundColor: 'rgba(16,185,129,0.15)', color: 'rgb(110,231,183)', border: '1px solid rgba(16,185,129,0.35)' }}
            >{getMotionModelLabel(m.modelUsed)}</span>
          )}
          {!isEdit && (
            <select
              value={b.motionModelOverride ?? ''}
              onChange={e => dispatch({ type: 'set-block-motion-model', id: b.id, model: e.target.value || undefined })}
              className="ml-auto shrink-0 bg-transparent text-[9.5px] px-1 py-0.5 rounded outline-none"
              style={{ color: b.motionModelOverride ? '#60A5FA' : 'rgba(113,113,122,1)', border: `1px solid ${b.motionModelOverride ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.09)'}` }}
              title="Modelo de IA deste bloco"
            >
              <option value="">🤖 {getActiveMotionModel().label} (global)</option>
              {MOTION_MODEL_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>🤖 {opt.label}</option>
              ))}
            </select>
          )}
        </div>

        <MotionDock
          layout="vertical"
          value={dockValue}
          onChange={v => {
            if (isEdit) {
              setEditDockValue(v);
              // Live-apply position + timing to this segment's EXISTING
              // overlay: floatShiftY is a pure compositor translate and the
              // window is element gating — both update instantly, no regen.
              // Area/visual changes only affect the next generation (the
              // art is baked into the MP4 for those).
              const elId = `ovmot_${b.id}`;
              const existingEl = (state.overlayElements ?? []).find(e => e.id === elId);
              if (existingEl) {
                const off = v.placement.startOffsetSec ?? 0;
                const dur = Math.max(1, Math.min(v.placement.durationSec ?? blockDur, blockDur - off));
                dispatch({ type: 'update-overlay-element', id: elId, patch: {
                  startSec: b.start + off,
                  durationSec: dur,
                  placement: {
                    ...(existingEl.placement ?? v.placement),
                    floatShiftY: v.placement.floatShiftY,
                    scrimAlpha: v.placement.scrimAlpha,
                    scrimSpread: v.placement.scrimSpread,
                    startOffsetSec: 0,
                    durationSec: dur,
                  },
                } });
              }
              return;
            }
            const nextVisual = v.visual === 'auto' ? undefined : v.visual;
            if (nextVisual !== b.stylePresetOverride) dispatch({ type: 'set-block-style-preset', id: b.id, preset: nextVisual });
            const existing = b.motion;
            const draft = existing ?? createMotionFromBlock(b);
            dispatch({ type: 'set-block-motion', id: b.id, motion: { ...draft, placement: v.placement } });
          }}
          segmentDurationSec={blockDur}
          motionColorMode={state.motionColorMode ?? (state.appTheme === 'light' ? 'light' : 'dark')}
          onSetMotionColorMode={(mode) => dispatch({ type: 'set-motion-color-mode', mode })}
          allowedAreas={allowedAreas}
          overlayContext={isEdit && editDockValue.placement.area === 'float'}
          overlaySafeIds={isEdit ? OVERLAY_SAFE_TEMPLATE_IDS : undefined}
          onGenerate={() => {
            if (isEdit) { void handleGenerateOverlays([b], editDockValue.visual, editDockValue.placement); return; }
            if (requiresAsset) { setAssetPickerBlockId(b.id); return; }
            void handleAutoMotion(b.id);
          }}
          generateLabel={isEdit
            ? '✨ Gerar pra esta fala'
            : requiresAsset ? '📎 Anexar asset'
            : m?.status === 'ready' ? '↻ Regerar motion' : '✨ Gerar motion'}
          busy={isBusy}
          secondaryAction={isEdit ? {
            label: `⚡ Gerar TODOS automaticamente (${autoTargets.length} falas)`,
            onClick: () => void handleGenerateOverlays(autoTargets, 'auto', editDockValue.placement),
            disabled: autoTargets.length === 0,
          } : autoTargets.length > 1 ? {
            label: `⚡ Gerar TODOS os blocos (${autoTargets.length})`,
            onClick: () => void handleAutoMotionMany(autoTargets.map(x => x.id)),
            disabled: autoTargets.length === 0,
          } : undefined}
          onOpenAdvanced={isEdit ? undefined : () => setMotionPickerBlockId(b.id)}
        />

        {/* Edit mode: "marcar pra gerar" — configura cada fala (placement/visual
            do Dock) sem gastar nada, depois UM clique gera todas as marcadas. */}
        {isEdit && (() => {
          const isMarked = !!b.motionSetup;
          const markedBlocks = blocks.filter(x => x.motionSetup);
          return (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => dispatch({
                  type: 'set-block-motion-setup',
                  id: b.id,
                  setup: isMarked ? null : { placement: dockValue.placement, visual: dockValue.visual },
                })}
                className="px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors"
                style={isMarked
                  ? { backgroundColor: 'rgba(251,191,36,0.15)', color: '#fcd34d', border: '1px solid rgba(251,191,36,0.45)' }
                  : { backgroundColor: 'transparent', color: 'rgba(161,161,170,1)', border: '1px solid rgba(255,255,255,0.12)' }}
                title={isMarked
                  ? 'Marcada com a config salva. Clique pra desmarcar (pra atualizar a config, desmarque e marque de novo).'
                  : 'Salva a config atual do Dock nesta fala pra gerar depois em lote'}
              >
                {isMarked ? '🏷 Marcada ✓' : '🏷 Marcar pra gerar'}
              </button>
              {markedBlocks.length > 0 && (
                <button
                  onClick={() => { if (!overlayGenerating) void handleGenerateOverlays(markedBlocks, 'auto', editDockValue.placement); }}
                  disabled={overlayGenerating}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(180deg, #fbbf24, #d97706)' }}
                  title="Gera só as falas marcadas, cada uma com a config salva nela"
                >
                  ⚡ Gerar marcadas ({markedBlocks.length})
                </button>
              )}
            </div>
          );
        })()}

        {/* Edit mode: generated overlays list lives right below the dock */}
        {isEdit && (state.overlayElements ?? []).length > 0 && (
          <div className="mt-2 pt-2 flex flex-col gap-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.09)' }}>
            <span className="text-[9px] uppercase tracking-[0.15em] font-bold text-zinc-500">Gerados · {(state.overlayElements ?? []).length}</span>
            {(state.overlayElements ?? []).map(el => {
              const busy = overlayBusy[el.id];
              const isMotion = el.kind === 'motion';
              const elPlacement = isMotion ? placementOfElement(el) : null;
              const areaLabel = elPlacement
                ? (elPlacement.area === 'float' ? '▭ Flutuar'
                  : elPlacement.area === 'top-half' ? '◱ Metade ↑'
                  : elPlacement.area === 'bottom-half' ? '◰ Metade ↓'
                  : '▣ Tela cheia')
                : null;
              return (
                <div key={el.id} className="rounded-lg px-2 py-1.5 flex items-center gap-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <span className="text-[10px] text-zinc-500">{isMotion ? '🎬' : '📝'}</span>
                  <span className="flex-1 text-[10.5px] truncate text-zinc-300">
                    {busy ? <span className="animate-pulse">{busy}</span>
                      : el.motion?.status === 'ready' ? '✅ ' + (el.text.slice(0, 26) || 'motion')
                      : el.text.slice(0, 26) || 'motion'}
                  </span>
                  {areaLabel && (
                    <span className="shrink-0 text-[8.5px] px-1.5 py-0.5 rounded font-semibold" style={{ backgroundColor: 'rgba(96,165,250,0.12)', color: '#93c5fd' }}>{areaLabel}</span>
                  )}
                  <button
                    onClick={() => dispatch({ type: 'remove-overlay-element', id: el.id })}
                    className="shrink-0 px-1 rounded text-[10px]" style={{ color: '#f87171' }} title="Remover"
                  >✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const handleEditVideo = () => editVideoInputRef.current?.click();

  const processEditVideo = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      alert('Selecione um arquivo de vídeo (MP4, MOV ou WebM).');
      return;
    }
    editVideoProcessingRef.current = true;
    setEditVideoStatus('Preparando o vídeo…');
    try {
      // Base take (IndexedDB blob URL — drives preview + export visuals).
      const { take } = await createTakeFromFile(file);
      // Persist the video to disk so the Rust pipeline can read it.
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const ref = await invoke<{ absolute_path: string }>('save_imported_video', {
        bytes, originalName: file.name,
      });

      setEditVideoStatus('Extraindo áudio…');
      // Two extractions: 16kHz mono for Whisper (its native rate) and a
      // 44.1kHz stereo master for playback/export — using the Whisper wav as
      // the master is what made playback sound muffled (telephone band).
      const [wavPath, hqResult] = await Promise.all([
        invoke<string>('extract_audio', { videoPath: ref.absolute_path }),
        invoke<string>('extract_audio_playback', { videoPath: ref.absolute_path })
          .catch((e: unknown) => { console.warn('[reels/edit-video] extração HQ falhou — usando 16k:', e); return null; }),
      ]);

      setEditVideoStatus('Transcrevendo com Whisper… (1ª vez baixa o modelo)');
      const json = await invoke<string>('transcribe_whisper', { audioPath: wavPath });

      // Falas nascem como 'avatar' ("🎥 Vídeo"): a footage é a pessoa falando,
      // motions flutuam por cima. Toggle pra 'broll' = motion tela cheia.
      const { blocks, words } = importWhisperTranscript(json, { defaultKind: 'avatar' });
      if (blocks.length === 0) throw new Error('Não encontrei fala transcrita no vídeo.');

      // Master audio: the HQ wav (fallback: whisper wav) → peaks + playable URL + export blob.
      setEditVideoStatus('Montando a timeline…');
      const audioUrl = convertFileSrc(hqResult ?? wavPath);
      const arr = await (await fetch(audioUrl)).arrayBuffer();
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(arr.slice(0));
      const peaks = computePeaks(buf);
      const duration = buf.duration;
      ctx.close();
      // Keep export happy — it reads the audio blob from this ref / IndexedDB.
      const audioBlob = new Blob([arr], { type: 'audio/wav' });
      audioBlobRef.current = audioBlob;
      try { await saveAudioBlob(audioBlob); } catch { /* non-fatal */ }

      // Fresh project, then load the edit payload.
      revokeStateUrls(state);
      clearCutSession();
      try { window.localStorage.removeItem('reels.activeProjectId'); } catch { /* ignore */ }
      dispatch({ type: 'hydrate', state: { ...INITIAL_STATE, projectName: `Edição · ${file.name.replace(/\.[^.]+$/, '')}`, activeProjectId: null } });
      dispatch({ type: 'edit-video-loaded', baseVideoTake: take, blocks, audioUrl, duration, peaks, words });
      setAppView('editor');
    } catch (e) {
      console.error('[reels/edit-video]', e);
      alert('Erro ao processar o vídeo: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      editVideoProcessingRef.current = false;
      setEditVideoStatus(null);
    }
  };

  /**
   * "Começar com meu áudio": recorded/uploaded voice → Whisper transcript →
   * blocks with real timing → creation project whose avatars will lip-sync
   * THIS audio. Mirrors processEditVideo minus the base video.
   */
  const processCreateFromAudio = async (blob: Blob, fileName: string) => {
    editVideoProcessingRef.current = true;
    setEditVideoStatus('Salvando o áudio…');
    try {
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      // save_imported_video é um gravador de bytes genérico — serve pra áudio.
      const ref = await invoke<{ absolute_path: string }>('save_imported_video', {
        bytes, originalName: fileName,
      });

      setEditVideoStatus('Preparando o áudio…');
      // ffmpeg lê qualquer container de áudio: 16k mono pro Whisper + 44.1k pro playback.
      const [wavPath, hqResult] = await Promise.all([
        invoke<string>('extract_audio', { videoPath: ref.absolute_path }),
        invoke<string>('extract_audio_playback', { videoPath: ref.absolute_path })
          .catch((e: unknown) => { console.warn('[reels/audio-import] extração HQ falhou — usando 16k:', e); return null; }),
      ]);

      setEditVideoStatus('Transcrevendo com Whisper… (1ª vez baixa o modelo)');
      const json = await invoke<string>('transcribe_whisper', { audioPath: wavPath });
      const { blocks, words } = importWhisperTranscript(json, { defaultKind: 'avatar' });
      if (blocks.length === 0) throw new Error('Não encontrei fala no áudio.');

      setEditVideoStatus('Montando a timeline…');
      const audioUrl = convertFileSrc(hqResult ?? wavPath);
      const arr = await (await fetch(audioUrl)).arrayBuffer();
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(arr.slice(0));
      const peaks = computePeaks(buf);
      const duration = buf.duration;
      ctx.close();
      // sliceAudioByBlocks/export leem o master daqui.
      const audioBlob = new Blob([arr], { type: 'audio/wav' });
      audioBlobRef.current = audioBlob;
      try { await saveAudioBlob(audioBlob); } catch { /* non-fatal */ }

      revokeStateUrls(state);
      clearCutSession();
      try { window.localStorage.removeItem('reels.activeProjectId'); } catch { /* ignore */ }
      dispatch({ type: 'hydrate', state: { ...INITIAL_STATE, projectName: `Voz · ${fileName.replace(/\.[^.]+$/, '')}`, activeProjectId: null } });
      dispatch({ type: 'audio-project-loaded', blocks, audioUrl, duration, peaks, words });
      setRecordAudioOpen(false);
      setAppView('editor');
    } catch (e) {
      console.error('[reels/audio-import]', e);
      alert('Erro ao processar o áudio: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      editVideoProcessingRef.current = false;
      setEditVideoStatus(null);
    }
  };

  /** Creates a fresh empty project and switches to it immediately, in-place (no reload). */
  const handleNewProject = async () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${pad(now.getDate())}/${pad(now.getMonth() + 1)} ${pad(now.getHours())}h${pad(now.getMinutes())}`;
    const newName = `Reel · ${stamp}`;

    revokeStateUrls(state);
    // Reset all cross-project audio carriers — same reasoning as handleLoadNamedProject.
    audioBlobRef.current = null;
    clearCutSession();
    try { const { clearAudioBlob } = await import('./reelsStudio/persistence'); await clearAudioBlob(); } catch { /* non-fatal */ }
    // Start from INITIAL_STATE so all transient flags reset; auto-save will create the named entry.
    const empty: ReelsState = { ...INITIAL_STATE, projectName: newName, activeProjectId: null };
    try { window.localStorage.removeItem('reels.activeProjectId'); } catch { /* ignore */ }
    dispatch({ type: 'hydrate', state: empty });

    // Refresh the modal list if it's open.
    if (projectsOpen) {
      const list = await listNamedProjects();
      setSavedProjects(list);
    }
  };

  const handleDeleteNamedProject = async (id: string) => {
    console.log('[projects/delete] iniciando · id=', id, '· ativo=', id === state.activeProjectId);
    try {
      const wasActive = id === state.activeProjectId;
      // ORDER MATTERS: when deleting the ACTIVE project, switch away FIRST.
      // The debounced auto-save (120ms) writes the CURRENT state under its
      // activeProjectId — deleting first and switching after left a window
      // where the auto-save resurrected the just-deleted record ("clico em
      // excluir e nada acontece": the project reappeared in the list).
      if (wasActive) {
        const list = (await listNamedProjects()).filter(p => p.id !== id);
        if (list.length > 0) {
          console.log('[projects/delete] projeto ativo — trocando para', list[0].id, 'antes de apagar');
          await handleLoadNamedProject(list[0].id);
        } else {
          console.log('[projects/delete] projeto ativo e único — criando novo antes de apagar');
          await handleNewProject();
        }
      }
      await deleteNamedProject(id);
      setSavedProjects(prev => prev.filter(p => p.id !== id));
      console.log('[projects/delete] apagado · id=', id);
      // Tombstone: if a stale debounced save (scheduled while the old state
      // was still mounted) lands after the delete, remove the record again.
      setTimeout(() => { void deleteNamedProject(id).catch(() => {}); }, 600);
    } catch (err) {
      console.error('[projects/delete] falhou:', err);
      alert('Erro ao excluir projeto: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleRenameNamedProject = async (id: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    await renameNamedProject(id, trimmed);
    setSavedProjects(prev => prev.map(p => p.id === id ? { ...p, name: trimmed } : p));
    if (id === state.activeProjectId) {
      dispatch({ type: 'set-name', name: trimmed });
    }
  };

  const activeTake = state.takes.find(t => t.id === state.activeTakeId) ?? null;

  // ─── Auto-detect silences when audio is ready or preset changes ────
  // Guard against multiple in-flight detections via a ref (state can lag).
  // Token-based concurrency control. Every detection run gets a fresh
  // token; only the latest token is allowed to dispatch its result.
  // Earlier runs that are still mid-async become no-ops when they
  // notice the token has moved on. No shared mutable `lock` flag, so
  // there's no cross-run interference.
  const detectionTokenRef = useRef(0);

  useEffect(() => {
    if (state.audio.status !== 'ready' || !state.audio.url) return;
    if (state.audio.keepSegments.length > 0) return; // already detected
    const myToken = ++detectionTokenRef.current;
    const preset = state.audio.silencePreset;
    console.log('[reels/silence] effect run · preset=', preset, '· token=', myToken);

    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const isCurrent = () => detectionTokenRef.current === myToken;

    (async () => {
      console.log('[reels/silence] STARTING detection · preset=', preset, '· token=', myToken);
      dispatch({ type: 'audio-silence-detect-start' });
      watchdog = setTimeout(() => {
        if (!isCurrent()) return;
        console.warn('[reels/silence] timeout 20s — token', myToken);
        dispatch({ type: 'audio-silence-detect-done', keepSegments: [], detectedSilenceSec: 0 });
      }, 20_000);
      try {
        const { loadAudioBlob } = await import('./reelsStudio/persistence');
        const blob = await loadAudioBlob();
        if (!isCurrent()) return;
        if (!blob) throw new Error('Blob original não encontrado em IndexedDB');
        console.log('[reels/silence] blob size=', (blob.size / 1024).toFixed(1), 'KB · token=', myToken);
        const opts = PRESET_OPTIONS[preset];
        const result = await detectKeepSegments(blob, opts);
        if (!isCurrent()) {
          console.log('[reels/silence] stale token, skipping dispatch', myToken);
          return;
        }
        console.log('[reels/silence] result · keep=', result.keep.length, '· silent=', result.totalSilent.toFixed(2), 's');
        if (watchdog) clearTimeout(watchdog);
        dispatch({ type: 'audio-silence-detect-done', keepSegments: result.keep, detectedSilenceSec: result.totalSilent });
      } catch (err) {
        console.error('[reels/silence] FAILED:', err);
        if (watchdog) clearTimeout(watchdog);
        if (isCurrent()) {
          dispatch({ type: 'audio-silence-detect-done', keepSegments: [], detectedSilenceSec: 0 });
        }
      }
    })();

    return () => {
      // Bumping the token here makes this run "stale" — the async loop
      // observes that and exits cleanly without dispatching anything,
      // even when the cleanup races with the in-flight detection.
      if (watchdog) clearTimeout(watchdog);
      detectionTokenRef.current++;
    };
  }, [state.audio.status, state.audio.url, state.audio.silencePreset, state.audio.keepSegments.length, state.audio.duration]);

  // ─── Apply / revert silence cuts to the actual audio + blocks ─────
  // When silenceCut goes ON (with detected segments) → re-encode the MP3
  // through the worker, remap block/word timestamps, and swap state to the
  // compressed timeline. When it goes OFF → restore the pristine blob from
  // IndexedDB and restore the snapshotted blocks.
  // The lipsync rule (250ms tolerance inside ready avatar clips) is applied
  // before the worker runs, so the audio cut and the block remap stay in sync.
  const applyingLockRef = useRef(false);
  // Tracks the keepSegments that were used for the currently-applied cut.
  // When state.audio.keepSegments differs from this (e.g. user switched preset),
  // we revert + re-apply.
  const appliedKeepRef = useRef<{ start: number; end: number }[] | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const a = state.audio;
    console.log('[reels/cut] effect run · status=', a.status,
      '· silenceCut=', a.silenceCut,
      '· keepCount=', a.keepSegments.length,
      '· cutsApplied=', a.cutsApplied,
      '· applyingCuts=', a.applyingCuts,
      '· detecting=', a.detectingSilence,
      '· locked=', applyingLockRef.current);
    if (a.status !== 'ready') return;
    if (a.detectingSilence) return;
    // Trust the local ref over the state flag — the state flag can persist
    // across crashes (and hidration doesn't always clear it depending on
    // ordering). If the ref says we're not actively applying, we shouldn't
    // be blocked by a stale state flag.
    if (applyingLockRef.current) return;
    // If state thinks we're applying but the ref disagrees, that's a stale
    // flag. Clear it now and re-run the effect on the next dispatch.
    if (a.applyingCuts) {
      console.warn('[reels/cut] stale applyingCuts=true detected, clearing');
      dispatch({ type: 'audio-cuts-cancel' });
      return;
    }

    const wantCut = a.silenceCut && a.keepSegments.length > 0;

    // Detect "segments changed while cuts applied" by comparing the segments
    // we last applied with the segments now in state. If they differ (because
    // the user switched presets, or detection re-ran), revert + re-apply.
    // We treat a missing `appliedKeepRef` as "always changed" so the case
    // where the ref got cleared by a preset reset is handled correctly.
    const segsChanged = (() => {
      if (!a.cutsApplied) return false;
      if (a.keepSegments.length === 0) return false; // handled by Case 2 (revert)
      const prev = appliedKeepRef.current;
      if (!prev) return true; // unknown applied set → safer to revert and re-apply
      if (prev.length !== a.keepSegments.length) return true;
      for (let i = 0; i < prev.length; i++) {
        if (Math.abs(prev[i].start - a.keepSegments[i].start) > 0.001) return true;
        if (Math.abs(prev[i].end - a.keepSegments[i].end) > 0.001) return true;
      }
      return false;
    })();

    if (segsChanged) {
      console.log('[reels/cut] segs changed → reverting to allow re-apply');
      // Revert silently — the next render will re-enter this effect with
      // cutsApplied=false and apply the new segments fresh.
      applyingLockRef.current = true;
      (async () => {
        try {
          const { loadAudioBlob } = await import('./reelsStudio/persistence');
          const sourceBlob = await loadAudioBlob();
          if (sourceBlob) {
            const url = URL.createObjectURL(sourceBlob);
            dispatch({ type: 'audio-cuts-revert', url });
            appliedKeepRef.current = null;
            clearCutSession();
          }
        } finally {
          applyingLockRef.current = false;
        }
      })();
      return;
    }

    // Case 1: cut is ON, but state is still on original → apply cuts.
    if (wantCut && !a.cutsApplied) {
      console.log('[reels/cut] Case 1 · APPLYING cuts');
      applyingLockRef.current = true;
      let cancelled = false;
      (async () => {
        dispatch({ type: 'audio-cuts-applying' });
        try {
          console.log('[reels/cut] loading source blob from IDB...');
          const { loadAudioBlob } = await import('./reelsStudio/persistence');
          const sourceBlob = await loadAudioBlob();
          if (!sourceBlob) throw new Error('Áudio original não encontrado');
          console.log('[reels/cut] source blob loaded, size=', sourceBlob.size);

          // Hybrid lipsync rule: preserve silences ≥250ms that fall inside
          // ready avatar clips so the boca/áudio stay in sync there.
          const protectedKeep = applyLipsyncRule(
            a.keepSegments,
            a.duration,
            state.blocks,
            state.avatarClips,
          );
          console.log('[reels/cut] protected keep segments:', protectedKeep);

          // The original blocks/words are what we'll snapshot before remap.
          const originalBlocks = state.blocks;
          const originalWords = a.words;
          const originalDuration = a.duration;
          const originalPeaks = a.peaks;

          console.log('[reels/cut] calling cutAudioByKeepSegments...');
          const { blob: cutBlob, duration: cutDuration, peaks: cutPeaks } =
            await cutAudioByKeepSegments(sourceBlob, protectedKeep);
          console.log('[reels/cut] cut done · newDuration=', cutDuration, 'newSize=', cutBlob.size);
          // Don't bail on `cancelled` here — once we've paid for the encode,
          // we always want to land the result. The effect re-running just
          // means deps changed; the next dispatch will reconcile state.

          const url = URL.createObjectURL(cutBlob);
          const remappedBlocks = remapBlocks(originalBlocks, protectedKeep);
          const remappedWords = remapWords(originalWords, protectedKeep);

          dispatch({
            type: 'audio-cuts-apply-done',
            url,
            duration: cutDuration,
            peaks: cutPeaks,
            words: remappedWords,
            blocks: remappedBlocks,
            originalBlocks,
            originalWords,
            originalDuration,
            originalPeaks,
          });
          // Track the ORIGINAL detected segments (not `protectedKeep`).
          // `applyLipsyncRule` may add extra ranges to preserve speech rhythm
          // inside avatar blocks, so `protectedKeep.length` ≠ `keepSegments.length`.
          // If we stored the expanded set, the next effect run would always
          // see `segsChanged=true` (length mismatch) and trigger a revert
          // → re-detect → re-apply loop that flashes the timeline.
          appliedKeepRef.current = a.keepSegments.map(k => ({ ...k }));
          // Module-level singleton — survives HMR remounts and reducer races
          // that would blank a useRef on the component instance.
          setCutSession({ audioBlob: cutBlob, blocks: remappedBlocks, duration: cutDuration });
          console.log('[reels/cut] cut session set · blob.size=', cutBlob.size, '· blocks=', remappedBlocks.length, '· duration=', cutDuration);
        } catch (err) {
          console.error('[reels/cut] apply failed:', err);
          // Always clear the in-flight flag so the spinner stops; also turn
          // the toggle off so the user gets a clean slate (otherwise the
          // detect→apply cycle would loop forever on the same broken inputs).
          dispatch({ type: 'audio-cuts-cancel' });
          dispatch({ type: 'audio-silence-toggle', on: false });
        } finally {
          applyingLockRef.current = false;
        }
      })();
      return () => { cancelled = true; };
    }

    // Case 2: cut is OFF (or no segments), but state has cuts applied → revert.
    if (!wantCut && a.cutsApplied) {
      applyingLockRef.current = true;
      (async () => {
        try {
          const { loadAudioBlob } = await import('./reelsStudio/persistence');
          const sourceBlob = await loadAudioBlob();
          if (!sourceBlob) throw new Error('Áudio original não encontrado');
          const url = URL.createObjectURL(sourceBlob);
          dispatch({ type: 'audio-cuts-revert', url });
          appliedKeepRef.current = null;
          clearCutSession();
        } catch (err) {
          console.error('[reels/cut] revert failed:', err);
        } finally {
          applyingLockRef.current = false;
        }
      })();
    }

    // Case 3: cut is ON and already applied, but preset changed (keepSegments
    // changed) → re-apply with the new segments. The detection effect already
    // resets cutsApplied implicitly by emitting fresh keepSegments; but we
    // need to re-run apply when the new segments arrive.
    // Detection clears keepSegments first, then fills them in — so when
    // length transitions from 0 → N while cutsApplied is still true from a
    // previous run, we need to re-apply. We do that by also reverting first
    // when the active set of segments differs from what's currently applied.
    // For MVP we keep it simple: changing preset turns toggle off-then-on.
    // The detection-done dispatch already produces fresh segments; this
    // effect reacts to (cutsApplied=true && keepSegments=[freshly-different])
    // by checking duration: if blocks state still references the old segs,
    // we'd need to revert+re-apply. Skipped for v1 — user can toggle.

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    state.audio.status,
    state.audio.silenceCut,
    state.audio.cutsApplied,
    // Use a stable serialised key for keepSegments so the effect only re-fires
    // when the segments actually change in value, not just in reference identity.
    // Removing applyingCuts from deps prevents the self-triggering loop where
    // dispatching audio-cuts-applying (inside the effect) immediately re-runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(state.audio.keepSegments),
    state.audio.detectingSilence,
  ]);

  // Effective duration after silence cut.
  // When cutsApplied is true the audio's `duration` is *already* the compressed
  // duration, so we just use it as-is. The skip-based "compress on the fly"
  // path (cutOn) only kicks in when we have detected segments but haven't
  // applied them yet (legacy preview, kept for the brief window between
  // detect-done and apply-done).
  const audioEffectiveDuration = state.audio.cutsApplied
    ? state.audio.duration
    : state.audio.silenceCut && state.audio.keepSegments.length > 0
      ? state.audio.keepSegments.reduce((s, k) => s + (k.end - k.start), 0)
      : state.audio.duration;

  // cutOn means "show a compressed view via re-mapping" — once cuts have been
  // physically applied, the timeline IS the compressed view, so cutOn is false
  // and the waveform/playhead use plain identity.
  const cutOn = !state.audio.cutsApplied
    && state.audio.silenceCut
    && state.audio.keepSegments.length > 0;
  const cutSegments = state.audio.keepSegments;
  const sourceToEffective = useCallback((sec: number): number => {
    if (!cutOn) return sec;
    let acc = 0;
    for (const k of cutSegments) {
      if (sec <= k.start) return acc;
      if (sec < k.end) return acc + (sec - k.start);
      acc += k.end - k.start;
    }
    return acc;
  }, [cutOn, cutSegments]);
  const effectiveToSource = useCallback((sec: number): number => {
    if (!cutOn) return sec;
    let remaining = sec;
    for (const k of cutSegments) {
      const segLen = k.end - k.start;
      if (remaining <= segLen) return k.start + remaining;
      remaining -= segLen;
    }
    // Past the end → return last segment's end.
    return cutSegments.length > 0 ? cutSegments[cutSegments.length - 1].end : sec;
  }, [cutOn, cutSegments]);

  // Force re-render every 30s so the relative "saved X ago" label stays fresh.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const [clonedVoices, setClonedVoices] = useState<ClonedVoice[]>(() => loadClonedVoices());
  const refreshClonedVoices = useCallback(() => setClonedVoices(loadClonedVoices()), []);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewZoomHudVisible, setPreviewZoomHudVisible] = useState(false);
  // 👁 layer isolation: temporarily hide the AI motion layers in the preview
  // to see what's underneath (avatar/footage). Local-only, never affects
  // export — answers "o que é motion e o que é o avatar/vídeo?".
  const [motionLayerHidden, setMotionLayerHidden] = useState(false);
  const previewZoomHudTimer = useRef<number | null>(null);
  const flashPreviewZoomHud = useCallback(() => {
    setPreviewZoomHudVisible(true);
    if (previewZoomHudTimer.current) window.clearTimeout(previewZoomHudTimer.current);
    previewZoomHudTimer.current = window.setTimeout(() => setPreviewZoomHudVisible(false), 1400);
  }, []);
  const bumpPreviewZoom = useCallback((factor: number) => {
    setPreviewZoom(z => {
      const next = Math.max(0.5, Math.min(4, +(z * factor).toFixed(3)));
      return next;
    });
    flashPreviewZoomHud();
  }, [flashPreviewZoomHud]);
  const resetPreviewZoom = useCallback(() => {
    setPreviewZoom(1);
    flashPreviewZoomHud();
  }, [flashPreviewZoomHud]);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  // Holds the cut audio blob whenever cuts are applied. Independent of
  // state.audio.cutsApplied so race conditions in re-renders / HMR don't
  // make the export pick up the wrong blob. Cleared on revert.
  // Cut session state moved to module-level (cutSession.ts) so HMR can't blank it.
  // Restore audioBlobRef from IndexedDB after hydration so export works without regenerating audio.
  useEffect(() => {
    if (!hydrated || audioBlobRef.current) return;
    import('./reelsStudio/persistence').then(({ loadAudioBlob }) => {
      loadAudioBlob().then(blob => { if (blob) audioBlobRef.current = blob; }).catch(() => {});
    });
  }, [hydrated]);
  const rafRef = useRef<number | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  // Edit-video mode: the full-frame base video that chases the master audio.
  const baseVideoRef = useRef<HTMLVideoElement | null>(null);
  // Refs that the playback tick reads — kept up-to-date via effect below.
  const silenceCutRef = useRef<boolean>(false);
  const keepSegmentsRef = useRef<{ start: number; end: number }[]>([]);
  const layoutRef = useRef<ReturnType<typeof computeLayout>>({ slots: [], totalDuration: 0 });
  const totalDurationRef = useRef<number>(0);

  // Compute the effective timeline layout (blocks + ripple-edit offsets).
  const layout = useMemo(() => computeLayout(blocks), [blocks]);
  const baseDuration = audio.status === 'ready' ? audio.duration : Math.max(estimateScriptDuration(blocks), 1);
  // totalDuration accounts for offsets; falls back to baseDuration if there's no layout yet.
  const totalDuration = Math.max(layout.totalDuration, baseDuration > 0 ? baseDuration : 1);
  // Visual denominator for the timeline. When silence cut is on, the timeline
  // is compressed: gaps disappear and blocks slide together.
  const viewDuration = cutOn ? audioEffectiveDuration : totalDuration;
  // Left/width helpers: take a source-time second and return the % position
  // on the visible (compressed-when-cut) timeline.
  const viewPct = useCallback((sec: number): number => {
    const v = sourceToEffective(sec);
    return (v / Math.max(viewDuration, 0.0001)) * 100;
  }, [sourceToEffective, viewDuration]);
  const slotById = useMemo(() => {
    const m = new Map<string, typeof layout.slots[number]>();
    for (const s of layout.slots) m.set(s.blockId, s);
    return m;
  }, [layout]);

  // (Trim handles foram removidos — agora avatarVisibleSec é controlado pelo slider no Script card.)
  const avatarSeconds = useMemo(
    () => blocks.filter(b => b.kind === 'avatar').reduce((sum, b) => {
      const blockLen = b.end - b.start;
      return sum + Math.min(b.avatarVisibleSec ?? blockLen, blockLen);
    }, 0),
    [blocks],
  );
  const estimatedAudioCost = PRICE_AUDIO;
  const estimatedAvatarCost = avatarSeconds * PRICE_PER_AVATAR_SECOND;
  const estimatedTotalCost = estimatedAudioCost + estimatedAvatarCost;
  const hasDirtyBlocks = useMemo(() => blocks.some(b => b.dirty), [blocks]);
  const showCostBreakdown = audio.status !== 'ready' || hasDirtyBlocks;

  const geminiMotionCost = useMemo(() => {
    return blocks.reduce((sum, b) => sum + (b.motion?.actualCostUSD ?? 0), 0);
  }, [blocks]);

  const geminiAnalysisCost = useMemo(() => {
    let cost = state.lastAnalysis?.actualCostUSD ?? 0;
    cost += state.analyses.reduce((sum, a) => sum + (a.actualCostUSD ?? 0), 0);
    return cost;
  }, [state.lastAnalysis, state.analyses]);

  const totalGeminiCost = geminiMotionCost + geminiAnalysisCost;

  const wordsByBlock = useMemo(() => {
    const m = new Map<string, typeof audio.words>();
    for (const w of audio.words) {
      const arr = m.get(w.blockId) ?? [];
      arr.push(w);
      m.set(w.blockId, arr);
    }
    return m;
  }, [audio.words]);

  const isClonedVoice = useCallback(
    (id: string) => clonedVoices.some(v => v.voiceId === id),
    [clonedVoices],
  );

  const selectedVoiceLabel = useMemo(() => {
    const cloned = clonedVoices.find(v => v.voiceId === selectedVoiceId);
    if (cloned) return { label: cloned.name, hint: 'Sua voz · clonada', isCustom: true };
    const def = getVoice(selectedVoiceId);
    return { label: def.label, hint: def.hint, isCustom: false };
  }, [clonedVoices, selectedVoiceId]);

  const handleGenerate = useCallback(async () => {
    setConfirmOpen(false);
    dispatch({ type: 'audio-start' });
    try {
      // Per-generation override (set by preview panel) wins over the active
      // voice profile's outputLanguage.
      const { profiles, activeId } = ensureProfiles();
      const profile = profiles.find(p => p.id === activeId) ?? profiles[0];
      const effectiveLang: OutputLanguage | undefined = ttsLanguageOverride ?? profile?.outputLanguage;
      const result = await generateProjectAudio(blocks, selectedVoiceId, {
        language: outputLanguageToTts(effectiveLang),
        emotion,
        speed: voiceSpeed,
      });
      if (isClonedVoice(selectedVoiceId)) {
        touchClonedVoice(selectedVoiceId);
        refreshClonedVoices();
      }
      audioBlobRef.current = result.blob;
      // Save blob immediately to IndexedDB — don't rely on the URL fetch in useReelsPersistence
      // because WebKit blob URLs can expire before the persistence effect fires.
      saveAudioBlob(result.blob).catch(e => console.warn('[audio] saveAudioBlob failed:', e));
      dispatch({
        type: 'audio-success',
        url: result.url,
        duration: result.duration,
        peaks: result.peaks,
        words: result.words,
        voiceId: selectedVoiceId,
      });
      setPlayhead(0);
      // New audio → user hasn't acknowledged any silence-cut tradeoff
      // yet for this take. Reset the "skip warning" decision so the
      // confirmation re-asks next time they Gerar clipes.
      skipSilenceWarningRef.current = false;
    } catch (err) {
      dispatch({ type: 'audio-error', error: err instanceof Error ? err.message : 'Falha ao gerar áudio' });
    }
  }, [blocks, selectedVoiceId, emotion, voiceSpeed, isClonedVoice, refreshClonedVoices, ttsLanguageOverride]);

  const avatarBlocks = useMemo(() => blocks.filter(b => b.kind === 'avatar' && b.end > b.start), [blocks]);

  // ─── Project assets count ──────────────────────────────────────────────
  // Refreshes the cached count of files in the project's assets folder. Called
  // on mount, after AssetPickerModal closes, and after the user opens the
  // Finder window via "Abrir pasta de assets" (they often drop files in then).
  // The count gates motion generation — see requiresAssetAttachment().
  const refreshProjectAssetsCount = useCallback(async () => {
    try {
      const raw = await invoke<Array<{ name: string; path: string }>>(
        'list_project_assets',
        { projectName: state.projectName },
      );
      setProjectAssetsCount(raw.length);
    } catch {
      // Folder may not exist yet — treat as empty so the gate doesn't lock.
      setProjectAssetsCount(0);
    }
  }, [state.projectName]);

  useEffect(() => {
    if (!hydrated) return;
    void refreshProjectAssetsCount();
  }, [hydrated, refreshProjectAssetsCount]);

  // ─── Motion auto-pipeline ──────────────────────────────────────────────
  // Apple-style one-shot: click "Motion" on a block → Gemini decides everything,
  // generates HTML, HyperFrames renders MP4, the result lands on the timeline.
  // No modal involved. The user can later open the modal to fine-tune.
  const handleAutoMotion = useCallback(async (blockId: string, plan?: DirectorPlanItem) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;
    if (motionBusyByBlock[blockId]) return; // already running
    // Gate: if the project folder has assets but this block hasn't picked one,
    // refuse to generate. Sending the universal asset list confuses Gemini
    // (picks one at random, references it with paths the runtime can't
    // resolve, HyperFrames lint then aborts the render). Pop the AssetPicker
    // so the user can attach one before retrying.
    if (requiresAssetAttachment(block, projectAssetsCount)) {
      console.warn('[motion] block', blockId, 'blocked — project has assets but block has none attached');
      setAssetPickerBlockId(blockId);
      return;
    }
    const setBusy = (msg: string | null) => setMotionBusyByBlock(prev => {
      const next = { ...prev };
      if (msg === null) delete next[blockId]; else next[blockId] = msg;
      return next;
    });
    const blockIndex = blocks.indexOf(block);
    // Effect detector context — let createMotionFromBlock pick a sensible
    // default preset based on block content (stat → counter-reveal, etc.)
    // when the user hasn't picked one manually.
    const brandIdentitySnapshot = state.brandIdentity as { logoSvg?: string } | undefined;
    const seedBase = createMotionFromBlock(block, {
      index: blockIndex,
      total: blocks.length,
      brandHasLogo: !!brandIdentitySnapshot?.logoSvg && brandIdentitySnapshot.logoSvg.length > 0,
      brandHasIdentity: !!brandIdentitySnapshot && Object.keys(brandIdentitySnapshot).length > 0,
      audioWordCount: state.audio.words.filter(w => w.blockId === blockId).length,
    });
    // Per-block style preset override: if the user picked a vibe in the
    // inline chip on the card, use it. Otherwise stick with the seed default
    // (which is now informed by the deterministic effect detector).
    // Placement: ALWAYS resolved — explicit Dock choice wins, otherwise the
    // SAME default the Dock displays (defaultPlacementFor). This guarantees
    // "what you see selected is what generates" — previously an untouched
    // Dock showed Flutuar while generation fell back to full-frame.
    // Product rule: a creation B-roll block's motion IS the content — always
    // full-frame, even if an older draft carried a float placement.
    const basePlacement = (block.kind === 'broll' && state.projectMode !== 'edit')
      ? defaultPlacementFor('broll', state.projectMode, block.end - block.start)
      : block.motion?.placement
        ?? defaultPlacementFor(block.kind, state.projectMode, block.end - block.start);
    // Director plan (batch generation): keyword-anchored timing lands on the
    // placement so compositor + preview window-gate the motion. The director's
    // client-side validation already forces b-roll to full span.
    const effectivePlacement = plan
      ? { ...basePlacement, startOffsetSec: plan.startOffsetSec, durationSec: plan.durationSec }
      : basePlacement;
    const blockDurSec = block.end - block.start;
    const windowStart = effectivePlacement.startOffsetSec ?? 0;
    const windowDur = Math.max(1, Math.min(
      effectivePlacement.durationSec ?? (blockDurSec - windowStart),
      blockDurSec - windowStart,
    ));
    const seed = {
      ...(block.stylePresetOverride ? { ...seedBase, presetId: block.stylePresetOverride } : seedBase),
      placement: effectivePlacement,
      // The rendered MP4 covers exactly the visible window (not the whole
      // block) — the compositor only draws inside it.
      durationSec: Math.max(2, Math.min(12, windowDur)),
    };
    try {
      setBusy('Pensando…');
      dispatch({ type: 'set-block-motion', id: blockId, motion: { ...seed, status: 'generating' } });

      // Load project assets (screenshots) if available
      let projectAssets: Array<{ name: string; path: string; kind?: 'image' | 'video' }> = [];
      try {
        const raw = await invoke<Array<{ name: string; path: string; ext: string; size_bytes: number; kind: 'image' | 'video' }>>(
          'list_project_assets', { projectName: state.projectName }
        );
        projectAssets = raw;
      } catch { /* no assets folder yet — proceed without */ }

      // If the user attached a specific asset to this block, it becomes the
      // pinned protagonist. Force split-top layout so the motion (with asset as
      // centerpiece) sits on the top half and the avatar fills the bottom half.
      //
      // We also copy the file into the motion's own assets/ folder so the HTML
      // can reference it with a project-relative path. HyperFrames runs in a
      // sandboxed headless Chromium that does NOT resolve asset:// URLs — using
      // them produces ERR_UNKNOWN_URL_SCHEME and the render dies in frame
      // capture (with a 45s timeout per asset). Relative paths fix this.
      // Multi-asset carousel: copy each attached asset into the motion folder
      // and build a parallel pinnedAssets array. Each entry carries its own
      // relativeUrl so the prompt can reference them by project-relative path.
      type PinnedAssetIn = {
        name: string;
        path: string;
        kind: 'image' | 'video' | undefined;
        type: 'image' | 'video' | undefined;
        relativeUrl?: string;
      };
      const attachedAssets = block.attachedAssets ?? [];
      const pinnedAssets: PinnedAssetIn[] = [];
      for (const a of attachedAssets) {
        const entry: PinnedAssetIn = {
          name: a.name,
          path: a.path,
          kind: a.type,
          type: a.type,
        };
        console.log('[motion] copying asset into motion folder · motion=', seed.id, '· src=', a.path);
        try {
          const copied = await invoke<{ relative_path: string; absolute_path: string }>('copy_asset_to_motion', {
            motionId: seed.id,
            sourcePath: a.path,
          });
          entry.relativeUrl = copied.relative_path; // e.g. "assets/foo.mp4"
          console.log('[motion] asset copied OK · relativeUrl=', copied.relative_path);
        } catch (e) {
          console.error('[motion] FAILED to copy asset · falling back to asset://', e);
          // Fall through — preview works via asset://, render may freeze for video.
        }
        pinnedAssets.push(entry);
      }
      const hasPinnedAssets = pinnedAssets.length > 0;

      // Carousel slides have no avatar — always use 'replace' (full-frame motion).
      // Reel blocks: split-top when assets attached (assets top, avatar bottom);
      // otherwise the resolved placement (seed.placement is ALWAYS set now).
      const isCarousel = aspect === 'carousel';
      const effectiveLayer = isCarousel
        ? 'replace'
        : hasPinnedAssets
          ? (block.kind === 'broll' ? 'replace' : 'split-top')
          : layerOfPlacement(seed.placement);
      const canvasAspect: '9:16' | '4:5' = isCarousel ? '4:5' : '9:16';

      // Universal asset list: only forward it to Gemini if NO block in the reel
      // has explicit pinned assets. Otherwise the model may "borrow" assets
      // intended for other blocks. Pinned-only mode keeps the user in control.
      const reelHasPinnedAssets = blocks.some(b => (b.attachedAssets?.length ?? 0) > 0);
      const universalAssetsToSend = reelHasPinnedAssets ? undefined : projectAssets;

      // Word-level timestamps for this block, rebased to block-local time.
      // Only forwarded when the audio has timestamps AND the block's slot is
      // known — otherwise word-sync presets fall back gracefully to staggered
      // reveals based on durationSec.
      const blockSlot = slotById.get(blockId);
      // Rebase to MOTION-local time (block-local minus the visibility window
      // offset) and keep only words inside the window — word-sync presets
      // must align to when the motion is actually on screen.
      const blockWordTimestamps = (blockSlot && state.audio.words.length > 0)
        ? state.audio.words
            .filter(w => w.blockId === blockId)
            .map(w => ({
              word: w.word,
              start: Math.max(0, w.start - blockSlot.projectStart - windowStart),
              end: Math.max(0, w.end - blockSlot.projectStart - windowStart),
            }))
            .filter(w => w.end > w.start && w.start < seed.durationSec)
        : undefined;

      // ── Template router: when the user didn't pick a preset explicitly and
      // the block has no pinned assets, ask the LLM whether a motion-pack
      // template fits this block perfectly (selection + variable fill in one
      // small call). A hit replaces the seed preset; null falls through to
      // the freeform pipeline untouched. Explicit user choice always wins.
      let routedPresetId = seed.presetId;
      let routedTemplateVars: Record<string, string> | undefined;
      if (plan && !block.stylePresetOverride && !hasPinnedAssets && !isCarousel) {
        // Director already routed this block in the single batch call — no
        // per-block router round-trip needed.
        if (plan.templateId) {
          routedPresetId = plan.templateId as typeof seed.presetId;
          routedTemplateVars = plan.variables;
          console.log('[motion/director] template:', plan.templateId, '·', plan.rationale);
        } else if (plan.styleHint) {
          routedPresetId = plan.styleHint as typeof seed.presetId;
          console.log('[motion/director] estilo:', plan.styleHint, '·', plan.rationale);
        }
      } else if (!block.stylePresetOverride && !hasPinnedAssets && !isCarousel) {
        try {
          setBusy('Escolhendo template…');
          const route = await routeTemplateForBlock({
            blockText: block.text,
            durationSec: seed.durationSec,
            preferredModel: block.motionModelOverride,
            // Templates only when the motion owns the whole frame — float
            // and splits get freeform art authored inside the safe zone.
            overlayContext: effectiveLayer !== 'replace',
          });
          if (route) {
            routedPresetId = route.templateId as typeof seed.presetId;
            routedTemplateVars = route.vars;
            console.log('[motion/router] template hit:', route.templateId, '·', route.rationale);
          }
        } catch (e) {
          console.warn('[motion/router] routing skipped:', e);
        }
        setBusy('Pensando…');
      }

      const result = await generateMotionHtml({
        presetId: routedPresetId,
        templateVars: routedTemplateVars,
        blockText: block.text,
        durationSec: seed.durationSec,
        compositionId: seed.id,
        // Float = screen-blend over avatar/footage → the HTML must be authored
        // as a pure-black-bg overlay. Without this the blend washes the motion
        // out entirely (light mode) or leaves a faint veil (ink bg).
        overlayMode: effectiveLayer === 'overlay',
        preferredModel: block.motionModelOverride,
        motionLayer: effectiveLayer,
        canvasAspect,
        projectAssets: hasPinnedAssets ? undefined : universalAssetsToSend,
        pinnedAssets: hasPinnedAssets ? pinnedAssets : undefined,
        wordTimestamps: blockWordTimestamps,
        reelContext: {
          projectName: state.projectName,
          allBlocks: blocks.map(b => b.text),
          blockIndex,
          prevBlockText: blockIndex > 0 ? blocks[blockIndex - 1].text : undefined,
          nextBlockText: blockIndex < blocks.length - 1 ? blocks[blockIndex + 1].text : undefined,
          // Storyboard continuity: feed recent motion intents so Gemini varies the focal grammar.
          // We look back up to 2 blocks for any block that already has a generated motion.
          prevMotionIntent: blockIndex > 0 ? blocks[blockIndex - 1].motion?.intent : undefined,
          prevPrevMotionIntent: blockIndex > 1 ? blocks[blockIndex - 2].motion?.intent : undefined,
        },
        // Reuse the reel's brand identity so all motions stay visually consistent.
        existingBrand: state.brandIdentity as Parameters<typeof generateMotionHtml>[0]['existingBrand'],
        motionColorMode: (state.motionColorMode ?? (state.appTheme === 'light' ? 'light' : 'dark')),
        motionEnergy: state.motionEnergy ?? 'energetic',
        // Match motion text language to the script language (TTS override wins
        // over the active voice profile, same precedence used for audio).
        outputLanguage: (() => {
          const { profiles, activeId } = ensureProfiles();
          const profile = profiles.find(p => p.id === activeId) ?? profiles[0];
          return ttsLanguageOverride ?? profile?.outputLanguage;
        })(),
        // Creator identity from Settings — fuels social CTA preset (handle,
        // photo, follower count). Without this, the Inspector's "Gerar motion"
        // button generated follow cards with invented handles ignoring what
        // the user configured. MotionPickerModal already passed it; this
        // mirrors that path for the inline generate flow.
        userIdentity: loadUserIdentity(),
      });
      // Cache the brand identity if this was the first motion (research happened).
      if (result.brand && !state.brandIdentity) {
        dispatch({ type: 'set-brand-identity', brand: result.brand as unknown as Record<string, unknown> });
      }
      // Post-process: replace repeat:-1 with a finite count derived from the duration.
      // HyperFrames is a deterministic renderer — infinite GSAP loops break it.
      const sanitizedHtml = result.htmlBody.replace(
        /repeat\s*:\s*-1/g,
        () => `repeat: Math.floor(${seed.durationSec} / 0.8) - 1`
      );
      const resolvedColorMode = state.motionColorMode ?? (state.appTheme === 'light' ? 'light' : 'dark');
      const generated: MotionConfig = {
        ...seed,
        // Sync the legacy layer with the RESOLVED placement — the doc wrapper
        // and renderer must agree on the canvas the HTML was authored for.
        layer: effectiveLayer,
        // Carry the router's choice so the badge/chips reflect the template
        // that actually generated this motion, not the pre-routing seed.
        presetId: routedPresetId,
        intent: result.intent || seed.intent,
        text: result.text || seed.text,
        html: sanitizedHtml,
        status: 'rendering',
        generatedAt: Date.now(),
        canvasAspect,
        // Drives the float compositor blend: dark→screen, light→multiply.
        authoredMode: resolvedColorMode,
        modelUsed: result.modelUsed,
        // Cost tracking — feeds the "Gasto API Gemini (Real)" panel.
        actualCostUSD: result.actualCostUSD,
        actualTokens: result.actualTokens,
        // Snapshot the carousel at generation time — used later to detect
        // staleness (user added/removed/reordered/swapped an asset).
        assetSnapshots: hasPinnedAssets
          ? pinnedAssets.map(a => ({ path: a.path, name: a.name }))
          : undefined,
      };
      dispatch({ type: 'set-block-motion', id: blockId, motion: generated });

      setBusy('Renderizando…');
      let activeGenerated = generated;
      let renderResult: { mp4_path: string; size_bytes: number } | null = null;

      // Self-correction loop: if HyperFrames lint rejects the HTML, feed the
      // exact lint errors back to Gemini for one corrective attempt. Only
      // lint failures trigger a retry — all other errors propagate immediately.
      for (let attempt = 0; attempt <= 1; attempt++) {
        try {
          // Overlay floats follow the reel's color mode too now: dark art →
          // screen blend, LIGHT art → multiply blend ("float claro").
          const fullHtml = buildFullHtmlDoc(activeGenerated, canvasAspect, resolvedColorMode);
          await invoke('save_motion_html', { motionId: activeGenerated.id, html: fullHtml });
          renderResult = await invoke<{ mp4_path: string; size_bytes: number }>(
            'render_motion', { motionId: activeGenerated.id },
          );
          break; // success — exit retry loop
        } catch (renderErr) {
          const renderMsg = renderErr instanceof Error ? renderErr.message : String(renderErr);
          const isLintError = renderMsg.includes('Lint do HyperFrames reprovou') || renderMsg.includes('overlapping_clips') || renderMsg.includes('missing_timeline');
          if (attempt === 0 && isLintError) {
            // One self-correction attempt: re-generate with the lint errors as context.
            setBusy('Corrigindo HTML (lint falhou)…');
            const colorMode = state.motionColorMode ?? (state.appTheme === 'light' ? 'light' : 'dark');
            const correctedResult = await generateMotionHtml({
              presetId: seed.presetId,
              blockText: block.text,
              durationSec: seed.durationSec,
              compositionId: seed.id,
              preferredModel: block.motionModelOverride,
              motionLayer: effectiveLayer,
              canvasAspect,
              existingBrand: state.brandIdentity as Parameters<typeof generateMotionHtml>[0]['existingBrand'],
              motionColorMode: colorMode,
              motionEnergy: state.motionEnergy ?? 'energetic',
              userIdentity: loadUserIdentity(),
              lintError: renderMsg,
            });
            const correctedHtml = correctedResult.htmlBody.replace(
              /repeat\s*:\s*-1/g,
              () => `repeat: Math.floor(${seed.durationSec} / 0.8) - 1`,
            );
            activeGenerated = {
              ...activeGenerated,
              html: correctedHtml,
              generatedAt: Date.now(),
              modelUsed: correctedResult.modelUsed,
            };
            dispatch({ type: 'set-block-motion', id: blockId, motion: { ...activeGenerated, status: 'rendering' } });
            setBusy('Renderizando (tentativa corrigida)…');
            continue; // retry render with corrected HTML
          }
          // Non-lint error or second failure → propagate
          throw renderErr;
        }
      }

      dispatch({
        type: 'set-block-motion',
        id: blockId,
        motion: {
          ...activeGenerated,
          videoPath: renderResult!.mp4_path,
          status: 'ready',
          renderedAt: Date.now(),
          errorMessage: undefined,
        },
      });
      setBusy(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[motion] auto pipeline failed:', msg);
      dispatch({
        type: 'set-block-motion',
        id: blockId,
        motion: { ...seed, status: 'error', errorMessage: msg },
      });
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, dispatch, motionBusyByBlock, projectAssetsCount, state.motionColorMode, state.motionEnergy, state.appTheme, state.brandIdentity, state.projectName, state.audio.words, slotById, aspect, ttsLanguageOverride]);

  const handleRenderMotionMp4 = useCallback(async (blockId: string) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block?.motion?.html) return;
    const motion = block.motion;
    const setBusy = (msg: string | null) => setMotionBusyByBlock(prev => {
      const next = { ...prev };
      if (msg === null) delete next[blockId]; else next[blockId] = msg;
      return next;
    });
    try {
      setBusy('Renderizando…');
      dispatch({ type: 'set-block-motion', id: blockId, motion: { ...motion, status: 'rendering' } });
      // Sanitize repeat:-1 before render
      const sanitizedMotion = {
        ...motion,
        html: motion.html.replace(/repeat\s*:\s*-1/g, () => `repeat: Math.floor(${motion.durationSec} / 0.8) - 1`),
      };
      const fullHtml = buildFullHtmlDoc(sanitizedMotion, motion.canvasAspect, (state.motionColorMode ?? (state.appTheme === 'light' ? 'light' : 'dark')));
      await invoke('save_motion_html', { motionId: motion.id, html: fullHtml });
      const rendered = await invoke<{ mp4_path: string; size_bytes: number }>(
        'render_motion', { motionId: motion.id },
      );
      dispatch({
        type: 'set-block-motion',
        id: blockId,
        motion: { ...motion, videoPath: rendered.mp4_path, status: 'ready', renderedAt: Date.now(), errorMessage: undefined },
      });
      setBusy(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dispatch({ type: 'set-block-motion', id: blockId, motion: { ...motion, status: 'error', errorMessage: msg } });
      setBusy(null);
    }
  }, [blocks, dispatch]);

  const handleRenderAllMotions = useCallback(async () => {
    const pending = blocks.filter(b => {
      if (!b.motion) return false;
      const m = b.motion;
      if (!m.html) return true; // no html yet → full generate
      if (!m.videoPath) return true; // html exists but no mp4 → render only
      if (m.generatedAt && m.renderedAt && m.generatedAt > m.renderedAt) return true; // re-render after regen
      return false;
    });
    if (pending.length === 0) return;

    for (const block of pending) {
      if (motionBusyByBlock[block.id]) continue;
      if (block.motion?.html) {
        // Already has HTML — just render the MP4, no need to call Gemini again
        await handleRenderMotionMp4(block.id);
      } else {
        // No HTML yet — full pipeline (Gemini + render)
        await handleAutoMotion(block.id);
      }
    }
  }, [blocks, motionBusyByBlock, handleAutoMotion, handleRenderMotionMp4]);

  /// Batch motion pipeline — called by the agent's
  /// `generate_motion_for_blocks` tool. Runs each block in sequence so:
  /// (a) only one Chromium spawns at a time (the bottleneck), and
  /// (b) Gemini Pro rate-limits stay happy.
  ///
  /// For blocks that already have HTML set (Claude-mode passthrough already
  /// dispatched set-block-motion with html before this runs), we skip the
  /// Gemini step via handleRenderMotionMp4. Blocks without HTML go through
  /// the full handleAutoMotion pipeline.
  ///
  /// Returns `{ ok, failed, failedIds }` so the agent can summarize.
  const handleAutoMotionMany = useCallback(
    async (
      ids: string[],
    ): Promise<{ ok: number; failed: number; failedIds: string[] }> => {
      let ok = 0;
      let failed = 0;
      const failedIds: string[] = [];
      const total = ids.length;
      batchMotionCancelRef.current = false;
      console.log('[batch-motion] starting', total, 'blocks:', ids);

      // ── Scene director (motion-pack guide workflow): ONE planning call for
      // the whole batch — picks the visual per block AND anchors each motion
      // at the keyword's word-timestamp (3–8s window) instead of spanning the
      // block. Carousel, pinned-asset blocks and already-generated blocks are
      // excluded; on failure the loop falls back to the per-block router.
      let planByBlock = new Map<string, DirectorPlanItem>();
      const directorEligible = ids.filter(id => {
        const b = blocks.find(x => x.id === id);
        return !!b && !b.motion?.html && !(b.attachedAssets?.length)
          && !requiresAssetAttachment(b, projectAssetsCount);
      });
      if (aspect !== 'carousel' && directorEligible.length > 1) {
        try {
          setBatchMotionProgress({ current: 0, total, blockId: '' });
          const { profiles, activeId } = ensureProfiles();
          const profile = profiles.find(p => p.id === activeId) ?? profiles[0];
          planByBlock = await planMotionsForScript({
            scriptText: blocks.map(b => b.text).join('\n'),
            blocks: directorEligible.flatMap(id => {
              const b = blocks.find(x => x.id === id);
              const slot = b ? slotById.get(b.id) : undefined;
              if (!b) return [];
              const projectStart = slot?.projectStart ?? b.start;
              return [{
                id: b.id,
                kind: b.kind,
                text: b.text,
                startSec: projectStart,
                durationSec: b.end - b.start,
                words: state.audio.words.length > 0
                  ? state.audio.words
                      .filter(w => w.blockId === b.id)
                      .map(w => ({ word: w.word, start: Math.max(0, w.start - projectStart), end: Math.max(0, w.end - projectStart) }))
                      .filter(w => w.end > w.start)
                  : undefined,
              }];
            }),
            outputLanguage: ttsLanguageOverride ?? profile?.outputLanguage,
          });
          console.log('[motion/director] plano:', planByBlock.size, 'blocos planejados de', directorEligible.length);
        } catch (e) {
          console.warn('[motion/director] planejamento pulado:', e);
        }
      }

      try {
        for (let i = 0; i < ids.length; i++) {
          if (batchMotionCancelRef.current) {
            console.log('[batch-motion] cancelado pelo usuário — parando antes do próximo bloco');
            break;
          }
          const id = ids[i];
          setBatchMotionProgress({ current: i + 1, total, blockId: id });
          console.log('[batch-motion] iteration', i + 1, '/', total, '· blockId=', id);
          try {
            // Each block processed in sequence. handleAutoMotion / handle-
            // RenderMotionMp4 read `blocks` from their own captured closure,
            // which is fine because they're dispatched-via-reducer and the
            // reducer state at the time of the next iteration reflects the
            // previous one's dispatch.
            const target = blocks.find(b => b.id === id);
            if (!target) {
              console.warn('[batch-motion] block', id, 'not found in snapshot blocks — skipping');
              failed += 1;
              failedIds.push(id);
              continue;
            }
            if (motionBusyByBlock[id]) {
              // Already in-flight (e.g. user clicked Motion on this block
              // manually right before the batch). Skip silently.
              console.log('[batch-motion] block', id, 'already busy — skipping');
              continue;
            }
            if (requiresAssetAttachment(target, projectAssetsCount)) {
              // The project folder has assets but this block has none pinned.
              // Skip rather than fail — failing would mark it as errored in the
              // UI, but the actual fix is "user must attach an asset", which
              // isn't really a failure of THIS batch run.
              console.log('[batch-motion] block', id, 'skipped — no asset attached (project has', projectAssetsCount, 'assets)');
              continue;
            }
            if (target.motion?.html) {
              await handleRenderMotionMp4(id);
            } else {
              await handleAutoMotion(id, planByBlock.get(id));
            }
            ok += 1;
            console.log('[batch-motion] iteration', i + 1, '/', total, '· blockId=', id, '· DONE');
          } catch (e) {
            console.warn('[batch-motion] iteration', i + 1, '/', total, '· blockId=', id, '· FAILED:', e);
            failed += 1;
            failedIds.push(id);
          }
        }
      } finally {
        // Always clear — even if the whole loop throws (it shouldn't, but
        // we don't want the progress chip stuck on screen).
        setBatchMotionProgress(null);
        console.log('[batch-motion] finished · ok=', ok, '· failed=', failed, '· failedIds=', failedIds);
      }
      return { ok, failed, failedIds };
    },
    [blocks, motionBusyByBlock, projectAssetsCount, handleAutoMotion, handleRenderMotionMp4, aspect, slotById, state.audio.words, ttsLanguageOverride],
  );

  // Core clip generation. Reads the *current* audio.url (which is the
  // cut version when cutsApplied is true) and the *current* block ranges.
  // Callers must dispatch set-photo / set-avatar-model and apply any
  // silence cut BEFORE calling this — we don't gate here.
  const runGenerateClips = useCallback(async (photoId: string, model: HeyGenModelChoice) => {
    const url = audio.url;
    if (!url) return;
    const photos = loadAvatarPhotos();
    const photo = photos.find(p => p.id === photoId);
    if (!photo) {
      alert('Foto não encontrada. Selecione novamente.');
      return;
    }
    setGeneratingClips(true);
    try {
      // Re-fetch the audio Blob from its object URL.
      const audioResp = await fetch(url);
      const audioBlob = await audioResp.blob();

      // For each avatar block, send only the visible portion to HeyGen.
      const ranges = avatarBlocks.map(b => {
        const blockLen = b.end - b.start;
        const visible = Math.min(b.avatarVisibleSec ?? blockLen, blockLen);
        return { blockId: b.id, start: b.start, end: b.start + visible };
      });
      const slices = await sliceAudioByBlocks(audioBlob, ranges);

      // Build per-block override map.
      const photosById = new Map(loadAvatarPhotos().map(p => [p.id, p]));
      const talkingPhotoIdByBlock: Record<string, string> = {};
      for (const b of avatarBlocks) {
        if (b.avatarPhotoId) {
          const override = photosById.get(b.avatarPhotoId);
          if (override) talkingPhotoIdByBlock[b.id] = override.talkingPhotoId;
        }
      }

      await generateAvatarClips(slices, {
        talkingPhotoId: photo.talkingPhotoId,
        talkingPhotoIdByBlock,
        model,
        aspect: state.aspect,
        onClipUpdate: (blockId, update) => {
          dispatch({
            type: 'clip-update',
            blockId,
            status: update.status,
            message: 'message' in update ? update.message : undefined,
            videoUrl: 'videoUrl' in update ? update.videoUrl : undefined,
            error: 'error' in update ? update.error : undefined,
          });
        },
      });
      void notifyDone('Avatares prontos ✅', 'Os clipes de avatar terminaram de gerar.');
    } catch (err) {
      console.error('[reels] generateAvatarClips failed:', err);
    } finally {
      setGeneratingClips(false);
    }
  }, [audio.url, avatarBlocks, state.aspect]);

  // Re-runs the full slice + HeyGen call for a SINGLE avatar block. Mirrors
  // runGenerateClips but limits the ranges and the API call to one id. Used
  // by the per-block "regenerate" button in the timeline so the user can fix
  // a bad lipsync without paying for the entire reel again.
  const runRegenerateOneClip = useCallback(async (blockId: string, modelOverride?: HeyGenModelChoice): Promise<void> => {
    const url = audio.url;
    if (!url) return;
    const target = avatarBlocks.find(b => b.id === blockId);
    if (!target) return;
    if (!state.selectedPhotoId) {
      alert('Selecione uma foto de avatar antes de regenerar.');
      return;
    }
    const photos = loadAvatarPhotos();
    const photo = photos.find(p => p.id === state.selectedPhotoId);
    if (!photo) {
      alert('Foto não encontrada. Selecione novamente.');
      return;
    }
    setGeneratingClips(true);
    try {
      const audioResp = await fetch(url);
      const audioBlob = await audioResp.blob();
      const blockLen = target.end - target.start;
      const visible = Math.min(target.avatarVisibleSec ?? blockLen, blockLen);
      const slices = await sliceAudioByBlocks(audioBlob, [
        { blockId: target.id, start: target.start, end: target.start + visible },
      ]);
      const photosById = new Map(photos.map(p => [p.id, p]));
      const talkingPhotoIdByBlock: Record<string, string> = {};
      if (target.avatarPhotoId) {
        const override = photosById.get(target.avatarPhotoId);
        if (override) talkingPhotoIdByBlock[target.id] = override.talkingPhotoId;
      }
      const effectiveModel = modelOverride ?? state.avatarModel;
      await generateAvatarClips(slices, {
        talkingPhotoId: photo.talkingPhotoId,
        talkingPhotoIdByBlock,
        model: effectiveModel,
        aspect: state.aspect,
        onClipUpdate: (id, update) => {
          dispatch({
            type: 'clip-update',
            blockId: id,
            status: update.status,
            message: 'message' in update ? update.message : undefined,
            videoUrl: 'videoUrl' in update ? update.videoUrl : undefined,
            error: 'error' in update ? update.error : undefined,
          });
        },
      });
    } catch (err) {
      console.error('[reels] regenerate-one failed:', err);
    } finally {
      setGeneratingClips(false);
    }
  }, [audio.url, avatarBlocks, state.aspect, state.selectedPhotoId, state.avatarModel]);

  // Entry point from the GenerateAvatarsModal. Decides whether to
  // surface the anti-dessync warning before kicking off the real
  // generation. The warning fires when silence is detected on the
  // audio but the user hasn't cut it yet — generating now bakes the
  // silences into HeyGen's lipsync, which the export then strips and
  // the lips drift.
  const handleGenerateClips = useCallback(async (photoId: string, model: HeyGenModelChoice) => {
    if (!audio.url || avatarBlocks.length === 0) return;

    dispatch({ type: 'set-photo', photoId });
    dispatch({ type: 'set-avatar-model', model });
    setAvatarsModalOpen(false);

    const hasDetectedSilence =
      audio.keepSegments.length > 0 && audio.detectedSilenceSec >= 0.2;
    const cutPending = hasDetectedSilence && !audio.silenceCut;

    if (cutPending && !skipSilenceWarningRef.current) {
      // Park the request; user resolves via SilenceWarningModal buttons.
      setPendingClipGen({ photoId, model });
      return;
    }

    await runGenerateClips(photoId, model);
  }, [audio.url, audio.keepSegments.length, audio.detectedSilenceSec, audio.silenceCut, avatarBlocks.length, runGenerateClips]);

  // Resolves the SilenceWarningModal: apply the silence cut, wait
  // for cutsApplied to flip true, then run the clip generation with
  // the now-cut audio in scope. The applying useEffect elsewhere in
  // this component handles the actual re-encoding.
  const onWarningApplyAndGenerate = useCallback(async () => {
    const req = pendingClipGen;
    if (!req) return;
    setPendingClipGen(null);
    setGeneratingClips(true);
    try {
      dispatch({ type: 'audio-silence-toggle', on: true });
      // Poll for the cut to land. The effect that owns the actual
      // cut takes ~1-3s end-to-end. We give up after 20s — well above
      // worst-case so we don't hang if something upstream broke.
      const start = Date.now();
      while (Date.now() - start < 20_000) {
        await new Promise(r => setTimeout(r, 150));
        // audioRef-style read via stateRef would be cleaner, but we
        // can re-read state via a deferred path: rerun the effect
        // pipeline finished when state.audio.cutsApplied flips. We
        // check the latest snapshot through a function reference.
        if (audioRefForWait.current?.cutsApplied) break;
      }
    } finally {
      setGeneratingClips(false);
    }
    await runGenerateClips(req.photoId, req.model);
  }, [pendingClipGen, runGenerateClips]);

  const onWarningGenerateAnyway = useCallback(async () => {
    const req = pendingClipGen;
    if (!req) return;
    setPendingClipGen(null);
    skipSilenceWarningRef.current = true;
    await runGenerateClips(req.photoId, req.model);
  }, [pendingClipGen, runGenerateClips]);

  const onWarningCancel = useCallback(() => {
    setPendingClipGen(null);
  }, []);

  // Mirror of state.audio used by onWarningApplyAndGenerate's polling
  // loop — closures captured at callback-creation time would never see
  // the post-dispatch updates otherwise.
  const audioRefForWait = useRef(audio);
  audioRefForWait.current = audio;

  // ─── Re-split current blocks by the user's max duration setting ────
  // Reads `Settings → Avançado → Duração máxima do bloco`, finds every
  // block that exceeds it, and splits at natural word boundaries
  // (preferring sentence terminators, then commas). The audio file
  // stays untouched — we just rewire block start/end + retag words.
  const handleResplitBlocks = useCallback(() => {
    const maxSec = getMaxBlockSec();
    if (maxSec == null) {
      alert(
        'Defina uma duração máxima em Settings → Agents → Avançado → "Duração máxima do bloco" antes de quebrar blocos.',
      );
      return;
    }
    const result = resplitBlocksByDuration(blocks, audio.words, {
      maxSec,
      flipTailToBroll: true,
    });
    if (!result.changed) {
      alert(`Nenhum bloco passa de ${maxSec}s — nada pra quebrar.`);
      return;
    }
    const newWords = remapWordsToBlocks(audio.words, result.blocks);
    // Count clips that would be DISCARDED — only the ones on split
    // blocks where the HEAD piece is broll (so the clip can't be
    // migrated). Clips whose head stays avatar migrate over and are
    // preserved.
    const clipsAtRisk = result.removedIds.reduce((n, oldId) => {
      const wasReady = state.avatarClips[oldId]?.status === 'ready';
      if (!wasReady) return n;
      const newHeadId = result.oldIdToHeadId[oldId];
      const headBlock = result.blocks.find(b => b.id === newHeadId);
      // Clip can be reused if the head piece is still an avatar block.
      const willMigrate = headBlock?.kind === 'avatar';
      return willMigrate ? n : n + 1;
    }, 0);
    setPendingResplit({
      newBlocks: result.blocks,
      newWords,
      removedIds: result.removedIds,
      oldIdToHeadId: result.oldIdToHeadId,
      clipsAtRisk,
    });
  }, [blocks, audio.words, state.avatarClips]);

  const applyPendingResplit = useCallback(() => {
    const req = pendingResplit;
    if (!req) return;
    dispatch({
      type: 'resplit-blocks',
      blocks: req.newBlocks,
      words: req.newWords,
      removedIds: req.removedIds,
      oldIdToHeadId: req.oldIdToHeadId,
    });
    // Keep the cut session in sync with the post-resplit block list,
    // otherwise the export path reads the stale (pre-resplit) blocks
    // from the session and ignores all clips/motions generated after
    // the split — the export then ends up with no visuals.
    syncCutSessionBlocks(req.newBlocks);
    setPendingResplit(null);
  }, [pendingResplit]);

  const handleGenerateMockClips = useCallback(async () => {
    if (avatarBlocks.length === 0) return;
    setGeneratingClips(true);
    try {
      for (const b of avatarBlocks) {
        dispatch({ type: 'clip-update', blockId: b.id, status: 'rendering', message: 'gerando clip de teste…' });
        const durationSec = Math.max(1, b.end - b.start);
        const { url: videoUrl, blob } = await generateMockClip(b.id, b.text, durationSec);
        // Save to IndexedDB so the clip survives app restarts.
        saveClipBlob(b.id, blob).catch(e => console.warn('[mock-clip] saveClipBlob failed:', e));
        dispatch({ type: 'clip-update', blockId: b.id, status: 'ready', videoUrl });
      }
    } catch (err) {
      console.error('[mock-clip] failed:', err);
    } finally {
      setGeneratingClips(false);
    }
  }, [avatarBlocks]);

  // Bridge MCP tool calls from the Rust side into reducer dispatches +
  // service calls. Mounted once after all handlers are declared so the
  // bridge can wire each agent capability to its underlying handler.
  // Same logic as handleResplitBlocks, but returns a structured result for
  // the Agent instead of alerting the user. Has two paths:
  //   1. Audio ready → uses word timestamps for exact splits (high precision)
  //   2. No audio yet → uses words-per-second heuristic (same as imports)
  const splitLongBlocksForAgent = useCallback((): {
    error?: string;
    splitsApplied?: number;
    newBlockCount?: number;
  } => {
    const maxSec = getMaxBlockSec();
    if (maxSec == null) {
      return {
        error: 'Configure a "Duração máxima do bloco" em Settings → Agents → Avançado antes.',
      };
    }

    // Path 1: audio ready — use word timestamps for accurate splits.
    if (state.audio.status === 'ready') {
      const result = resplitBlocksByDuration(blocks, audio.words, {
        maxSec,
        flipTailToBroll: true,
      });
      if (!result.changed) {
        return { error: `Nenhum bloco passa de ${maxSec}s — nada pra quebrar.` };
      }
      const newWords = remapWordsToBlocks(audio.words, result.blocks);
      dispatch({
        type: 'resplit-blocks',
        blocks: result.blocks,
        words: newWords,
        removedIds: result.removedIds,
        oldIdToHeadId: result.oldIdToHeadId,
      });
      syncCutSessionBlocks(result.blocks);
      return {
        splitsApplied: result.removedIds.length,
        newBlockCount: result.blocks.length,
      };
    }

    // Path 2: no audio — heuristic split using estimated words/second.
    // Same approach used when importing scripts.
    const splits = splitLongBlocks(
      blocks.map(b => ({ kind: b.kind, text: b.text })),
      { maxSec },
    );
    if (splits.length === blocks.length) {
      return { error: `Nenhum bloco passa de ~${maxSec}s — nada pra quebrar.` };
    }
    const newBlocks: ScriptBlock[] = splits.map(s => ({
      id: `b_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`,
      kind: s.kind,
      text: s.text,
      start: 0,
      end: 0,
      // Sticky avatar layout: respect user's last choice instead of forcing avatar-top.
      // Falls back to 'avatar-top' for projects that haven't set one yet (default initial state).
      layout: s.kind === 'avatar' ? (state.lastAvatarLayout ?? 'avatar-top') : undefined,
    }));
    dispatch({ type: 'replace-blocks', blocks: newBlocks });
    return {
      splitsApplied: splits.length - blocks.length,
      newBlockCount: newBlocks.length,
    };
  }, [state.audio.status, state.lastAvatarLayout, blocks, audio.words, dispatch]);

  useAgentToolBridge({
    state,
    dispatch,
    onGenerateAudio: handleGenerate,
    onSplitLongBlocks: splitLongBlocksForAgent,
    onGenerateMotionForBlock: handleAutoMotion,
    onGenerateMotionForBlocks: handleAutoMotionMany,
    onRenderAllMotions: handleRenderAllMotions,
    onGenerateAvatarClips: async (mock: boolean) => {
      if (mock) {
        await handleGenerateMockClips();
        return;
      }
      if (state.selectedPhotoId) {
        await handleGenerateClips(state.selectedPhotoId, state.avatarModel);
      }
    },
    onApplyCaption: (caption, opts) => {
      setCaptionText(caption);
      if (opts?.openModal) setCaptionOpen(true);
    },
  });

  // ─── Audio playback sync ──────────────────────────────────────────────
  useEffect(() => {
    if (!audio.url) return;
    const el = new Audio(audio.url);
    el.preload = 'auto';
    // Defensive: a recent regression silently muted preview audio after some
    // play/pause cycles. Set both explicitly on every audio swap so neither
    // can drift to a wrong state from a prior session.
    el.muted = false;
    el.volume = 1;
    audioElRef.current = el;
    return () => {
      el.pause();
      // Detach the source so WebKit stops trying to fetch the (possibly
      // already-revoked) blob URL on unmount — this caused dozens of
      // "WebKitBlobResource error 1" warnings spamming the console.
      el.removeAttribute('src');
      el.load();
      audioElRef.current = null;
    };
  }, [audio.url]);

  // Keep refs in sync so the playback tick always reads the latest config.
  // When cutsApplied is true, the <audio> element is already playing the cut
  // MP3 (silences physically removed) — we MUST NOT skip again, otherwise we'd
  // pull the playhead forward for silences that no longer exist in the source.
  useEffect(() => {
    const cutsApplied = !!state.audio.cutsApplied;
    silenceCutRef.current = state.audio.silenceCut && !cutsApplied;
    keepSegmentsRef.current = cutsApplied ? [] : state.audio.keepSegments;
    layoutRef.current = layout;
    totalDurationRef.current = totalDuration;
  }, [state.audio.silenceCut, state.audio.cutsApplied, state.audio.keepSegments, layout, totalDuration]);

  // Ref so the play effect can read current audio status without re-running on changes.
  const audioReadyRef = useRef(false);
  useEffect(() => {
    audioReadyRef.current = state.audio.status === 'ready' && !!state.audio.url;
  }, [state.audio.status, state.audio.url]);

  useEffect(() => {
    if (!playing) {
      const el = audioElRef.current;
      if (el) el.pause();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      return;
    }

    const el = audioElRef.current;
    const hasAudio = audioReadyRef.current && !!el;
    console.log('[reels/play] starting · hasAudio=', hasAudio, '· status=', state.audio.status, '· hasEl=', !!el, '· hasUrl=', !!state.audio.url);

    let cancelled = false;

    // Walltime fallback — used when no audio OR when audio.play() fails.
    const startWalltimeMode = () => {
      if (cancelled) return;
      console.log('[reels/play] using walltime mode');
      let startWall = performance.now();
      let startPlayhead = playhead;
      if (startPlayhead >= totalDurationRef.current - 0.05) {
        startPlayhead = 0;
        setPlayhead(0);
      }
      const tickNoAudio = () => {
        if (cancelled) return;
        const total = totalDurationRef.current;
        const elapsed = (performance.now() - startWall) / 1000;
        const t = startPlayhead + elapsed;
        if (t >= total) {
          setPlayhead(total);
          setPlaying(false);
          return;
        }
        setPlayhead(t);
        rafRef.current = requestAnimationFrame(tickNoAudio);
      };
      rafRef.current = requestAnimationFrame(tickNoAudio);
    };

    if (hasAudio && el) {
      // ─── AUDIO MODE ───
      if (el.currentTime >= totalDurationRef.current - 0.05) {
        try { el.currentTime = 0; } catch { /* ignore */ }
        setPlayhead(0);
      }
      let audioPlayConfirmed = false;
      let switchedToWalltime = false;
      const playStartedAt = performance.now();
      const playPromise = el.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(() => {
          audioPlayConfirmed = true;
          console.log('[reels/play] audio playing');
        }).catch((err) => {
          console.warn('[reels/play] audio.play() failed, falling back to walltime:', err);
          if (!switchedToWalltime) {
            switchedToWalltime = true;
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
            startWalltimeMode();
          }
        });
      } else {
        // Sync return — older WebKit. Assume it started.
        audioPlayConfirmed = true;
      }

      const tick = () => {
        if (cancelled || switchedToWalltime) return;
        const a = audioElRef.current;
        if (!a) return;
        if (a.ended) {
          setPlaying(false);
          return;
        }
        // Detection: if 500ms passed since play() and currentTime is still 0
        // (or hasn't advanced), the browser silently rejected playback.
        // Switch to walltime mode so the user still sees the playhead move.
        if (!audioPlayConfirmed && performance.now() - playStartedAt > 500 && a.currentTime < 0.05) {
          console.warn('[reels/play] audio currentTime not advancing — falling back to walltime');
          switchedToWalltime = true;
          startWalltimeMode();
          return;
        }
        let t = a.currentTime;
        const total = totalDurationRef.current;
        if (t >= total) {
          setPlayhead(total);
          setPlaying(false);
          return;
        }
        if (silenceCutRef.current && keepSegmentsRef.current.length > 0) {
          const segs = keepSegmentsRef.current;
          const inside = segs.find(s => t >= s.start && t < s.end);
          if (!inside) {
            const next = segs.find(s => s.start > t);
            if (next) {
              try { a.currentTime = next.start; t = next.start; } catch { /* ignore */ }
            } else {
              setPlayhead(total);
              setPlaying(false);
              return;
            }
          }
        }
        setPlayhead(t);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => {
        cancelled = true;
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      };
    }

    // ─── NO-AUDIO MODE ───
    startWalltimeMode();
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const seekTo = (t: number) => {
    const clamped = Math.max(0, Math.min(totalDuration, t));
    setPlayhead(clamped);
    if (audioElRef.current) {
      const { sourceTime } = projectToSourceTime(layout, clamped);
      try { audioElRef.current.currentTime = sourceTime; } catch { /* ignore */ }
    }
  };

  // Select a block and move the playhead to its start so the preview reflects
  // exactly the block being edited (avatarZoom, layout, etc.).
  const selectAndSeekBlock = (blockId: string) => {
    setSelectedBlockId(blockId);
    // Only snap the playhead when it's OUTSIDE the block — if the user
    // already scrubbed to the moment they want to inspect, selecting the
    // block (chip/card click) must not teleport them back to its start.
    const slot = slotById.get(blockId);
    if (slot && (playhead < slot.projectStart || playhead >= slot.projectEnd)) {
      seekTo(slot.projectStart);
    }
  };

  // Scrub by dragging on empty timeline space. Elements that should not trigger
  // scrub (blocks, chips, motion overlays) tag themselves with data-no-scrub.
  const handleTimelinePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    if (e.button !== 0) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('[data-no-scrub="true"]')) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const seekToClientX = (clientX: number) => {
      const x = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      const effectiveT = ratio * viewDuration;
      const sourceT = cutOn ? effectiveToSource(effectiveT) : effectiveT;
      seekTo(sourceT);
    };
    seekToClientX(e.clientX);
    // Scrubbing does NOT clear the block selection — positioning the
    // playhead while the Dock is open is the core editing loop ("click the
    // chip, scrub to the moment, tweak"). Deselect via Esc or "mostrar
    // todos"; clicking another block's chip switches selection.
    const onMove = (ev: PointerEvent) => seekToClientX(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Drag-to-reorder: pointerdown on a block starts a potential drag. If the
  // pointer moves > 5px while held, we enter drag mode and follow the cursor.
  // On release, compute drop index and dispatch reorder-blocks.
  const handleBlockPointerDown = (blockId: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!timelineRef.current) {
      // Fallback: still select on click
      selectAndSeekBlock(blockId);
      return;
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = timelineRef.current.getBoundingClientRect();
    let dragging = false;

    const computeDropIndex = (clientX: number): number => {
      const x = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      const t = ratio * Math.max(viewDuration, 0.0001);
      // Find the nearest block boundary (between blocks N and N+1) by accumulating durations
      // across all blocks (avatar + broll, in current order, excluding the dragged one).
      const others = blocks.filter(b => b.id !== blockId);
      let acc = 0;
      for (let i = 0; i < others.length; i++) {
        const dur = Math.max(0, others[i].end - others[i].start);
        const mid = acc + dur / 2;
        if (t < mid) return i;
        acc += dur;
      }
      return others.length;
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) > 5) {
        dragging = true;
        setDraggingBlockId(blockId);
      }
      if (dragging) {
        setDragGhostX(ev.clientX - rect.left);
        setDragOverIndex(computeDropIndex(ev.clientX));
      }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (!dragging) {
        // Treat as a click — select and seek.
        selectAndSeekBlock(blockId);
      } else {
        const dropIdx = computeDropIndex(ev.clientX);
        const others = blocks.filter(b => b.id !== blockId).map(b => b.id);
        const orderedIds = [...others.slice(0, dropIdx), blockId, ...others.slice(dropIdx)];
        // Only dispatch if order actually changed.
        const currentIds = blocks.map(b => b.id).join(',');
        if (orderedIds.join(',') !== currentIds) {
          dispatch({ type: 'reorder-blocks', orderedIds });
        }
      }
      setDraggingBlockId(null);
      setDragOverIndex(null);
      setDragGhostX(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const playheadPct = viewPct(playhead);

  // Auto-scroll: keep playhead inside the viewport. Triggers on zoom change or
  // when the playhead drifts off-screen during playback. We center the playhead
  // when it leaves the middle 60% band of the visible viewport.
  useEffect(() => {
    const scroller = timelineScrollRef.current;
    if (!scroller) return;
    if (zoom <= 1) {
      // No zoom = full timeline visible, no scroll needed.
      if (scroller.scrollLeft !== 0) scroller.scrollLeft = 0;
      return;
    }
    const inner = scroller.firstElementChild as HTMLElement | null;
    if (!inner) return;
    const innerWidth = inner.scrollWidth;
    const viewWidth = scroller.clientWidth;
    const playheadX = (playheadPct / 100) * innerWidth;
    const margin = viewWidth * 0.2; // 20% breathing room on each side
    const visibleStart = scroller.scrollLeft + margin;
    const visibleEnd = scroller.scrollLeft + viewWidth - margin;
    if (playheadX < visibleStart || playheadX > visibleEnd) {
      const target = Math.max(0, Math.min(innerWidth - viewWidth, playheadX - viewWidth / 2));
      scroller.scrollTo({ left: target, behavior: playing ? 'auto' : 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, playheadPct]);

  const aspectClass = aspect === '9:16' ? 'aspect-[9/16] h-full' : aspect === '16:9' ? 'aspect-video w-full max-w-3xl' : aspect === 'carousel' ? 'aspect-[4/5] h-full' : 'aspect-square h-full';

  const layoutHit = hitTest(layout, playhead);
  const currentBlock = layoutHit.kind === 'block'
    ? blocks.find(b => b.id === layoutHit.slot.blockId) ?? null
    : null;
  const currentClip = currentBlock ? state.avatarClips[currentBlock.id] : undefined;
  // Tail/head fade for preview block transitions. Mirrors the mp4Renderer
  // FADE_FRAMES (200ms) — without this, each block's <video> element holds
  // its final frame for ~100-200ms during the React swap to the next block,
  // creating a visible "freeze" between blocks. With the fade, the outgoing
  // block dims to 0 and the incoming block fades from 0, hiding the swap.
  // TRANSITION-AWARE boundary effects. The old version applied a fixed 200ms
  // cross-fade to every boundary regardless of block.transition — the user
  // picked whip-pan/glitch/flash and saw nothing ("não consigo fazer o
  // preview da transição"), and even 'cut' (the recommended default) got a
  // fade. Now the preview approximates each transition with CSS on the
  // preview container (transform/filter) + black/white overlays. The export
  // (applyTransition in mp4Renderer) remains the source of truth; same
  // resolution rule: the transition AT a boundary is the OUTGOING block's.
  const previewFx = (() => {
    const none = { opacity: 1, transform: '', filter: '', blackAlpha: 0, whiteAlpha: 0, active: false };
    if (!currentBlock) return none;
    const slot = slotById.get(currentBlock.id);
    if (!slot) return none;
    const localT = playhead - slot.projectStart;
    const slack = (slot.projectEnd - slot.projectStart) - localT;
    const idx = blocks.findIndex(b => b.id === currentBlock.id);
    const prevB = idx > 0 ? blocks[idx - 1] : null;
    const nextB = idx >= 0 && idx < blocks.length - 1 ? blocks[idx + 1] : null;
    const inTr: BlockTransition = prevB ? (prevB.transition ?? 'cut') : 'fade';
    const outTr: BlockTransition = currentBlock.transition ?? (nextB ? 'cut' : 'fade');
    // 'cut' keeps a hair of fade (70ms) purely to mask the <video> element
    // src swap; everything else gets the full 200ms window.
    const winFor = (tr: BlockTransition) => (tr === 'cut' ? 0.07 : 0.2);
    const fxFor = (tr: BlockTransition, t: number, dir: 'in' | 'out') => {
      const entering = dir === 'in';
      const cross = entering ? t : 1 - t; // crossfade-style opacity
      switch (tr) {
        case 'cut':
          return { ...none, opacity: cross, active: true };
        case 'fade':
          return { ...none, blackAlpha: entering ? 1 - t : t, active: true };
        case 'dissolve':
          return { ...none, opacity: cross, active: true };
        case 'whip-pan': {
          const amt = entering ? (1 - t) : t;
          return {
            ...none,
            transform: `translateX(${(entering ? 1 : -1) * amt * 36}px)`,
            filter: amt > 0.05 ? `blur(${(amt * 8).toFixed(1)}px)` : '',
            active: true,
          };
        }
        case 'zoom-blur': {
          const amt = entering ? (1 - t) : t;
          return {
            ...none,
            opacity: Math.max(cross, 0.25),
            transform: `scale(${(1 + amt * 0.12).toFixed(3)})`,
            filter: amt > 0.05 ? `blur(${(amt * 10).toFixed(1)}px)` : '',
            active: true,
          };
        }
        case 'glitch': {
          const seed = Math.floor(t * 6);
          const j = ((seed * 11) % 3 - 1) * 5;
          return {
            ...none,
            opacity: Math.max(cross, 0.3),
            transform: `translateX(${j}px)`,
            filter: `contrast(1.25) saturate(1.5) hue-rotate(${seed % 2 ? 12 : -12}deg)`,
            active: true,
          };
        }
        case 'light-flash':
          return { ...none, whiteAlpha: entering ? 1 - t : t, active: true };
        default:
          return { ...none, opacity: cross, active: true };
      }
    };
    const inWin = winFor(inTr);
    if (localT < inWin) return fxFor(inTr, Math.max(0, Math.min(1, localT / inWin)), 'in');
    const outWin = winFor(outTr);
    if (slack < outWin) return fxFor(outTr, Math.max(0, Math.min(1, 1 - slack / outWin)), 'out');
    return none;
  })();
  const blockFadeOpacity = previewFx.opacity;
  // Avatar is visible only while we're inside the block AND within the configured visibility window.
  const avatarVisibilityCutoff = currentBlock && currentBlock.kind === 'avatar' && currentBlock.avatarVisibleSec !== undefined
    ? (slotById.get(currentBlock.id)?.projectStart ?? 0) + currentBlock.avatarVisibleSec
    : Infinity;
  const avatarStillVisible = playhead < avatarVisibilityCutoff;
  // Unified motion placement for the current block — THE same resolution the
  // export compositor uses (resolveMotionPlacement), so the preview can never
  // show a different composition than the rendered MP4.
  const currentMotionPlacement = currentBlock?.motion ? resolveMotionPlacement(currentBlock) : null;
  // Resolve layout boxes for the current block. B-roll blocks always use 'media-only'.
  // A split motion placement overrides the layout: the export squeezes the
  // avatar into the complementary half for the whole block, so the preview
  // must do the same (placement wins over block.layout).
  const currentLayout: BlockLayout =
    currentMotionPlacement?.area === 'bottom-half' ? 'avatar-top'
    : currentMotionPlacement?.area === 'top-half' ? 'media-top'
    : currentBlock?.kind === 'avatar' ? (currentBlock.layout ?? 'avatar-only') : 'media-only';
  const layoutSlots = getLayoutSlots(currentLayout);
  const avatarBoxStyle = layoutSlots.avatar
    ? { left: `${layoutSlots.avatar.x * 100}%`, top: `${layoutSlots.avatar.y * 100}%`, width: `${layoutSlots.avatar.w * 100}%`, height: `${layoutSlots.avatar.h * 100}%` }
    : null;
  // When a split motion placement is active, the motion owns its half — the
  // export draws no media take there, so the preview must not either.
  const motionOwnsHalf = currentMotionPlacement?.area === 'top-half' || currentMotionPlacement?.area === 'bottom-half';
  const mediaBoxStyle = !motionOwnsHalf && layoutSlots.media
    ? { left: `${layoutSlots.media.x * 100}%`, top: `${layoutSlots.media.y * 100}%`, width: `${layoutSlots.media.w * 100}%`, height: `${layoutSlots.media.h * 100}%` }
    : null;
  const showAvatarVideo = currentBlock?.kind === 'avatar' && currentClip?.status === 'ready' && !!currentClip?.videoUrl && avatarStillVisible && layoutSlots.avatar !== null;
  const [previewVideoError, setPreviewVideoError] = useState<string | null>(null);

  // Reset preview error when clip changes.
  useEffect(() => {
    setPreviewVideoError(null);
  }, [currentClip?.videoUrl]);

  // Keep carousel preview pointing at the first slide after blocks are replaced.
  useEffect(() => {
    if (aspect === 'carousel') setCarouselPreviewId(blocks[0]?.id ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspect, blocks[0]?.id]);

  // ─── Global keyboard shortcuts (CapCut-style) ─────────────────────────
  // Refs keep the handler stable across renders without exhaustive-deps churn.
  const shortcutRefs = useRef({
    playing,
    seekTo,
    totalDuration,
    playhead,
    audioReady: audio.status === 'ready',
    currentBlock,
    slotById,
    selectedBlockId,
    blocks,
    history,
    dispatch,
    bumpPreviewZoom,
    resetPreviewZoom,
  });
  shortcutRefs.current = {
    playing,
    seekTo,
    totalDuration,
    playhead,
    audioReady: audio.status === 'ready',
    currentBlock,
    slotById,
    selectedBlockId,
    blocks,
    history,
    dispatch,
    bumpPreviewZoom,
    resetPreviewZoom,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing inside inputs/textareas/contenteditables.
      const t = e.target as HTMLElement | null;
      const inEditable = !!t && (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        (t as HTMLElement).isContentEditable
      );

      const r = shortcutRefs.current;
      const mod = e.metaKey || e.ctrlKey;

      // ⌘L / Ctrl+L — toggle the embedded agent panel. Works from anywhere.
      if (mod && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        setAgentPanelOpen(o => !o);
        return;
      }

      // Undo / Redo — works even inside inputs (browsers usually do this anyway,
      // but our reducer-history is the source of truth here).
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        // Let the browser handle native undo inside text fields — our reducer
        // text edits are already coalesced and re-running them risks double-undo.
        if (inEditable) return;
        e.preventDefault();
        if (e.shiftKey) r.history.redo();
        else r.history.undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        if (inEditable) return;
        e.preventDefault();
        r.history.redo();
        return;
      }

      // ⌘+ / ⌘= / ⌘- / ⌘0 — preview zoom (Apple-standard). Works even while a
      // text field is focused if the user holds ⌘, since these are deliberate
      // OS-level gestures.
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        r.bumpPreviewZoom(1.25);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        r.bumpPreviewZoom(1 / 1.25);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        r.resetPreviewZoom();
        return;
      }

      if (inEditable) return;

      // Space — play/pause (works with or without audio).
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying(p => !p);
        return;
      }

      // Home / End
      if (e.key === 'Home') {
        e.preventDefault();
        r.seekTo(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        r.seekTo(r.totalDuration);
        return;
      }

      // ←/→ frame (1/30s); Shift+←/→ one second.
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        r.seekTo(r.playhead - step);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        r.seekTo(r.playhead + step);
        return;
      }

      // S — split current block at playhead (CapCut convention).
      if (e.key === 's' || e.key === 'S') {
        const cb = r.currentBlock;
        if (!cb) return;
        const slot = r.slotById.get(cb.id);
        if (!slot) return;
        const localT = r.playhead - slot.projectStart;
        const blockLen = slot.projectEnd - slot.projectStart;
        const MIN_HALF = 0.8;
        const canSplit = localT >= MIN_HALF && (blockLen - localT) >= MIN_HALF;
        if (!canSplit) return;
        e.preventDefault();
        r.dispatch({ type: 'split-block', id: cb.id, atSec: slot.sourceStart + localT });
        return;
      }

      // Delete / Backspace — remove selected block.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!r.selectedBlockId) return;
        if (r.blocks.length <= 1) return; // keep at least one block
        e.preventDefault();
        r.dispatch({ type: 'remove-block', id: r.selectedBlockId });
        setSelectedBlockId(null);
        return;
      }

      // Esc — clear selection.
      if (e.key === 'Escape') {
        setSelectedBlockId(null);
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sync preview <video> with playhead.
  // Master clock = the <audio> element. The avatar <video> chases its currentTime.
  //
  // Sync strategy (3rd iteration — see git history for the previous two):
  // 1. Per-tick force-seek (>80ms) — constant stutter: a WebKit seek costs
  //    100-400ms, the playhead keeps advancing, every tick re-seeked.
  // 2. Seek only on discrete events + free-run — no stutter, but two leaks:
  //    (a) the discrete seek LANDS 100-400ms late (playhead advanced while
  //        the decoder seeked), so every block started with a built-in lag
  //        that never got corrected (stayed under the 350ms threshold);
  //    (b) free-run drift accumulated up to 350ms, then a visible jump.
  // 3. (current) Hard seek only for play-start / block-change / scrubs;
  //    a short post-seek CHASE re-aligns once the seek lands; and during
  //    steady playback an adaptive playbackRate (±12%, video is muted —
  //    imperceptible) continuously converges the residual gap to zero.
  //    No per-frame seeks, no jumps, no standing offset.
  const wasPlayingRef = useRef(false);
  const lastSyncedBlockIdRef = useRef<string | null>(null);
  const chaseSyncRef = useRef(0); // pending post-seek re-alignments
  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v || !currentBlock || currentBlock.kind !== 'avatar') return;
    if (!currentClip || currentClip.status !== 'ready') return;
    const slot = slotById.get(currentBlock.id);
    if (!slot) return;
    const target = Math.max(0, playhead - slot.projectStart);
    const diff = target - v.currentTime; // >0 → vídeo atrasado em relação ao áudio
    const gap = Math.abs(diff);

    const justStartedPlaying = playing && !wasPlayingRef.current;
    const blockChanged = lastSyncedBlockIdRef.current !== currentBlock.id;
    // BIG jump = manual scrub. The adaptive rate below handles anything
    // smaller without a seek.
    const bigJump = gap > 0.5;

    if (justStartedPlaying || blockChanged || bigJump || !playing) {
      // While paused we ALSO sync at fine granularity so the scrubber updates
      // the preview frame as the user drags.
      if (!playing && gap < 0.05) {
        // already aligned
      } else {
        try { v.currentTime = target; } catch { /* ignore */ }
        // The seek will land late — schedule up to 2 chase re-alignments.
        chaseSyncRef.current = playing ? 2 : 0;
      }
      v.playbackRate = 1;
    } else if (playing && chaseSyncRef.current > 0) {
      // Post-seek chase: once the previous seek completed, measure how late
      // it landed and re-align. Near-target seeks are fast (decoder warm),
      // so 1-2 chases converge to <60ms at the START of the block instead
      // of carrying a 100-400ms lag through it.
      if (!v.seeking) {
        if (gap > 0.06) {
          try { v.currentTime = target; } catch { /* ignore */ }
          chaseSyncRef.current -= 1;
        } else {
          chaseSyncRef.current = 0;
        }
      }
    } else if (playing) {
      // Steady playback: adaptive rate correction. The video is muted, so a
      // ±12% rate is invisible; it converges a 0.3s drift in ~2.5s and then
      // hovers at 1.0. This both eliminates accumulated free-run drift AND
      // any residual post-seek offset — with zero seeks (zero stutter).
      const rate = gap < 0.02 ? 1 : 1 + Math.max(-0.12, Math.min(0.12, diff * 0.6));
      if (Math.abs(v.playbackRate - rate) > 0.005) v.playbackRate = rate;
    }
    wasPlayingRef.current = playing;
    lastSyncedBlockIdRef.current = currentBlock.id;
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing && !v.paused) { v.pause(); v.playbackRate = 1; }
  }, [playhead, playing, currentBlock, currentClip, slotById]);

  // When the src of the preview <video> swaps (block changed to a different
  // avatar clip), the browser starts loading the new file but currentTime
  // resets to 0. The sync effect above sets currentTime, but it only sticks
  // once metadata is available. Force a re-seek on loadedmetadata so the
  // first paint of the new clip is at the right offset — mirrors the pattern
  // in MotionLayerOverlay.tsx and prevents a brief "jump to 0" between
  // blocks. Same precedence as the sync effect: trust slotById + playhead.
  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v || !currentBlock || currentBlock.kind !== 'avatar') return;
    if (!currentClip?.videoUrl) return;
    const slot = slotById.get(currentBlock.id);
    if (!slot) return;
    const target = Math.max(0, playhead - slot.projectStart);
    const onMeta = () => {
      // [DESYNC-DIAG] Fase 0 — duração real do clip vs comprimento do bloco (1x por swap).
      // delta > 0 e variando por bloco = HeyGen não mapeia 1:1 (#1). REMOVER depois.
      const blockLen = slot.projectEnd - slot.projectStart;
      console.log(
        '[DESYNC-DIAG/preview/meta] block', currentBlock.id,
        '· clipDur', Number.isFinite(v.duration) ? v.duration.toFixed(3) : 'n/a',
        '· blockLen', blockLen.toFixed(3),
        '· sliceLen(+0.18)', (blockLen + 0.18).toFixed(3),
        '· delta(clip-block)', Number.isFinite(v.duration) ? (v.duration - blockLen).toFixed(3) : 'n/a',
      );
      try { v.currentTime = target; } catch { /* ignore */ }
      if (playing) v.play().catch(() => {});
    };
    v.addEventListener('loadedmetadata', onMeta);
    return () => v.removeEventListener('loadedmetadata', onMeta);
    // playhead/playing intentionally omitted — only re-attach on src change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentClip?.videoUrl, currentBlock?.id]);

  // ─── Edit-video mode: base <video> chases the master audio (project time) ──
  // Same discrete-seek discipline as the avatar chase: force-seek only on play
  // start / big scrub jumps; trust the element to keep its own time during
  // steady playback so WebKit doesn't stutter re-seeking every frame.
  const baseWasPlayingRef = useRef(false);
  useEffect(() => {
    const v = baseVideoRef.current;
    if (!v || state.projectMode !== 'edit' || !state.baseVideoTake) return;
    const target = Math.max(0, playhead); // base video maps 1:1 to project time (no cut yet)
    const gap = Math.abs(v.currentTime - target);
    const justStarted = playing && !baseWasPlayingRef.current;
    const bigJump = gap > 0.35;
    if (justStarted || bigJump || !playing) {
      if (!(!playing && gap < 0.05)) {
        try { v.currentTime = target; } catch { /* ignore */ }
      }
    }
    baseWasPlayingRef.current = playing;
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  }, [playhead, playing, state.projectMode, state.baseVideoTake]);

  const statusPill = (() => {
    if (audio.status === 'generating') return { dotColor: 'warn' as const, pulse: true, text: 'Gerando áudio...' };
    if (audio.status === 'ready') {
      const cutSuffix = state.audio.silenceCut && state.audio.detectedSilenceSec >= 0.1
        ? ` · ✂ ${formatTime(audioEffectiveDuration)}`
        : '';
      return { dotColor: 'ok' as const, pulse: true, text: `Áudio pronto · ${formatTime(audio.duration)}${cutSuffix} · ${selectedVoiceLabel.label}` };
    }
    if (audio.status === 'error')      return { dotColor: 'err' as const, pulse: false, text: audio.error ?? 'Erro' };
    return { dotColor: 'pending' as const, pulse: false, text: 'Sem áudio · gere pra começar' };
  })();

  const tokens = useTheme(state.appTheme);
  const isLight = (state.appTheme ?? 'dark') === 'light';

  // Sync data-theme attribute on <body> so global CSS variables in index.html
  // resolve correctly. Affects scrollbars, default form colors, and any class
  // that uses `bg-surface`/`text-primary` etc.
  useEffect(() => {
    document.body.setAttribute('data-theme', state.appTheme ?? 'dark');
  }, [state.appTheme]);
  const exportEnabled = audio.status === 'ready' && blocks.length > 0;

  return (
    <div
      className="flex flex-row h-full"
      style={{
        backgroundColor: tokens.bg.canvas,
        color: tokens.text.primary,
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      }}
    >
      {/* ─── LANDING (cold-start overlay) ───────────────────────────────────
           Sits above the editor (z-[90]) but below the app modals (z-[100]),
           so "Abrir" pops the projects modal on top and "Novo" opens the
           creation wizard on top — editor stays mounted underneath. */}
      {appView === 'landing' && (
        <LandingScreen
          tokens={tokens}
          isLight={isLight}
          projectCount={savedProjects.length}
          onOpenProject={handleOpenProjects}
          onNewProject={() => setGuidedOpen(true)}
          onEditVideo={handleEditVideo}
          onStartWithAudio={() => setRecordAudioOpen(true)}
          // Dismissible only when opened mid-session via "Início" (not on the
          // first cold-start welcome, where the user must pick an action).
          onClose={landingDismissible ? () => { setLandingDismissible(false); setAppView('editor'); } : undefined}
        />
      )}

      {/* "Começar com meu áudio" — gravar/subir voz que guia o reel */}
      <RecordAudioModal
        open={recordAudioOpen}
        onClose={() => setRecordAudioOpen(false)}
        onConfirm={(blob, name) => void processCreateFromAudio(blob, name)}
      />

      {/* Hidden picker for "Editar vídeo pronto" */}
      <input
        ref={editVideoInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/*"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0];
          e.currentTarget.value = ''; // allow re-picking the same file
          if (f) void processEditVideo(f);
        }}
      />

      {/* Progress overlay while the edit-video pipeline runs */}
      {editVideoStatus !== null && (
        <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
          <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin" />
          <div className="text-white text-sm font-medium max-w-sm text-center px-6">{editVideoStatus}</div>
          <div className="text-white/50 text-[11px]">Editar vídeo · transcrição local com Whisper</div>
        </div>
      )}

      {/* Main editor column — shrinks when the agent panel opens. */}
      <div className="flex flex-col min-w-0 flex-1 h-full">
      {/* ─── TOP BAR ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 h-14 shrink-0"
        style={{
          backgroundColor: tokens.bg.surface,
          borderBottom: `1px solid ${tokens.border.subtle}`,
        }}
      >
        {/* Left: project name + save indicator */}
        <div className="flex items-center min-w-0 gap-1.5">
          {/* Início — opens the landing hub (Abrir / Novo / Editar vídeo) over
              the current project. Closeable via ✕ or Esc. */}
          <button
            onClick={() => { setLandingDismissible(true); setAppView('landing'); }}
            title="Tela inicial (Abrir · Novo · Editar vídeo)"
            className="shrink-0 mr-0.5 p-1.5 rounded-md transition-colors"
            style={{ color: tokens.text.secondary }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10" />
            </svg>
          </button>
          <input
            value={projectName}
            onChange={e => dispatch({ type: 'set-name', name: e.target.value })}
            className="bg-transparent text-sm font-semibold outline-none px-2 py-1 rounded-md transition-colors w-56 truncate"
            style={{ color: tokens.text.primary }}
            onFocus={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
            onBlur={e => e.currentTarget.style.backgroundColor = 'transparent'}
            placeholder="Projeto sem nome"
          />
          {/* Save indicator — Figma/Notion-style. Shows while saving, fades to "salvo" after. */}
          {saving ? (
            <span
              className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md"
              style={{ color: tokens.text.tertiary }}
              title="Salvando..."
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: tokens.status.warn }}
              />
              salvando
            </span>
          ) : savedAt ? (
            <span
              className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md"
              style={{ color: tokens.text.secondary }}
              title={`Salvo ${formatRelativeTime(savedAt)}`}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2.5 6.5L4.8 8.8L9.5 3.5" stroke={tokens.status.ok} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              salvo
            </span>
          ) : null}
        </div>

        {/* Center: status pill (dot + text, no background) */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: tokens.text.secondary }}>
          <span
            className={`w-1.5 h-1.5 rounded-full ${statusPill.pulse ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: tokens.status[statusPill.dotColor] }}
          />
          <span className="tabular-nums">{statusPill.text}</span>
        </div>

        {/* Right: aspect, overflow menu, export */}
        <div className="flex items-center gap-2">
          {/* Aspect switcher — icon only */}
          <div className="relative">
            <button
              onClick={() => setAspectMenuOpen(o => !o)}
              className="h-9 min-w-9 px-2.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
              style={{ color: tokens.text.secondary, backgroundColor: aspectMenuOpen ? tokens.bg.active : 'transparent' }}
              onMouseEnter={e => { if (!aspectMenuOpen) e.currentTarget.style.backgroundColor = tokens.bg.hover; }}
              onMouseLeave={e => { if (!aspectMenuOpen) e.currentTarget.style.backgroundColor = 'transparent'; }}
              title={`Proporção: ${aspect === 'carousel' ? '4:5 Carrossel' : aspect}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <rect x="6" y="3" width="12" height="18" rx="2" />
              </svg>
              <span>{aspect === 'carousel' ? '4:5' : aspect}</span>
            </button>
            {aspectMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1 rounded-lg shadow-2xl py-1 min-w-[160px] z-50"
                style={{ backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}` }}
              >
                {(['9:16','16:9','1:1'] as const).map(a => (
                  <button
                    key={a}
                    onClick={() => { dispatch({ type: 'set-aspect', aspect: a }); setAspectMenuOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                    style={{ color: aspect === a ? tokens.accent.focus : tokens.text.secondary }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >{a}</button>
                ))}
                <div className="my-1" style={{ borderTop: `1px solid ${tokens.border.subtle}` }} />
                <button
                  onClick={() => {
                    dispatch({ type: 'set-aspect', aspect: 'carousel' });
                    setAspectMenuOpen(false);
                    // Empty project + carousel → open wizard with carousel preselected,
                    // skipping the format step entirely.
                    if (blocks.length === 0) {
                      setWizardInitialFormat('carousel');
                      setWizardOpen(true);
                    }
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2"
                  style={{ color: aspect === 'carousel' ? tokens.accent.focus : tokens.text.secondary }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <span>4:5</span>
                  <span className="text-[10px]" style={{ color: tokens.text.tertiary }}>Carrossel</span>
                </button>
              </div>
            )}
          </div>

          {/* Viral Breakdown — direct access button */}
          <button
            onClick={() => setBreakdownDirectOpen(true)}
            className="h-9 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            style={{ color: '#fb7185', backgroundColor: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.2)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(251,113,133,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(251,113,133,0.08)'; }}
            title="Breakdown viral — analisa qualquer vídeo por link"
          >
            🔬 Breakdown
          </button>

          {/* Overflow menu (···) — consolidates Salvar / Projetos / Novo / Referências / Importar / Tema / Settings / Limpar */}
          <div className="relative">
            <button
              onClick={() => setOverflowMenuOpen(o => !o)}
              className="h-9 w-9 rounded-lg flex items-center justify-center transition-colors"
              style={{ color: tokens.text.secondary, backgroundColor: overflowMenuOpen ? tokens.bg.active : 'transparent' }}
              onMouseEnter={e => { if (!overflowMenuOpen) e.currentTarget.style.backgroundColor = tokens.bg.hover; }}
              onMouseLeave={e => { if (!overflowMenuOpen) e.currentTarget.style.backgroundColor = 'transparent'; }}
              title="Mais opções"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="5" cy="12" r="1" />
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
              </svg>
            </button>
            {overflowMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1 rounded-lg shadow-2xl py-1.5 min-w-[260px] z-50 max-h-[80vh] overflow-y-auto"
                style={{ backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}` }}
                onMouseLeave={() => setOverflowMenuOpen(false)}
              >
                {/* Group: Project — auto-save means no manual "save" button. */}
                <div className="px-3 pb-1 text-[10px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Projeto</div>
                <button
                  onClick={() => { setOverflowMenuOpen(false); handleOpenProjects(); }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                  style={{ color: tokens.text.primary }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <svg className="w-3.5 h-3.5" style={{ color: tokens.text.secondary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
                  </svg>
                  <span>Meus projetos</span>
                </button>
                <button
                  onClick={() => {
                    setOverflowMenuOpen(false);
                    // If there's already content in the current project, ask
                    // the user whether to keep it saved or delete it before
                    // starting fresh. Without content there's nothing at risk.
                    if (blocks.length > 0) setNewProjectConfirmOpen(true);
                    else setGuidedOpen(true);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                  style={{ color: tokens.text.primary }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <svg className="w-3.5 h-3.5" style={{ color: tokens.text.secondary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Novo projeto</span>
                </button>
                <button
                  onClick={() => { setOverflowMenuOpen(false); handleEditVideo(); }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                  style={{ color: tokens.text.primary }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  title="Subir um vídeo pronto, transcrever e editar (cortar silêncios, motions)"
                >
                  <svg className="w-3.5 h-3.5" style={{ color: tokens.text.secondary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span>Editar vídeo pronto</span>
                </button>
                {/* Convert the CURRENT loaded project to edit mode (reuse its
                    video as base) — no re-import. Shown when there's a take to use
                    and we're not already in edit mode. */}
                {state.projectMode !== 'edit' && state.takes.length > 0 && (
                  <button
                    onClick={() => { setOverflowMenuOpen(false); dispatch({ type: 'enter-edit-mode' }); }}
                    className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                    style={{ color: tokens.text.primary }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    title="Ativar overlays (texto/elementos) sobre o vídeo que já está neste projeto — sem re-importar"
                  >
                    <svg className="w-3.5 h-3.5" style={{ color: '#60A5FA' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                    <span>Ativar overlays neste vídeo</span>
                  </button>
                )}
                <button
                  onClick={() => { setOverflowMenuOpen(false); setClipRescueOpen(true); }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                  style={{ color: tokens.text.primary }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  title="Reassocia vídeos de avatar que ficaram órfãos depois de splits ou edições"
                >
                  <svg className="w-3.5 h-3.5" style={{ color: tokens.text.secondary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a4 4 0 014 4v2M3 10l4-4m-4 4l4 4" />
                  </svg>
                  <span>Recuperar clips perdidos</span>
                </button>

                <div className="my-1.5" style={{ borderTop: `1px solid ${tokens.border.subtle}` }} />

                {/* Group: Content */}
                <div className="px-3 pb-1 text-[10px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Conteúdo</div>
                <button
                  onClick={() => { setOverflowMenuOpen(false); setReferencesModalOpen(true); }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                  style={{ color: tokens.text.primary }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <svg className="w-3.5 h-3.5" style={{ color: tokens.text.secondary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                  <span className="flex-1">Referências analisadas</span>
                  {state.analyses.length > 0 && (
                    <span className="text-[10px] tabular-nums" style={{ color: tokens.text.tertiary }}>{state.analyses.length}</span>
                  )}
                </button>
                <button
                  onClick={() => { setOverflowMenuOpen(false); setBreakdownDirectOpen(true); }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                  style={{ color: '#fb7185' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <span>🔬</span>
                  <span>Breakdown viral de link</span>
                </button>
                <button
                  onClick={() => { setOverflowMenuOpen(false); setWizardInitialFormat(undefined); setWizardInitialVideoUrl(undefined); setWizardOpen(true); }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                  style={{ color: tokens.text.primary }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <svg className="w-3.5 h-3.5" style={{ color: tokens.text.secondary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                  </svg>
                  <span>Criar com IA</span>
                </button>
                <div className="my-1.5" style={{ borderTop: `1px solid ${tokens.border.subtle}` }} />

                {/* Group: System */}
                <div className="px-3 pb-1 text-[10px] uppercase tracking-wider font-semibold" style={{ color: tokens.text.tertiary }}>Sistema</div>
                {/* App theme segmented control. Light/Dark here is the SINGLE
                    source of truth — it also drives motionColorMode so motions
                    generated after the toggle follow the chosen scheme. Earlier
                    they were independent and users were surprised to see motions
                    stay dark after switching the UI to light. */}
                <div className="px-3 py-1.5">
                  <div className="text-[10px] mb-1" style={{ color: tokens.text.secondary }}>Tema</div>
                  <div className="flex rounded-md p-0.5" style={{ backgroundColor: tokens.bg.hover }}>
                    <button
                      onClick={() => {
                        dispatch({ type: 'set-app-theme', theme: 'light' });
                        dispatch({ type: 'set-motion-color-mode', mode: 'light' });
                      }}
                      className="flex-1 px-2 py-1 rounded text-[11px] flex items-center justify-center gap-1 transition-colors"
                      style={{
                        backgroundColor: isLight ? tokens.bg.surface : 'transparent',
                        color: isLight ? tokens.text.primary : tokens.text.secondary,
                      }}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <circle cx="12" cy="12" r="4" />
                        <path strokeLinecap="round" d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
                      </svg>
                      Claro
                    </button>
                    <button
                      onClick={() => {
                        dispatch({ type: 'set-app-theme', theme: 'dark' });
                        dispatch({ type: 'set-motion-color-mode', mode: 'dark' });
                      }}
                      className="flex-1 px-2 py-1 rounded text-[11px] flex items-center justify-center gap-1 transition-colors"
                      style={{
                        backgroundColor: !isLight ? tokens.bg.surface : 'transparent',
                        color: !isLight ? tokens.text.primary : tokens.text.secondary,
                      }}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                      Escuro
                    </button>
                  </div>
                </div>
                {/* Motion energy segmented control — minimal vs energetic pacing */}
                <div className="px-3 py-1.5">
                  <div className="text-[10px] mb-1" style={{ color: tokens.text.secondary }}>Vibe dos motions</div>
                  <div className="flex rounded-md p-0.5" style={{ backgroundColor: tokens.bg.hover }}>
                    {([
                      { id: 'minimal', label: '🪶 Minimal' },
                      { id: 'energetic', label: '🔥 Energético' },
                    ] as const).map(opt => {
                      const active = (state.motionEnergy ?? 'energetic') === opt.id;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => dispatch({ type: 'set-motion-energy', energy: opt.id })}
                          className="flex-1 px-2 py-1 rounded text-[11px] flex items-center justify-center gap-1 transition-colors"
                          style={{
                            backgroundColor: active ? tokens.bg.surface : 'transparent',
                            color: active ? tokens.text.primary : tokens.text.secondary,
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  onClick={() => { setOverflowMenuOpen(false); setSettingsOpen(true); }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                  style={{ color: tokens.text.primary }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <svg className="w-3.5 h-3.5" style={{ color: tokens.text.secondary }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span>Configurações</span>
                </button>

                <div className="my-1.5" style={{ borderTop: `1px solid ${tokens.border.subtle}` }} />

                <button
                  onClick={() => { setOverflowMenuOpen(false); setConfirmClearMode('clear'); setConfirmClearOpen(true); }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors"
                  style={{ color: tokens.status.err }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                  </svg>
                  <span>Limpar tudo</span>
                </button>
              </div>
            )}
          </div>

          {/* Agents — toggles the embedded Claude Code chat panel. */}
          <button
            onClick={() => setAgentPanelOpen(o => !o)}
            className="h-9 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
            style={{
              backgroundColor: agentPanelOpen ? tokens.accent.bg : tokens.bg.elevated,
              color: agentPanelOpen ? tokens.accent.fg : tokens.text.primary,
              border: `1px solid ${agentPanelOpen ? tokens.accent.bg : tokens.border.subtle}`,
            }}
            title="Abrir chat do agente (⌘L)"
          >
            <span>✨</span>
            Agents
          </button>

          {/* Export — single primary CTA. Dim until actionable. */}
          <div className="relative">
            <button
              onClick={() => setExportMenuOpen(o => !o)}
              disabled={!exportEnabled}
              className="h-9 px-4 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:cursor-not-allowed"
              style={{
                backgroundColor: tokens.accent.bg,
                color: tokens.accent.fg,
                opacity: exportEnabled ? 1 : 0.4,
              }}
              onMouseEnter={e => { if (exportEnabled) e.currentTarget.style.opacity = '0.9'; }}
              onMouseLeave={e => { if (exportEnabled) e.currentTarget.style.opacity = '1'; }}
              title={exportEnabled ? 'Exportar projeto' : 'Gere áudio e adicione blocos antes de exportar'}
            >
              Exportar
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {exportMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1 rounded-lg shadow-2xl py-1 min-w-[260px] z-50"
                style={{ backgroundColor: tokens.bg.elevated, border: `1px solid ${tokens.border.subtle}` }}
              >
                {aspect === 'carousel' ? (
                  <button
                    onClick={handleCarouselExport}
                    disabled={blocks.length === 0 || !!carouselExportStatus}
                    className="w-full text-left px-3 py-2 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ color: tokens.text.primary }}
                    onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = tokens.bg.hover; }}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <span className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: tokens.bg.hover, color: tokens.text.secondary }}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      </svg>
                    </span>
                    <div className="flex-1">
                      <div className="text-xs font-semibold">Exportar carrossel</div>
                      <div className="text-[10px]" style={{ color: tokens.text.tertiary }}>{blocks.length} slide{blocks.length !== 1 ? 's' : ''} · MP4 individuais em .zip</div>
                    </div>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => { setExportMenuOpen(false); setExportOpen(true); }}
                      className="w-full text-left px-3 py-2 transition-colors flex items-center gap-2"
                      style={{ color: tokens.text.primary }}
                      onMouseEnter={e => e.currentTarget.style.backgroundColor = tokens.bg.hover}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <span className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: tokens.bg.hover, color: tokens.text.secondary }}>
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      </span>
                      <div className="flex-1">
                        <div className="text-xs font-semibold">MP4 final · renderizar agora</div>
                        <div className="text-[10px]" style={{ color: tokens.text.tertiary }}>WebCodecs · pronto pra postar</div>
                      </div>
                    </button>
                    <button
                      onClick={handleCapcutExport}
                      disabled={audio.status !== 'ready'}
                      className="w-full text-left px-3 py-2 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ color: tokens.text.primary }}
                      onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = tokens.bg.hover; }}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <span className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: tokens.bg.hover, color: tokens.text.secondary }}>🎞️</span>
                      <div className="flex-1">
                        <div className="text-xs font-semibold">Enviar pro CapCut</div>
                        <div className="text-[10px]" style={{ color: tokens.text.tertiary }}>Aparece em "Recentes" · timeline montada</div>
                      </div>
                    </button>
                    <button
                      onClick={handleCapcutDownloadZip}
                      disabled={audio.status !== 'ready'}
                      className="w-full text-left px-3 py-2 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ color: tokens.text.primary }}
                      onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = tokens.bg.hover; }}
                      onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <span className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: tokens.bg.hover, color: tokens.text.secondary }}>📦</span>
                      <div className="flex-1">
                        <div className="text-xs font-semibold">Baixar pacote (.zip)</div>
                        <div className="text-[10px]" style={{ color: tokens.text.tertiary }}>FCPXML + mídias · pra outros editores</div>
                      </div>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Script editor toggle — borderless icon on far right */}
          <button
            onClick={() => setScriptOpen(o => !o)}
            className="h-9 w-9 rounded-lg flex items-center justify-center transition-colors"
            style={{
              color: scriptOpen ? tokens.text.primary : tokens.text.secondary,
              backgroundColor: scriptOpen ? tokens.bg.active : 'transparent',
            }}
            onMouseEnter={e => { if (!scriptOpen) e.currentTarget.style.backgroundColor = tokens.bg.hover; }}
            onMouseLeave={e => { if (!scriptOpen) e.currentTarget.style.backgroundColor = 'transparent'; }}
            title={scriptOpen ? 'Ocultar editor' : 'Mostrar editor'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Transient export status — floating toast strip below the top bar, no longer in toolbar */}
      {(capcutExportStatus || carouselExportStatus) && (
        <div
          className="absolute top-14 left-1/2 -translate-x-1/2 z-40 mt-2 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 shadow-lg"
          style={{
            backgroundColor: tokens.bg.elevated,
            color: tokens.text.primary,
            border: `1px solid ${tokens.border.subtle}`,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: tokens.status.ok }}
          />
          {capcutExportStatus || carouselExportStatus}
        </div>
      )}

      {/* ─── PREVIEW + SCRIPT ───────────────────────────────────────────── */}
      {/* minHeight guarantees the phone preview NEVER collapses to zero when
          the lower panels (inspector/montar/timeline) stack up — the user must
          always see the video they're editing. */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 260 }}>
        <div
          className="flex-1 flex flex-col items-center justify-center p-6 overflow-hidden relative"
          style={{ backgroundColor: tokens.bg.canvas }}
          onWheel={(e) => {
            // macOS trackpad pinch arrives as wheel + ctrlKey. We swallow it
            // so the browser doesn't try to zoom the whole page, and translate
            // the delta into a smooth previewZoom multiplier. Step is small
            // because pinch fires many events per gesture.
            if (e.ctrlKey) {
              e.preventDefault();
              const factor = e.deltaY < 0 ? 1.04 : 1 / 1.04;
              bumpPreviewZoom(factor);
            }
          }}
        >
          {/* Edit-video motion config moved to the right panel (Motion Dock
              under the selected speech card) — same anatomy as creation. */}

          <div
            className={`relative ${aspectClass} bg-black rounded-2xl overflow-hidden`}
            style={{
              boxShadow: isLight ? '0 12px 40px rgba(0,0,0,0.18)' : '0 30px 80px rgba(0,0,0,0.8)',
              border: `1px solid ${tokens.border.subtle}`,
              // Transition fx compose with the zoom (whip translate / zoom-blur
              // scale). The 120ms CSS transition is disabled while a boundary
              // effect drives the transform per-frame — easing would lag it.
              transform: `scale(${previewZoom})${previewFx.transform ? ` ${previewFx.transform}` : ''}`,
              transformOrigin: 'center center',
              transition: previewFx.active ? 'none' : 'transform 120ms cubic-bezier(0.2, 0, 0.2, 1)',
              filter: previewFx.filter || undefined,
              // Container for cqh units so edit-video overlay text scales to the
              // preview box height (matches the renderer's height*0.05 sizing).
              containerType: 'size',
            }}
          >
            {aspect === 'carousel' ? (
              <CarouselCanvasPreview
                block={blocks.find(b => b.id === carouselPreviewId) ?? blocks[0] ?? null}
                index={Math.max(0, blocks.findIndex(b => b.id === carouselPreviewId))}
                total={blocks.length}
                onPrev={() => {
                  const idx = blocks.findIndex(b => b.id === carouselPreviewId);
                  if (idx > 0) setCarouselPreviewId(blocks[idx - 1].id);
                }}
                onNext={() => {
                  const idx = blocks.findIndex(b => b.id === carouselPreviewId);
                  if (idx < blocks.length - 1) setCarouselPreviewId(blocks[idx + 1].id);
                }}
              />
            ) : (<>
            {/* Black background — fills the whole canvas (any unfilled layout area stays black). */}
            <div className="absolute inset-0 bg-black z-0" />

            {/* Edit-video mode: full-frame base video chasing the master audio.
                Muted (the <audio> element is the master); covers the canvas.
                When a SPLIT motion overlay is active at the playhead, the base
                is squeezed into the complementary half — mirroring the export
                compositor (base.box = underlyingBox + coral seam), so the
                split doesn't read as "the panel covered my video". */}
            {state.projectMode === 'edit' && state.baseVideoTake && (() => {
              const activeSplitEl = (state.overlayElements ?? []).find(el => {
                if (el.kind !== 'motion' || el.motion?.status !== 'ready') return false;
                if (playhead < el.startSec || playhead >= el.startSec + el.durationSec) return false;
                const a = placementOfElement(el).area;
                return a === 'top-half' || a === 'bottom-half';
              });
              const splitArea = activeSplitEl ? placementOfElement(activeSplitEl).area : null;
              // Motion occupies its half; base video gets the OTHER half.
              const baseStyle: React.CSSProperties = splitArea === 'top-half'
                ? { position: 'absolute', left: 0, right: 0, top: '50%', bottom: 0, width: '100%', height: '50%' }
                : splitArea === 'bottom-half'
                  ? { position: 'absolute', left: 0, right: 0, top: 0, width: '100%', height: '50%' }
                  : { position: 'absolute', inset: 0, width: '100%', height: '100%' };
              // User framing shift (↕ Vídeo) — same offsetY semantics as the
              // export compositor (fraction of the video box height).
              const baseShift = state.baseVideoTake.offsetY ?? 0;
              return (
                <>
                  <video
                    ref={baseVideoRef}
                    key={`base-${state.baseVideoTake.id}`}
                    src={state.baseVideoTake.url}
                    muted
                    playsInline
                    preload="auto"
                    className="z-[5]"
                    style={{
                      ...baseStyle, objectFit: 'cover', backgroundColor: 'black', zIndex: 5,
                      transform: baseShift !== 0 ? `translateY(${(baseShift * 100).toFixed(1)}%)` : undefined,
                    }}
                  />
                  {splitArea && (
                    <div
                      className="absolute left-0 right-0 pointer-events-none z-[10]"
                      style={{ top: 'calc(50% - 1px)', height: 2, backgroundColor: 'rgba(217,119,87,0.65)' }}
                    />
                  )}
                </>
              );
            })()}

            {/* Edit-video overlay elements alive at the playhead (text + motion). */}
            {state.projectMode === 'edit' && (state.overlayElements ?? [])
              .filter(el => playhead >= el.startSec && playhead < el.startSec + el.durationSec)
              .map(el => {
                if (el.kind === 'motion' && motionLayerHidden) return null;
                if (el.kind === 'motion' && el.motion?.status === 'ready') {
                  // AI-generated motion clip — unified placement drives the
                  // preview exactly like the export compositor (float/split/full).
                  // CRITICAL: this wrapper must NOT have a z-index. A z-index
                  // here creates a stacking context that ISOLATES the inner
                  // mix-blend-mode:screen — the blend stops seeing the base
                  // video (a sibling) and the float's black canvas renders
                  // OPAQUE over the footage ("flutuar não flutua"). The inner
                  // MotionLayerOverlay layers (scrim z-25, motion z-30) order
                  // themselves above the base video (z-5) in the root context.
                  const placement = placementOfElement(el);
                  return (
                    <div key={el.id} className="absolute inset-0 pointer-events-none">
                      <MotionLayerOverlay
                        motion={el.motion}
                        playing={playing}
                        layer={el.mode === 'fullscreen' ? 'replace' : 'overlay'}
                        placement={placement}
                        localTime={Math.max(0, playhead - el.startSec - (placement.startOffsetSec ?? 0))}
                      />
                    </div>
                  );
                }
                // Text caption element.
                return el.mode === 'fullscreen' ? (
                  <div
                    key={el.id}
                    className="absolute inset-0 z-[8] flex items-center justify-center px-[7%] text-center"
                    style={{ background: 'linear-gradient(135deg,#0a0a0c,#16161a)' }}
                  >
                    <span style={{ color: el.color || '#fff', fontWeight: 800, fontSize: `${5 * (el.fontScale || 1)}cqh`, lineHeight: 1.2, textShadow: '0 2px 14px rgba(0,0,0,0.65)' }}>{el.text}</span>
                  </div>
                ) : (
                  <div
                    key={el.id}
                    className="absolute z-[8] left-0 right-0 flex items-center justify-center px-[7%] text-center pointer-events-none"
                    style={{ top: `${el.y * 100}%`, transform: 'translateY(-50%)' }}
                  >
                    <span style={{ color: el.color || '#fff', fontWeight: 800, fontSize: `${5 * (el.fontScale || 1)}cqh`, lineHeight: 1.2, textShadow: '0 2px 14px rgba(0,0,0,0.65)' }}>{el.text}</span>
                  </div>
                );
              })}

            {/* Media layer (B-roll) — draws below the avatar layer. Renders if layout has media slot AND a take is available. */}
            {state.projectMode !== 'edit' && mediaBoxStyle && activeTake && (
              <div className="absolute z-10 overflow-hidden bg-black" style={{ ...(mediaBoxStyle as React.CSSProperties), opacity: blockFadeOpacity }}>
                <TakeVideoPlayer key={`media-${currentBlock?.id}-${activeTake.id}`} take={activeTake} />
              </div>
            )}

            {/* The whole avatar/take/placeholder chain below is CREATION
                machinery. In edit-video mode the base video IS the person —
                rendering the "sem avatar ainda" placeholder here (z-15)
                covered the user's footage whenever the fala was 🎥 Vídeo
                (kind avatar), reading as "Vídeo mostra nada, B-roll mostra
                meu vídeo" — inverted. Edit mode renders none of this. */}
            {state.projectMode === 'edit' ? null
            : showAvatarVideo && currentClip?.videoUrl && !previewVideoError && avatarBoxStyle ? (
              <>
                <video
                  ref={previewVideoRef}
                  // Stable key — never remount the element when blocks change.
                  // The original key={`${blockId}-${videoUrl}`} caused React to
                  // unmount the previous <video> and mount a fresh one on every
                  // block boundary, producing a 1-2 frame gap where the
                  // element didn't exist while `blockFadeOpacity` was still
                  // interpolating (= the visible "piscada"). Now the element
                  // persists across blocks; only the `src` attribute swaps,
                  // which triggers a load + the existing useEffect re-syncs
                  // currentTime. Mirrors the pattern used by MotionLayerOverlay.
                  key="avatar-preview-video"
                  src={currentClip.videoUrl}
                  muted
                  playsInline
                  preload="auto"
                  autoPlay
                  style={{
                    position: 'absolute',
                    ...avatarBoxStyle,
                    objectFit: 'cover',
                    backgroundColor: 'black',
                    // Split layouts: avatar and motion are in different halves — no overlap,
                    // z-index only matters for overlay mode where motion blends over avatar.
                    // overlay → avatar below motion (z-index 20, motion is z-index 30)
                    // all other modes → avatar and motion don't overlap, keep at z-index 20
                    zIndex: 20,
                    opacity: blockFadeOpacity,
                    transform: `scale(${currentBlock?.kind === 'avatar' ? (currentBlock.avatarZoom ?? defaultAvatarZoom(state.aspect, currentBlock.layout)) : 1})`,
                    transformOrigin: 'center center',
                  } as React.CSSProperties}
                  onError={(e) => {
                    const v = e.currentTarget as HTMLVideoElement;
                    const code = v.error?.code ?? 0;
                    const msg = v.error?.message ?? 'desconhecido';
                    console.error('[reels] Preview video error:', { src: v.currentSrc, code, message: msg });
                    setPreviewVideoError(`Code ${code}: ${msg}`);
                  }}
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget as HTMLVideoElement;
                    console.log('[reels] Preview video metadata:', { width: v.videoWidth, height: v.videoHeight, duration: v.duration });
                  }}
                  onLoadedData={() => console.log('[reels] Preview video loaded:', currentClip.videoUrl)}
                />
                <button
                  onClick={() => window.open(currentClip.videoUrl, '_blank', 'noopener,noreferrer')}
                  className="absolute top-3 right-3 px-3 py-1.5 rounded-md bg-black/60 hover:bg-black/80 backdrop-blur text-[11px] font-medium text-white transition-colors flex items-center gap-1.5 z-20"
                  title="Abrir vídeo em nova aba"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Abrir em nova aba
                </button>
              </>
            ) : showAvatarVideo && previewVideoError && currentClip?.videoUrl ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-red-500/10 via-zinc-900 to-zinc-950 p-6 gap-4">
                <div className="text-amber-400 text-3xl">⚠</div>
                <div className="text-sm text-zinc-200 text-center">Player do app não conseguiu carregar.</div>
                <div className="text-[10px] text-zinc-500 text-center font-mono break-all max-w-xs">{previewVideoError}</div>
                <button
                  onClick={() => window.open(currentClip.videoUrl, '_blank', 'noopener,noreferrer')}
                  className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-400 text-xs font-semibold text-white transition-colors flex items-center gap-2"
                >
                  Abrir vídeo em nova aba
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </button>
                <button
                  onClick={() => { setPreviewVideoError(null); previewVideoRef.current?.load(); }}
                  className="text-[11px] text-zinc-400 underline hover:text-zinc-200 transition-colors"
                >
                  Tentar de novo
                </button>
              </div>
            ) : currentBlock?.kind === 'avatar' && !avatarStillVisible && activeTake ? (
              // Avatar block but past visibility cutoff → fill the avatar box with the active take.
              avatarBoxStyle ? (
                <div className="absolute z-20 overflow-hidden bg-black" style={avatarBoxStyle as React.CSSProperties}>
                  <TakeVideoPlayer key={`avatar-cover-${activeTake.id}`} take={activeTake} />
                </div>
              ) : null
            ) : currentBlock?.kind === 'avatar' ? (
              // Avatar-not-yet-generated placeholder. Doubles as a backdrop for
              // motion overlays so the user can preview their motion before
              // committing to a HeyGen render. Kept visually muted (silhouette
              // on dark gradient) so the motion stays the visual focus.
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-zinc-800 via-zinc-900 to-black z-[15]">
                <div className="text-center px-6">
                  {/* Silhouette avatar — neutral grey so motion overlays (screen blend) read well over it */}
                  <div className="w-40 h-40 rounded-full bg-gradient-to-b from-zinc-600 to-zinc-700 mx-auto mb-5 flex items-center justify-center opacity-60">
                    <svg className="w-20 h-20 text-zinc-900/40" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">👤 Seu avatar entra AQUI</div>
                  <div className="mt-1 text-[10px] text-zinc-600">ainda não gerado — use "Gerar avatares" · o que você vê por cima é a camada ✨ motion</div>
                  {state.avatarClips[currentBlock.id] && state.avatarClips[currentBlock.id].status !== 'ready' && (
                    <div className="mt-3 text-[11px] text-blue-300">⏳ {state.avatarClips[currentBlock.id].message ?? state.avatarClips[currentBlock.id].status}</div>
                  )}
                </div>
              </div>
            ) : currentBlock?.kind === 'broll' && !activeTake ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-500/10 via-zinc-900 to-zinc-950">
                <div className="text-center">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-400/20 to-emerald-600/20 border border-emerald-400/30 mx-auto mb-3 flex items-center justify-center">
                    <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" strokeLinecap="round" /></svg>
                  </div>
                  <div className="text-xs uppercase tracking-widest text-emerald-300/70">Screen Recording</div>
                  <div className="text-sm text-zinc-400 mt-1">Clique em "Gravar Tela" pra capturar B-roll</div>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/50">
                <div className="text-zinc-600 text-xs">— sem mídia —</div>
              </div>
            )}

            {/* Motion overlay — position derived from current block layout, not
                from motion.layer (which reflects the Gemini prompt canvas, not
                the live preview layout). This keeps motion and avatar in sync
                when the user changes layout after generating the motion. */}
            {currentBlock?.motion && currentMotionPlacement && !motionLayerHidden && (() => {
              const motion = currentBlock.motion;
              // THE same placement resolution as the export compositor
              // (resolveMotionPlacement) — placement chosen in the Dock wins;
              // legacy motions derive from the block's current layout. The
              // preview can never show a different composition than the MP4.
              const placement = currentMotionPlacement;
              // Visibility window (director / "Quando" sliders): outside
              // [offset, offset+duration) the motion is simply not mounted —
              // the avatar/take underneath shows through, mirroring the
              // compositor's window gating.
              const slot = slotById.get(currentBlock.id);
              const blockLocalT = slot ? Math.max(0, playhead - slot.projectStart) : 0;
              const blockDur = slot ? slot.projectEnd - slot.projectStart : (currentBlock.end - currentBlock.start);
              const startOffset = placement.startOffsetSec ?? 0;
              const visibleDur = Math.max(0, Math.min(placement.durationSec ?? (blockDur - startOffset), blockDur - startOffset));
              if (blockLocalT < startOffset || blockLocalT >= startOffset + visibleDur) return null;
              // The motion renders even before the avatar clip exists — the
              // placeholder behind doubles as a "what this could look like"
              // mockup (screen-blend reads fine over the grey silhouette).
              return (
                <div className="absolute inset-0" style={{ opacity: blockFadeOpacity, pointerEvents: 'none' }}>
                  <MotionLayerOverlay
                    key={`motion-${motion.id}-${motion.renderedAt ?? 0}`}
                    motion={motion}
                    playing={playing}
                    layer={layerOfPlacement(placement)}
                    placement={placement}
                    localTime={blockLocalT - startOffset}
                  />
                </div>
              );
            })()}

            {/* 👁 layer isolation — hide the AI motion layers to see the
                avatar/footage underneath. Visible whenever a motion could be
                on screen. Preview-only; export is untouched. */}
            {(currentBlock?.motion || (state.projectMode === 'edit' && (state.overlayElements ?? []).some(el => el.kind === 'motion'))) && (
              <button
                onClick={() => setMotionLayerHidden(v => !v)}
                className="absolute bottom-3 right-3 z-[65] px-2.5 py-1 rounded-md backdrop-blur text-[10px] font-medium transition-colors flex items-center gap-1.5"
                style={motionLayerHidden
                  ? { backgroundColor: 'rgba(251,191,36,0.2)', color: '#fcd34d', border: '1px solid rgba(251,191,36,0.45)' }
                  : { backgroundColor: 'rgba(0,0,0,0.6)', color: '#a1a1aa', border: '1px solid rgba(255,255,255,0.1)' }}
                title={motionLayerHidden
                  ? 'Camada de motion OCULTA — você está vendo só o que fica por baixo (avatar/vídeo). Clique pra mostrar de novo.'
                  : 'Ocultar a camada de motion (✨ IA) pra ver o avatar/vídeo por baixo'}
              >
                {motionLayerHidden ? '👁 motion oculto' : '👁 motion'}
              </button>
            )}

            {/* Transition flash overlays (fade→black · light-flash→white). */}
            {previewFx.blackAlpha > 0.01 && (
              <div className="absolute inset-0 pointer-events-none z-[60]" style={{ backgroundColor: '#000', opacity: previewFx.blackAlpha }} />
            )}
            {previewFx.whiteAlpha > 0.01 && (
              <div className="absolute inset-0 pointer-events-none z-[60]" style={{ backgroundColor: '#fff', opacity: previewFx.whiteAlpha }} />
            )}

            <div className="absolute top-3 right-3 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur text-[10px] font-mono text-zinc-300">
              {formatTime(cutOn ? sourceToEffective(playhead) : playhead)} / {formatTime(viewDuration)}
            </div>
            <div className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur text-[10px] font-medium text-zinc-400">{aspect}</div>
            {currentBlock?.motion && (() => {
              const m = currentBlock.motion;
              const busy = motionBusyByBlock[currentBlock.id];
              const isReady = m.status === 'ready' && !!m.videoPath;
              const isError = m.status === 'error';
              const isGenerating = m.status === 'generating' || (busy && !m.html);
              const isRendering = m.status === 'rendering' || (busy && !!m.html && !isReady);
              const tone = isError ? 'bg-red-500/30 border-red-400/40 text-red-100'
                : isReady ? 'bg-emerald-500/30 border-emerald-400/40 text-emerald-100'
                : isGenerating ? 'bg-amber-500/30 border-amber-400/40 text-amber-100'
                : isRendering ? 'bg-cyan-500/30 border-cyan-400/40 text-cyan-100'
                : 'bg-blue-500/25 border-blue-400/40 text-blue-100';
              const label = isError ? '✨ Motion (camada IA) · erro'
                : isReady ? '✨ Motion (camada IA) · pronto'
                : isGenerating ? '✨ Motion (camada IA) · gerando…'
                : isRendering ? `✨ Motion (camada IA) · ${busy ?? 'renderizando…'}`
                : '✨ Motion (camada IA) ativo';
              return (
                <div className={`absolute bottom-3 left-3 px-2 py-0.5 rounded-md backdrop-blur text-[10px] font-medium border ${tone} ${(isGenerating || isRendering) ? 'animate-pulse' : ''}`}>
                  {label}
                </div>
              );
            })()}
            </>)}
          </div>

          {/* Zoom controls — bottom-right of the preview area. Sketch / Final
              Cut style: − [100%] + grouped in a single pill. The center label
              is a button (click = reset). Hidden during playback so it doesn't
              compete with the video. */}
          {!playing && aspect !== 'carousel' && (
            <div
              className="absolute bottom-4 right-4 flex items-center select-none"
              style={{
                backgroundColor: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)',
                border: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 999,
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                padding: 2,
                opacity: previewZoomHudVisible ? 1 : 0.55,
                transition: 'opacity 200ms ease',
              }}
              onMouseEnter={() => setPreviewZoomHudVisible(true)}
              onMouseLeave={() => setPreviewZoomHudVisible(false)}
            >
              <button
                onClick={() => bumpPreviewZoom(1 / 1.25)}
                disabled={previewZoom <= 0.5}
                className="w-6 h-6 flex items-center justify-center rounded-full transition-colors disabled:opacity-30"
                style={{ color: isLight ? '#1d1d1f' : '#fff', cursor: previewZoom <= 0.5 ? 'not-allowed' : 'pointer', background: 'transparent', border: 'none' }}
                title="Diminuir zoom (⌘−)"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" d="M5 12h14"/></svg>
              </button>
              <button
                onClick={resetPreviewZoom}
                className="px-2 h-6 flex items-center justify-center rounded-full text-[10px] font-mono font-medium transition-colors"
                style={{
                  color: previewZoom === 1
                    ? (isLight ? '#86868b' : 'rgba(255,255,255,0.55)')
                    : (isLight ? '#1d1d1f' : '#fff'),
                  cursor: 'pointer',
                  background: 'transparent',
                  border: 'none',
                  minWidth: 44,
                }}
                title="Resetar zoom (⌘0)"
              >
                {Math.round(previewZoom * 100)}%
              </button>
              <button
                onClick={() => bumpPreviewZoom(1.25)}
                disabled={previewZoom >= 4}
                className="w-6 h-6 flex items-center justify-center rounded-full transition-colors disabled:opacity-30"
                style={{ color: isLight ? '#1d1d1f' : '#fff', cursor: previewZoom >= 4 ? 'not-allowed' : 'pointer', background: 'transparent', border: 'none' }}
                title="Aumentar zoom (⌘+)"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" d="M12 5v14M5 12h14"/></svg>
              </button>
            </div>
          )}

          <div className={`flex items-center gap-3 mt-4 ${aspect === 'carousel' ? 'hidden' : ''}`}>
            <button onClick={() => seekTo(0)} className="p-2 rounded-lg hover:bg-white/5 text-zinc-400 transition-colors" title="Início (Home)">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
            </button>
            <button
              onClick={() => setPlaying(p => !p)}
              className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-2xl"
              title={playing ? 'Pausar (Space)' : 'Tocar (Space)'}
            >
              {playing ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>
                       : <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
            </button>
            <button onClick={() => seekTo(totalDuration)} className="p-2 rounded-lg hover:bg-white/5 text-zinc-400 transition-colors" title="Fim (End)">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M16 6h2v12h-2zm-9.5 6L15 6v12z"/></svg>
            </button>
            {/* Split button — visible when playhead sits inside a block with room to split. */}
            {(() => {
              if (!currentBlock) return null;
              const slot = slotById.get(currentBlock.id);
              if (!slot) return null;
              const localT = playhead - slot.projectStart;
              const blockLen = slot.projectEnd - slot.projectStart;
              const MIN_HALF = 0.8;
              const canSplit = localT >= MIN_HALF && (blockLen - localT) >= MIN_HALF;
              return (
                <button
                  onClick={() => dispatch({ type: 'split-block', id: currentBlock.id, atSec: slot.sourceStart + localT })}
                  disabled={!canSplit}
                  className="ml-2 px-3 py-2 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/40 text-[11px] font-semibold text-blue-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                  title={canSplit ? `Dividir bloco em ${localT.toFixed(1)}s (S)` : 'Aproxime o playhead do meio do bloco pra dividir (S)'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                    <line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" />
                  </svg>
                  Dividir aqui
                </button>
              );
            })()}
          </div>
        </div>

        {/* ─── SCRIPT EDITOR ────────────────────────────────────────────── */}
        {scriptOpen && (
          <div
            className="min-w-[320px] w-[min(420px,40vw)] flex flex-col shrink-0"
            style={{
              backgroundColor: tokens.bg.surface,
              borderLeft: `1px solid ${tokens.border.subtle}`,
              color: tokens.text.primary,
            }}
          >
            <div
              className="px-5 py-4 flex items-center justify-between"
              style={{ borderBottom: `1px solid ${tokens.border.subtle}` }}
            >
              <div>
                <div className="text-sm font-semibold" style={{ color: tokens.text.primary }}>{aspect === 'carousel' ? 'Slides' : 'Script'}</div>
                <div className="text-[11px]" style={{ color: tokens.text.tertiary }}>
                  {aspect === 'carousel'
                    ? `${blocks.length} slide${blocks.length !== 1 ? 's' : ''} · Cover + ${Math.max(0, blocks.length - 2)} body + CTA`
                    : `${blocks.length} blocos · ${formatTime(totalDuration)}`}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {aspect !== 'carousel' && blocks.length > 0 && (
                  <button
                    onClick={() => {
                      setEditAllBlocks(blocks);
                      setEditAllOpen(true);
                    }}
                    className="px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[11px] font-medium text-zinc-300 transition-colors"
                    title="Reabre o painel de revisão com os blocos atuais"
                  >
                    ✏ Editar tudo
                  </button>
                )}
                {aspect === 'carousel' && blocks.length > 0 && (
                  <button
                    onClick={() => {
                      // Build the list of pending block ids upfront, then
                      // hand it to the shared serialized batcher. Without
                      // this, the fire-and-forget loop would launch every
                      // block in parallel — 8 blocks = 8 Chromium renders
                      // fighting for the same GPU and most timing out.
                      const pendingIds = blocks
                        .filter(b => {
                          const m = b.motion;
                          const isStale = isMotionAssetsStale(m, b.attachedAssets);
                          return !motionBusyByBlock[b.id] && (!m?.html || isStale);
                        })
                        .map(b => b.id);
                      if (pendingIds.length === 0) return;
                      void handleAutoMotionMany(pendingIds);
                    }}
                    className="text-[11px] px-2 py-1 rounded-md bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/30 transition-colors flex items-center gap-1"
                    title="Gerar motion para todos os slides que ainda não têm"
                  >
                    <span>🎨</span> Gerar todos
                  </button>
                )}
                <button
                  onClick={() => dispatch({ type: 'add-block' })}
                  className="text-[11px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors"
                  title={aspect === 'carousel' ? 'Adicionar slide' : 'Adicionar bloco vazio'}
                >
                  {aspect === 'carousel' ? '+ Slide' : '+ Bloco'}
                </button>
                {state.lastAnalysis && (
                  <button
                    onClick={() => setPlanModalOpen(true)}
                    className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md text-[11px] transition-colors"
                    style={{ color: tokens.text.secondary, backgroundColor: tokens.bg.hover }}
                    title="Ver plano de gravação"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    <span>Plano</span>
                  </button>
                )}
              </div>
            </div>

            {/* Voice + Vibe — creation only: in edit-video mode the voice IS
                the user's own recording, so the TTS voice/vibe picker is noise. */}
            {aspect !== 'carousel' && state.projectMode !== 'edit' && (() => {
              const VIBE_OPTS = [
                { id: 'neutral',   emoji: '😐', label: 'Neutro' },
                { id: 'happy',     emoji: '😊', label: 'Animado' },
                { id: 'sad',       emoji: '😢', label: 'Triste' },
                { id: 'angry',     emoji: '😠', label: 'Bravo' },
                { id: 'surprised', emoji: '😲', label: 'Surpreso' },
                { id: 'fearful',   emoji: '😰', label: 'Ansioso' },
              ] as const;
              const currentVibe = VIBE_OPTS.find(v => v.id === emotion) ?? VIBE_OPTS[0];
              const isOpen = voicePickerOpen || vibeExpanded;
              return (
                <div className="border-b border-white/5">
                  {/* Collapsed header row */}
                  <button
                    onClick={() => {
                      const next = !isOpen;
                      setVoicePickerOpen(false);
                      setVibeExpanded(next);
                    }}
                    className="w-full px-4 py-2.5 flex items-center gap-2 text-left group hover:bg-white/[0.02] transition-colors"
                    title={isOpen ? 'Recolher' : 'Expandir voz e vibe'}
                  >
                    <div className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold text-white ${selectedVoiceLabel.isCustom ? 'bg-gradient-to-br from-blue-400 to-blue-600' : 'bg-gradient-to-br from-zinc-500 to-zinc-700'}`}>
                      {selectedVoiceLabel.label.slice(0, 1).toUpperCase()}
                    </div>
                    <span className="text-[11px] font-medium text-zinc-200 truncate max-w-[90px]">{selectedVoiceLabel.label}</span>
                    {selectedVoiceLabel.isCustom && (
                      <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-300 uppercase tracking-wider shrink-0">Sua</span>
                    )}
                    <span className="text-zinc-600 shrink-0">·</span>
                    <span className="text-[11px] text-zinc-400 flex items-center gap-1 shrink-0">
                      <span>{currentVibe.emoji}</span>
                      <span>{currentVibe.label}</span>
                    </span>
                    {voiceSpeed !== 1 && (
                      <>
                        <span className="text-zinc-600 shrink-0">·</span>
                        <span className="text-[11px] text-zinc-400 font-mono shrink-0">{voiceSpeed.toFixed(2)}×</span>
                      </>
                    )}
                    <svg className={`w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-transform ml-auto shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded panel */}
                  {isOpen && (
                    <div className="px-4 pb-3 space-y-3">
                      {/* Voice picker inline */}
                      <button
                        onClick={() => setVoicePickerOpen(o => !o)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/5 border border-white/10 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${selectedVoiceLabel.isCustom ? 'bg-gradient-to-br from-blue-400 to-blue-600 ring-2 ring-blue-300/40' : 'bg-gradient-to-br from-zinc-500 to-zinc-700'}`}>
                            {selectedVoiceLabel.label.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="text-left">
                            <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                              {selectedVoiceLabel.label}
                              {selectedVoiceLabel.isCustom && <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-300 uppercase tracking-wider">Sua</span>}
                            </div>
                            <div className="text-[10px] text-zinc-500">{selectedVoiceLabel.hint}</div>
                          </div>
                        </div>
                        <svg className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${voicePickerOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {voicePickerOpen && (
                        <div className="mt-1 max-h-[300px] overflow-y-auto rounded-lg bg-[#0A0A0B] border border-white/10">
                          {/* MINHAS VOZES */}
                          <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-wider text-blue-300/60 font-semibold">Minhas vozes</div>
                          {clonedVoices.length === 0 ? (
                            <div className="px-3 pb-2 text-[10px] text-zinc-600 italic">Nenhuma voz salva ainda.</div>
                          ) : (
                            clonedVoices.map(v => {
                              const daysLeft = Math.max(0, Math.floor((v.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
                              const isSelected = selectedVoiceId === v.voiceId;
                              return (
                                <div key={v.id} className={`group flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 transition-colors ${isSelected ? 'bg-blue-500/10' : ''}`}>
                                  <button onClick={() => { dispatch({ type: 'set-voice', voiceId: v.voiceId }); setVoicePickerOpen(false); }} className="flex items-center gap-2.5 flex-1 text-left">
                                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-[9px] font-bold text-white ring-2 ring-blue-300/30">
                                      {v.name.slice(0, 1).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-[11px] font-medium text-zinc-200 truncate">{v.name}</div>
                                      <div className="text-[9px] text-zinc-500 truncate">
                                        {daysLeft > 1 ? `Expira em ${daysLeft} dias` : daysLeft === 1 ? 'Expira amanhã' : 'Expira hoje'} · {v.model}
                                      </div>
                                    </div>
                                    {isSelected && <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>}
                                  </button>
                                  <button
                                    onClick={async (e) => { e.stopPropagation(); if (await confirmDialog(`Remover a voz "${v.name}"?`)) { deleteClonedVoice(v.id); refreshClonedVoices(); } }}
                                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-all"
                                    title="Remover"
                                  >
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                  </button>
                                </div>
                              );
                            })
                          )}
                          <button
                            onClick={() => { setSaveVoiceModalOpen(true); setVoicePickerOpen(false); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-blue-500/10 transition-colors text-left border-y border-white/5 mt-1"
                          >
                            <div className="w-6 h-6 rounded-full bg-blue-500/20 border border-dashed border-blue-400/40 flex items-center justify-center text-blue-300">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                            </div>
                            <div className="flex-1">
                              <div className="text-[11px] font-medium text-blue-200">Salvar voice_id do Minimax</div>
                              <div className="text-[9px] text-zinc-500">Cole o ID que você já tem</div>
                            </div>
                          </button>
                          <div className="px-3 pt-3 pb-1 text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">Vozes padrão</div>
                          {VOICE_OPTIONS.map(v => (
                            <button key={v.id} onClick={() => { dispatch({ type: 'set-voice', voiceId: v.id }); setVoicePickerOpen(false); }} className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 transition-colors text-left ${v.id === selectedVoiceId ? 'bg-blue-500/10' : ''}`}>
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${v.gender === 'female' ? 'bg-gradient-to-br from-pink-400 to-rose-600' : 'bg-gradient-to-br from-cyan-400 to-blue-600'}`}>
                                {v.label.slice(0, 1)}
                              </div>
                              <div className="flex-1">
                                <div className="text-[11px] font-medium text-zinc-200">{v.label}</div>
                                <div className="text-[9px] text-zinc-500">{v.hint}</div>
                              </div>
                              {v.id === selectedVoiceId && <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Vibe controls */}
                      <div className="flex flex-wrap gap-1.5">
                        {VIBE_OPTS.map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => dispatch({ type: 'set-emotion', emotion: opt.id })}
                            className={`px-2.5 py-1 rounded-full text-[10.5px] font-medium border transition-colors flex items-center gap-1 ${
                              emotion === opt.id
                                ? 'bg-blue-500/20 border-blue-400/50 text-blue-100'
                                : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20'
                            }`}
                          >
                            <span>{opt.emoji}</span>
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 shrink-0">Ritmo</span>
                        <input
                          type="range"
                          min={0.85}
                          max={1.2}
                          step={0.05}
                          value={voiceSpeed}
                          onChange={e => dispatch({ type: 'set-voice-speed', speed: parseFloat(e.target.value) })}
                          className="flex-1 accent-blue-400"
                        />
                        <span className="text-[11px] text-zinc-300 font-mono tabular-nums w-10 text-right">{voiceSpeed.toFixed(2)}×</span>
                      </div>
                      {audio.status === 'ready' && (
                        <button
                          onClick={() => setConfirmOpen(true)}
                          className="w-full py-2 rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-[11px] font-semibold text-white shadow-[0_0_15px_rgba(10,132,255,0.35)] transition-all flex items-center justify-center gap-1.5"
                          title="Refaz o áudio com a emoção e ritmo escolhidos"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Recriar áudio com nova vibe
                        </button>
                      )}
                      {audio.status === 'generating' && (
                        <div className="text-[10px] text-blue-300 flex items-center gap-1.5 justify-center">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Gerando…
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5 relative">
              {/* Multi-select floating toolbar — appears when 2+ blocks are selected via shift/cmd+click. */}
              {multiSelectIds.size > 1 && (
                <div
                  className="sticky top-0 z-30 flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg backdrop-blur"
                  style={{
                    backgroundColor: 'rgba(15,15,18,0.92)',
                    border: `1px solid ${tokens.border.subtle}`,
                  }}
                >
                  <span className="text-xs font-semibold" style={{ color: tokens.text.primary }}>
                    {multiSelectIds.size} blocos selecionados
                  </span>
                  <div className="h-4 w-px" style={{ backgroundColor: tokens.border.subtle }} />
                  <select
                    onChange={e => {
                      const layout = e.target.value as BlockLayout;
                      for (const id of multiSelectIds) dispatch({ type: 'set-block-layout', id, layout });
                      e.target.value = '';
                    }}
                    defaultValue=""
                    className="bg-transparent text-xs px-1.5 py-1 rounded outline-none"
                    style={{ color: tokens.text.primary, border: `1px solid ${tokens.border.subtle}` }}
                  >
                    <option value="" disabled>📐 Layout</option>
                    <option value="avatar-only">Avatar only</option>
                    <option value="media-only">Media only</option>
                    <option value="avatar-top">Avatar top / Media bottom</option>
                    <option value="media-top">Media top / Avatar bottom</option>
                  </select>
                  <select
                    onChange={e => {
                      const transition = e.target.value as BlockTransition;
                      for (const id of multiSelectIds) dispatch({ type: 'set-block-transition', id, transition });
                      e.target.value = '';
                    }}
                    defaultValue=""
                    className="bg-transparent text-xs px-1.5 py-1 rounded outline-none"
                    style={{ color: tokens.text.primary, border: `1px solid ${tokens.border.subtle}` }}
                  >
                    <option value="" disabled>▾ Transição</option>
                    <option value="cut">╳ Cut</option>
                    <option value="fade">▾ Fade</option>
                    <option value="dissolve">◐ Dissolve</option>
                    <option value="whip-pan">↔ Whip pan</option>
                    <option value="zoom-blur">⊕ Zoom blur</option>
                    <option value="glitch">⚡ Glitch</option>
                    <option value="light-flash">✶ Light flash</option>
                  </select>
                  <select
                    onChange={e => {
                      const preset = e.target.value as StylePresetId;
                      for (const id of multiSelectIds) dispatch({ type: 'set-block-style-preset', id, preset });
                      e.target.value = '';
                    }}
                    defaultValue=""
                    className="bg-transparent text-xs px-1.5 py-1 rounded outline-none"
                    style={{ color: tokens.text.primary, border: `1px solid ${tokens.border.subtle}` }}
                  >
                    <option value="" disabled>🎭 Papel</option>
                    {STYLE_PRESETS.filter(p => p.id !== 'claude-ui' && !isHidden(p.id)).map(p => (
                      <option key={p.id} value={p.id}>{p.emoji} {p.roleLabel ?? p.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setMultiSelectIds(new Set())}
                    className="ml-auto w-6 h-6 rounded flex items-center justify-center"
                    style={{ color: tokens.text.tertiary }}
                    title="Limpar seleção (ESC)"
                  >×</button>
                </div>
              )}
              {aspect === 'carousel' ? (

                // ── CAROUSEL MODE: dedicated CarouselSlideCard, no avatar/layout/audio ──
                blocks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
                    <div className="text-sm font-semibold" style={{ color: tokens.text.primary }}>Comece seu carrossel</div>
                    <button
                      onClick={() => { setWizardInitialFormat('carousel'); setWizardInitialVideoUrl(undefined); setWizardOpen(true); }}
                      className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity"
                      style={{ backgroundColor: tokens.accent.bg, color: tokens.accent.fg }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                    >
                      + Criar com IA
                    </button>
                    <div className="text-[11px]" style={{ color: tokens.text.tertiary }}>ou adicione slides manualmente</div>
                  </div>
                ) : (
                  blocks.map((b, idx) => {
                    const isCover = idx === 0;
                    const isCta   = idx === blocks.length - 1;
                    const role: 'cover' | 'body' | 'cta' = isCover ? 'cover' : isCta ? 'cta' : 'body';
                    return (
                      <CarouselSlideCard
                        key={b.id}
                        block={b}
                        index={idx}
                        total={blocks.length}
                        role={role}
                        motionBusyMessage={motionBusyByBlock[b.id] ?? null}
                        isSelected={b.id === carouselPreviewId}
                        onSelect={() => setCarouselPreviewId(b.id)}
                        onUpdateText={(t) => dispatch({ type: 'update-block-text', id: b.id, text: t })}
                        onRemove={() => dispatch({ type: 'remove-block', id: b.id })}
                        onMoveUp={() => dispatch({ type: 'move-block', id: b.id, direction: 'up' as const })}
                        onMoveDown={() => dispatch({ type: 'move-block', id: b.id, direction: 'down' as const })}
                        onDuplicate={() => dispatch({ type: 'duplicate-block', id: b.id })}
                        onOpenMotion={() => {
                          const m = b.motion;
                          const isStale = isMotionAssetsStale(m, b.attachedAssets);
                          if (m && m.html && !isStale) {
                            setMotionPickerBlockId(b.id);
                          } else {
                            void handleAutoMotion(b.id);
                          }
                        }}
                        onOpenMotionAdvanced={() => setMotionPickerBlockId(b.id)}
                        onOpenAssetPicker={() => setAssetPickerBlockId(b.id)}
                        onSetStylePreset={(preset) => dispatch({ type: 'set-block-style-preset-cascade', id: b.id, preset })}
                      />
                    );
                  })
                )
              ) : blocks.length === 0 && hydrated ? (
                // ── REEL MODE empty state ──
                <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                  <div className="text-sm font-semibold" style={{ color: tokens.text.primary }}>Comece seu reel</div>
                  <button
                    onClick={() => { setWizardInitialFormat(undefined); setWizardInitialVideoUrl(undefined); setWizardOpen(true); }}
                    className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity"
                    style={{ backgroundColor: tokens.accent.bg, color: tokens.accent.fg }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                  >
                    + Criar com IA
                  </button>
                  <div className="text-[11px]" style={{ color: tokens.text.tertiary }}>ou adicione um bloco manualmente abaixo</div>
                </div>
              ) : (
                // ── REEL MODE: full ScriptBlockCard with avatar/broll/motion controls ──
                (() => {
                  const cardProps = (b: ScriptBlock, idx: number, isCompact?: boolean) => ({
                    block: b,
                    index: idx,
                    total: blocks.length,
                    wordCount: wordsByBlock.get(b.id)?.length ?? 0,
                    audioReady: audio.status === 'ready',
                    onToggleKind: () => dispatch({ type: 'toggle-block-kind', id: b.id }),
                    onUpdateText: (t: string) => dispatch({ type: 'update-block-text', id: b.id, text: t }),
                    onRemove: () => { dispatch({ type: 'remove-block', id: b.id }); if (selectedBlockId === b.id) setSelectedBlockId(null); },
                    onMoveUp: () => dispatch({ type: 'move-block', id: b.id, direction: 'up' as const }),
                    onMoveDown: () => dispatch({ type: 'move-block', id: b.id, direction: 'down' as const }),
                    onSetAvatarVisibleSec: (sec: number | undefined) => dispatch({ type: 'set-avatar-visible-sec', id: b.id, sec }),
                    onSetLayout: (layout: BlockLayout) => dispatch({ type: 'set-block-layout', id: b.id, layout }),
                    onSetAvatarZoom: (zoom: number) => dispatch({ type: 'set-avatar-zoom', id: b.id, zoom }),
                    onSetAvatarOffsetY: (offsetY: number) => dispatch({ type: 'set-avatar-offset-y', id: b.id, offsetY }),
                    onSetAvatarPhoto: (photoId: string | undefined) => dispatch({ type: 'set-block-avatar-photo', id: b.id, photoId }),
                    defaultZoom: defaultAvatarZoom(state.aspect, b.layout),
                    isCurrent: currentBlock?.id === b.id,
                    isSelected: selectedBlockId === b.id || multiSelectIds.has(b.id),
                    compact: isCompact,
                    onSelect: (e?: React.MouseEvent) => {
                      const isShift = !!e?.shiftKey;
                      const isMeta = !!(e?.metaKey || e?.ctrlKey);
                      if (isShift && selectedBlockId) {
                        // Range select between previously focused block and this one.
                        const anchorIdx = blocks.findIndex(x => x.id === selectedBlockId);
                        const targetIdx = blocks.findIndex(x => x.id === b.id);
                        if (anchorIdx >= 0 && targetIdx >= 0) {
                          const [from, to] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
                          const range = new Set<string>();
                          for (let i = from; i <= to; i++) range.add(blocks[i].id);
                          setMultiSelectIds(range);
                          return;
                        }
                      }
                      if (isMeta) {
                        setMultiSelectIds(prev => {
                          const next = new Set(prev);
                          if (next.has(b.id)) next.delete(b.id);
                          else next.add(b.id);
                          return next;
                        });
                        return;
                      }
                      // Plain click → clear multi-select and select this one.
                      if (multiSelectIds.size > 0) setMultiSelectIds(new Set());
                      selectAndSeekBlock(b.id);
                    },
                    onJumpTo: () => selectAndSeekBlock(b.id),
                    onOpenMotion: () => {
                      const m = b.motion;
                      const isStale = isMotionAssetsStale(m, b.attachedAssets);
                      if (m && m.html && !isStale) {
                        setMotionPickerBlockId(b.id);
                      } else {
                        void handleAutoMotion(b.id);
                      }
                    },
                    onOpenMotionAdvanced: () => setMotionPickerBlockId(b.id),
                    onOpenAssetPicker: () => setAssetPickerBlockId(b.id),
                    onSetStylePreset: (preset: StylePresetId | undefined) => dispatch({ type: 'set-block-style-preset-cascade', id: b.id, preset }),
                    onDuplicate: () => dispatch({ type: 'duplicate-block', id: b.id }),
                    motionBusyMessage: motionBusyByBlock[b.id] ?? null,
                    // Edit-video mode: speech segments of the user's own video —
                    // the creation asset-gate and per-block cost don't apply.
                    requiresAsset: state.projectMode === 'edit' ? false : requiresAssetAttachment(b, projectAssetsCount),
                    carouselRole: undefined,
                    editMode: state.projectMode === 'edit',
                  });

                  const selectedIdx = selectedBlockId ? blocks.findIndex(b => b.id === selectedBlockId) : -1;
                  if (selectedIdx < 0) {
                    return blocks.map((b, idx) => <ScriptBlockCard key={b.id} {...cardProps(b, idx)} />);
                  }
                  const selected = blocks[selectedIdx];
                  return (
                    <>
                      <ScriptBlockCard key={selected.id} {...cardProps(selected, selectedIdx)} />
                      {/* Motion Dock — the single home of motion config (mockup
                          anatomy: preview big in the center, dock in the right
                          column, right under the selected block). */}
                      {renderMotionDockSection(selected)}
                      {blocks.length > 1 && (
                        <div className="pt-3 mt-1 border-t border-white/5 space-y-1.5">
                          <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500 px-1 mb-1.5 flex items-center justify-between">
                            <span>Outros blocos</span>
                            <button
                              onClick={() => setSelectedBlockId(null)}
                              className="text-[9px] text-zinc-500 hover:text-zinc-300 normal-case tracking-normal"
                            >
                              mostrar todos
                            </button>
                          </div>
                          {blocks.map((b, idx) => idx === selectedIdx ? null : <ScriptBlockCard key={b.id} {...cardProps(b, idx, true)} />)}
                        </div>
                      )}
                    </>
                  );
                })()
              )}
            </div>

            {aspect !== 'carousel' && (
              <div className="border-t border-white/5 bg-[#0A0A0B]/50">
                {/* Collapsible header */}
                <button
                  onClick={() => setAudioSectionExpanded(v => !v)}
                  className="w-full px-5 py-2.5 flex items-center gap-2 text-left group hover:bg-white/[0.02] transition-colors"
                  title={audioSectionExpanded ? 'Recolher' : 'Expandir áudio'}
                >
                  <span className="text-[11px] font-medium text-zinc-300">Áudio</span>
                  <span className="text-zinc-600 shrink-0">·</span>
                  <span className="text-[11px] text-zinc-400 truncate">
                    {audio.status === 'ready'
                      ? hasDirtyBlocks
                        ? 'Texto alterado · regenere'
                        : `Pronto · ${formatTime(audio.duration)}`
                      : audio.status === 'generating'
                        ? 'Gerando…'
                        : audio.status === 'error'
                          ? 'Erro · tentar de novo'
                          : `Estimado · $${estimatedTotalCost.toFixed(2)}`}
                  </span>
                  <svg
                    className={`w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-transform ml-auto shrink-0 ${audioSectionExpanded ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded body */}
                {audioSectionExpanded && (
                  <div className="px-5 pb-4">
                    {audio.status === 'ready' && (
                      <div className="mb-3">
                        <SilenceCutControl
                          enabled={state.audio.silenceCut}
                          preset={state.audio.silencePreset}
                          detecting={state.audio.detectingSilence}
                          applying={!!state.audio.applyingCuts}
                          detectedSilenceSec={state.audio.detectedSilenceSec}
                          effectiveDuration={audioEffectiveDuration}
                          rawDuration={state.audio.duration}
                          onToggle={(on) => dispatch({ type: 'audio-silence-toggle', on })}
                          onPresetChange={(preset) => dispatch({ type: 'audio-silence-preset', preset })}
                        />
                      </div>
                    )}

                    {showCostBreakdown && (
                      <>
                        <div className="flex items-center justify-between text-[11px] mb-2">
                          <span className="text-zinc-500">Áudio</span>
                          <span className="text-zinc-300 font-mono">${estimatedAudioCost.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] mb-3">
                          <span className="text-zinc-500">Avatar ({avatarSeconds.toFixed(1)}s)</span>
                          <span className="text-zinc-300 font-mono">${estimatedAvatarCost.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] mb-3 pt-2 border-t border-white/5">
                          <span className="text-zinc-300 font-medium">Total estimado</span>
                          <span className="text-zinc-100 font-bold">${estimatedTotalCost.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    {/* Gemini actual cost tracker */}
                    <div className="mt-2.5 pt-2.5 border-t border-white/5 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-zinc-400 font-semibold">Gasto API Gemini (Real)</span>
                        <span className="text-emerald-400 font-bold font-mono">${totalGeminiCost.toFixed(4)} USD</span>
                      </div>
                      <div className="pl-1 space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-zinc-500">Motions ({blocks.filter(b => b.motion?.html).length} gerados)</span>
                          <span className="text-zinc-400 font-mono">${geminiMotionCost.toFixed(4)}</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-zinc-500">Análise de Vídeo ({state.analyses.length + (state.lastAnalysis ? 1 : 0)} analisados)</span>
                          <span className="text-zinc-400 font-mono">${geminiAnalysisCost.toFixed(4)}</span>
                        </div>
                      </div>
                    </div>
                    {(audio.status === 'idle' || audio.status === 'generating' || audio.status === 'error' || (audio.status === 'ready' && hasDirtyBlocks)) && (
                      <button
                        onClick={() => setConfirmOpen(true)}
                        disabled={audio.status === 'generating'}
                        className="w-full py-2.5 rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(10,132,255,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        title={`Custo estimado · $${estimatedTotalCost.toFixed(2)}`}
                      >
                        {audio.status === 'generating'
                          ? '⏳ Gerando áudio...'
                          : audio.status === 'error'
                          ? '⚠️ Tentar novamente'
                          : audio.status === 'ready'
                          ? `🔄 Regenerar áudio · $${estimatedAudioCost.toFixed(2)}`
                          : '🎙️ Gerar áudio'}
                      </button>
                    )}
                    {audio.status === 'error' && <div className="mt-2 text-[10px] text-red-400">{audio.error}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── INSPECTOR (Apple-style contextual block editor) ─────────────────
           Onda 1 — replaces per-card inline expansion. Lives between the
           preview/script row and the timeline, full-width across them. */}
      {aspect !== 'carousel' && (() => {
        const selBlock = selectedBlockId ? blocks.find(b => b.id === selectedBlockId) ?? null : null;
        const selDefaultZoom = selBlock?.kind === 'avatar'
          ? defaultAvatarZoom(state.aspect, selBlock.layout)
          : 1;
        // Inputs for the deterministic effect detector. Cheap to compute; the
        // Inspector re-runs detectEffect on each render and uses these to paint
        // the "auto" badge on whichever effect chip matches the current block.
        const selBlockIndex = selBlock ? blocks.findIndex(b => b.id === selBlock.id) : -1;
        const brandIdentity = state.brandIdentity as { logoSvg?: string } | undefined;
        const brandHasLogo = !!brandIdentity?.logoSvg && brandIdentity.logoSvg.length > 0;
        const brandHasIdentity = !!brandIdentity && Object.keys(brandIdentity).length > 0;
        const selAudioWordCount = selBlock ? state.audio.words.filter(w => w.blockId === selBlock.id).length : 0;
        return (
          <InspectorPanel
            block={selBlock}
            appTheme={state.appTheme}
            editMode={state.projectMode === 'edit'}
            multiSelectCount={multiSelectIds.size}
            aspect={state.aspect}
            defaultZoom={selDefaultZoom}
            audioReady={audio.status === 'ready'}
            onSetAvatarZoom={selBlock ? (z) => dispatch({ type: 'set-avatar-zoom', id: selBlock.id, zoom: z }) : undefined}
            onSetAvatarOffsetY={selBlock ? (o) => dispatch({ type: 'set-avatar-offset-y', id: selBlock.id, offsetY: o }) : undefined}
            onSetAvatarVisibleSec={selBlock ? (s) => dispatch({ type: 'set-avatar-visible-sec', id: selBlock.id, sec: s }) : undefined}
            onSetLayout={selBlock ? (l) => dispatch({ type: 'set-block-layout', id: selBlock.id, layout: l }) : undefined}
            onSetAvatarPhoto={selBlock ? (id) => dispatch({ type: 'set-block-avatar-photo', id: selBlock.id, photoId: id }) : undefined}
            onSetStylePreset={selBlock ? (preset) => dispatch({ type: 'set-block-style-preset', id: selBlock.id, preset }) : undefined}
            onSetMotionPlacement={selBlock ? (placement) => {
              // Merge the placement into the existing motion, or seed a draft
              // carrying it — the generation pipeline reads motion.placement.
              const existing = selBlock.motion;
              const draft = existing ?? createMotionFromBlock(selBlock);
              dispatch({ type: 'set-block-motion', id: selBlock.id, motion: { ...draft, placement } });
            } : undefined}
            motionModelOverride={selBlock?.motionModelOverride}
            onSetMotionModel={selBlock ? (model) => dispatch({ type: 'set-block-motion-model', id: selBlock.id, model }) : undefined}
            onOpenMotion={selBlock ? () => setMotionPickerBlockId(selBlock.id) : undefined}
            onGenerateMotion={selBlock ? () => handleAutoMotion(selBlock.id) : undefined}
            motionBusy={selBlock ? (motionBusyByBlock[selBlock.id] ?? null) : null}
            motionColorMode={state.motionColorMode ?? (state.appTheme === 'light' ? 'light' : 'dark')}
            onSetMotionColorMode={(mode) => dispatch({ type: 'set-motion-color-mode', mode })}
            onOpenAssetPicker={selBlock ? () => setAssetPickerBlockId(selBlock.id) : undefined}
            onToggleKind={selBlock ? () => dispatch({ type: 'toggle-block-kind', id: selBlock.id }) : undefined}
            blockIndex={selBlockIndex >= 0 ? selBlockIndex : 0}
            blockTotal={blocks.length}
            brandHasLogo={brandHasLogo}
            brandHasIdentity={brandHasIdentity}
            audioWordCount={selAudioWordCount}
            requiresAsset={selBlock ? requiresAssetAttachment(selBlock, projectAssetsCount) : false}
          />
        );
      })()}

      {/* ─── MONTAR (guided staged production) — own strip above the timeline,
           so it never eats into the timeline's fixed height / clips tracks.
           Hidden in edit-video mode: the imported video IS the person talking,
           so "Gerar avatares"/staged production makes no sense there. ── */}
      {aspect !== 'carousel' && state.projectMode !== 'edit' && blocks.length > 0 && (() => {
        const avatarReady = avatarBlocks.filter(b => state.avatarClips[b.id]?.status === 'ready').length;
        // Candidates: blocks with no motion yet + blocks whose motion needs a
        // (re)render (html newer than the MP4, or never rendered). The batch
        // routes html-blocks straight to render — this pill is THE single
        // batch entry point now (the ⋯ menu duplicates were removed).
        const motionCandidates = blocks.filter(b => {
          if (requiresAssetAttachment(b, projectAssetsCount)) return false;
          const m = b.motion;
          if (!m?.html) return true;
          if (!m.videoPath) return true;
          if (m.generatedAt && m.renderedAt && m.generatedAt > m.renderedAt) return true;
          return false;
        });
        const motionDone = blocks.filter(b => !!b.motion?.videoPath).length;
        return (
          <MontarBar
            tokens={tokens}
            audioStatus={audio.status}
            avatarTotal={avatarBlocks.length}
            avatarReady={avatarReady}
            generatingClips={generatingClips}
            motionCandidates={motionCandidates.length}
            motionDone={motionDone}
            motionTotal={blocks.length}
            batch={batchMotionProgress}
            onAudio={() => setConfirmOpen(true)}
            onAvatars={() => setAvatarsModalOpen(true)}
            onMotions={() => { const ids = motionCandidates.map(b => b.id); if (ids.length) void handleAutoMotionMany(ids); }}
            onCancelBatch={() => { batchMotionCancelRef.current = true; }}
            onExport={exportEnabled ? () => setExportOpen(true) : undefined}
            avatarChips={avatarBlocks.map(b => {
              const s = state.avatarClips[b.id]?.status;
              return s === 'ready' ? 'done' : s === 'error' ? 'error' : s && s !== 'idle' ? 'running' : 'pending';
            })}
          />
        );
      })()}

      {/* ─── EDIT-VIDEO toolbar — the edit-mode counterpart of the MontarBar
           (approved v2 mockup): video info + the single global entry point
           for overlay generation via the scene director. ── */}
      {aspect !== 'carousel' && state.projectMode === 'edit' && blocks.length > 0 && (() => {
        const overlayMotions = (state.overlayElements ?? []).filter(e => e.kind === 'motion');
        const hasReadyOverlay = (blockId: string) =>
          (state.overlayElements ?? []).some(e => e.id === `ovmot_${blockId}` && e.kind === 'motion' && e.motion?.status === 'ready');
        const eligible = blocks.filter(x => (x.end - x.start) >= 1.0);
        // Só as que FALTAM — quem já tem overlay pronto não regenera por aqui
        // (regerar é por fala, no Dock).
        const editTargets = eligible.filter(x => !hasReadyOverlay(x.id));
        const allDone = eligible.length > 0 && editTargets.length === 0;
        return (
          <div className="flex items-center gap-3 px-4 py-2 border-t border-b border-white/5" style={{ backgroundColor: '#111114' }}>
            <span className="text-[11px] font-semibold text-zinc-300 shrink-0">📼 Edição de vídeo</span>
            <span className="text-[10px] text-zinc-500 truncate">
              {state.baseVideoTake?.name ?? 'vídeo importado'} · {blocks.length} falas · {overlayMotions.length} overlay{overlayMotions.length === 1 ? '' : 's'}
            </span>
            {/* Vertical framing of the base video — live, applies to preview
                AND export (FrameLayer.offsetY). Positive = video down (black
                opens at the top for floating overlays). */}
            <span className="flex items-center gap-1.5 shrink-0 ml-2" title="Desloca o vídeo verticalmente — abre espaço pro overlay (preview e export)">
              <span className="text-[9.5px] text-zinc-500">↕ Vídeo</span>
              <input
                type="range" min={-40} max={40} step={1}
                value={Math.round((state.baseVideoTake?.offsetY ?? 0) * 100)}
                onChange={e => dispatch({ type: 'set-base-video-offset-y', offsetY: parseInt(e.target.value, 10) / 100 })}
                className="w-24" style={{ accentColor: '#60A5FA', height: 3 }}
              />
              <button
                onClick={() => dispatch({ type: 'set-base-video-offset-y', offsetY: 0 })}
                className="text-[9px] w-9 text-right font-mono text-zinc-400 hover:text-zinc-200"
                title="Clique pra zerar"
              >{Math.round((state.baseVideoTake?.offsetY ?? 0) * 100)}%</button>
            </span>
            <button
              onClick={() => { if (!overlayGenerating && editTargets.length > 0) void handleGenerateOverlays(editTargets, 'auto', editDockValue.placement); }}
              disabled={overlayGenerating || editTargets.length === 0}
              className="ml-auto shrink-0 px-3.5 py-1.5 rounded-lg text-[11px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={allDone
                ? { backgroundColor: 'rgba(16,185,129,0.15)', color: '#6ee7b7', border: '1px solid rgba(16,185,129,0.4)' }
                : { background: 'linear-gradient(180deg, #60A5FA, #2563EB)', boxShadow: '0 2px 10px rgba(37,99,235,0.35)' }}
              title={allDone ? 'Todas as falas já têm overlay. Pra refazer uma, selecione a fala e use "Gerar pra esta fala" no Dock.' : 'Gera overlay só pras falas que ainda não têm'}
            >
              {overlayGenerating ? '⏳ Gerando overlays…'
                : allDone ? '✓ Todas geradas'
                : `⚡ Gerar overlays que faltam (${editTargets.length})`}
            </button>
            {(() => {
              const marked = blocks.filter(x => x.motionSetup);
              if (marked.length === 0 || overlayGenerating) return null;
              return (
                <button
                  onClick={() => void handleGenerateOverlays(marked, 'auto', editDockValue.placement)}
                  className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white transition-opacity hover:opacity-90"
                  style={{ background: 'linear-gradient(180deg, #fbbf24, #d97706)' }}
                  title="Gera só as falas marcadas (🏷), cada uma com a config salva nela"
                >
                  🏷 Gerar marcadas ({marked.length})
                </button>
              );
            })()}
            {overlayGenerating && (
              <button
                onClick={() => { overlayCancelRef.current = true; }}
                className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
                style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}
                title="Para depois da fala atual terminar (a geração em andamento não é interrompida no meio)"
              >
                ✕ Cancelar
              </button>
            )}
          </div>
        );
      })()}

      {/* ─── TIMELINE (hidden in carousel mode — no audio timeline concept) ── */}
      {/* Compact timeline (Rob's request on the v2 mockup): lower lanes give
          ~40px of vertical space back to the preview above. */}
      <div className={`h-[260px] border-t border-white/5 bg-[#0C0C0E] flex flex-col shrink-0 ${aspect === 'carousel' ? 'hidden' : ''}`}>
        <div className="flex items-center justify-between px-5 py-2 border-b border-white/5">
          <div className="flex items-center gap-2">
            <TakesPanel
              takes={state.takes}
              activeTakeId={state.activeTakeId}
              onSelectTake={(id) => dispatch({ type: 'set-active-take', id })}
              onRemoveTake={(id) => dispatch({ type: 'remove-take', id })}
              onRenameTake={(id, name) => dispatch({ type: 'rename-take', id, name })}
              onEditTake={(id) => setReviewTakeId(id)}
              onRecordNew={() => setAddBrollOpen(true)}
            />

            {/* Manual-action menu. The agent is the primary path; this menu
                exists for the actions the agent can't (yet) trigger itself,
                or for power users who prefer direct control. */}
            {(() => {
              const items: Array<{
                key: string;
                label: string;
                hint?: string;
                onClick: () => void;
                disabled?: boolean;
                disabledHint?: string;
                visible?: boolean;
                icon: string;
              }> = [
                {
                  key: 'broll',
                  icon: '➕',
                  label: 'Adicionar B-roll',
                  hint: 'Grave a tela ou suba um vídeo',
                  onClick: () => setAddBrollOpen(true),
                },
                {
                  key: 'audio',
                  icon: '🎙',
                  label: 'Gerar áudio',
                  hint: 'TTS do roteiro com a voz ativa',
                  onClick: () => setConfirmOpen(true),
                },
                {
                  key: 'caption',
                  icon: '📸',
                  label: 'Descrição do Instagram',
                  hint: 'Caption + hashtags via IA',
                  onClick: () => setCaptionOpen(v => !v),
                },
                {
                  key: 'avatars',
                  icon: '✨',
                  label: generatingClips
                    ? 'Gerando clipes…'
                    : `Gerar clipes de avatar (${avatarBlocks.length})`,
                  hint: 'HeyGen renderiza um vídeo por bloco avatar',
                  onClick: () => setAvatarsModalOpen(true),
                  disabled: audio.status !== 'ready' || avatarBlocks.length === 0 || generatingClips,
                  disabledHint:
                    audio.status !== 'ready'
                      ? 'Gere o áudio primeiro'
                      : avatarBlocks.length === 0
                      ? 'Marque ao menos 1 bloco como Avatar'
                      : undefined,
                },
                {
                  key: 'mock',
                  icon: '🎨',
                  label: 'Clipes de teste (mock)',
                  hint: 'Clipes coloridos pra testar export sem gastar HeyGen',
                  onClick: handleGenerateMockClips,
                  disabled: generatingClips,
                  visible: avatarBlocks.length > 0,
                },
                // Motion batch actions intentionally NOT here — "Gerar todos"
                // lives in the MontarBar phase pill + the empty motion-track
                // CTA (single discoverable hierarchy, no duplicate surfaces).
                {
                  key: 'assets',
                  icon: '🖼',
                  label: 'Abrir pasta de assets',
                  hint: 'Coloque imagens e clipes pra usar no projeto',
                  onClick: async () => {
                    await invoke('reveal_assets_dir', { projectName: state.projectName });
                    // Refresh count — user likely opened the folder to add files.
                    // The recheck happens when AssetPickerModal closes too, but
                    // many users drop files via Finder without ever opening the
                    // modal. Without this, the gate is stale until next mount.
                    void refreshProjectAssetsCount();
                  },
                },
                {
                  key: 'suggest-roles',
                  icon: '🎭',
                  label: 'Sugerir papéis nos blocos',
                  hint: 'Detecta hook/estatística/CTA pelo conteúdo e aplica o preset certo',
                  onClick: async () => {
                    const { detectRolesForBlocks } = await import('./reelsStudio/roleDetector');
                    const suggestions = detectRolesForBlocks(blocks);
                    console.log('[suggest-roles] detectado:', blocks.map(b => ({
                      id: b.id.slice(-6),
                      text: b.text.slice(0, 40),
                      atual: b.stylePresetOverride ?? '(default)',
                      sugerido: suggestions[b.id],
                    })));
                    // Apply ALL suggestions (overrides any current preset). User can undo via Ctrl+Z.
                    console.log('[suggest-roles] aplicando em', blocks.length, 'blocos');
                    for (const b of blocks) {
                      const sugg = suggestions[b.id];
                      if (sugg) dispatch({ type: 'set-block-style-preset', id: b.id, preset: sugg });
                    }
                  },
                  disabled: blocks.length === 0,
                },
                {
                  key: 'resplit',
                  icon: '🪓',
                  label: 'Quebrar blocos longos',
                  hint: 'Aplica o limite configurado em Settings nos blocos atuais',
                  onClick: handleResplitBlocks,
                  disabled: audio.status !== 'ready' || audio.words.length === 0 || blocks.length === 0,
                  disabledHint:
                    audio.status !== 'ready'
                      ? 'Gere o áudio primeiro'
                      : audio.words.length === 0
                        ? 'Sem timestamps de palavras pra usar como corte'
                        : undefined,
                },
              ];

              return (
                <ActionsMenu
                  items={items.filter(i => i.visible !== false)}
                  tokens={tokens}
                />
              );
            })()}

            <div className="ml-2 flex items-center gap-0.5 border-l border-white/10 pl-2">
              <button
                onClick={() => history.undo()}
                disabled={!history.canUndo}
                title="Desfazer (⌘Z)"
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h11a4 4 0 010 8h-1m-10-8l3-3m-3 3l3 3" />
                </svg>
              </button>
              <button
                onClick={() => history.redo()}
                disabled={!history.canRedo}
                title="Refazer (⌘⇧Z)"
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 10H10a4 4 0 000 8h1m10-8l-3-3m3 3l-3 3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Caption modal */}
          {captionOpen && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-6" onClick={() => setCaptionOpen(false)}>
              <div className="bg-[#141416] border border-pink-500/20 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">Descrição Instagram</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">Gerada com base no roteiro · CTA do último bloco</div>
                  </div>
                  <button onClick={() => setCaptionOpen(false)} className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 pb-3 min-h-0">
                  {!captionText && !captionLoading && (
                    <button
                      onClick={async () => {
                        setCaptionLoading(true);
                        try { setCaptionText(await generateInstagramCaption(blocks, state.projectName)); }
                        finally { setCaptionLoading(false); }
                      }}
                      className="w-full py-3 rounded-xl bg-pink-500/15 hover:bg-pink-500/25 text-sm font-semibold text-pink-300 transition-colors mt-2"
                    >
                      📸 Gerar descrição
                    </button>
                  )}
                  {captionLoading && (
                    <div className="text-sm text-zinc-500 text-center py-8 animate-pulse">Gerando descrição...</div>
                  )}
                  {captionText && !captionLoading && (
                    <textarea
                      readOnly
                    autoCorrect="off"
                      value={captionText}
                      onClick={e => e.currentTarget.select()}
                      spellCheck={false}
                      className="w-full text-[13px] text-zinc-200 leading-relaxed bg-black/30 border border-white/5 rounded-xl p-4 resize-none outline-none cursor-text font-sans"
                      style={{ minHeight: '260px', height: Math.min(600, Math.max(260, captionText.split('\n').length * 22)) + 'px' }}
                    />
                  )}
                </div>

                {/* Footer */}
                <div className="flex gap-2 px-5 pb-5 pt-2 shrink-0 border-t border-white/5">
                  {captionText && (
                    <button
                      onClick={async () => {
                        setCaptionLoading(true);
                        try { setCaptionText(await generateInstagramCaption(blocks, state.projectName)); setCaptionCopied(false); }
                        finally { setCaptionLoading(false); }
                      }}
                      disabled={captionLoading}
                      className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-40"
                    >
                      ↺ Regerar
                    </button>
                  )}
                  {captionText && (
                    <button
                      onClick={() => { copyText(captionText).then(() => { setCaptionCopied(true); setTimeout(() => setCaptionCopied(false), 2500); }); }}
                      className="flex-1 py-2.5 rounded-lg bg-pink-500/20 hover:bg-pink-500/30 text-xs font-semibold text-pink-200 transition-colors"
                    >
                      {captionCopied ? '✓ Copiado!' : '📋 Copiar tudo'}
                    </button>
                  )}
                  <button onClick={() => setCaptionOpen(false)} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-400 transition-colors">
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <button
              onClick={() => setZoom(z => Math.max(1, +(z - 0.5).toFixed(2)))}
              disabled={zoom <= 1}
              title="Diminuir zoom"
              className="p-1 hover:text-zinc-200 disabled:opacity-30 disabled:hover:text-zinc-500 transition-colors"
            >−</button>
            <button
              onClick={() => setZoom(1)}
              title="Resetar zoom"
              className="font-mono text-[10px] tabular-nums w-10 text-center hover:text-zinc-200 transition-colors"
            >{zoom.toFixed(1)}x</button>
            <button
              onClick={() => setZoom(z => Math.min(8, +(z + 0.5).toFixed(2)))}
              disabled={zoom >= 8}
              title="Aumentar zoom"
              className="p-1 hover:text-zinc-200 disabled:opacity-30 disabled:hover:text-zinc-500 transition-colors"
            >+</button>
          </div>
        </div>

        {/* Scrollable zoom container — régua + tracks compartilham o mesmo width escalado */}
        <div
          ref={timelineScrollRef}
          onWheel={(e) => {
            // Cmd/Ctrl + scroll = zoom anchored at the cursor's source-time position.
            if (!(e.metaKey || e.ctrlKey)) return;
            e.preventDefault();
            const scroller = timelineScrollRef.current;
            if (!scroller) return;
            const inner = scroller.firstElementChild as HTMLElement | null;
            if (!inner) return;
            const rect = scroller.getBoundingClientRect();
            const cursorX = e.clientX - rect.left + scroller.scrollLeft;
            const ratioInContent = cursorX / inner.scrollWidth;
            const next = Math.max(1, Math.min(8, +(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(2)));
            if (next === zoom) return;
            setZoom(next);
            // After zoom changes, restore the scrollLeft so the same source-time
            // stays under the cursor. Defer to next frame so the new width is laid out.
            requestAnimationFrame(() => {
              const newInner = scroller.firstElementChild as HTMLElement | null;
              if (!newInner) return;
              const newCursorX = ratioInContent * newInner.scrollWidth;
              scroller.scrollLeft = Math.max(0, newCursorX - (e.clientX - rect.left));
            });
          }}
          className="flex-1 flex flex-col overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/25"
        >
          <div className="flex flex-col flex-1" style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
        {/* Time ruler */}
        <div className="relative h-6 border-b border-white/5 px-2 shrink-0">
          <div className="relative h-full">
            {Array.from({ length: Math.ceil(viewDuration) + 1 }).map((_, i) => {
              const isMajor = i % 5 === 0;
              return (
                <div key={i} className="absolute top-0 bottom-0 flex items-end pb-0.5" style={{ left: `${(i / Math.max(viewDuration, 0.0001)) * 100}%` }}>
                  <div className={`w-px ${isMajor ? 'h-3 bg-zinc-500' : 'h-1.5 bg-zinc-700'}`}></div>
                  {isMajor && <span className="text-[9px] text-zinc-500 font-mono ml-1">0:{String(i).padStart(2,'0')}</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Tracks */}
        <div ref={timelineRef} className="relative flex-1 px-2 py-2 cursor-pointer overflow-hidden" onPointerDown={handleTimelinePointerDown}>
          {/* Audio waveform — only shown when audio exists OR is being generated. */}
          {(audio.status === 'ready' || audio.status === 'generating') && (
          <div className={`relative h-9 mb-1 rounded-md bg-cyan-500/[0.04] border border-cyan-500/20 overflow-hidden ${audio.status === 'generating' ? 'animate-pulse' : ''}`}>
            <div className="absolute left-2 top-1 text-[8px] uppercase tracking-wider text-cyan-300/60 font-semibold pointer-events-none z-10">Audio</div>
            <div className="absolute inset-0 flex items-center px-2 pl-12">
              {audio.peaks.length > 0 ? (
                cutOn ? (
                  // Cut ON: each kept peak is positioned by its true source time mapped to
                  // the compressed (effective) timeline via sourceToEffective. This keeps
                  // the waveform aligned with the ruler and playhead — silent regions
                  // collapse together instead of being silently re-flowed by flexbox.
                  <div className="relative h-full w-full">
                    {audio.peaks.map((p, i) => {
                      const peakSec = (i / audio.peaks.length) * audio.duration;
                      const inKeep = cutSegments.some(k => peakSec >= k.start && peakSec < k.end);
                      if (!inKeep) return null;
                      const effSec = sourceToEffective(peakSec);
                      const leftPct = (effSec / Math.max(audioEffectiveDuration, 0.0001)) * 100;
                      const widthPct = (1 / audio.peaks.length) * (audio.duration / Math.max(audioEffectiveDuration, 0.0001)) * 100;
                      const heightPct = Math.max(8, p * 90);
                      return (
                        <div
                          key={i}
                          className="absolute bg-gradient-to-t from-cyan-500/40 to-cyan-300/80 rounded-sm"
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            height: `${heightPct}%`,
                            top: `${(100 - heightPct) / 2}%`,
                          }}
                        ></div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center gap-px h-full w-full">
                    {audio.peaks.map((p, i) => (
                      <div key={i} className="flex-1 bg-gradient-to-t from-cyan-500/40 to-cyan-300/80 rounded-sm" style={{ height: `${Math.max(8, p * 90)}%` }}></div>
                    ))}
                  </div>
                )
              ) : (
                <div className="text-[10px] text-cyan-300/40 italic">{audio.status === 'generating' ? 'Sintetizando...' : 'Sem áudio · clique em Gerar Áudio'}</div>
              )}
            </div>
            {audio.status === 'generating' && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-400/15 to-transparent" style={{ animation: 'shimmer 1.6s linear infinite' }}></div>
            )}
            {/* Silence cut indicators.
                - Cut OFF: vermelho hash sobre as regiões silenciosas (preview do que seria cortado)
                - Cut ON (preview mode, not yet applied): linha vertical fina nas junções
                - cutsApplied=true: nothing — keepSegments live on the
                  pristine coord space, but the waveform now shows the
                  COMPRESSED audio; drawing the markers here would put
                  them on the wrong time axis. */}
            {!state.audio.cutsApplied && state.audio.keepSegments.length > 0 && state.audio.duration > 0 && (() => {
              const segs = state.audio.keepSegments;
              if (cutOn) {
                // Junctions: between consecutive keep segments — at the END of each keep segment except the last.
                return segs.slice(0, -1).map((k, i) => {
                  const leftPct = viewPct(k.end);
                  return (
                    <div
                      key={`junction-${i}`}
                      className="absolute top-0 bottom-0 w-0.5 bg-red-400/40 pointer-events-none"
                      style={{ left: `${leftPct}%` }}
                      title="Silêncio removido aqui"
                    ></div>
                  );
                });
              }
              // OFF mode: highlight what WOULD be cut.
              const total = state.audio.duration;
              const cuts: { start: number; end: number }[] = [];
              let cursor = 0;
              for (const k of segs) {
                if (k.start > cursor) cuts.push({ start: cursor, end: k.start });
                cursor = k.end;
              }
              if (cursor < total) cuts.push({ start: cursor, end: total });
              return cuts.map((c, i) => {
                const left = (c.start / total) * 100;
                const width = ((c.end - c.start) / total) * 100;
                return (
                  <div
                    key={`cut-${i}`}
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundImage: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.18) 0 4px, transparent 4px 8px)',
                      borderLeft: i === 0 ? 'none' : '1px dashed rgba(239,68,68,0.5)',
                      borderRight: i === cuts.length - 1 ? 'none' : '1px dashed rgba(239,68,68,0.5)',
                    }}
                  ></div>
                );
              });
            })()}
          </div>
          )}

          {/* Unified content track — avatar + broll blocks share one row in source-time order */}
          <div className="relative h-10 mb-1 rounded-md bg-white/[0.02] border border-white/10 overflow-hidden">
            <div className="absolute left-2 top-1 text-[8px] uppercase tracking-wider text-zinc-400/70 font-semibold pointer-events-none z-10 flex items-center gap-1.5">
              Conteúdo
              {activeTake && (
                <>
                  <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-200 normal-case font-normal">{activeTake.name}</span>
                  {activeTake.cutSilence && activeTake.detectedSilenceSec > 0.1 && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-200 normal-case font-normal" title={`${activeTake.detectedSilenceSec.toFixed(1)}s de silêncio cortado`}>
                      ✂ −{activeTake.detectedSilenceSec.toFixed(1)}s
                    </span>
                  )}
                </>
              )}
            </div>
            {blocks.map((b, idx) => {
              const slot = slotById.get(b.id);
              if (!slot) return null;
              // Make blocks magnetic: each block occupies up to the next block's start,
              // not its own end (closes any sub-pixel/timestamp gap between consecutive blocks).
              const nextSlot = idx < blocks.length - 1 ? slotById.get(blocks[idx + 1].id) : null;
              const rightAt = nextSlot ? nextSlot.projectStart : slot.projectEnd;
              const left = viewPct(slot.projectStart);
              const width = Math.max(0, viewPct(rightAt) - left);
              const isDraggingThis = draggingBlockId === b.id;
              const isHovered = hoveredId === b.id;
              const blockLen = b.end - b.start;

              // Edit-video mode: every transcript block is a SPEECH segment of
              // the user's own continuous video — never draggable/deletable.
              // Click selects (drives the Motion Dock context). The chip TONE
              // shows the fala's role: graphite = 🎥 Vídeo (footage shows),
              // emerald = 🖥️ B-roll (motion takes the whole frame here).
              if (state.projectMode === 'edit') {
                const selected = selectedBlockId === b.id;
                const isBrollRole = b.kind === 'broll';
                // Overlay status — a fala "tem cena gerada?" precisa ser legível
                // de relance: ✓ + faixa azul embaixo = gerado; ⏳ + faixa âmbar
                // pulsando = gerando; nada = falta gerar.
                const ovElId = `ovmot_${b.id}`;
                const ovEl = (state.overlayElements ?? []).find(e => e.id === ovElId && e.kind === 'motion');
                const ovBusyMsg = overlayBusy[ovElId];
                const ovStatus: 'ready' | 'busy' | 'missing' =
                  ovBusyMsg ? 'busy' : ovEl?.motion?.status === 'ready' ? 'ready' : ovEl ? 'busy' : 'missing';
                return (
                  <div
                    key={b.id}
                    data-no-scrub="true"
                    onClick={() => selectAndSeekBlock(b.id)}
                    className="absolute top-1 bottom-1 rounded-md cursor-pointer overflow-hidden transition-colors"
                    style={{
                      left: `${left}%`, width: `${Math.max(width, 0.5)}%`,
                      backgroundColor: selected
                        ? 'rgba(96,165,250,0.16)'
                        : isBrollRole ? 'rgba(16,185,129,0.14)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${selected
                        ? 'rgba(96,165,250,0.6)'
                        : isBrollRole ? 'rgba(16,185,129,0.45)' : 'rgba(255,255,255,0.10)'}`,
                    }}
                    title={`${b.text}${isBrollRole ? ' · 🖥️ B-roll: motion tela cheia' : ' · 🎥 Vídeo'} · ${
                      ovStatus === 'ready' ? '✓ overlay gerado' : ovStatus === 'busy' ? '⏳ gerando overlay…' : '○ sem overlay ainda'}`}
                  >
                    <div className="px-2 py-1 min-w-0">
                      <div className="text-[9px] truncate" style={{ color: selected ? '#dbeafe' : isBrollRole ? '#a7f3d0' : 'rgba(244,244,245,0.75)' }}>
                        {ovStatus === 'ready' ? <span style={{ color: '#6ee7b7' }}>✓ </span> : ovStatus === 'busy' ? '⏳ ' : ''}
                        {b.motionSetup ? '🏷 ' : ''}{isBrollRole ? '🖥️ ' : ''}{b.text.slice(0, 48) || '(fala)'}
                      </div>
                      <div className="text-[8px] font-mono" style={{ color: 'rgba(161,161,170,0.7)' }}>{blockLen.toFixed(1)}s</div>
                    </div>
                    {/* Faixa de status no pé do chip — independe da cor do papel (vídeo/b-roll). */}
                    {ovStatus !== 'missing' && (
                      <div
                        className={`absolute bottom-0 left-0 right-0 h-[2.5px] ${ovStatus === 'busy' ? 'animate-pulse' : ''}`}
                        style={{ backgroundColor: ovStatus === 'ready' ? '#34d399' : '#fbbf24' }}
                      />
                    )}
                  </div>
                );
              }

              if (b.kind === 'broll') {
                return (
                  <div
                    key={b.id}
                    data-no-scrub="true"
                    onMouseEnter={() => setHoveredId(b.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onPointerDown={handleBlockPointerDown(b.id)}
                    className={`absolute top-1 bottom-1 rounded-md bg-gradient-to-b from-emerald-400/70 to-emerald-600/80 border border-emerald-300/40 shadow-[0_2px_8px_rgba(16,185,129,0.2)] cursor-grab active:cursor-grabbing hover:-translate-y-0.5 transition-transform overflow-hidden ${isDraggingThis ? 'opacity-40' : ''} ${selectedBlockId === b.id ? 'ring-2 ring-blue-400 ring-offset-1 ring-offset-[#0C0C0E] z-10' : ''}`}
                    style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
                  >
                    <div className="px-2 py-1.5 flex items-center gap-1">
                      <svg className="w-3 h-3 text-emerald-50 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="M8 21h8" strokeLinecap="round" />
                      </svg>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-semibold text-emerald-50 truncate">B-roll</div>
                        <div className="text-[9px] font-mono text-emerald-100/70">{blockLen.toFixed(1)}s</div>
                      </div>
                    </div>
                  </div>
                );
              }

              // Avatar block
              const cost = blockLen * PRICE_PER_AVATAR_SECOND;
              const clip = state.avatarClips[b.id];
              const status = clip?.status ?? 'idle';
              const isGenerating = status === 'queued' || status === 'uploading' || status === 'submitting' || status === 'rendering';
              const isReady = status === 'ready';
              const isError = status === 'error';

              const tone = isError
                ? 'from-red-400/80 to-red-600/90 border-red-300/40'
                : isReady
                ? 'from-amber-400/85 to-amber-600/95 border-amber-300/40 ring-1 ring-amber-300/30'
                : isGenerating
                ? 'from-blue-400/70 to-blue-600/80 border-blue-300/40'
                : 'from-amber-400/70 to-amber-600/80 border-amber-300/40';

              const statusLabel = status === 'queued'      ? 'na fila'
                                : status === 'uploading'   ? 'enviando'
                                : status === 'submitting'  ? 'submetendo'
                                : status === 'rendering'   ? (clip?.message ?? 'renderizando')
                                : status === 'ready'       ? '✓'
                                : status === 'error'       ? 'erro'
                                : null;

              const visibleSec = b.avatarVisibleSec ?? blockLen;
              const isPartial = visibleSec < blockLen - 0.05;

              return (
                <div
                  key={b.id}
                  data-no-scrub="true"
                  onMouseEnter={() => setHoveredId(b.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onPointerDown={handleBlockPointerDown(b.id)}
                  className={`absolute top-1 bottom-1 rounded-md bg-gradient-to-b ${tone} border cursor-grab active:cursor-grabbing transition-all overflow-hidden ${isDraggingThis ? 'opacity-40' : ''} ${selectedBlockId === b.id ? 'ring-2 ring-blue-400 ring-offset-1 ring-offset-[#0C0C0E] z-10' : isHovered ? '-translate-y-0.5 shadow-[0_8px_24px_rgba(245,158,11,0.4)] z-10' : 'shadow-[0_2px_8px_rgba(245,158,11,0.2)]'}`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
                >
                  {/* When avatar is partially visible, divider shows where B-roll takes over */}
                  {isPartial && (
                    <div
                      className="absolute top-0 bottom-0 border-r-2 border-dashed border-emerald-300/70 pointer-events-none"
                      style={{ left: `${(visibleSec / blockLen) * 100}%` }}
                    >
                      <div className="absolute right-0 top-0 bottom-0 left-0 bg-emerald-500/15"></div>
                    </div>
                  )}
                  <div className="px-2 py-1.5 truncate relative z-10 flex items-start gap-1">
                    <svg className="w-3 h-3 text-white/80 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                    </svg>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-semibold text-white truncate">{b.text.slice(0, 30) || '(vazio)'}</div>
                      <div className="text-[9px] font-mono text-white/80 flex items-center justify-between gap-1">
                        <span>
                          {blockLen.toFixed(1)}s
                          {isPartial && <span className="text-emerald-200 ml-1">· {visibleSec.toFixed(1)}s</span>}
                        </span>
                        {statusLabel && <span className="truncate">{statusLabel}</span>}
                      </div>
                    </div>
                  </div>
                  {isGenerating && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent" style={{ animation: 'shimmer 1.6s linear infinite' }}></div>
                  )}
                  {!isGenerating && (
                    <div className="absolute top-1 right-1 flex items-center gap-1 z-20" onPointerDown={(e) => e.stopPropagation()}>
                      {/* Generate/Regen button — same affordance, label changes
                          per state. When no clip exists yet the user clicks
                          this to make one; when ready, to redo a bad take;
                          when errored, to retry after fixing whatever. The
                          color shifts (sparkle steel-blue for first gen → amber
                          loop arrows for regen/retry) to telegraph intent. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); setRegenAvatarBlockId(b.id); }}
                        disabled={generatingClips}
                        className={`w-5 h-5 rounded-full backdrop-blur flex items-center justify-center text-white transition-all hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed ${
                          isReady
                            ? 'bg-amber-500/80 hover:bg-amber-500'
                            : isError
                              ? 'bg-red-500/80 hover:bg-red-500'
                              : 'bg-blue-500/80 hover:bg-blue-500'
                        }`}
                        title={
                          isReady
                            ? 'Regerar este avatar (HeyGen)'
                            : isError
                              ? 'Tentar gerar de novo'
                              : 'Gerar avatar deste bloco'
                        }
                      >
                        {isReady ? (
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        ) : (
                          // Sparkle/wand for first-time generation. Visually
                          // distinct from the loop-arrow regen icon so the
                          // user immediately reads "fresh generate" vs "redo".
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                          </svg>
                        )}
                      </button>
                  {isReady && clip?.videoUrl && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); window.open(clip.videoUrl, '_blank', 'noopener,noreferrer'); }}
                        className="w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur flex items-center justify-center text-white transition-all hover:scale-110"
                        title="Abrir em nova aba"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const a = document.createElement('a');
                          a.href = clip.videoUrl!;
                          a.download = `clip-${b.id}.mp4`;
                          a.target = '_blank';
                          a.rel = 'noopener noreferrer';
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }}
                        className="w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur flex items-center justify-center text-white transition-all hover:scale-110"
                        title="Baixar MP4"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPreviewClipId(b.id); }}
                        className="w-5 h-5 rounded-full bg-blue-500/80 hover:bg-blue-500 backdrop-blur flex items-center justify-center text-white transition-all hover:scale-110"
                        title="Ver no app"
                      >
                        <svg className="w-2.5 h-2.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      </button>
                    </>
                  )}
                    </div>
                  )}
                  {b.dirty && <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-200" title="Texto alterado · regenere o áudio"></div>}
                  {isHovered && (
                    <div className="absolute -top-9 left-1/2 -translate-x-1/2 px-2 py-1 rounded-md bg-zinc-900 border border-amber-500/30 text-[10px] text-amber-200 whitespace-nowrap shadow-2xl z-20">
                      {blockLen.toFixed(1)}s · ${cost.toFixed(2)}{isError && clip?.error ? ` · ${clip.error.slice(0, 40)}` : ''}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Transition junction markers — between each pair of consecutive blocks (any kind) */}
            {!draggingBlockId && blocks.slice(0, -1).map((b, i) => {
              const slot = slotById.get(b.id);
              const nextSlot = slotById.get(blocks[i + 1].id);
              if (!slot || !nextSlot) return null;
              // Center the marker in the GAP between the two chips (edit-mode
              // falas have real silence between them). At projectEnd it sat on
              // top of the chip's ✕ delete button and looked missing/offset.
              const leftPct = viewPct((slot.projectEnd + nextSlot.projectStart) / 2);
              // Default to 'cut' to match the compositor's new default for
              // middle blocks (see mp4Renderer.ts). The previous 'fade' default
              // here was a stale label — the renderer was actually doing
              // 'dissolve' under the hood, so the circle icon misled users
              // about what would actually be exported.
              const trans: BlockTransition = b.transition ?? 'cut';
              const icon = trans === 'cut' ? '╳' : trans === 'dissolve' ? '◐' : '▾';
              const tone = trans === 'cut' ? 'bg-red-500/70 hover:bg-red-500 border-red-300/60' : trans === 'dissolve' ? 'bg-cyan-500/70 hover:bg-cyan-500 border-cyan-300/60' : 'bg-zinc-700 hover:bg-zinc-600 border-white/30';
              return (
                <button
                  key={`tr-${b.id}`}
                  data-no-scrub="true"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setTransitionPopoverIdx(transitionPopoverIdx === i ? null : i); }}
                  className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full ${tone} border text-[8px] text-white font-bold flex items-center justify-center shadow-[0_2px_8px_rgba(0,0,0,0.6)] z-20 transition-colors`}
                  style={{ left: `${leftPct}%` }}
                  title={`Transição: ${trans} · clique pra mudar`}
                >
                  {icon}
                </button>
              );
            })}
          </div>

          {/* Motion track */}
          <div className="relative h-8 mb-1 rounded-md bg-white/[0.02] border border-white/10 overflow-hidden">
            <div className="absolute left-2 top-1 text-[8px] uppercase tracking-wider text-zinc-400/70 font-semibold pointer-events-none z-10">🎨 Motion</div>
            {/* Empty-track CTA — the main action must never be hidden behind
                per-block selection. One click generates every block via the
                Auto router (Figma/CapCut empty-state pattern). */}
            {state.projectMode !== 'edit' && audio.status === 'ready' && blocks.length > 0 && blocks.every(b => !b.motion) && (() => {
              const eligible = blocks.filter(b => !requiresAssetAttachment(b, projectAssetsCount));
              if (eligible.length === 0) return null;
              return (
                <div className="absolute inset-0 z-20 flex items-center justify-center">
                  <button
                    onClick={() => void handleAutoMotionMany(eligible.map(b => b.id))}
                    className="px-4 py-1.5 rounded-lg text-[11px] font-bold text-white transition-opacity hover:opacity-90"
                    style={{ background: 'linear-gradient(180deg, #60A5FA, #3b82f6)', boxShadow: '0 2px 12px rgba(96,165,250,0.35)' }}
                  >
                    ⚡ Gerar motions de todos os blocos ({eligible.length}) — a IA escolhe o visual de cada um
                  </button>
                </div>
              );
            })()}
            {(() => {
              // Motion plays once and freezes on its last frame, so each motion is
              // visually active during the ENTIRE block (or until the next block that
              // also has a motion). Chips are magnetic — they extend up to the next
              // motion's block start, closing inter-chip gaps.
              const blocksWithMotion = blocks.filter(b => !!b.motion);
              return blocksWithMotion.map((b, mIdx) => {
              const slot = slotById.get(b.id);
              if (!slot) return null;
              const motion = b.motion!;
              const motionDur = motion.durationSec ?? 3;
              void mIdx;
              // Honest chip geometry: the chip spans exactly the motion's
              // visibility window (director anchor / "Quando" sliders), not
              // the whole block — what you see on the track is when the
              // motion is actually on screen.
              const chipPlacement = resolveMotionPlacement(b);
              const chipOffset = chipPlacement?.startOffsetSec ?? 0;
              const chipBlockDur = slot.projectEnd - slot.projectStart;
              const chipVisibleDur = Math.max(0.4, Math.min(chipPlacement?.durationSec ?? (chipBlockDur - chipOffset), chipBlockDur - chipOffset));
              const left = viewPct(slot.projectStart + chipOffset);
              const width = Math.max(0, viewPct(slot.projectStart + chipOffset + chipVisibleDur) - left);
              const isAnchored = chipOffset > 0.05;
              const layerLabel = chipPlacement?.area === 'float' ? 'flutua'
                : chipPlacement?.area === 'full' ? 'cheia'
                : chipPlacement?.area === 'top-half' ? '½↑'
                : chipPlacement?.area === 'bottom-half' ? '½↓' : 'flutua';
              const busyMessage = motionBusyByBlock[b.id];
              const isBusy = !!busyMessage;
              const isReady = motion.status === 'ready' && !!motion.videoPath;
              const isError = motion.status === 'error';
              const isGenerating = motion.status === 'generating' || (isBusy && !motion.html);
              const isRendering = motion.status === 'rendering' || (isBusy && !!motion.html && !isReady);
              const isDraft = motion.status === 'draft' && !isBusy;
              const hasHtmlNeedsRender = !!motion.html && !motion.videoPath && !isBusy && !isError;

              // Color tone by status
              const tone = isError
                ? 'from-red-500/70 to-red-600/80 border-red-400/50'
                : isReady
                ? 'from-emerald-500/70 to-emerald-600/80 border-emerald-400/50 shadow-[0_2px_8px_rgba(16,185,129,0.3)]'
                : isGenerating
                ? 'from-amber-500/70 to-amber-600/80 border-amber-400/50 shadow-[0_2px_8px_rgba(245,158,11,0.3)]'
                : isRendering
                ? 'from-cyan-500/70 to-cyan-600/80 border-cyan-400/50 shadow-[0_2px_8px_rgba(6,182,212,0.3)]'
                : hasHtmlNeedsRender
                ? 'from-cyan-500/40 to-cyan-600/50 border-cyan-400/40'
                : isDraft
                ? 'from-zinc-600/40 to-zinc-700/50 border-zinc-500/40'
                : 'from-blue-500/50 to-blue-600/60 border-blue-400/50';

              const statusLabel = isError       ? 'erro'
                                : isReady       ? '✓'
                                : isGenerating  ? 'IA…'
                                : isRendering   ? (busyMessage?.toLowerCase().includes('rend') ? 'render…' : busyMessage?.slice(0, 10) ?? 'render…')
                                : hasHtmlNeedsRender ? 'render →'
                                : isDraft       ? 'rascunho'
                                : layerLabel;

              const titleText = `${motion.presetId} · ${motion.layer} · ${motionDur.toFixed(1)}s · ${motion.status}${motion.errorMessage ? ' · ' + motion.errorMessage.slice(0, 60) : ''}`;
              const showShimmer = isGenerating || isRendering;

              return (
                <div
                  key={`mot-${b.id}`}
                  data-no-scrub="true"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); selectAndSeekBlock(b.id); }}
                  className={`absolute top-1 bottom-1 rounded bg-gradient-to-r ${tone} border cursor-pointer hover:brightness-110 transition-all overflow-hidden ${selectedBlockId === b.id ? 'ring-2 ring-blue-400' : ''}`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
                  title={titleText}
                >
                  <div className="px-1.5 py-1 flex items-center gap-1 text-white relative z-10">
                    {isAnchored && <span className="text-[8px] text-amber-300 shrink-0" title={`Ancorado em ${chipOffset.toFixed(1)}s`}>⚓</span>}
                    <span className="text-[10px] truncate font-medium">{motion.text || motion.intent || 'motion'}</span>
                    <span className="text-[8px] uppercase tracking-wider opacity-90 shrink-0 font-semibold">
                      {statusLabel}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); dispatch({ type: 'set-block-motion', id: b.id, motion: undefined }); }}
                      className="ml-1 w-3.5 h-3.5 rounded-full bg-black/40 hover:bg-black/80 flex items-center justify-center text-white/70 hover:text-white shrink-0 transition-colors"
                      title="Remover motion desse bloco"
                    >×</button>
                  </div>
                  {showShimmer && (
                    <div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none"
                      style={{ animation: 'shimmer 1.6s linear infinite' }}
                    ></div>
                  )}
                  {isReady && (
                    <div className="absolute right-1 top-1 bottom-1 flex items-center pointer-events-none">
                      <span className="text-[9px] text-emerald-100">●</span>
                    </div>
                  )}
                </div>
              );
              });
            })()}
          </div>

          {/* Captions track — hidden (decorative lane showing block script
              text; was visually confusing because it looked like motion-
              embedded captions). Block text is already visible inside the
              orange block lane above; keeping this lane was redundant. */}

          {/* Playhead */}
          <div className="absolute top-0 bottom-0 pointer-events-none z-20" style={{ left: `calc(${playheadPct}% + 8px)` }}>
            <div className="absolute top-0 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-blue-400 drop-shadow-[0_0_6px_rgba(10,132,255,0.8)]"></div>
            <div className="absolute top-0 bottom-0 w-0.5 bg-blue-400 -translate-x-1/2 shadow-[0_0_8px_rgba(10,132,255,0.6)]"></div>
          </div>

          {/* Drop indicator while dragging a block to reorder */}
          {draggingBlockId && dragOverIndex !== null && (() => {
            const others = blocks.filter(b => b.id !== draggingBlockId);
            let acc = 0;
            for (let i = 0; i < dragOverIndex && i < others.length; i++) {
              acc += Math.max(0, others[i].end - others[i].start);
            }
            const dropPct = viewPct(acc);
            return (
              <div className="absolute top-0 bottom-0 pointer-events-none z-30" style={{ left: `calc(${dropPct}% + 8px)` }}>
                <div className="absolute top-0 bottom-0 w-1 bg-cyan-300 -translate-x-1/2 shadow-[0_0_12px_rgba(103,232,249,0.9)]"></div>
              </div>
            );
          })()}
          {dragGhostX !== null && draggingBlockId && (() => {
            const dragged = blocks.find(b => b.id === draggingBlockId);
            if (!dragged) return null;
            return (
              <div
                className="absolute top-1/2 -translate-y-1/2 px-2 py-1 rounded-md bg-cyan-500/90 text-[10px] text-white font-semibold pointer-events-none z-40 shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
                style={{ left: `${dragGhostX}px`, transform: 'translate(-50%, -50%)' }}
              >
                {dragged.text.slice(0, 24) || dragged.kind}
              </div>
            );
          })()}

          {/* Transition popover */}
          {transitionPopoverIdx !== null && blocks[transitionPopoverIdx] && (() => {
            const fromBlock = blocks[transitionPopoverIdx];
            const slot = slotById.get(fromBlock.id);
            if (!slot) return null;
            const leftPct = viewPct(slot.projectEnd);
            const current: BlockTransition = fromBlock.transition ?? 'cut';
            const opts: { value: BlockTransition; label: string; desc: string; recommended?: boolean }[] = [
              { value: 'cut',         label: '╳ Cut',         desc: 'Corte seco — padrão moderno pra Reels/TikTok', recommended: true },
              { value: 'fade',        label: '▾ Fade',        desc: 'Fade pro preto — use só pra chapter break' },
              { value: 'dissolve',    label: '◐ Dissolve',    desc: 'Cross-dissolve suave (100ms)' },
              { value: 'whip-pan',    label: '↔ Whip pan',    desc: 'Câmera varrendo lateral com motion blur' },
              { value: 'zoom-blur',   label: '⊕ Zoom blur',   desc: 'Zoom dramático com blur' },
              { value: 'glitch',      label: '⚡ Glitch',      desc: 'RGB split + jitter digital' },
              { value: 'light-flash', label: '✶ Light flash', desc: 'Flash branco no meio do corte' },
            ];
            // Position the popover using fixed viewport coords (escapes the
            // timeline wrapper's overflow-hidden). Clamp horizontally so it
            // never spills off the screen edges. Anchor above the timeline.
            const POPOVER_W = 240;
            const EDGE_PAD = 12;
            const tlRect = timelineRef.current?.getBoundingClientRect();
            const anchorX = tlRect
              ? tlRect.left + (leftPct / 100) * tlRect.width
              : window.innerWidth / 2;
            const leftPx = Math.max(
              EDGE_PAD + POPOVER_W / 2,
              Math.min(window.innerWidth - EDGE_PAD - POPOVER_W / 2, anchorX),
            );
            const topPx = tlRect ? tlRect.top - 8 : window.innerHeight / 2;
            return (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setTransitionPopoverIdx(null)}
                />
                <div
                  data-no-scrub="true"
                  onPointerDown={(e) => e.stopPropagation()}
                  className="rounded-lg bg-[#141416] border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.8)] z-40 p-1.5"
                  style={{ position: 'fixed', left: `${leftPx}px`, top: `${topPx}px`, transform: 'translate(-50%, -100%)', width: `${POPOVER_W}px` }}
                >
                  <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold px-2 pt-1 pb-1.5">Transição entre blocos</div>
                  {opts.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        dispatch({ type: 'set-block-transition', id: fromBlock.id, transition: opt.value });
                        setTransitionPopoverIdx(null);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-md transition-colors ${current === opt.value ? 'bg-blue-500/20 border border-blue-500/40' : 'border border-transparent hover:bg-white/5'}`}
                    >
                      <div className="text-[11px] font-medium text-zinc-100 flex items-center gap-1.5">
                        {opt.label}
                        {opt.recommended && (
                          <span className="text-[8px] uppercase tracking-wider px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                            recomendado
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-zinc-500 leading-tight">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
          </div>
        </div>
      </div>

      {/* ─── CONFIRM MODAL ───────────────────────────────────────────── */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-6">
          <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-md w-full overflow-hidden">
            <div className="px-6 pt-6 pb-4">
              <div className="text-base font-semibold text-zinc-100 mb-1">Gerar áudio?</div>
              <div className="text-xs text-zinc-500">Vai juntar o roteiro inteiro e enviar pro Minimax via fal.ai.</div>
            </div>
            <div className="px-6 py-4 bg-black/30 border-y border-white/5 space-y-2">
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Voz</span><span className="text-zinc-200">{selectedVoiceLabel.label}{selectedVoiceLabel.isCustom && <span className="ml-1 text-[9px] text-blue-300">(sua)</span>}</span></div>
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Idioma</span><span className="text-zinc-200">Português</span></div>
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Blocos</span><span className="text-zinc-200">{blocks.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Duração estimada</span><span className="text-zinc-200">~{formatTime(estimateScriptDuration(blocks))}</span></div>
              <div className="flex justify-between text-xs pt-2 border-t border-white/5"><span className="text-zinc-300 font-medium">Custo</span><span className="text-blue-400 font-bold">${estimatedAudioCost.toFixed(2)}</span></div>
            </div>
            <div className="px-6 py-4 flex gap-2">
              <button onClick={() => setConfirmOpen(false)} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Cancelar</button>
              <button onClick={handleGenerate} className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(10,132,255,0.5)] transition-all">Gerar agora</button>
            </div>
          </div>
        </div>
      )}

      {saveVoiceModalOpen && (
        <SaveVoiceModal
          onClose={() => setSaveVoiceModalOpen(false)}
          onSaved={(newVoiceId) => {
            refreshClonedVoices();
            dispatch({ type: 'set-voice', voiceId: newVoiceId });
            setSaveVoiceModalOpen(false);
          }}
        />
      )}

      {/* ─── GUIDED WIZARD (light 3-step creation, from landing "Novo") ─────── */}
      <GuidedWizard
        key={guidedOpen ? 'guided-on' : 'guided-off'}
        open={guidedOpen}
        tokens={tokens}
        isLight={isLight}
        initialVoiceId={state.selectedVoiceId}
        onClose={() => setGuidedOpen(false)}
        onUseVideoFlow={(url) => {
          // Hand the URL off so the CreationWizard skips its own "Fonte" step
          // and lands in the video config form already filled in — keeps the
          // single-paste promise of "Novo projeto".
          setGuidedOpen(false);
          setAppView('editor');
          setWizardInitialFormat('reel');
          setWizardInitialVideoUrl(url);
          setWizardOpen(true);
        }}
        onConfirm={async (newBlocks, extras: GuidedExtras) => {
          // Create the fresh project ONLY now (on confirm), not when the wizard
          // opened — so cancelling "Novo projeto" never wipes the current work.
          // handleNewProject resets name/activeProjectId + clears the previous
          // project's audio carriers; the old project stays saved in IndexedDB
          // and is reachable via "Abrir projeto".
          await handleNewProject();
          const isCarousel = extras.format === 'carousel';
          flushSync(() => {
            dispatch({ type: 'replace-blocks', blocks: newBlocks });
            dispatch({ type: 'set-aspect', aspect: isCarousel ? 'carousel' : '9:16' });
            if (!isCarousel) {
              dispatch({ type: 'set-voice', voiceId: extras.voiceId });
              dispatch({ type: 'set-emotion', emotion: extras.emotion });
              dispatch({ type: 'set-voice-speed', speed: extras.speed });
              if (extras.photoId) dispatch({ type: 'set-photo', photoId: extras.photoId });
            }
            setPlayhead(0);
            setPlaying(false);
            setScriptOpen(true);
            if (isCarousel) setCarouselPreviewId(newBlocks[0]?.id ?? null);
          });
          setGuidedOpen(false);
          setAppView('editor');
        }}
      />

      {wizardOpen && (
        <CreationWizard
          key={(reanalyzeMeta?.fileName ?? wizardInitialVideoUrl ?? wizardInitialFormat) ?? 'fresh'}
          open={wizardOpen}
          existingBlockCount={blocks.length}
          initialFormat={wizardInitialFormat}
          initialReanalyzeMeta={reanalyzeMeta ?? undefined}
          initialVideoUrl={wizardInitialVideoUrl}
          onClose={() => { setWizardOpen(false); setWizardInitialFormat(undefined); setWizardInitialVideoUrl(undefined); setReanalyzeMeta(null); }}
          onConfirm={(newBlocks, format, extras) => {
            const targetAspect = format === 'carousel' ? 'carousel' as const : '9:16' as const;
            // Propagate per-generation language override to the upcoming TTS call.
            if (extras?.languageOverride) {
              setTtsLanguageOverride(extras.languageOverride as OutputLanguage);
            }
            // Build PersistedAnalysis from video source (preserves history + plan modal).
            let analysisToPersist: PersistedAnalysis | undefined;
            let emotionFromTone: 'happy' | 'sad' | 'angry' | 'surprised' | 'fearful' | null = null;
            if (extras?.analysis && extras?.meta) {
              const analysis = extras.analysis;
              const meta = extras.meta;
              analysisToPersist = {
                language: analysis.language,
                format: analysis.format,
                hookStyle: analysis.hookStyle,
                tone: analysis.tone,
                durationSec: analysis.durationSec,
                blockIds: newBlocks.map(b => b.id),
                directions: analysis.directions.map(d => ({
                  blockIndex: d.blockIndex,
                  delivery: d.delivery,
                  framing: d.framing,
                  screenAction: d.screenAction,
                  mood: d.mood,
                })),
                brollSuggestions: analysis.brollSuggestions,
                production: {
                  setup: analysis.production.setup,
                  watchOuts: analysis.production.watchOuts,
                  soundbed: analysis.production.soundbed,
                },
                originalTranscript: analysis.transcript ?? [],
                originalBlocks: analysis.originalBlocks ?? [],
                sourceFileName: meta.fileName,
                sourceUrl: meta.sourceUrl,
                createdAt: Date.now(),
              };
              // Auto-suggest emotion from detected tone tags.
              const tones = (analysis.tone ?? []).map(t => t.toLowerCase());
              emotionFromTone =
                tones.some(t => /(happy|warm|playful|excited|energetic|hype|fun|friendly|bold|inspiring|motivational)/.test(t)) ? 'happy' :
                tones.some(t => /(sad|melancholic|nostalgic|wistful)/.test(t)) ? 'sad' :
                tones.some(t => /(angry|frustrated|aggressive)/.test(t)) ? 'angry' :
                tones.some(t => /(surprised|shocked|astonished)/.test(t)) ? 'surprised' :
                tones.some(t => /(fearful|anxious|nervous|tense)/.test(t)) ? 'fearful' :
                null;
            }
            // Article payload (caption, hashtags, sourceUrl) — log for now; could persist later.
            if (extras?.contentPayload) {
              console.log('[content import]', {
                caption: extras.contentPayload.caption,
                hashtags: extras.contentPayload.hashtags,
                framework: extras.contentPayload.frameworkUsed,
                rationale: extras.contentPayload.rationale,
                source: extras.contentPayload.sourceUrl ?? extras.contentPayload.sourceTitle,
              });
            }
            // flushSync ensures all state updates are committed to the DOM
            // before the wizard unmounts — prevents the wizard unmount from
            // racing with the reducer dispatch in some WebView environments.
            flushSync(() => {
              dispatch({ type: 'replace-blocks', blocks: newBlocks, analysis: analysisToPersist });
              dispatch({ type: 'set-aspect', aspect: targetAspect });
              if (emotionFromTone) dispatch({ type: 'set-emotion', emotion: emotionFromTone });
              setPlayhead(0);
              setPlaying(false);
              setScriptOpen(true);
            });
            setWizardOpen(false);
            setWizardInitialFormat(undefined);
            setWizardInitialVideoUrl(undefined);
            setReanalyzeMeta(null);
          }}
        />
      )}

      {motionPickerBlockId && (() => {
        const block = blocks.find(b => b.id === motionPickerBlockId);
        if (!block) return null;
        const isLastBlock = blocks.length > 0 && blocks[blocks.length - 1].id === block.id;
        return (
          <MotionPickerModal
            block={block}
            isLastBlock={isLastBlock}
            brandIdentity={state.brandIdentity}
            onBrandLearned={(brand) => dispatch({ type: 'set-brand-identity', brand })}
            motionColorMode={state.motionColorMode ?? (state.appTheme === 'light' ? 'light' : 'dark')}
            motionEnergy={state.motionEnergy ?? 'energetic'}
            onSetMotionColorMode={(mode) => dispatch({ type: 'set-motion-color-mode', mode })}
            appTheme={state.appTheme ?? 'dark'}
            activeTake={activeTake}
            onClose={() => setMotionPickerBlockId(null)}
            onSave={(motion) => {
              dispatch({ type: 'set-block-motion', id: block.id, motion });
              // Keep the Inspector chip strip in sync with the preset the user
              // just picked in the advanced editor. Without this, the chip
              // strip kept reading `block.stylePresetOverride` (untouched)
              // while the modal wrote to `motion.presetId` — two independent
              // states for the same concept. Clicking the just-picked chip
              // afterwards would visually bounce back to the previous one.
              if (motion?.presetId) {
                dispatch({ type: 'set-block-style-preset', id: block.id, preset: motion.presetId });
              } else if (motion === undefined) {
                // Modal "remove motion" — also clear the override so the
                // detector can suggest fresh defaults on next interaction.
                dispatch({ type: 'set-block-style-preset', id: block.id, preset: undefined });
              }
              setMotionPickerBlockId(null);
            }}
          />
        );
      })()}

      {assetPickerBlockId && (() => {
        const block = blocks.find(b => b.id === assetPickerBlockId);
        if (!block) return null;
        return (
          <AssetPickerModal
            projectName={state.projectName}
            currentAssets={block.attachedAssets ?? []}
            gateActive={requiresAssetAttachment(block, projectAssetsCount)}
            onSkipGate={() => {
              dispatch({ type: 'set-block-skip-asset-gate', id: block.id, skip: true });
              setAssetPickerBlockId(null);
              void refreshProjectAssetsCount();
            }}
            onClose={() => {
              setAssetPickerBlockId(null);
              // User may have dropped files into the folder via Finder while
              // the modal was open. Refresh so the gate updates immediately.
              void refreshProjectAssetsCount();
            }}
            onAdd={(asset) => dispatch({ type: 'add-block-asset', id: block.id, asset })}
            onRemove={(index) => dispatch({ type: 'remove-block-asset', id: block.id, index })}
            onReorder={(fromIndex, toIndex) => dispatch({ type: 'reorder-block-assets', id: block.id, fromIndex, toIndex })}
          />
        );
      })()}

      {planModalOpen && state.lastAnalysis && (
        <ProductionPlanModal
          blocks={state.blocks}
          analysis={state.lastAnalysis}
          projectName={state.projectName}
          onClose={() => setPlanModalOpen(false)}
        />
      )}

      {planAnalysis && (
        <ProductionPlanModal
          blocks={state.blocks}
          analysis={planAnalysis}
          projectName={state.projectName}
          onClose={() => setPlanAnalysis(null)}
        />
      )}

      <ClipRescueModal
        open={clipRescueOpen}
        onClose={() => setClipRescueOpen(false)}
        blocks={blocks}
        avatarClips={state.avatarClips}
        dispatch={dispatch}
        appTheme={state.appTheme}
      />
      {referencesModalOpen && (
        <ReferencesModal
          appTheme={state.appTheme ?? 'dark'}
          analyses={state.analyses}
          onClose={() => setReferencesModalOpen(false)}
          onOpenPlan={(a) => setPlanAnalysis(a)}
          onRemoveAnalysis={(createdAt) => dispatch({ type: 'remove-analysis', createdAt })}
          onReanalyze={(meta) => {
            // Open the wizard already in source 'video' / 'saved' sub-tab, auto-firing reanalysis.
            setReferencesModalOpen(false);
            setReanalyzeMeta(meta);
            setWizardInitialFormat(undefined);
            setWizardOpen(true);
          }}
        />
      )}

      {breakdownDirectOpen && (
        <BreakdownDirectModal
          onClose={() => setBreakdownDirectOpen(false)}
          appTheme={state.appTheme ?? 'dark'}
        />
      )}

      {avatarsModalOpen && (
        <GenerateAvatarsModal
          totalAvatarSeconds={avatarBlocks.reduce((sum, b) => sum + (b.end - b.start), 0)}
          clipCount={avatarBlocks.length}
          initialPhotoId={state.selectedPhotoId}
          initialModel={state.avatarModel}
          onClose={() => setAvatarsModalOpen(false)}
          onConfirm={(photoId, model) => handleGenerateClips(photoId, model)}
        />
      )}

      {pendingClipGen && (
        <SilenceWarningModal
          silenceSeconds={audio.detectedSilenceSec}
          durationSeconds={audio.duration}
          onApplyAndGenerate={onWarningApplyAndGenerate}
          onGenerateAnyway={onWarningGenerateAnyway}
          onCancel={onWarningCancel}
        />
      )}

      {pendingResplit && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[80] p-6">
          <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-md w-full overflow-hidden">
            <div className="px-6 pt-6 pb-2">
              <div className="text-[11px] uppercase tracking-widest text-blue-300/80 font-semibold mb-2">
                Resplit · preview
              </div>
              <div className="text-base font-semibold text-zinc-100 mb-2">
                Quebrar {blocks.length} blocos em {pendingResplit.newBlocks.length}?
              </div>
              <div className="text-[12px] text-zinc-400 leading-relaxed">
                {pendingResplit.removedIds.length} bloco
                {pendingResplit.removedIds.length === 1 ? '' : 's'} acima do limite
                {' '}vai ser divido em pedaços menores nas pausas naturais do áudio.
                {' '}A primeira parte mantém o tipo original; o resto vira B-roll.
                {' '}O áudio fica intacto.
              </div>
            </div>

            {pendingResplit.clipsAtRisk > 0 && (
              <div className="px-6 py-3 bg-amber-500/[0.08] border-y border-amber-500/20 mt-3">
                <div className="text-[11px] font-semibold text-amber-300 mb-1">
                  ⚠️ {pendingResplit.clipsAtRisk} clipe
                  {pendingResplit.clipsAtRisk === 1 ? '' : 's'} de avatar
                  {pendingResplit.clipsAtRisk === 1 ? ' será descartado' : ' serão descartados'}
                </div>
                <div className="text-[10.5px] text-amber-200/70 leading-snug">
                  Os clipes dos blocos divididos perdem o vínculo. Regenere depois pra
                  cobrir os pedaços novos.
                </div>
              </div>
            )}

            <div className="px-6 py-4 flex flex-col gap-2">
              <button
                onClick={applyPendingResplit}
                className="w-full py-2.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-[12.5px] font-semibold transition-colors"
              >
                Quebrar agora
              </button>
              <button
                onClick={() => setPendingResplit(null)}
                className="w-full py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <AddBrollModal
        open={addBrollOpen}
        onClose={() => setAddBrollOpen(false)}
        onTake={handleNewTake}
        onChooseRecord={() => setScreenRecOpen(true)}
      />

      <ScreenRecordingFlow
        open={screenRecOpen}
        onClose={() => setScreenRecOpen(false)}
        onTakeRecorded={handleNewTake}
      />

      {exportOpen && (
        // Conditional mount instead of toggling `open`. The modal's internal
        // state (phase, resultBlob, muxedOutputPath, caption…) persisted across
        // open/close cycles even with the reset useEffect inside the component
        // — closing then re-opening trapped the user on the "Reel pronto" done
        // screen with the previous MP4, blocking a fresh export. Unmounting
        // guarantees React drops all the state.
        <ExportRenderModal
          open={true}
          state={state}
          audioBlob={audioBlobRef.current}
          onClose={() => setExportOpen(false)}
        />
      )}

      <SettingsModal
        appTheme={state.appTheme ?? 'dark'}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={() => setSettingsOpen(false)}
        initialTab={settingsTab}
        onClonedVoicesChange={refreshClonedVoices}
      />

      {/* Editar tudo — reabre o painel de revisão com os blocos atuais. */}
      {editAllOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
          <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-3xl w-full overflow-hidden flex flex-col max-h-[92vh]">
            <ScriptPreviewPanel
              mode="script"
              blocks={editAllBlocks}
              detectedHeader={{
                format: `${editAllBlocks.length} blocos · ${editAllBlocks.filter(b => b.kind === 'avatar').length} avatar / ${editAllBlocks.filter(b => b.kind === 'broll').length} B-roll`,
              }}
              onBlocksChange={setEditAllBlocks}
              onRegenerateAll={async (extra, _tone, _lang) => {
                // No upstream source available here, so we regenerate each block in parallel.
                setEditAllBusy({ kind: 'all' });
                try {
                  const profile = activeProfileWithSpeechStyle();
                  const next = await Promise.all(editAllBlocks.map((b, i) => regenerateBlock(
                    b,
                    { prev: editAllBlocks[i - 1], next: editAllBlocks[i + 1] },
                    profile,
                    extra || 'reescreve mantendo a intenção do bloco',
                  )));
                  setEditAllBlocks(next);
                } catch (err) {
                  console.error('[editAll] regenerateAll failed:', err);
                } finally {
                  setEditAllBusy(undefined);
                }
              }}
              onRegenerateBlock={async (blockId, extra) => {
                const idx = editAllBlocks.findIndex(b => b.id === blockId);
                if (idx === -1) return;
                setEditAllBusy({ kind: 'block', blockId });
                try {
                  const profile = activeProfileWithSpeechStyle();
                  const updated = await regenerateBlock(
                    editAllBlocks[idx],
                    { prev: editAllBlocks[idx - 1], next: editAllBlocks[idx + 1] },
                    profile,
                    extra,
                  );
                  setEditAllBlocks(prev => prev.map(b => b.id === blockId ? updated : b));
                } catch (err) {
                  console.error('[editAll] regenerateBlock failed:', err);
                } finally {
                  setEditAllBusy(undefined);
                }
              }}
              onAddBlock={async (kind: BlockKind, prompt) => {
                setEditAllBusy({ kind: 'add' });
                try {
                  const profile = activeProfileWithSpeechStyle();
                  const fresh = await generateNewBlock(
                    kind,
                    prompt,
                    { prev: editAllBlocks[editAllBlocks.length - 1] },
                    profile,
                  );
                  setEditAllBlocks(prev => [...prev, fresh]);
                } catch (err) {
                  console.error('[editAll] addBlock failed:', err);
                } finally {
                  setEditAllBusy(undefined);
                }
              }}
              onApprove={(_lang) => {
                dispatch({ type: 'replace-blocks', blocks: editAllBlocks });
                setEditAllOpen(false);
              }}
              onCancel={() => setEditAllOpen(false)}
              busy={editAllBusy}
            />
          </div>
        </div>
      )}

      {/* Projects modal */}
      {projectsOpen && (
        <div
          className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-[100] p-6"
          style={{ backgroundColor: isLight ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.7)' }}
          onClick={() => setProjectsOpen(false)}
        >
          <div
            className="rounded-2xl w-full max-w-lg flex flex-col max-h-[80vh]"
            style={{
              backgroundColor: tokens.bg.surface,
              border: `1px solid ${tokens.border.subtle}`,
              color: tokens.text.primary,
              boxShadow: isLight ? '0 30px 80px rgba(0,0,0,0.18)' : '0 30px 80px rgba(0,0,0,0.8)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
              <div>
                <div className="text-sm font-semibold" style={{ color: tokens.text.primary }}>Projetos</div>
                <div className="text-[11px] mt-0.5" style={{ color: tokens.text.tertiary }}>Tudo salva automático. Abra um projeto antigo a qualquer momento.</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setProjectsOpen(false); setGuidedOpen(true); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  style={{ backgroundColor: tokens.accent.focus, color: 'white' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Novo projeto
                </button>
                <button onClick={() => setProjectsOpen(false)} className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors text-lg leading-none">×</button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 px-5 pb-5">
              {savedProjects.length === 0 ? (
                <div className="text-center py-10">
                  <div className="text-2xl mb-2">📁</div>
                  <div className="text-sm" style={{ color: tokens.text.secondary }}>Nenhum projeto ainda.</div>
                  <div className="text-[11px] mt-1" style={{ color: tokens.text.tertiary }}>Comece editando — o auto-save vai criar o primeiro.</div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {savedProjects.map(p => {
                    const isActive = p.id === state.activeProjectId;
                    const isRenaming = renamingProjectId === p.id;
                    const isPendingDelete = deleteConfirmId === p.id;
                    return (
                      <div
                        key={p.id}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors group"
                        style={{
                          backgroundColor: isActive ? `${tokens.accent.focus}1a` : tokens.bg.hover,
                          border: `1px solid ${isActive ? tokens.accent.focus : tokens.border.subtle}`,
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          {isRenaming ? (
                            <input
                              autoFocus
                              value={renameDraft}
                              onChange={e => setRenameDraft(e.target.value)}
                              onBlur={async () => {
                                if (renameDraft.trim() && renameDraft.trim() !== p.name) {
                                  await handleRenameNamedProject(p.id, renameDraft);
                                }
                                setRenamingProjectId(null);
                              }}
                              onKeyDown={async e => {
                                if (e.key === 'Enter') {
                                  if (renameDraft.trim() && renameDraft.trim() !== p.name) {
                                    await handleRenameNamedProject(p.id, renameDraft);
                                  }
                                  setRenamingProjectId(null);
                                } else if (e.key === 'Escape') {
                                  setRenamingProjectId(null);
                                }
                              }}
                              className="w-full bg-transparent text-sm font-semibold outline-none border-b"
                              style={{ color: tokens.text.primary, borderColor: tokens.accent.focus }}
                            />
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="text-sm font-semibold truncate" style={{ color: tokens.text.primary }}>{p.name}</div>
                              {isActive && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: `${tokens.accent.focus}33`, color: tokens.accent.focus }}>Aberto</span>
                              )}
                            </div>
                          )}
                          <div className="text-[10px] mt-0.5 flex items-center gap-2" style={{ color: tokens.text.tertiary }}>
                            <span>{p.blockCount} bloco{p.blockCount !== 1 ? 's' : ''}</span>
                            <span>·</span>
                            <span>{p.aspect}</span>
                            {p.durationSec > 0 && <><span>·</span><span>{Math.round(p.durationSec)}s</span></>}
                            <span>·</span>
                            <span>{formatRelativeTime(p.savedAt)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isPendingDelete ? (
                            <>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                                style={{ backgroundColor: tokens.bg.hover, color: tokens.text.secondary }}
                              >Cancelar</button>
                              <button
                                onClick={async () => { setDeleteConfirmId(null); await handleDeleteNamedProject(p.id); }}
                                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors"
                                style={{ backgroundColor: tokens.status.err }}
                              >Excluir</button>
                            </>
                          ) : !isRenaming ? (
                            <>
                              {!isActive && (
                                <button
                                  onClick={() => handleLoadNamedProject(p.id)}
                                  disabled={loadingProjectId === p.id}
                                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                  style={{ backgroundColor: `${tokens.accent.focus}33`, color: tokens.accent.focus }}
                                >
                                  {loadingProjectId === p.id ? (
                                    <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                  ) : 'Abrir'}
                                </button>
                              )}
                              <button
                                onClick={() => { setRenamingProjectId(p.id); setRenameDraft(p.name); }}
                                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                                title="Renomear"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(p.id)}
                                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-zinc-500 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                                title="Excluir projeto"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                                </svg>
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmClearOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
          <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-md w-full overflow-hidden">
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  confirmClearMode === 'new'
                    ? 'bg-blue-500/15 border border-blue-500/30'
                    : 'bg-red-500/15 border border-red-500/30'
                }`}>
                  {confirmClearMode === 'new' ? (
                    <svg className="w-5 h-5 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                    </svg>
                  )}
                </div>
                <div>
                  <div className="text-base font-semibold text-zinc-100">
                    {confirmClearMode === 'new' ? 'Começar novo projeto?' : 'Limpar projeto?'}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {confirmClearMode === 'new'
                      ? `O projeto atual ("${projectName}") será fechado.`
                      : 'Essa ação não pode ser desfeita.'}
                  </div>
                </div>
              </div>
              <div className="text-[12.5px] text-zinc-400 leading-relaxed">
                {confirmClearMode === 'new' ? (
                  <>
                    Tudo volta ao zero — roteiro, áudio, clipes de avatar e takes saem do app.
                    <br />
                    <span className="text-zinc-500">
                      Os arquivos físicos do "{projectName}" (assets, motions renderizados) ficam salvos em <code className="text-zinc-400">~/Reels Studio/Projects/</code> caso queira reaproveitar depois.
                    </span>
                  </>
                ) : (
                  'O roteiro, áudio gerado, clipes de avatar e takes serão removidos do app. Você vai começar do zero.'
                )}
              </div>
            </div>
            <div className="px-6 py-4 bg-black/30 border-t border-white/5 flex gap-2">
              <button
                onClick={() => setConfirmClearOpen(false)}
                disabled={clearing}
                className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setClearing(true);
                  try {
                    await clearProject();
                    // For "new project", stamp a unique name so the new
                    // project gets its OWN assets dir
                    // (`~/Reels Studio/Projects/<unique>/Assets/`).
                    // Without this, every fresh project would share
                    // "Reel sem título" → assets from prior runs leak.
                    // The hydrator reads + clears this key on next boot.
                    if (confirmClearMode === 'new') {
                      const now = new Date();
                      const pad = (n: number) => String(n).padStart(2, '0');
                      const stamp =
                        `${pad(now.getDate())}/${pad(now.getMonth() + 1)} ${pad(now.getHours())}h${pad(now.getMinutes())}`;
                      localStorage.setItem(
                        'reels.pendingProjectName',
                        `Reel · ${stamp}`,
                      );
                    }
                    window.location.reload();
                  } catch (err) {
                    console.error('[reels] clearProject failed:', err);
                    alert(`Erro ao limpar: ${err instanceof Error ? err.message : 'desconhecido'}`);
                    setClearing(false);
                    setConfirmClearOpen(false);
                  }
                }}
                disabled={clearing}
                className={`flex-1 py-2.5 rounded-lg text-xs font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  confirmClearMode === 'new'
                    ? 'bg-blue-500 hover:bg-blue-400'
                    : 'bg-red-500 hover:bg-red-400'
                }`}
              >
                {clearing
                  ? (confirmClearMode === 'new' ? 'Iniciando…' : 'Limpando…')
                  : (confirmClearMode === 'new' ? 'Começar novo' : 'Sim, limpar tudo')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Novo projeto" confirmation — save or delete current before opening the
          guided wizard. Only triggered when there's already content. */}
      {newProjectConfirmOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
          <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-md w-full overflow-hidden">
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-blue-500/15 border border-blue-500/30">
                  <svg className="w-5 h-5 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <div>
                  <div className="text-base font-semibold text-zinc-100">Começar novo projeto?</div>
                  <div className="text-xs text-zinc-500">O que fazer com "{projectName}"?</div>
                </div>
              </div>
              <div className="text-[12.5px] text-zinc-400 leading-relaxed">
                <b className="text-zinc-300">Salvar</b> mantém o projeto atual em "Meus projetos" e abre um novo do zero.<br />
                <b className="text-zinc-300">Deletar</b> remove o projeto atual (e seu áudio/clipes) antes de abrir um novo.
              </div>
            </div>
            <div className="px-6 py-4 bg-black/30 border-t border-white/5 flex gap-2">
              <button
                onClick={() => setNewProjectConfirmOpen(false)}
                className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  // Delete current project from IndexedDB first, then open the wizard.
                  const id = state.activeProjectId;
                  if (id) {
                    try { await deleteNamedProject(id); } catch (err) { console.error('[reels] delete current failed:', err); }
                  }
                  setNewProjectConfirmOpen(false);
                  setGuidedOpen(true);
                }}
                className="flex-1 py-2.5 rounded-lg bg-red-500/90 hover:bg-red-500 text-xs font-semibold text-white transition-colors"
              >
                Deletar atual
              </button>
              <button
                onClick={() => {
                  // Save = default behavior: handleNewProject keeps the old
                  // project saved in IndexedDB; user can reopen via "Meus projetos".
                  setNewProjectConfirmOpen(false);
                  setGuidedOpen(true);
                }}
                className="flex-1 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-xs font-semibold text-white transition-colors"
              >
                Salvar e continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {regenAvatarBlockId && (() => {
        const target = avatarBlocks.find(b => b.id === regenAvatarBlockId);
        if (!target) {
          // Selection went stale (block removed?). Clear and skip.
          setRegenAvatarBlockId(null);
          return null;
        }
        const visible = Math.min(target.avatarVisibleSec ?? (target.end - target.start), target.end - target.start);
        const effectiveModel = regenAvatarModel ?? state.avatarModel;
        const existingClip = state.avatarClips[target.id];
        const isFirstGen = !existingClip || existingClip.status === 'idle' || existingClip.status === 'error' || !existingClip.videoUrl;
        const modalTitle = isFirstGen ? 'Gerar avatar deste bloco?' : 'Regerar avatar deste bloco?';
        const modalSubtitle = isFirstGen
          ? 'Um novo clipe HeyGen será criado pra este bloco.'
          : 'O clipe atual será substituído pelo novo.';
        // Per-second pricing varies by model — calculate from the same table
        // the global GenerateAvatarsModal uses so the user sees consistent
        // numbers between the two flows.
        const pricePerSec = PRICE_PER_SECOND_BY_MODEL[effectiveModel] ?? PRICE_PER_AVATAR_SECOND;
        const cost = visible * pricePerSec;
        // Avatar 4 retirado: mesmo custo do V ($0.058/s), qualidade inferior.
        const modelOptions: { id: HeyGenModelChoice; label: string; hint: string }[] = [
          { id: 'avatar5', label: 'Avatar V', hint: 'recomendado · mais realista' },
          { id: 'avatar3', label: 'Avatar 3', hint: 'mais barato' },
        ];
        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
            <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-md w-full overflow-hidden">
              <div className="px-6 pt-6 pb-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center bg-amber-500/15 border border-amber-500/30">
                    <svg className="w-5 h-5 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-base font-semibold text-zinc-100">{modalTitle}</div>
                    <div className="text-xs text-zinc-500">{modalSubtitle}</div>
                  </div>
                </div>
                <div className="text-[12.5px] text-zinc-400 leading-relaxed mb-4">
                  <div className="mb-2">"{target.text.slice(0, 80)}{target.text.length > 80 ? '…' : ''}"</div>
                </div>
                <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Modelo</div>
                <div className="flex items-center gap-1.5 mb-3">
                  {modelOptions.map(opt => {
                    const active = effectiveModel === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => setRegenAvatarModel(opt.id)}
                        className={`flex-1 px-2 py-2 rounded-lg border text-[11px] font-semibold transition-all ${
                          active
                            ? 'bg-amber-500/15 border-amber-400/50 text-amber-100'
                            : 'bg-black/20 border-white/10 text-zinc-400 hover:border-white/20'
                        }`}
                      >
                        <div>{opt.label}</div>
                        <div className="text-[9px] font-normal opacity-70 mt-0.5">{opt.hint}</div>
                      </button>
                    );
                  })}
                </div>
                <div className="text-[11px] text-zinc-500">
                  Duração visível: <span className="text-zinc-300">{visible.toFixed(1)}s</span> · Custo estimado: <span className="text-zinc-300">${cost.toFixed(2)}</span>
                </div>
              </div>
              <div className="px-6 py-4 bg-black/30 border-t border-white/5 flex gap-2">
                <button
                  onClick={() => { setRegenAvatarBlockId(null); setRegenAvatarModel(null); }}
                  disabled={generatingClips}
                  className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors disabled:opacity-40"
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    const id = regenAvatarBlockId;
                    const model = regenAvatarModel ?? state.avatarModel;
                    setRegenAvatarBlockId(null);
                    setRegenAvatarModel(null);
                    if (id) await runRegenerateOneClip(id, model);
                  }}
                  disabled={generatingClips}
                  className="flex-1 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-semibold text-zinc-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {generatingClips ? 'Gerando…' : isFirstGen ? 'Gerar' : 'Regerar'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {reviewTakeId && (() => {
        const take = state.takes.find(t => t.id === reviewTakeId);
        if (!take) return null;
        return (
          <TakeReviewModal
            take={take}
            onClose={() => setReviewTakeId(null)}
            onSave={(patch) => dispatch({ type: 'update-take', id: take.id, patch })}
          />
        );
      })()}

      {previewClipId && (() => {
        const block = blocks.find(b => b.id === previewClipId);
        const clip = state.avatarClips[previewClipId];
        if (!block || !clip?.videoUrl) {
          return null;
        }
        return (
          <ClipPreviewLightbox
            videoUrl={clip.videoUrl}
            blockText={block.text}
            duration={block.end - block.start}
            onClose={() => setPreviewClipId(null)}
          />
        );
      })()}

      <style>{`
        @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
      `}</style>
      </div>{/* /main editor column */}

      <AgentPanel
        open={agentPanelOpen}
        onClose={() => setAgentPanelOpen(false)}
        appTheme={state.appTheme}
        projectKey={state.projectName || '_default'}
      />
    </div>
  );
};

// ─── SUB-COMPONENT: ACTIONS MENU ─────────────────────────────────────────
// Collapses what used to be 7 inline buttons (Add B-roll, Gerar Áudio,
// Descrição, Gerar Clipes, Clip de Teste, Motions, Assets) into a single
// "Ações" dropdown next to the timeline. With the chat agent as the
// primary CTA, surfacing all of these in the toolbar is visual noise.
interface ActionsMenuItem {
  key: string;
  icon: string;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  disabledHint?: string;
}

const ActionsMenu: React.FC<{
  items: ActionsMenuItem[];
  tokens: import('./reelsStudio/theme').ThemeTokens;
}> = ({ items, tokens }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // "down" by default; flips to "up" when the menu would overflow the
  // viewport bottom. Re-evaluated each open so it adapts to scroll.
  const [direction, setDirection] = useState<'down' | 'up'>('down');

  useEffect(() => {
    if (!open) return;
    // Pick a direction based on how much room is below the trigger.
    // Reasonable estimate: each item is ~52px (icon + label + hint),
    // plus 12px of vertical padding on the menu.
    const trigger = ref.current?.querySelector('button');
    if (trigger) {
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const estimatedHeight = items.length * 52 + 12;
      setDirection(spaceBelow < estimatedHeight + 24 && rect.top > spaceBelow ? 'up' : 'down');
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, items.length]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
        style={{
          backgroundColor: open ? tokens.bg.active : tokens.bg.hover,
          color: tokens.text.primary,
          border: `1px solid ${tokens.border.subtle}`,
        }}
        title="Ações manuais (o agente cobre a maioria via chat)"
      >
        Ações
        <svg
          className="w-3 h-3 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute left-0 rounded-xl py-1.5 z-50 min-w-[260px] max-h-[80vh] overflow-y-auto ${
            direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
          style={{
            backgroundColor: tokens.bg.elevated,
            border: `1px solid ${tokens.border.default}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
          }}
        >
          {items.map(item => (
            <button
              key={item.key}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onClick();
              }}
              disabled={item.disabled}
              className="w-full px-3 py-2 text-left flex items-start gap-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={item.disabled ? item.disabledHint : item.hint}
              onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.backgroundColor = tokens.bg.hover; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span className="text-[14px] leading-[1.2] shrink-0 mt-0.5">{item.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-medium" style={{ color: tokens.text.primary }}>
                  {item.label}
                </div>
                {item.hint && (
                  <div className="text-[10.5px] mt-0.5 leading-snug" style={{ color: tokens.text.tertiary }}>
                    {item.hint}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── SUB-COMPONENT: SCRIPT BLOCK CARD ───────────────────────────────────
interface BlockCardProps {
  block: ScriptBlock;
  index: number;
  total: number;
  wordCount: number;
  audioReady: boolean;
  onToggleKind: () => void;
  onUpdateText: (text: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSetAvatarVisibleSec: (sec: number | undefined) => void;
  onSetLayout: (layout: BlockLayout) => void;
  onSetAvatarZoom: (zoom: number) => void;
  onSetAvatarOffsetY: (offsetY: number) => void;
  /** Pick a per-block avatar photo. `undefined` clears the override and
   *  the block falls back to the project's default photo. The list of
   *  photos is loaded lazily inside the card. */
  onSetAvatarPhoto: (photoId: string | undefined) => void;
  defaultZoom: number;
  isCurrent: boolean;
  isSelected: boolean;
  compact?: boolean;
  /** Click handler — receives the event so the parent can read shift/meta keys for multi-select. */
  onSelect: (e?: React.MouseEvent) => void;
  onJumpTo: () => void;
  onOpenMotion: () => void;
  onOpenMotionAdvanced: () => void;
  onOpenAssetPicker: () => void;
  onSetStylePreset: (preset: StylePresetId | undefined) => void;
  onDuplicate: () => void;
  motionBusyMessage: string | null;
  /** True when the project's asset folder has files but this block has none
   *  attached — motion generation is blocked until the user attaches one. */
  requiresAsset: boolean;
  /** Shown as a badge in the card header when in carousel mode. */
  carouselRole?: 'cover' | 'body' | 'cta';
  /** Edit-video mode: the card is a SPEECH segment of the user's own video —
   *  hide creation-only noise (per-block cost, avatar/asset gates). */
  editMode?: boolean;
}

// ── Carousel canvas preview — shows motion video or slide text fallback ────────
const CarouselCanvasPreview: React.FC<{
  block: ScriptBlock | null;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}> = ({ block, index, total, onPrev, onNext }) => {
  const m = block?.motion;
  const isReady = m?.status === 'ready' && !!m?.videoPath;
  const isWorking = m?.status === 'generating' || m?.status === 'rendering';

  return (
    <div className="absolute inset-0 bg-black">
      {isReady ? (
        <MotionLayerOverlay
          key={`cp-${m!.id}-${m!.renderedAt ?? 0}`}
          motion={m!}
          playing={true}
          layer="replace"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8">
          {block?.text ? (
            <p className="text-zinc-200 text-center text-[15px] leading-relaxed font-medium">
              {block.text}
            </p>
          ) : (
            <p className="text-zinc-600 text-[12px] italic">Slide vazio</p>
          )}
          {isWorking ? (
            <div className="flex items-center gap-2 text-blue-400 text-[11px]">
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25"/>
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Gerando motion…
            </div>
          ) : (
            <p className="text-zinc-600 text-[11px]">
              {block ? 'Clique "Gerar motion" no slide →' : 'Selecione um slide'}
            </p>
          )}
        </div>
      )}

      {/* Label */}
      <div className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur text-[10px] font-medium text-zinc-400 z-40">
        4:5 Carrossel
      </div>

      {/* Navigation arrows */}
      {total > 1 && (
        <>
          <button
            onClick={onPrev}
            disabled={index === 0}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white disabled:opacity-20 transition-all z-40"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <button
            onClick={onNext}
            disabled={index === total - 1}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white disabled:opacity-20 transition-all z-40"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-40">
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === index ? 'bg-white' : 'bg-white/25'}`}/>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ── Carousel-only slide card — no avatar, layout, zoom, or audio concepts ──────
interface CarouselSlideCardProps {
  block: ScriptBlock;
  index: number;
  total: number;
  role: 'cover' | 'body' | 'cta';
  motionBusyMessage: string | null;
  isSelected?: boolean;
  onSelect?: () => void;
  onUpdateText: (t: string) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onOpenMotion: () => void;
  onOpenMotionAdvanced: () => void;
  onOpenAssetPicker: () => void;
  onSetStylePreset: (preset: StylePresetId | undefined) => void;
}

const CarouselSlideCard: React.FC<CarouselSlideCardProps> = ({
  block: b, index, total, role, motionBusyMessage, isSelected, onSelect,
  onUpdateText, onRemove, onMoveUp, onMoveDown, onDuplicate,
  onOpenMotion, onOpenMotionAdvanced, onOpenAssetPicker, onSetStylePreset,
}) => {
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const activePreset = findStylePreset(b.stylePresetOverride ?? 'glass-tech');

  const isBusy = !!motionBusyMessage;
  const m = b.motion;
  const currentAssets = b.attachedAssets ?? [];
  const isStale = !isBusy && isMotionAssetsStale(m, currentAssets);
  const isReady = m?.status === 'ready' && !!m?.videoPath && !isStale;
  const isError = m?.status === 'error';

  const motionLabel = isBusy
    ? motionBusyMessage
    : isStale ? 'Regenerar'
    : isReady ? 'Motion ✓'
    : isError ? 'Motion ⚠'
    : currentAssets.length > 0 ? `Gerar com ${currentAssets.length} asset${currentAssets.length > 1 ? 's' : ''}`
    : 'Gerar motion';

  const motionCls = isBusy
    ? 'bg-blue-500/15 border-blue-400/40 text-blue-200 cursor-progress'
    : isStale ? 'bg-amber-500/20 border-amber-400/60 text-amber-100 hover:bg-amber-500/30'
    : isReady ? 'bg-blue-500/20 border-blue-400/50 text-blue-100 hover:bg-blue-500/30'
    : isError ? 'bg-red-500/15 border-red-500/40 text-red-200 hover:bg-red-500/25'
    : 'bg-blue-500/[0.08] border-blue-400/30 text-blue-200 hover:bg-blue-500/15 hover:border-blue-400/50';

  const roleCls = role === 'cover'
    ? 'bg-blue-500/30 text-blue-300'
    : role === 'cta'
    ? 'bg-emerald-500/20 text-emerald-300'
    : 'bg-white/5 text-zinc-400';

  const roleLabel = role === 'cover' ? 'Cover' : role === 'cta' ? 'CTA' : `Slide ${index + 1}`;

  const placeholder = role === 'cover'
    ? 'Frase de impacto que para o scroll…'
    : role === 'cta'
    ? 'Chamada para ação — o que o leitor deve fazer agora?'
    : 'Texto do slide…';

  const assetCount = currentAssets.length;
  const assetLabel = assetCount === 0 ? 'Asset' : assetCount === 1 ? currentAssets[0].name : `${assetCount} slides`;

  return (
    <div
      className={`rounded-xl border overflow-hidden transition-all cursor-pointer ${
        isSelected
          ? 'border-blue-500/50 ring-1 ring-blue-500/30 bg-blue-500/[0.03]'
          : 'border-white/8 bg-white/[0.02] hover:border-white/15'
      }`}
      onClick={onSelect}
    >
      {/* Header: role badge · motion · ⋯ */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${roleCls}`}>
          {roleLabel}
        </span>

        {/* Motion button — primary action */}
        <button
          onClick={() => { if (!isBusy) onOpenMotion(); }}
          disabled={isBusy}
          className={`flex-1 min-w-0 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors flex items-center gap-1.5 ${motionCls}`}
        >
          {isBusy ? (
            <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25"/>
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          ) : (
            <span className="text-[12px] leading-none shrink-0">🎨</span>
          )}
          <span className="truncate">{motionLabel}</span>
        </button>

        {/* Edit motion (only when html exists) */}
        {m?.html && !isBusy && (
          <button
            onClick={onOpenMotionAdvanced}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors shrink-0"
            title="Editar motion"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
          </button>
        )}

        {/* ⋯ menu */}
        <div className="relative shrink-0">
          <button
            onClick={() => setMoreMenuOpen(o => !o)}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
            </svg>
          </button>
          {moreMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(false)}/>
              <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-lg border border-white/10 bg-[#141416] shadow-[0_20px_60px_rgba(0,0,0,0.6)] py-1" onClick={e => e.stopPropagation()}>
                <button onClick={() => { setMoreMenuOpen(false); onMoveUp(); }} disabled={index === 0}
                  className="w-full text-left px-3 py-2 text-[12px] text-zinc-200 hover:bg-white/5 disabled:opacity-30 flex items-center gap-2">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7"/></svg>
                  Mover acima
                </button>
                <button onClick={() => { setMoreMenuOpen(false); onMoveDown(); }} disabled={index === total - 1}
                  className="w-full text-left px-3 py-2 text-[12px] text-zinc-200 hover:bg-white/5 disabled:opacity-30 flex items-center gap-2">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
                  Mover abaixo
                </button>
                <button onClick={() => { setMoreMenuOpen(false); onDuplicate(); }}
                  className="w-full text-left px-3 py-2 text-[12px] text-zinc-200 hover:bg-white/5 flex items-center gap-2">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                  Duplicar
                </button>
                <div className="border-t border-white/5 my-1"/>
                <button onClick={() => { setMoreMenuOpen(false); onRemove(); }}
                  className="w-full text-left px-3 py-2 text-[12px] text-red-300 hover:bg-red-500/10 flex items-center gap-2">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/></svg>
                  Remover slide
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Motion preview thumbnail — plays only on hover to avoid 10x simultaneous video decode */}
      {isReady && m?.videoPath && (
        <div className="px-3 pt-2.5 group/thumb">
          <video
            src={convertFileSrc(m.videoPath)}
            className="w-full aspect-[4/5] rounded-lg object-cover bg-black"
            muted playsInline preload="auto"
            onMouseEnter={e => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
            onMouseLeave={e => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }}
          />
        </div>
      )}

      {/* Editable text */}
      <textarea
        value={b.text}
                    onChange={e => onUpdateText(e.target.value)}
        rows={3}
        placeholder={placeholder}
        // Spell-check disabled: NSSpellServer in WKWebView hammers CPU when
        // many block textareas are mounted at once (one per block), causing
        // the app to slow to a crawl. See dev log for `NSSpellServer ... timed
        // out` + the resulting `EmptyRanges` ReferenceError loop.
        spellCheck={false}
        autoCorrect="off"
        className="w-full bg-transparent px-3 py-2.5 text-[12px] text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:bg-white/[0.02] transition-colors"
      />

      {/* Footer: asset + style */}
      <div className="px-3 py-2 border-t border-white/5 flex items-center gap-1.5">
        <button
          onClick={onOpenAssetPicker}
          className={`px-2 py-1 rounded-md text-[10.5px] font-medium border transition-colors flex items-center gap-1 min-w-0 ${
            assetCount > 0
              ? 'bg-blue-500/20 border-blue-400/50 text-blue-100 hover:bg-blue-500/30'
              : 'bg-blue-500/[0.06] border-blue-400/20 text-blue-300/80 hover:bg-blue-500/15 hover:text-blue-200 hover:border-blue-400/40'
          }`}
        >
          <span>📎</span>
          <span className="max-w-[120px] truncate">{assetLabel}</span>
          {assetCount > 1 && <span className="ml-0.5 px-1 rounded bg-blue-300/20 text-[9px] font-bold text-blue-50">{assetCount}</span>}
        </button>

        <div className="relative">
          <button
            onClick={() => setStyleMenuOpen(o => !o)}
            className={`px-2 py-1 rounded-md text-[10.5px] font-medium border transition-colors flex items-center gap-1 ${
              b.stylePresetOverride
                ? 'bg-amber-500/15 border-amber-400/40 text-amber-100 hover:bg-amber-500/25'
                : 'bg-zinc-500/[0.06] border-zinc-400/20 text-zinc-300/80 hover:bg-zinc-500/15 hover:text-zinc-100 hover:border-zinc-400/40'
            }`}
          >
            <span>{activePreset.emoji}</span>
            <span className="max-w-[90px] truncate">{activePreset.label}</span>
            <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </button>
          {styleMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setStyleMenuOpen(false)}/>
              <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-lg border border-white/10 bg-[#141416] shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-3 py-2 border-b border-white/5 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Estilo do motion</div>
                <div className="max-h-[280px] overflow-y-auto">
                  {STYLE_PRESETS.map(p => {
                    const isActive = (b.stylePresetOverride ?? 'glass-tech') === p.id;
                    return (
                      <button key={p.id} onClick={() => { onSetStylePreset(p.id === 'glass-tech' ? undefined : (p.id as StylePresetId)); setStyleMenuOpen(false); }}
                        className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${isActive ? 'bg-amber-500/10' : 'hover:bg-white/5'}`}>
                        <span className="text-base shrink-0 mt-0.5">{p.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className={`text-[11.5px] font-medium ${isActive ? 'text-amber-200' : 'text-zinc-100'}`}>
                            {p.label}{isActive && <span className="ml-1.5 text-[9px] text-amber-300">●</span>}
                          </div>
                          <div className="text-[10px] text-zinc-500 leading-snug line-clamp-2">{p.bestFor}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const LayoutThumbnail: React.FC<{ layout: BlockLayout; selected: boolean }> = ({ layout, selected }) => {
  // Each thumbnail is a stylized 9:16-ish rectangle showing where avatar (amber) and media (emerald) sit.
  const borderClass = selected ? 'border-blue-400 shadow-[0_0_12px_rgba(10,132,255,0.4)]' : 'border-white/10';
  return (
    <div className={`relative w-full aspect-[9/16] rounded border bg-zinc-900 overflow-hidden transition-all ${borderClass}`}>
      {layout === 'avatar-only' && (
        <div className="absolute inset-0 bg-gradient-to-b from-amber-400/70 to-amber-600/70 flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-amber-200/90" />
        </div>
      )}
      {layout === 'media-only' && (
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-400/70 to-emerald-600/70 flex items-center justify-center">
          <svg className="w-3 h-3 text-emerald-100" fill="currentColor" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2"/></svg>
        </div>
      )}
      {layout === 'avatar-top' && (
        <>
          <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-amber-400/70 to-amber-600/70 flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-amber-200/90" /></div>
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-emerald-400/70 to-emerald-600/70 flex items-center justify-center"><svg className="w-2 h-2 text-emerald-100" fill="currentColor" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2"/></svg></div>
        </>
      )}
      {layout === 'media-top' && (
        <>
          <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-emerald-400/70 to-emerald-600/70 flex items-center justify-center"><svg className="w-2 h-2 text-emerald-100" fill="currentColor" viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2"/></svg></div>
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-amber-400/70 to-amber-600/70 flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-amber-200/90" /></div>
        </>
      )}
    </div>
  );
};

// Inline thumbnail picker for the per-block avatar photo. Loads
// AvatarPhoto[] from localStorage (cheap), renders a horizontal strip of
// thumbs. The first chip is "Padrão" (clears the override and falls back
// to the project-level photo). Selection state is purely driven by the
// block's `avatarPhotoId` — we don't keep local state here.
const BlockAvatarPhotoPicker: React.FC<{
  currentPhotoId: string | undefined;
  onPick: (photoId: string | undefined) => void;
}> = ({ currentPhotoId, onPick }) => {
  const photos = loadAvatarPhotos();
  if (photos.length === 0) {
    return (
      <div className="px-3 py-2 border-t border-white/5">
        <div className="text-[10px] text-zinc-400 mb-1.5">👤 Foto do avatar</div>
        <div className="text-[10px] text-zinc-500">
          Nenhuma foto cadastrada — adicione em &quot;Gerar clipes de avatar&quot;.
        </div>
      </div>
    );
  }
  const usingDefault = !currentPhotoId;
  return (
    <div className="px-3 py-2 border-t border-white/5">
      <div className="text-[10px] text-zinc-400 mb-1.5">👤 Foto do avatar</div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {/* Default chip — clears the per-block override. */}
        <button
          onClick={() => onPick(undefined)}
          className={`shrink-0 w-12 h-12 rounded-md border flex items-center justify-center text-[9px] font-medium transition-colors ${
            usingDefault
              ? 'border-blue-400 bg-blue-500/15 text-blue-200'
              : 'border-white/10 bg-black/30 text-zinc-400 hover:bg-white/5'
          }`}
          title="Usar a foto padrão do projeto"
        >
          Padrão
        </button>
        {photos.map(p => {
          const selected = currentPhotoId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              className={`shrink-0 w-12 h-12 rounded-md overflow-hidden border transition-colors ${
                selected ? 'border-blue-400' : 'border-white/10 hover:border-white/30'
              }`}
              title={p.name}
            >
              <img
                src={p.thumbnailBase64 || p.previewUrl || ''}
                alt={p.name}
                className="w-full h-full object-cover"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ScriptBlockCard: React.FC<BlockCardProps> = ({ block: b, index, total, wordCount, audioReady, onToggleKind, onUpdateText, onRemove, onMoveUp, onMoveDown, onSetAvatarVisibleSec, onSetLayout, onSetAvatarZoom, onSetAvatarOffsetY, onSetAvatarPhoto, defaultZoom, isCurrent, isSelected, compact, onSelect, onJumpTo, onOpenMotion, onOpenMotionAdvanced, onOpenAssetPicker, onSetStylePreset, onDuplicate, motionBusyMessage, requiresAsset, carouselRole, editMode }) => {
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  // Note: Onda 1 moved all "advanced" controls (zoom, offset, layout, photo,
  // visible-sec, style picker, asset picker, attached assets) into the new
  // InspectorPanel below the preview. The sidebar card now only shows text +
  // status — selecting a block surfaces its details in the inspector.
  // Resolve current preset (override or seed default 'glass-tech').
  const activePreset = findStylePreset(b.stylePresetOverride ?? 'glass-tech');
  const isAvatar = b.kind === 'avatar';
  const duration = b.end - b.start;
  const visibleSec = b.avatarVisibleSec ?? duration;
  const cost = isAvatar ? visibleSec * PRICE_PER_AVATAR_SECOND : 0;
  const isPartial = isAvatar && b.avatarVisibleSec !== undefined && b.avatarVisibleSec < duration - 0.05;

  if (compact) {
    return (
      <button
        onClick={onSelect}
        title={b.text || '(vazio)'}
        className={`w-full text-left rounded-lg border px-3 py-2 transition-colors flex items-center gap-2.5 ${
          isCurrent ? 'ring-1 ring-blue-400/40' : ''
        } ${
          isAvatar
            ? 'bg-amber-500/[0.04] border-amber-500/20 hover:border-amber-500/40'
            : 'bg-emerald-500/[0.04] border-emerald-500/20 hover:border-emerald-500/40'
        }`}
      >
        <span className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
          isAvatar ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'
        }`}>{index + 1}</span>
        <span className="shrink-0 text-[10px]">{isAvatar ? '👤' : '🖥️'}</span>
        {carouselRole && (
          <span className={`shrink-0 text-[8px] px-1 py-0.5 rounded font-semibold uppercase ${
            carouselRole === 'cover' ? 'bg-blue-500/30 text-blue-300' :
            carouselRole === 'cta'   ? 'bg-emerald-500/20 text-emerald-300' :
                                      'bg-white/5 text-zinc-500'
          }`}>
            {carouselRole === 'cover' ? 'Cover' : carouselRole === 'cta' ? 'CTA' : 'Slide'}
          </span>
        )}
        <span className="flex-1 min-w-0 text-[11.5px] text-zinc-300 truncate">{b.text || <span className="italic text-zinc-600">vazio</span>}</span>
        <span className="shrink-0 text-[9.5px] text-zinc-500 font-mono tabular-nums">{duration.toFixed(1)}s</span>
        {b.dirty && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400" title="Texto alterado · regenere o áudio"></span>}
      </button>
    );
  }

  return (
    <div
      onClick={onSelect}
      className={`group rounded-xl border transition-all ${
        isSelected ? 'ring-2 ring-blue-400 shadow-[0_0_24px_rgba(10,132,255,0.35)]'
        : isCurrent ? 'ring-1 ring-blue-400/50 shadow-[0_0_24px_rgba(10,132,255,0.15)]' : ''
      } ${
        isAvatar ? 'bg-amber-500/[0.04] border-amber-500/20 hover:border-amber-500/40' : 'bg-emerald-500/[0.04] border-emerald-500/20 hover:border-emerald-500/40'
      }`}>
      {(() => {
        // Compute motion state once for use across header + inspector strip.
        const isBusy = !!motionBusyMessage;
        const m = b.motion;
        const currentAssets = b.attachedAssets ?? [];
        const snapCount = m?.assetSnapshots?.length ?? (m?.assetSnapshot ? 1 : 0);
        const isStale = !isBusy && isMotionAssetsStale(m, currentAssets);
        const isReady = m?.status === 'ready' && !!m?.videoPath && !isStale;
        const isError = m?.status === 'error';

        const noun = (n: number) => n === 0 ? 'asset' : n === 1 ? 'asset' : 'carrossel';
        // requiresAsset takes precedence over the normal label tree: even if
        // the motion has an old html (e.g. user removed the previously-attached
        // asset), we want the user to fix the gap before regenerating.
        // STATUS chip — informational. Generation/regeneration lives in the
        // Motion Dock below the selected card (single home); clicking the
        // chip just selects the block (event bubbles to the card's onSelect).
        const motionLabel = isBusy
          ? motionBusyMessage
          : requiresAsset
            ? '📎 Anexar asset'
            : isStale
              ? (snapCount === 0 && currentAssets.length > 0
                  ? `Regenerar (${noun(currentAssets.length)})`
                  : 'Regenerar no Dock')
              : isReady
                ? 'Motion ✓'
                : isError
                  ? 'Motion ⚠'
                  : 'Sem motion';

        const motionCls = isBusy
          ? 'bg-blue-500/10 border-blue-400/40 text-blue-200 cursor-progress'
          : requiresAsset
            ? 'bg-amber-500/15 border-amber-400/50 text-amber-100 hover:bg-amber-500/25 cursor-pointer'
            : isStale
              ? 'bg-amber-500/15 border-amber-400/40 text-amber-200'
              : isReady
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : isError
                  ? 'bg-red-500/15 border-red-500/40 text-red-200'
                  : 'bg-white/[0.04] border-white/10 text-zinc-400';

        const describeList = (items: { name: string }[]): string =>
          items.length === 0 ? '(nenhum)' : items.map(x => `"${x.name}"`).join(' → ');
        const snapItems = m?.assetSnapshots ?? (m?.assetSnapshot ? [m.assetSnapshot] : []);
        const motionTooltip = isBusy
          ? motionBusyMessage ?? 'Gerando…'
          : requiresAsset
            ? 'A pasta do projeto tem assets, mas este bloco não tem nenhum anexado. Clique pra anexar.'
            : isStale
              ? `Motion foi gerado com ${describeList(snapItems)}. Atual: ${describeList(currentAssets)}. Regere no Dock abaixo.`
              : isReady
                ? `Motion pronto · ${m?.intent ?? ''} — configure no Dock abaixo`
                : isError
                  ? `Erro: ${m?.errorMessage ?? ''}. Regere no Dock abaixo.`
                  : 'Sem motion ainda — gere no Dock abaixo do card';

        const assetCount = currentAssets.length;
        const assetLabel = assetCount === 0
          ? 'Asset'
          : assetCount === 1
            ? currentAssets[0].name
            : `${assetCount} slides`;
        const assetTooltip = assetCount === 0
          ? 'Anexar asset (imagem/vídeo) ao bloco'
          : assetCount === 1
            ? `Asset: ${currentAssets[0].name}`
            : `${assetCount} slides em sequência: ${currentAssets.map(a => a.name).join(' → ')}`;

        return (
          <>
            {/* ── Primary header: kind toggle · motion · ⋯ ───────────────── */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5">
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleKind(); }}
                  className={`flex items-center gap-1.5 text-[11px] font-semibold rounded-md px-2 py-1 transition-colors ${
                    isAvatar ? 'text-amber-300 bg-amber-500/10 hover:bg-amber-500/20' : 'text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20'
                  }`}
                  title={editMode
                    ? `O que aparece durante esta fala: ${isAvatar ? 'seu vídeo (motion flutua por cima)' : 'b-roll — o motion assume a tela inteira'} · clique pra alternar`
                    : `Tipo: ${isAvatar ? 'avatar' : 'b-roll'} · clique pra alternar`}
                >
                  {editMode
                    ? (isAvatar ? '🎥 Vídeo' : '🖥️ B-roll')
                    : (isAvatar ? '👤 Avatar' : '🖥️ B-roll')}
                </button>
                {carouselRole && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${
                    carouselRole === 'cover' ? 'bg-blue-500/25 text-blue-300' :
                    carouselRole === 'cta'   ? 'bg-emerald-500/20 text-emerald-300' :
                                              'bg-white/5 text-zinc-500'
                  }`}>
                    {carouselRole === 'cover' ? 'Cover' : carouselRole === 'cta' ? 'CTA' : `Slide ${index + 1}`}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 flex-1 min-w-0 justify-end">
                <div
                  onClick={(e) => {
                    // Missing-asset is the one actionable state: one tap opens
                    // the AssetPicker. Everything else bubbles to the card's
                    // onSelect — the Motion Dock below is where actions live.
                    if (!isBusy && requiresAsset) { e.stopPropagation(); onOpenAssetPicker(); }
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors flex items-center gap-1.5 min-w-0 ${motionCls}`}
                  title={motionTooltip}
                >
                  {isBusy && (
                    <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {!isBusy && isReady && (
                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  )}
                  <span className="truncate">{motionLabel}</span>
                </div>
                {/* ⋯ menu (motion advanced · asset · jump/move/duplicate/delete) */}
                <div className="relative shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); setMoreMenuOpen(o => !o); }}
                    className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors"
                    title="Mais ações"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
                    </svg>
                  </button>
                  {moreMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setMoreMenuOpen(false); }} />
                      <div
                        className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-white/10 bg-[#141416] shadow-[0_20px_60px_rgba(0,0,0,0.6)] overflow-hidden py-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {b.motion?.html && (
                          <button
                            onClick={() => { setMoreMenuOpen(false); onOpenMotionAdvanced(); }}
                            className="w-full text-left px-3 py-2 text-[12px] text-zinc-200 hover:bg-white/5 flex items-center gap-2"
                          >
                            <svg className="w-3.5 h-3.5 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            Editar motion avançado
                          </button>
                        )}
                        <button
                          onClick={() => { setMoreMenuOpen(false); onOpenAssetPicker(); }}
                          className="w-full text-left px-3 py-2 text-[12px] text-zinc-200 hover:bg-white/5 flex items-center gap-2"
                        >
                          <svg className="w-3.5 h-3.5 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                          </svg>
                          Anexar asset…
                        </button>
                        <div className="border-t border-white/5 my-1" />
                        <button
                          onClick={() => { setMoreMenuOpen(false); onJumpTo(); }}
                          className="w-full text-left px-3 py-2 text-[12px] text-zinc-200 hover:bg-white/5 flex items-center gap-2"
                        >
                          <svg className="w-3.5 h-3.5 text-blue-300" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                          Pular pra este bloco
                        </button>
                        <button
                          onClick={() => { setMoreMenuOpen(false); onMoveUp(); }}
                          disabled={index === 0}
                          className="w-full text-left px-3 py-2 text-[12px] text-zinc-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                          Mover acima
                        </button>
                        <button
                          onClick={() => { setMoreMenuOpen(false); onMoveDown(); }}
                          disabled={index === total - 1}
                          className="w-full text-left px-3 py-2 text-[12px] text-zinc-200 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                          Mover abaixo
                        </button>
                        <button
                          onClick={() => { setMoreMenuOpen(false); onDuplicate(); }}
                          className="w-full text-left px-3 py-2 text-[12px] text-zinc-200 hover:bg-white/5 flex items-center gap-2"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          Duplicar bloco
                        </button>
                        <div className="border-t border-white/5 my-1" />
                        <button
                          onClick={() => { setMoreMenuOpen(false); onRemove(); }}
                          className="w-full text-left px-3 py-2 text-[12px] text-red-300 hover:bg-red-500/10 flex items-center gap-2"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" /></svg>
                          Remover bloco
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </>
        );
      })()}
      <textarea
        value={b.text}
                    onChange={e => onUpdateText(e.target.value)}
        placeholder="Digite o texto desse bloco..."
        spellCheck={false}
        autoCorrect="off"
        className="w-full bg-transparent px-3 py-2.5 text-[13px] text-zinc-200 placeholder-zinc-600 outline-none resize-none leading-relaxed"
        rows={3}
      />


      <div className="px-3 py-2 border-t border-white/5 flex items-center justify-between text-[10px] text-zinc-500 font-mono">
        <span>{formatTime(b.start)} → {formatTime(b.end)}{b.dirty && <span className="ml-1.5 text-amber-400">· alterado</span>}</span>
        <span>
          {duration.toFixed(1)}s · {wordCount} palavras
          {/* Per-block HeyGen cost is a CREATION concept — meaningless when the
              speech comes from the user's own imported video. */}
          {!editMode && isAvatar && cost > 0 && <span className="text-amber-400/70 ml-2">${cost.toFixed(2)}</span>}
        </span>
      </div>
    </div>
  );
};
