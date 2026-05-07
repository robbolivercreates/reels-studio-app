import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { reducer, INITIAL_STATE } from './reelsStudio/reducer';
import { useHistoryReducer } from './reelsStudio/useHistoryReducer';
import { generateProjectAudio, estimateScriptDuration } from './reelsStudio/audioEngine';
import { saveAudioBlob, saveClipBlob } from './reelsStudio/persistence';
import { VOICE_OPTIONS, getVoice } from './reelsStudio/voices';
import type { ScriptBlock, ScreenTake } from './reelsStudio/types';
import {
  loadClonedVoices,
  deleteClonedVoice,
  touchClonedVoice,
  type ClonedVoice,
} from '../services/minimaxService';
import { SaveVoiceModal } from './reelsStudio/SaveVoiceModal';
import { ImportScriptModal } from './reelsStudio/ImportScriptModal';
import { VideoReferenceModal } from './reelsStudio/VideoReferenceModal';
import { ReferencesModal } from './reelsStudio/ReferencesModal';
import type { PersistedAnalysis } from './reelsStudio/types';
import { ProductionPlanModal } from './reelsStudio/ProductionPlanModal';
import { MotionPickerModal } from './reelsStudio/MotionPickerModal';
import { MotionLayerOverlay } from './reelsStudio/MotionLayerOverlay';
import { createMotionFromBlock, type MotionConfig } from './reelsStudio/motionLibrary';
import { generateMotionHtml, buildFullHtmlDoc } from '../services/motionService';
import { invoke } from '@tauri-apps/api/core';
import { GenerateAvatarsModal } from './reelsStudio/GenerateAvatarsModal';
import { ClipPreviewLightbox } from './reelsStudio/ClipPreviewLightbox';
import { useReelsPersistence } from './reelsStudio/useReelsPersistence';
import { ScreenRecordingFlow } from './reelsStudio/ScreenRecordingFlow';
import { TakesPanel } from './reelsStudio/TakesPanel';
import { AddBrollModal } from './reelsStudio/AddBrollModal';
import { TakeReviewModal } from './reelsStudio/TakeReviewModal';
import { TakeVideoPlayer } from './reelsStudio/TakeVideoPlayer';
import { ExportRenderModal } from './reelsStudio/ExportRenderModal';
import { SettingsModal } from './SettingsModal';
import { buildCapcutPackage, downloadPackage } from './reelsStudio/packageBuilder';
import { detectKeepSegments, PRESET_OPTIONS } from './reelsStudio/silenceDetector';
import { SilenceCutControl } from './reelsStudio/SilenceCutControl';
import { computeLayout, hitTest, projectToSourceTime } from './reelsStudio/timeline';
import { getLayoutSlots, LAYOUT_OPTIONS, defaultAvatarZoom } from './reelsStudio/layouts';
import type { SilencePreset, BlockLayout, BlockTransition } from './reelsStudio/types';
import { sliceAudioByBlocks } from './reelsStudio/audioSlicer';
import { generateAvatarClips } from './reelsStudio/avatarGenerator';
import { loadAvatarPhotos } from './reelsStudio/avatarPhotosStore';
import { generateMockClip } from './reelsStudio/mockClipGenerator';

const PRICE_PER_AVATAR_SECOND = 0.058;
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
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const [scriptOpen, setScriptOpen] = useState(true);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [vibeExpanded, setVibeExpanded] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saveVoiceModalOpen, setSaveVoiceModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [videoRefModalOpen, setVideoRefModalOpen] = useState(false);
  const [referencesModalOpen, setReferencesModalOpen] = useState(false);
  const [planAnalysis, setPlanAnalysis] = useState<PersistedAnalysis | null>(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [motionPickerBlockId, setMotionPickerBlockId] = useState<string | null>(null);
  const [motionBusyByBlock, setMotionBusyByBlock] = useState<Record<string, string>>({});
  const [avatarsModalOpen, setAvatarsModalOpen] = useState(false);
  const [generatingClips, setGeneratingClips] = useState(false);
  const [previewClipId, setPreviewClipId] = useState<string | null>(null);
  const [addBrollOpen, setAddBrollOpen] = useState(false);
  const [screenRecOpen, setScreenRecOpen] = useState(false);
  const [reviewTakeId, setReviewTakeId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [capcutExportStatus, setCapcutExportStatus] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      const pkg = await buildCapcutPackage(state, (p) => setCapcutExportStatus(p.message));
      downloadPackage(pkg);
      setCapcutExportStatus(`✓ Baixado · ${(pkg.size / 1024 / 1024).toFixed(1)}MB`);
      setTimeout(() => setCapcutExportStatus(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao exportar';
      console.error('[reels/capcut-export]', err);
      setCapcutExportStatus(`⚠ ${msg}`);
      setTimeout(() => setCapcutExportStatus(null), 6000);
    }
  };

  const handleNewTake = (take: ScreenTake) => {
    dispatch({ type: 'add-take', take });
    // Auto-open the review modal so the user can trim + cut silence right away.
    setReviewTakeId(take.id);
  };

  const { hydrated, savedAt, saving, clearProject } = useReelsPersistence({ state, dispatch });

  const activeTake = state.takes.find(t => t.id === state.activeTakeId) ?? null;

  // ─── Auto-detect silences when audio is ready or preset changes ────
  // Guard against multiple in-flight detections via a ref (state can lag).
  const detectingLockRef = useRef(false);

  useEffect(() => {
    console.log('[reels/silence] effect run · status=', state.audio.status,
      '· hasUrl=', !!state.audio.url,
      '· preset=', state.audio.silencePreset,
      '· keepCount=', state.audio.keepSegments.length,
      '· locked=', detectingLockRef.current);

    if (state.audio.status !== 'ready' || !state.audio.url) return;
    if (state.audio.keepSegments.length > 0) return; // already detected for this preset
    if (detectingLockRef.current) return;

    detectingLockRef.current = true;
    let cancelled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const audioUrl = state.audio.url;
    const preset = state.audio.silencePreset;

    (async () => {
      console.log('[reels/silence] STARTING detection · preset=', preset, '· duration=', state.audio.duration);
      dispatch({ type: 'audio-silence-detect-start' });
      watchdog = setTimeout(() => {
        if (cancelled) return;
        console.warn('[reels/silence] timeout 20s — finishing with empty result');
        detectingLockRef.current = false;
        dispatch({ type: 'audio-silence-detect-done', keepSegments: [], detectedSilenceSec: 0 });
      }, 20_000);
      try {
        console.log('[reels/silence] fetching audio blob...');
        const resp = await fetch(audioUrl);
        const blob = await resp.blob();
        console.log('[reels/silence] blob size =', (blob.size / 1024).toFixed(1), 'KB · type=', blob.type);
        if (cancelled) { detectingLockRef.current = false; return; }
        const opts = PRESET_OPTIONS[preset];
        console.log('[reels/silence] running detector with', opts);
        const result = await detectKeepSegments(blob, opts);
        if (cancelled) { detectingLockRef.current = false; return; }
        console.log('[reels/silence] result:', {
          keepCount: result.keep.length,
          silentSec: result.totalSilent.toFixed(2),
          duration: result.duration.toFixed(2),
        });
        if (watchdog) clearTimeout(watchdog);
        detectingLockRef.current = false;
        dispatch({ type: 'audio-silence-detect-done', keepSegments: result.keep, detectedSilenceSec: result.totalSilent });
      } catch (err) {
        console.error('[reels/silence] FAILED:', err);
        if (watchdog) clearTimeout(watchdog);
        detectingLockRef.current = false;
        if (!cancelled) dispatch({ type: 'audio-silence-detect-done', keepSegments: [], detectedSilenceSec: 0 });
      }
    })();
    return () => {
      cancelled = true;
      if (watchdog) clearTimeout(watchdog);
    };
  }, [state.audio.status, state.audio.url, state.audio.silencePreset, state.audio.keepSegments.length, state.audio.duration]);

  // Effective duration after silence cut.
  const audioEffectiveDuration = state.audio.silenceCut && state.audio.keepSegments.length > 0
    ? state.audio.keepSegments.reduce((s, k) => s + (k.end - k.start), 0)
    : state.audio.duration;

  // Map a source-time second to an "effective" (silence-cut applied) second.
  // When silence cut is off OR no segments detected, this is identity.
  const cutOn = state.audio.silenceCut && state.audio.keepSegments.length > 0;
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

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  // Restore audioBlobRef from IndexedDB after hydration so export works without regenerating audio.
  useEffect(() => {
    if (!hydrated || audioBlobRef.current) return;
    import('./reelsStudio/persistence').then(({ loadAudioBlob }) => {
      loadAudioBlob().then(blob => { if (blob) audioBlobRef.current = blob; }).catch(() => {});
    });
  }, [hydrated]);
  const rafRef = useRef<number | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
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
      const result = await generateProjectAudio(blocks, selectedVoiceId, {
        language: 'Portuguese',
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
    } catch (err) {
      dispatch({ type: 'audio-error', error: err instanceof Error ? err.message : 'Falha ao gerar áudio' });
    }
  }, [blocks, selectedVoiceId, emotion, voiceSpeed, isClonedVoice, refreshClonedVoices]);

  const avatarBlocks = useMemo(() => blocks.filter(b => b.kind === 'avatar' && b.end > b.start), [blocks]);

  // ─── Motion auto-pipeline ──────────────────────────────────────────────
  // Apple-style one-shot: click "Motion" on a block → Gemini decides everything,
  // generates HTML, HyperFrames renders MP4, the result lands on the timeline.
  // No modal involved. The user can later open the modal to fine-tune.
  const handleAutoMotion = useCallback(async (blockId: string) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;
    if (motionBusyByBlock[blockId]) return; // already running
    const setBusy = (msg: string | null) => setMotionBusyByBlock(prev => {
      const next = { ...prev };
      if (msg === null) delete next[blockId]; else next[blockId] = msg;
      return next;
    });
    const seed = createMotionFromBlock(block);
    const blockIndex = blocks.indexOf(block);
    try {
      setBusy('Pensando…');
      dispatch({ type: 'set-block-motion', id: blockId, motion: { ...seed, status: 'generating' } });

      // Load project assets (screenshots) if available
      let projectAssets: Array<{ name: string; path: string }> = [];
      try {
        const raw = await invoke<Array<{ name: string; path: string; ext: string; size_bytes: number }>>(
          'list_project_assets', { projectName: state.projectName }
        );
        projectAssets = raw;
      } catch { /* no assets folder yet — proceed without */ }

      const result = await generateMotionHtml({
        presetId: seed.presetId,
        blockText: block.text,
        durationSec: seed.durationSec,
        compositionId: seed.id,
        motionLayer: seed.layer,
        projectAssets,
        reelContext: {
          projectName: state.projectName,
          allBlocks: blocks.map(b => b.text),
          blockIndex,
          prevBlockText: blockIndex > 0 ? blocks[blockIndex - 1].text : undefined,
          nextBlockText: blockIndex < blocks.length - 1 ? blocks[blockIndex + 1].text : undefined,
        },
      });
      // Post-process: replace repeat:-1 with a finite count derived from the duration.
      // HyperFrames is a deterministic renderer — infinite GSAP loops break it.
      const sanitizedHtml = result.htmlBody.replace(
        /repeat\s*:\s*-1/g,
        () => `repeat: Math.floor(${seed.durationSec} / 0.8) - 1`
      );
      const generated: MotionConfig = {
        ...seed,
        intent: result.intent || seed.intent,
        text: result.text || seed.text,
        html: sanitizedHtml,
        status: 'rendering',
        generatedAt: Date.now(),
      };
      dispatch({ type: 'set-block-motion', id: blockId, motion: generated });

      setBusy('Renderizando…');
      const fullHtml = buildFullHtmlDoc(generated);
      await invoke('save_motion_html', { motionId: generated.id, html: fullHtml });
      const rendered = await invoke<{ mp4_path: string; size_bytes: number }>(
        'render_motion', { motionId: generated.id },
      );
      dispatch({
        type: 'set-block-motion',
        id: blockId,
        motion: {
          ...generated,
          videoPath: rendered.mp4_path,
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
  }, [blocks, dispatch, motionBusyByBlock]);

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
      const fullHtml = buildFullHtmlDoc(sanitizedMotion);
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

  const handleGenerateClips = useCallback(async (photoId: string, model: 'avatar3' | 'avatar4') => {
    if (!audio.url || avatarBlocks.length === 0) return;
    const photos = loadAvatarPhotos();
    const photo = photos.find(p => p.id === photoId);
    if (!photo) {
      alert('Foto não encontrada. Selecione novamente.');
      return;
    }
    dispatch({ type: 'set-photo', photoId });
    dispatch({ type: 'set-avatar-model', model });
    setAvatarsModalOpen(false);
    setGeneratingClips(true);

    try {
      // Re-fetch the audio Blob from its object URL.
      const audioResp = await fetch(audio.url);
      const audioBlob = await audioResp.blob();

      // For each avatar block, send only the visible portion to HeyGen.
      // This saves money: a 8s block configured for 3s of avatar visibility renders only 3s.
      const ranges = avatarBlocks.map(b => {
        const blockLen = b.end - b.start;
        const visible = Math.min(b.avatarVisibleSec ?? blockLen, blockLen);
        return { blockId: b.id, start: b.start, end: b.start + visible };
      });
      const slices = await sliceAudioByBlocks(audioBlob, ranges);

      await generateAvatarClips(slices, {
        talkingPhotoId: photo.talkingPhotoId,
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
    } catch (err) {
      console.error('[reels] generateAvatarClips failed:', err);
    } finally {
      setGeneratingClips(false);
    }
  }, [audio.url, avatarBlocks, state.aspect]);

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

  // ─── Audio playback sync ──────────────────────────────────────────────
  useEffect(() => {
    if (!audio.url) return;
    const el = new Audio(audio.url);
    el.preload = 'auto';
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
  useEffect(() => {
    silenceCutRef.current = state.audio.silenceCut;
    keepSegmentsRef.current = state.audio.keepSegments;
    layoutRef.current = layout;
    totalDurationRef.current = totalDuration;
  }, [state.audio.silenceCut, state.audio.keepSegments, layout, totalDuration]);

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

    if (hasAudio && el) {
      // ─── AUDIO MODE: audio is the clock, playhead reads from el.currentTime ───
      if (el.currentTime >= totalDurationRef.current - 0.05) {
        try { el.currentTime = 0; } catch { /* ignore */ }
        setPlayhead(0);
      }
      el.play().catch(() => setPlaying(false));

      const tick = () => {
        const a = audioElRef.current;
        if (!a) return;
        if (a.ended) {
          setPlaying(false);
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
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      };
    }

    // ─── NO-AUDIO MODE: walltime is the clock, playhead advances by elapsed seconds ───
    let startWall = performance.now();
    let startPlayhead = playhead;
    if (startPlayhead >= totalDurationRef.current - 0.05) {
      // Rewind to 0 so play from the end starts over.
      startPlayhead = 0;
      setPlayhead(0);
    }

    const tickNoAudio = () => {
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
    return () => {
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
    const slot = slotById.get(blockId);
    if (slot) seekTo(slot.projectStart);
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
    setSelectedBlockId(null);
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
  const aspectClass = aspect === '9:16' ? 'aspect-[9/16] h-full' : aspect === '16:9' ? 'aspect-video w-full max-w-3xl' : 'aspect-square h-full';

  const layoutHit = hitTest(layout, playhead);
  const currentBlock = layoutHit.kind === 'block'
    ? blocks.find(b => b.id === layoutHit.slot.blockId) ?? null
    : null;
  const currentClip = currentBlock ? state.avatarClips[currentBlock.id] : undefined;
  // Avatar is visible only while we're inside the block AND within the configured visibility window.
  const avatarVisibilityCutoff = currentBlock && currentBlock.kind === 'avatar' && currentBlock.avatarVisibleSec !== undefined
    ? (slotById.get(currentBlock.id)?.projectStart ?? 0) + currentBlock.avatarVisibleSec
    : Infinity;
  const avatarStillVisible = playhead < avatarVisibilityCutoff;
  // Resolve layout boxes for the current block. B-roll blocks always use 'media-only'.
  const currentLayout: BlockLayout = currentBlock?.kind === 'avatar' ? (currentBlock.layout ?? 'avatar-only') : 'media-only';
  const layoutSlots = getLayoutSlots(currentLayout);
  const avatarBoxStyle = layoutSlots.avatar
    ? { left: `${layoutSlots.avatar.x * 100}%`, top: `${layoutSlots.avatar.y * 100}%`, width: `${layoutSlots.avatar.w * 100}%`, height: `${layoutSlots.avatar.h * 100}%` }
    : null;
  const mediaBoxStyle = layoutSlots.media
    ? { left: `${layoutSlots.media.x * 100}%`, top: `${layoutSlots.media.y * 100}%`, width: `${layoutSlots.media.w * 100}%`, height: `${layoutSlots.media.h * 100}%` }
    : null;
  const showAvatarVideo = currentBlock?.kind === 'avatar' && currentClip?.status === 'ready' && !!currentClip?.videoUrl && avatarStillVisible && layoutSlots.avatar !== null;
  const [previewVideoError, setPreviewVideoError] = useState<string | null>(null);

  // Reset preview error when clip changes.
  useEffect(() => {
    setPreviewVideoError(null);
  }, [currentClip?.videoUrl]);

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
  useEffect(() => {
    const v = previewVideoRef.current;
    if (!v || !currentBlock || currentBlock.kind !== 'avatar') return;
    if (!currentClip || currentClip.status !== 'ready') return;
    const slot = slotById.get(currentBlock.id);
    if (!slot) return;
    // Local time within the avatar block.
    const target = Math.max(0, playhead - slot.projectStart);
    // Only seek when significantly off — avoids the popping caused by frequent seeks.
    if (Math.abs(v.currentTime - target) > 0.4) {
      try { v.currentTime = target; } catch { /* ignore */ }
    }
    if (playing && v.paused) v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  }, [playhead, playing, currentBlock, currentClip, slotById]);

  const statusPill = (() => {
    if (audio.status === 'generating') return { dot: 'bg-violet-400 animate-pulse', cls: 'bg-violet-500/10 text-violet-300 border-violet-500/20', text: 'Gerando áudio...' };
    if (audio.status === 'ready') {
      const cutSuffix = state.audio.silenceCut && state.audio.detectedSilenceSec >= 0.1
        ? ` · ✂ ${formatTime(audioEffectiveDuration)}`
        : '';
      return { dot: 'bg-emerald-400 animate-pulse', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', text: `Áudio pronto · ${formatTime(audio.duration)}${cutSuffix} · ${selectedVoiceLabel.label}` };
    }
    if (audio.status === 'error')      return { dot: 'bg-red-400', cls: 'bg-red-500/10 text-red-400 border-red-500/20', text: audio.error ?? 'Erro' };
    return { dot: 'bg-zinc-500', cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20', text: 'Sem áudio · gere pra começar' };
  })();

  return (
    <div className="flex flex-col h-full bg-[#0A0A0B] text-zinc-50" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif' }}>
      {/* ─── TOP BAR ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 h-14 border-b border-white/5 bg-[#141416]/60 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-[0_0_20px_rgba(124,58,237,0.4)]">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.867V15.133a1 1 0 01-1.447.902L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <input
            value={projectName}
            onChange={e => dispatch({ type: 'set-name', name: e.target.value })}
            className="bg-transparent text-sm font-semibold text-zinc-100 outline-none focus:bg-white/5 px-2 py-1 rounded-md transition-colors w-48"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${statusPill.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusPill.dot}`}></span>
            {statusPill.text}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setAspectMenuOpen(o => !o)} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-zinc-300 flex items-center gap-1.5 transition-colors">
              {aspect}
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {aspectMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-[#1C1C1F] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[100px] z-50">
                {(['9:16','16:9','1:1'] as const).map(a => (
                  <button key={a} onClick={() => { dispatch({ type: 'set-aspect', aspect: a }); setAspectMenuOpen(false); }} className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 ${aspect === a ? 'text-violet-400' : 'text-zinc-300'}`}>{a}</button>
                ))}
              </div>
            )}
          </div>

          {capcutExportStatus && (
            <span className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-medium text-emerald-200 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              {capcutExportStatus}
            </span>
          )}

          <span
            className="px-3 py-1.5 rounded-lg bg-white/5 text-xs font-medium text-zinc-400 flex items-center gap-1.5"
            title={savedAt ? new Date(savedAt).toLocaleString() : 'Ainda não salvo'}
          >
            {saving ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"></span>
                Salvando...
              </>
            ) : savedAt ? (
              <>
                <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Salvo · {formatRelativeTime(savedAt)}
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600"></span>
                Não salvo
              </>
            )}
          </span>
          <button
            onClick={() => setReferencesModalOpen(true)}
            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-violet-500/20 hover:text-violet-300 text-xs font-medium text-zinc-400 transition-colors flex items-center gap-1.5"
            title="Referências analisadas"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
            {state.analyses.length > 0 && (
              <span className="text-[9px] font-mono text-zinc-500">{state.analyses.length}</span>
            )}
          </button>
          <button
            onClick={() => setConfirmClearOpen(true)}
            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 hover:text-red-300 text-xs font-medium text-zinc-400 transition-colors"
            title="Limpar projeto e começar do zero"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
            </svg>
          </button>

          <div className="relative">
            <button onClick={() => setExportMenuOpen(o => !o)} className="px-4 py-1.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white flex items-center gap-1.5 shadow-[0_0_20px_rgba(124,58,237,0.5)] transition-all">
              Exportar
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {exportMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-[#1C1C1F] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[260px] z-50">
                <button
                  onClick={() => { setExportMenuOpen(false); setExportOpen(true); }}
                  className="w-full text-left px-3 py-2 hover:bg-violet-500/10 transition-colors flex items-center gap-2"
                >
                  <span className="w-7 h-7 rounded-md bg-violet-500/20 flex items-center justify-center text-violet-300">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  </span>
                  <div className="flex-1">
                    <div className="text-xs text-zinc-100 font-semibold">MP4 Final · renderizar agora</div>
                    <div className="text-[10px] text-zinc-500">WebCodecs · pronto pra postar</div>
                  </div>
                </button>
                <button disabled className="w-full text-left px-3 py-2 opacity-40 cursor-not-allowed flex items-center gap-2">
                  <span className="w-7 h-7 rounded-md bg-white/5 flex items-center justify-center text-zinc-500">📦</span>
                  <div className="flex-1">
                    <div className="text-xs text-zinc-300 font-medium">Pacote de assets (.zip)</div>
                    <div className="text-[10px] text-zinc-500">Em breve</div>
                  </div>
                </button>
                <button
                  onClick={handleCapcutExport}
                  disabled={audio.status !== 'ready'}
                  className="w-full text-left px-3 py-2 hover:bg-emerald-500/10 transition-colors flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="w-7 h-7 rounded-md bg-emerald-500/20 flex items-center justify-center text-emerald-300">🎞️</span>
                  <div className="flex-1">
                    <div className="text-xs text-zinc-100 font-semibold">Para CapCut (.fcpxml)</div>
                    <div className="text-[10px] text-zinc-500">Zip com timeline + mídias</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg bg-white/5 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Configurações · chaves de API"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button onClick={() => setScriptOpen(o => !o)} className={`p-2 rounded-lg transition-colors ${scriptOpen ? 'bg-violet-500/20 text-violet-300' : 'bg-white/5 text-zinc-400 hover:text-zinc-200'}`} title="Toggle Script Editor">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" /></svg>
          </button>
        </div>
      </div>

      {/* ─── PREVIEW + SCRIPT ───────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-[#0A0A0B] to-[#0F0F12] overflow-hidden">
          <div className={`relative ${aspectClass} bg-black rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] overflow-hidden border border-white/5`}>
            {/* Black background — fills the whole canvas (any unfilled layout area stays black). */}
            <div className="absolute inset-0 bg-black z-0" />

            {/* Media layer (B-roll) — draws below the avatar layer. Renders if layout has media slot AND a take is available. */}
            {mediaBoxStyle && activeTake && (
              <div className="absolute z-10 overflow-hidden bg-black" style={mediaBoxStyle as React.CSSProperties}>
                <TakeVideoPlayer key={`media-${currentBlock?.id}-${activeTake.id}`} take={activeTake} />
              </div>
            )}

            {showAvatarVideo && currentClip?.videoUrl && !previewVideoError && avatarBoxStyle ? (
              <>
                <video
                  ref={previewVideoRef}
                  key={`${currentBlock?.id}-${currentClip.videoUrl}`}
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
                    zIndex: 20,
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
                  className="px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-400 text-xs font-semibold text-white transition-colors flex items-center gap-2"
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
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-amber-500/20 via-zinc-900 to-zinc-950">
                <div className="text-center px-6">
                  <div className="w-32 h-32 rounded-full bg-gradient-to-br from-amber-300 to-amber-600 mx-auto mb-4 flex items-center justify-center shadow-2xl">
                    <svg className="w-16 h-16 text-white/90" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                  </div>
                  <div className="text-xs uppercase tracking-widest text-amber-300/70">Avatar Clip</div>
                  <div className="text-sm text-zinc-300 mt-1 max-w-[80%] mx-auto">{currentBlock.text.slice(0, 80)}{currentBlock.text.length > 80 ? '…' : ''}</div>
                  {state.avatarClips[currentBlock.id] && state.avatarClips[currentBlock.id].status !== 'ready' && (
                    <div className="mt-3 text-[11px] text-violet-300">⏳ {state.avatarClips[currentBlock.id].message ?? state.avatarClips[currentBlock.id].status}</div>
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

            {/* Motion overlay — split-bottom/split-top show in their half; replace
                fills the whole frame. Overlay (screen blend over avatar) is excluded
                here to keep the avatar preview clean. */}
            {currentBlock?.motion && (() => {
              const motion = currentBlock.motion;
              if (motion.layer === 'overlay') return null;
              const blockSlot = slotById.get(currentBlock.id);
              const blockStart = blockSlot?.projectStart ?? currentBlock.start;
              const elapsedInBlock = Math.max(0, playhead - blockStart);
              const motionDur = motion.durationSec ?? 3;
              if (elapsedInBlock > motionDur) return null;
              return (
                <MotionLayerOverlay
                  key={`motion-${motion.id}-${motion.renderedAt ?? 0}`}
                  motion={motion}
                  playing={playing}
                  layer={motion.layer}
                />
              );
            })()}

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
                : 'bg-fuchsia-500/30 border-fuchsia-400/40 text-fuchsia-100';
              const label = isError ? '🎨 Motion · erro'
                : isReady ? '🎨 Motion · pronto'
                : isGenerating ? '🎨 Motion · gerando IA…'
                : isRendering ? `🎨 Motion · ${busy ?? 'renderizando…'}`
                : '🎨 Motion ativo';
              return (
                <div className={`absolute bottom-3 left-3 px-2 py-0.5 rounded-md backdrop-blur text-[10px] font-medium border ${tone} ${(isGenerating || isRendering) ? 'animate-pulse' : ''}`}>
                  {label}
                </div>
              );
            })()}
          </div>

          <div className="flex items-center gap-3 mt-4">
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
                  className="ml-2 px-3 py-2 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/40 text-[11px] font-semibold text-violet-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
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
          <div className="w-[420px] border-l border-white/5 bg-[#0E0E10] flex flex-col shrink-0">
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-zinc-100">Script</div>
                <div className="text-[11px] text-zinc-500">{blocks.length} blocos · {formatTime(totalDuration)}</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => dispatch({ type: 'add-block' })}
                  className="text-[11px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors"
                  title="Adicionar bloco vazio"
                >
                  + Bloco
                </button>
                <div className="relative">
                  <button
                    onClick={() => setMoreMenuOpen(o => !o)}
                    className="text-[11px] w-7 h-7 inline-flex items-center justify-center rounded-md bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors"
                    title="Mais ações"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
                  </button>
                  {moreMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMoreMenuOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-lg bg-[#1C1C1F] border border-white/10 shadow-2xl py-1">
                        <button
                          onClick={() => { setImportModalOpen(true); setMoreMenuOpen(false); }}
                          className="w-full text-left px-3 py-2 text-[11px] text-zinc-200 hover:bg-white/5 flex items-center gap-2"
                        >
                          <span className="text-violet-300">📋</span>
                          <span className="flex-1">Importar roteiro com IA</span>
                        </button>
                        <button
                          onClick={() => { setVideoRefModalOpen(true); setMoreMenuOpen(false); }}
                          className="w-full text-left px-3 py-2 text-[11px] text-zinc-200 hover:bg-white/5 flex items-center gap-2"
                        >
                          <span className="text-emerald-300">🎬</span>
                          <span className="flex-1">Importar de vídeo (IG/TikTok/MP4)</span>
                        </button>
                        <button
                          onClick={() => { setReferencesModalOpen(true); setMoreMenuOpen(false); }}
                          className="w-full text-left px-3 py-2 text-[11px] text-zinc-200 hover:bg-white/5 flex items-center gap-2 border-t border-white/5"
                        >
                          <span className="text-violet-300">📁</span>
                          <span className="flex-1">Referências analisadas</span>
                          {state.analyses.length > 0 && (
                            <span className="text-[9px] font-mono text-zinc-500">{state.analyses.length}</span>
                          )}
                        </button>
                        {state.lastAnalysis && (
                          <button
                            onClick={() => { setPlanModalOpen(true); setMoreMenuOpen(false); }}
                            className="w-full text-left px-3 py-2 text-[11px] text-zinc-200 hover:bg-white/5 flex items-center gap-2 border-t border-white/5"
                          >
                            <span className="text-amber-300">📋</span>
                            <span className="flex-1">Ver plano de gravação</span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Voice picker */}
            <div className="px-5 py-3 border-b border-white/5">
              <button onClick={() => setVoicePickerOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] hover:bg-white/5 border border-white/10 transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${selectedVoiceLabel.isCustom ? 'bg-gradient-to-br from-violet-400 to-violet-600 ring-2 ring-violet-300/40' : 'bg-gradient-to-br from-zinc-500 to-zinc-700'}`}>
                    {selectedVoiceLabel.label.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="text-left">
                    <div className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
                      {selectedVoiceLabel.label}
                      {selectedVoiceLabel.isCustom && <span className="text-[8px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 uppercase tracking-wider">Sua</span>}
                    </div>
                    <div className="text-[10px] text-zinc-500">{selectedVoiceLabel.hint}</div>
                  </div>
                </div>
                <svg className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${voicePickerOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </button>
              {voicePickerOpen && (
                <div className="mt-2 max-h-[340px] overflow-y-auto rounded-lg bg-[#0A0A0B] border border-white/10">
                  {/* MINHAS VOZES */}
                  <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-wider text-violet-300/60 font-semibold">Minhas vozes</div>
                  {clonedVoices.length === 0 ? (
                    <div className="px-3 pb-2 text-[10px] text-zinc-600 italic">Nenhuma voz salva ainda.</div>
                  ) : (
                    clonedVoices.map(v => {
                      const daysLeft = Math.max(0, Math.floor((v.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
                      const isSelected = selectedVoiceId === v.voiceId;
                      return (
                        <div key={v.id} className={`group flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 transition-colors ${isSelected ? 'bg-violet-500/10' : ''}`}>
                          <button onClick={() => { dispatch({ type: 'set-voice', voiceId: v.voiceId }); setVoicePickerOpen(false); }} className="flex items-center gap-2.5 flex-1 text-left">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center text-[9px] font-bold text-white ring-2 ring-violet-300/30">
                              {v.name.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-medium text-zinc-200 truncate">{v.name}</div>
                              <div className="text-[9px] text-zinc-500 truncate">
                                {daysLeft > 1 ? `Expira em ${daysLeft} dias` : daysLeft === 1 ? 'Expira amanhã' : 'Expira hoje'} · {v.model}
                              </div>
                            </div>
                            {isSelected && <svg className="w-3.5 h-3.5 text-violet-400 shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); if (confirm(`Remover a voz "${v.name}"?`)) { deleteClonedVoice(v.id); refreshClonedVoices(); } }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 transition-all"
                            title="Remover"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      );
                    })
                  )}

                  {/* Action: salvar voice_id */}
                  <button
                    onClick={() => { setSaveVoiceModalOpen(true); setVoicePickerOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-violet-500/10 transition-colors text-left border-y border-white/5 mt-1"
                  >
                    <div className="w-6 h-6 rounded-full bg-violet-500/20 border border-dashed border-violet-400/40 flex items-center justify-center text-violet-300">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                    </div>
                    <div className="flex-1">
                      <div className="text-[11px] font-medium text-violet-200">Salvar voice_id do Minimax</div>
                      <div className="text-[9px] text-zinc-500">Cole o ID que você já tem</div>
                    </div>
                  </button>

                  {/* VOZES PADRÃO */}
                  <div className="px-3 pt-3 pb-1 text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">Vozes padrão</div>
                  {VOICE_OPTIONS.map(v => (
                    <button key={v.id} onClick={() => { dispatch({ type: 'set-voice', voiceId: v.id }); setVoicePickerOpen(false); }} className={`w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/5 transition-colors text-left ${v.id === selectedVoiceId ? 'bg-violet-500/10' : ''}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${v.gender === 'female' ? 'bg-gradient-to-br from-pink-400 to-rose-600' : 'bg-gradient-to-br from-cyan-400 to-blue-600'}`}>
                        {v.label.slice(0, 1)}
                      </div>
                      <div className="flex-1">
                        <div className="text-[11px] font-medium text-zinc-200">{v.label}</div>
                        <div className="text-[9px] text-zinc-500">{v.hint}</div>
                      </div>
                      {v.id === selectedVoiceId && <svg className="w-3.5 h-3.5 text-violet-400" fill="currentColor" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Emotion + speed — collapsible once audio exists */}
            {(() => {
              const VIBE_OPTS = [
                { id: 'neutral',   emoji: '😐', label: 'Neutro' },
                { id: 'happy',     emoji: '😊', label: 'Animado' },
                { id: 'sad',       emoji: '😢', label: 'Triste' },
                { id: 'angry',     emoji: '😠', label: 'Bravo' },
                { id: 'surprised', emoji: '😲', label: 'Surpreso' },
                { id: 'fearful',   emoji: '😰', label: 'Ansioso' },
              ] as const;
              const currentVibe = VIBE_OPTS.find(v => v.id === emotion) ?? VIBE_OPTS[0];
              const ready = audio.status === 'ready';
              const isOpen = !ready || vibeExpanded;
              return (
                <div className="px-5 py-3 border-b border-white/5">
                  {ready ? (
                    <button
                      onClick={() => setVibeExpanded(o => !o)}
                      className="w-full flex items-center justify-between text-left group"
                      title="Como o áudio foi gerado"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Vibe</span>
                        <span className="text-[11px] text-zinc-300 flex items-center gap-1">
                          <span>{currentVibe.emoji}</span>
                          <span>{currentVibe.label}</span>
                          <span className="text-zinc-500">·</span>
                          <span className="font-mono">{voiceSpeed.toFixed(2)}x</span>
                        </span>
                      </div>
                      <svg className={`w-3 h-3 text-zinc-500 group-hover:text-zinc-300 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  ) : (
                    <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-2">Vibe</div>
                  )}

                  {isOpen && (
                    <div className={ready ? 'mt-3' : ''}>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {VIBE_OPTS.map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => dispatch({ type: 'set-emotion', emotion: opt.id })}
                            className={`px-2.5 py-1 rounded-full text-[10.5px] font-medium border transition-colors flex items-center gap-1 ${
                              emotion === opt.id
                                ? 'bg-violet-500/20 border-violet-400/50 text-violet-100'
                                : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-zinc-200 hover:border-white/20'
                            }`}
                            title={`Aplica ${opt.label.toLowerCase()} ao próximo áudio gerado`}
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
                          className="flex-1 accent-violet-400"
                        />
                        <span className="text-[11px] text-zinc-300 font-mono tabular-nums w-10 text-right">{voiceSpeed.toFixed(2)}x</span>
                      </div>
                      {ready && (
                        <button
                          onClick={() => setConfirmOpen(true)}
                          className="mt-3 w-full py-2 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-[11px] font-semibold text-white shadow-[0_0_15px_rgba(124,58,237,0.35)] transition-all flex items-center justify-center gap-1.5"
                          title="Refaz o áudio com a emoção e ritmo escolhidos"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Recriar áudio com nova vibe
                        </button>
                      )}
                      {audio.status === 'generating' && (
                        <div className="mt-3 text-[10px] text-violet-300 flex items-center gap-1.5 justify-center">
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

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
              {(() => {
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
                  defaultZoom: defaultAvatarZoom(state.aspect, b.layout),
                  isCurrent: currentBlock?.id === b.id,
                  isSelected: selectedBlockId === b.id,
                  compact: isCompact,
                  onSelect: () => selectAndSeekBlock(b.id),
                  onJumpTo: () => selectAndSeekBlock(b.id),
                  onOpenMotion: () => {
                    // Smart click: if no motion yet, auto-generate. If motion exists, open advanced editor.
                    if (b.motion && b.motion.html) {
                      setMotionPickerBlockId(b.id);
                    } else {
                      void handleAutoMotion(b.id);
                    }
                  },
                  onOpenMotionAdvanced: () => setMotionPickerBlockId(b.id),
                  motionBusyMessage: motionBusyByBlock[b.id] ?? null,
                });

                const selectedIdx = selectedBlockId ? blocks.findIndex(b => b.id === selectedBlockId) : -1;

                // No selection → show all blocks expanded (legacy behavior).
                if (selectedIdx < 0) {
                  return blocks.map((b, idx) => <ScriptBlockCard key={b.id} {...cardProps(b, idx)} />);
                }

                // Selection → expanded card pinned at top, others compact below as a navigator.
                const selected = blocks[selectedIdx];
                return (
                  <>
                    <ScriptBlockCard key={selected.id} {...cardProps(selected, selectedIdx)} />
                    {blocks.length > 1 && (
                      <div className="pt-3 mt-1 border-t border-white/5 space-y-1.5">
                        <div className="text-[9px] uppercase tracking-[0.18em] text-zinc-500 px-1 mb-1.5 flex items-center justify-between">
                          <span>Outros blocos</span>
                          <button
                            onClick={() => setSelectedBlockId(null)}
                            className="text-[9px] text-zinc-500 hover:text-zinc-300 normal-case tracking-normal"
                            title="Fechar inspetor (Esc)"
                          >
                            mostrar todos
                          </button>
                        </div>
                        {blocks.map((b, idx) => idx === selectedIdx ? null : <ScriptBlockCard key={b.id} {...cardProps(b, idx, true)} />)}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="px-5 py-4 border-t border-white/5 bg-[#0A0A0B]/50">
              {audio.status === 'ready' && (
                <div className="mb-3">
                  <SilenceCutControl
                    enabled={state.audio.silenceCut}
                    preset={state.audio.silencePreset}
                    detecting={state.audio.detectingSilence}
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
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={audio.status === 'generating'}
                className="w-full py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title={`Custo estimado · $${estimatedTotalCost.toFixed(2)}`}
              >
                {audio.status === 'generating' ? '⏳ Gerando áudio...' : audio.status === 'ready' ? `🔄 Regenerar áudio${hasDirtyBlocks ? ` · $${estimatedAudioCost.toFixed(2)}` : ''}` : '🎙️ Gerar áudio'}
              </button>
              {audio.status === 'error' && <div className="mt-2 text-[10px] text-red-400">{audio.error}</div>}
            </div>
          </div>
        )}
      </div>

      {/* ─── TIMELINE ─────────────────────────────────────────────────── */}
      <div className="h-[300px] border-t border-white/5 bg-[#0C0C0E] flex flex-col shrink-0">
        <div className="flex items-center justify-between px-5 py-2 border-b border-white/5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddBrollOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-violet-500/20 hover:border-violet-400/40 hover:text-violet-200 text-zinc-300 border border-white/10 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Adicionar B-roll
            </button>
            <TakesPanel
              takes={state.takes}
              activeTakeId={state.activeTakeId}
              onSelectTake={(id) => dispatch({ type: 'set-active-take', id })}
              onRemoveTake={(id) => dispatch({ type: 'remove-take', id })}
              onRenameTake={(id, name) => dispatch({ type: 'rename-take', id, name })}
              onEditTake={(id) => setReviewTakeId(id)}
              onRecordNew={() => setAddBrollOpen(true)}
            />
            <button
              onClick={() => setConfirmOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 transition-colors"
              title="Gerar áudio do roteiro"
            >
              🎙️ Gerar Áudio
            </button>
            <button
              onClick={() => setAvatarsModalOpen(true)}
              disabled={audio.status !== 'ready' || avatarBlocks.length === 0 || generatingClips}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-zinc-300 border border-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={audio.status !== 'ready' ? 'Gere o áudio primeiro' : avatarBlocks.length === 0 ? 'Marque ao menos 1 bloco como Avatar' : 'Gerar clipes de avatar via HeyGen'}
            >
              {generatingClips ? '⏳ Gerando clipes...' : `✨ Gerar Clipes (${avatarBlocks.length})`}
            </button>
            {avatarBlocks.length > 0 && (
              <button
                onClick={handleGenerateMockClips}
                disabled={generatingClips}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-zinc-400 border border-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Gera clips coloridos sintéticos para testar o export sem gastar créditos HeyGen"
              >
                🎨 Clip de Teste
              </button>
            )}
            {(() => {
              const allMotions = blocks.filter(b => !!b.motion);
              if (allMotions.length === 0) return null;
              const pendingCount = allMotions.filter(b => {
                const m = b.motion!;
                if (!m.html) return true;
                if (!m.videoPath) return true;
                if (m.generatedAt && m.renderedAt && m.generatedAt > m.renderedAt) return true;
                return false;
              }).length;
              const busyCount = Object.keys(motionBusyByBlock).length;
              const isBusy = busyCount > 0;
              const label = isBusy
                ? `⏳ Renderizando… (${busyCount})`
                : pendingCount > 0
                  ? `🎨 Renderizar Motions (${pendingCount})`
                  : `🎨 Motions prontos (${allMotions.length})`;
              return (
                <button
                  onClick={() => { if (!isBusy && pendingCount > 0) void handleRenderAllMotions(); }}
                  disabled={isBusy || pendingCount === 0}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-fuchsia-500/15 hover:bg-fuchsia-500/25 text-fuchsia-200 border border-fuchsia-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={isBusy ? 'Renderizando em andamento…' : pendingCount > 0 ? `Renderizar ${pendingCount} motion(s) pendente(s)` : 'Todos os motions estão renderizados'}
                >
                  {label}
                </button>
              );
            })()}
            <button
              onClick={() => invoke('reveal_assets_dir', { projectName: state.projectName })}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 border border-white/10 transition-colors"
              title="Abrir pasta de assets do projeto — coloque screenshots aqui para usar nos motions"
            >
              🖼️ Assets
            </button>
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

          <div className="flex items-center gap-3 text-[11px] text-zinc-500">
            <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="p-1 hover:text-zinc-200 transition-colors">−</button>
            <div className="flex gap-0.5">{[1,2,3,4,5].map(i => <div key={i} className={`w-1 h-3 rounded-sm ${i <= zoom * 2 ? 'bg-violet-400' : 'bg-white/10'}`}></div>)}</div>
            <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="p-1 hover:text-zinc-200 transition-colors">+</button>
          </div>
        </div>

        {/* Time ruler */}
        <div className="relative h-6 border-b border-white/5 px-2">
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
          <div className={`relative h-12 mb-1.5 rounded-md bg-cyan-500/[0.04] border border-cyan-500/20 overflow-hidden ${audio.status === 'generating' ? 'animate-pulse' : ''}`}>
            <div className="absolute left-2 top-1.5 text-[9px] uppercase tracking-wider text-cyan-300/60 font-semibold pointer-events-none z-10">Audio</div>
            <div className="absolute inset-0 flex items-center px-2 pl-12">
              {audio.peaks.length > 0 ? (
                cutOn ? (
                  <div className="flex items-center gap-px h-full w-full">
                    {audio.peaks.map((p, i) => {
                      const peakSec = (i / audio.peaks.length) * audio.duration;
                      const inKeep = cutSegments.some(k => peakSec >= k.start && peakSec < k.end);
                      if (!inKeep) return null;
                      return (
                        <div key={i} className="flex-1 bg-gradient-to-t from-cyan-500/40 to-cyan-300/80 rounded-sm" style={{ height: `${Math.max(8, p * 90)}%` }}></div>
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
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-violet-400/15 to-transparent" style={{ animation: 'shimmer 1.6s linear infinite' }}></div>
            )}
            {/* Silence cut indicators.
                - Cut OFF: vermelho hash sobre as regiões silenciosas (preview do que seria cortado)
                - Cut ON: linha vertical fina onde os silêncios foram colados (junções) */}
            {state.audio.keepSegments.length > 0 && state.audio.duration > 0 && (() => {
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
          <div className="relative h-14 mb-1.5 rounded-md bg-white/[0.02] border border-white/10 overflow-hidden">
            <div className="absolute left-2 top-1.5 text-[9px] uppercase tracking-wider text-zinc-400/70 font-semibold pointer-events-none z-10 flex items-center gap-1.5">
              Conteúdo
              {activeTake && (
                <>
                  <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-200 normal-case font-normal">{activeTake.name}</span>
                  {activeTake.cutSilence && activeTake.detectedSilenceSec > 0.1 && (
                    <span className="text-[8px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-200 normal-case font-normal" title={`${activeTake.detectedSilenceSec.toFixed(1)}s de silêncio cortado`}>
                      ✂ −{activeTake.detectedSilenceSec.toFixed(1)}s
                    </span>
                  )}
                </>
              )}
            </div>
            {blocks.map(b => {
              const slot = slotById.get(b.id);
              if (!slot) return null;
              const left = viewPct(slot.projectStart);
              const width = Math.max(0, viewPct(slot.projectEnd) - left);
              const isDraggingThis = draggingBlockId === b.id;
              const isHovered = hoveredId === b.id;
              const blockLen = b.end - b.start;

              if (b.kind === 'broll') {
                return (
                  <div
                    key={b.id}
                    data-no-scrub="true"
                    onMouseEnter={() => setHoveredId(b.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onPointerDown={handleBlockPointerDown(b.id)}
                    className={`absolute top-1 bottom-1 rounded-md bg-gradient-to-b from-emerald-400/70 to-emerald-600/80 border border-emerald-300/40 shadow-[0_2px_8px_rgba(16,185,129,0.2)] cursor-grab active:cursor-grabbing hover:-translate-y-0.5 transition-transform overflow-hidden ${isDraggingThis ? 'opacity-40' : ''} ${selectedBlockId === b.id ? 'ring-2 ring-violet-400 ring-offset-1 ring-offset-[#0C0C0E] z-10' : ''}`}
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
                ? 'from-violet-400/80 to-violet-600/90 border-violet-300/40'
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
                  className={`absolute top-1 bottom-1 rounded-md bg-gradient-to-b ${tone} border cursor-grab active:cursor-grabbing transition-all overflow-hidden ${isDraggingThis ? 'opacity-40' : ''} ${selectedBlockId === b.id ? 'ring-2 ring-violet-400 ring-offset-1 ring-offset-[#0C0C0E] z-10' : isHovered ? '-translate-y-0.5 shadow-[0_8px_24px_rgba(245,158,11,0.4)] z-10' : 'shadow-[0_2px_8px_rgba(245,158,11,0.2)]'}`}
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
                  {isReady && clip?.videoUrl && (
                    <div className="absolute top-1 right-1 flex items-center gap-1 z-20" onPointerDown={(e) => e.stopPropagation()}>
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
                        className="w-5 h-5 rounded-full bg-violet-500/80 hover:bg-violet-500 backdrop-blur flex items-center justify-center text-white transition-all hover:scale-110"
                        title="Ver no app"
                      >
                        <svg className="w-2.5 h-2.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      </button>
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
              if (!slot) return null;
              const leftPct = viewPct(slot.projectEnd);
              const trans: BlockTransition = b.transition ?? 'fade';
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
          <div className="relative h-10 mb-1.5 rounded-md bg-white/[0.02] border border-white/10 overflow-hidden">
            <div className="absolute left-2 top-1.5 text-[9px] uppercase tracking-wider text-zinc-400/70 font-semibold pointer-events-none z-10">🎨 Motion</div>
            {blocks.filter(b => !!b.motion).map(b => {
              const slot = slotById.get(b.id);
              if (!slot) return null;
              const motion = b.motion!;
              const motionDur = motion.durationSec ?? 3;
              const blockDur = slot.projectEnd - slot.projectStart;
              const useDur = Math.min(motionDur, blockDur);
              const left = viewPct(slot.projectStart);
              const width = Math.max(0, viewPct(slot.projectStart + useDur) - left);
              const layerLabel = motion.layer === 'overlay' ? 'over' : motion.layer === 'replace' ? 'full' : motion.layer === 'split-bottom' ? 'split↑' : motion.layer === 'split-top' ? 'split↓' : 'over';
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
                : 'from-fuchsia-500/60 to-fuchsia-600/70 border-fuchsia-400/50';

              const statusLabel = isError       ? 'erro'
                                : isReady       ? '✓'
                                : isGenerating  ? 'IA…'
                                : isRendering   ? (busyMessage?.toLowerCase().includes('rend') ? 'render…' : busyMessage?.slice(0, 10) ?? 'render…')
                                : hasHtmlNeedsRender ? 'render →'
                                : isDraft       ? 'rascunho'
                                : layerLabel;

              const titleText = `${motion.presetId} · ${motion.layer} · ${useDur.toFixed(1)}s · ${motion.status}${motion.errorMessage ? ' · ' + motion.errorMessage.slice(0, 60) : ''}`;
              const showShimmer = isGenerating || isRendering;

              return (
                <div
                  key={`mot-${b.id}`}
                  data-no-scrub="true"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setMotionPickerBlockId(b.id); }}
                  className={`absolute top-1 bottom-1 rounded bg-gradient-to-r ${tone} border cursor-pointer hover:brightness-110 transition-all overflow-hidden ${selectedBlockId === b.id ? 'ring-2 ring-violet-400' : ''}`}
                  style={{ left: `${left}%`, width: `${Math.max(width, 1)}%` }}
                  title={titleText}
                >
                  <div className="px-1.5 py-1 flex items-center gap-1 text-white relative z-10">
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
            })}
          </div>

          {/* Captions track */}
          <div className="relative h-8 rounded-md bg-violet-500/[0.03] border border-violet-500/15 overflow-hidden">
            <div className="absolute left-2 top-1.5 text-[9px] uppercase tracking-wider text-violet-300/60 font-semibold pointer-events-none z-10">Captions</div>
            {blocks.map(b => {
              const slot = slotById.get(b.id);
              if (!slot) return null;
              const left = (slot.projectStart / totalDuration) * 100;
              const width = ((slot.projectEnd - slot.projectStart) / totalDuration) * 100;
              return (
                <div key={`cap-${b.id}`} className="absolute top-1 bottom-1 rounded bg-violet-500/15 border border-violet-400/20 px-1.5 flex items-center overflow-hidden" style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}>
                  <span className="text-[9px] text-violet-200 truncate">{b.text.slice(0, 40)}</span>
                </div>
              );
            })}
          </div>

          {/* Playhead */}
          <div className="absolute top-0 bottom-0 pointer-events-none z-20" style={{ left: `calc(${playheadPct}% + 8px)` }}>
            <div className="absolute top-0 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-violet-400 drop-shadow-[0_0_6px_rgba(167,139,250,0.8)]"></div>
            <div className="absolute top-0 bottom-0 w-0.5 bg-violet-400 -translate-x-1/2 shadow-[0_0_8px_rgba(167,139,250,0.6)]"></div>
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
            const current: BlockTransition = fromBlock.transition ?? 'fade';
            const opts: { value: BlockTransition; label: string; desc: string }[] = [
              { value: 'cut',      label: '╳ Cut',       desc: 'Corte seco, sem transição' },
              { value: 'fade',     label: '▾ Fade',      desc: 'Fade pro preto (~333ms)' },
              { value: 'dissolve', label: '◐ Dissolve',  desc: 'Cross-dissolve com áudio' },
            ];
            return (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setTransitionPopoverIdx(null)}
                />
                <div
                  data-no-scrub="true"
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute -top-1 -translate-x-1/2 -translate-y-full rounded-lg bg-[#141416] border border-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.8)] z-40 p-1.5 min-w-[200px]"
                  style={{ left: `calc(${leftPct}% + 8px)` }}
                >
                  <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold px-2 pt-1 pb-1.5">Transição entre blocos</div>
                  {opts.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        dispatch({ type: 'set-block-transition', id: fromBlock.id, transition: opt.value });
                        setTransitionPopoverIdx(null);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-md transition-colors ${current === opt.value ? 'bg-violet-500/20 border border-violet-500/40' : 'border border-transparent hover:bg-white/5'}`}
                    >
                      <div className="text-[11px] font-medium text-zinc-100">{opt.label}</div>
                      <div className="text-[9px] text-zinc-500 leading-tight">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </>
            );
          })()}
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
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Voz</span><span className="text-zinc-200">{selectedVoiceLabel.label}{selectedVoiceLabel.isCustom && <span className="ml-1 text-[9px] text-violet-300">(sua)</span>}</span></div>
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Idioma</span><span className="text-zinc-200">Português</span></div>
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Blocos</span><span className="text-zinc-200">{blocks.length}</span></div>
              <div className="flex justify-between text-xs"><span className="text-zinc-500">Duração estimada</span><span className="text-zinc-200">~{formatTime(estimateScriptDuration(blocks))}</span></div>
              <div className="flex justify-between text-xs pt-2 border-t border-white/5"><span className="text-zinc-300 font-medium">Custo</span><span className="text-violet-400 font-bold">${estimatedAudioCost.toFixed(2)}</span></div>
            </div>
            <div className="px-6 py-4 flex gap-2">
              <button onClick={() => setConfirmOpen(false)} className="flex-1 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-zinc-300 transition-colors">Cancelar</button>
              <button onClick={handleGenerate} className="flex-1 py-2.5 rounded-lg bg-gradient-to-b from-violet-500 to-violet-600 hover:from-violet-400 hover:to-violet-500 text-xs font-semibold text-white shadow-[0_0_20px_rgba(124,58,237,0.5)] transition-all">Gerar agora</button>
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

      {importModalOpen && (
        <ImportScriptModal
          onClose={() => setImportModalOpen(false)}
          onImported={(imported) => {
            dispatch({ type: 'replace-blocks', blocks: imported });
            setImportModalOpen(false);
            setPlayhead(0);
            setPlaying(false);
          }}
        />
      )}

      {motionPickerBlockId && (() => {
        const block = blocks.find(b => b.id === motionPickerBlockId);
        if (!block) return null;
        return (
          <MotionPickerModal
            block={block}
            onClose={() => setMotionPickerBlockId(null)}
            onSave={(motion) => {
              dispatch({ type: 'set-block-motion', id: block.id, motion });
              setMotionPickerBlockId(null);
            }}
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

      {referencesModalOpen && (
        <ReferencesModal
          analyses={state.analyses}
          onClose={() => setReferencesModalOpen(false)}
          onOpenPlan={(a) => setPlanAnalysis(a)}
          onRemoveAnalysis={(createdAt) => dispatch({ type: 'remove-analysis', createdAt })}
        />
      )}

      {videoRefModalOpen && (
        <VideoReferenceModal
          onClose={() => setVideoRefModalOpen(false)}
          onImported={(imported, analysis, meta) => {
            const persisted = {
              language: analysis.language,
              format: analysis.format,
              hookStyle: analysis.hookStyle,
              tone: analysis.tone,
              durationSec: analysis.durationSec,
              blockIds: imported.map(b => b.id),
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
            dispatch({ type: 'replace-blocks', blocks: imported, analysis: persisted });
            // Auto-suggest emotion from detected tone tags.
            const tones = (analysis.tone ?? []).map(t => t.toLowerCase());
            const suggested =
              tones.some(t => /(happy|warm|playful|excited|energetic|hype|fun|friendly|bold|inspiring|motivational)/.test(t)) ? 'happy' :
              tones.some(t => /(sad|melancholic|nostalgic|wistful)/.test(t)) ? 'sad' :
              tones.some(t => /(angry|frustrated|aggressive)/.test(t)) ? 'angry' :
              tones.some(t => /(surprised|shocked|astonished)/.test(t)) ? 'surprised' :
              tones.some(t => /(fearful|anxious|nervous|tense)/.test(t)) ? 'fearful' :
              null;
            if (suggested) dispatch({ type: 'set-emotion', emotion: suggested });
            setVideoRefModalOpen(false);
            setPlayhead(0);
            setPlaying(false);
          }}
          onContentImported={(imported, payload) => {
            // No video analysis context — just replace blocks. Caption + hashtags + rationale
            // are surfaced via console for now; could be persisted to a sibling store later.
            console.log('[content import]', {
              caption: payload.caption,
              hashtags: payload.hashtags,
              framework: payload.frameworkUsed,
              rationale: payload.rationale,
              source: payload.sourceUrl ?? payload.sourceTitle,
            });
            dispatch({ type: 'replace-blocks', blocks: imported });
            setVideoRefModalOpen(false);
            setPlayhead(0);
            setPlaying(false);
          }}
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

      <ExportRenderModal
        open={exportOpen}
        state={state}
        audioBlob={audioBlobRef.current}
        onClose={() => setExportOpen(false)}
      />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={() => setSettingsOpen(false)}
      />

      {confirmClearOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
          <div className="bg-[#141416] border border-white/10 rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.8)] max-w-md w-full overflow-hidden">
            <div className="px-6 pt-6 pb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                  </svg>
                </div>
                <div>
                  <div className="text-base font-semibold text-zinc-100">Limpar projeto?</div>
                  <div className="text-xs text-zinc-500">Essa ação não pode ser desfeita.</div>
                </div>
              </div>
              <div className="text-[12.5px] text-zinc-400 leading-relaxed">
                O roteiro, áudio gerado, clipes de avatar e takes serão removidos do app. Você vai começar do zero.
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
                    window.location.reload();
                  } catch (err) {
                    console.error('[reels] clearProject failed:', err);
                    alert(`Erro ao limpar: ${err instanceof Error ? err.message : 'desconhecido'}`);
                    setClearing(false);
                    setConfirmClearOpen(false);
                  }
                }}
                disabled={clearing}
                className="flex-1 py-2.5 rounded-lg bg-red-500 hover:bg-red-400 text-xs font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {clearing ? 'Limpando…' : 'Sim, limpar tudo'}
              </button>
            </div>
          </div>
        </div>
      )}

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
  defaultZoom: number;
  isCurrent: boolean;
  isSelected: boolean;
  compact?: boolean;
  onSelect: () => void;
  onJumpTo: () => void;
  onOpenMotion: () => void;
  onOpenMotionAdvanced: () => void;
  motionBusyMessage: string | null;
}

const LayoutThumbnail: React.FC<{ layout: BlockLayout; selected: boolean }> = ({ layout, selected }) => {
  // Each thumbnail is a stylized 9:16-ish rectangle showing where avatar (amber) and media (emerald) sit.
  const borderClass = selected ? 'border-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.4)]' : 'border-white/10';
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

const ScriptBlockCard: React.FC<BlockCardProps> = ({ block: b, index, total, wordCount, audioReady, onToggleKind, onUpdateText, onRemove, onMoveUp, onMoveDown, onSetAvatarVisibleSec, onSetLayout, onSetAvatarZoom, onSetAvatarOffsetY, defaultZoom, isCurrent, isSelected, compact, onSelect, onJumpTo, onOpenMotion, onOpenMotionAdvanced, motionBusyMessage }) => {
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
          isCurrent ? 'ring-1 ring-violet-400/40' : ''
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
        isSelected ? 'ring-2 ring-violet-400 shadow-[0_0_24px_rgba(167,139,250,0.35)]'
        : isCurrent ? 'ring-1 ring-violet-400/50 shadow-[0_0_24px_rgba(167,139,250,0.15)]' : ''
      } ${
        isAvatar ? 'bg-amber-500/[0.04] border-amber-500/20 hover:border-amber-500/40' : 'bg-emerald-500/[0.04] border-emerald-500/20 hover:border-emerald-500/40'
      }`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <button onClick={onToggleKind} className={`flex items-center gap-1.5 text-[11px] font-semibold rounded-md px-2 py-1 transition-colors ${
          isAvatar ? 'text-amber-300 bg-amber-500/10 hover:bg-amber-500/20' : 'text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20'
        }`}>
          {isAvatar ? '👤 Avatar' : '🖥️ B-roll'}
        </button>
        <div className="flex items-center gap-1">
          {(() => {
            const isBusy = !!motionBusyMessage;
            const isReady = b.motion?.status === 'ready' && !!b.motion?.videoPath;
            const isError = b.motion?.status === 'error';
            const label = isBusy ? motionBusyMessage : isReady ? '🎨 Motion ✓' : isError ? '🎨 Motion ⚠' : '🎨 Motion';
            const cls = isBusy
              ? 'bg-fuchsia-500/15 border-fuchsia-400/40 text-fuchsia-200 cursor-progress'
              : isReady
                ? 'bg-fuchsia-500/20 border-fuchsia-400/50 text-fuchsia-100 hover:bg-fuchsia-500/30'
                : isError
                  ? 'bg-red-500/15 border-red-500/40 text-red-200 hover:bg-red-500/25'
                  : 'bg-fuchsia-500/[0.06] border-fuchsia-400/20 text-fuchsia-300/80 hover:bg-fuchsia-500/15 hover:text-fuchsia-200 hover:border-fuchsia-400/40';
            return (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); if (!isBusy) onOpenMotion(); }}
                  disabled={isBusy}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors flex items-center gap-1 ${cls}`}
                  title={
                    isBusy ? motionBusyMessage ?? 'Gerando…'
                    : isReady ? `Editar motion · ${b.motion?.intent ?? ''}`
                    : isError ? `Erro: ${b.motion?.errorMessage ?? ''}. Clique pra tentar de novo.`
                    : 'Gerar motion automaticamente (Gemini decide)'
                  }
                >
                  {isBusy && (
                    <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                      <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  <span>{label}</span>
                </button>
                {b.motion?.html && !isBusy && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenMotionAdvanced(); }}
                    className="px-1.5 py-0.5 rounded-md text-[10px] text-zinc-500 hover:text-zinc-200 hover:bg-white/5 transition-colors"
                    title="Ajustar motion (avançado)"
                  >
                    ⚙
                  </button>
                )}
              </>
            );
          })()}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onMoveUp} disabled={index === 0} className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:hover:text-zinc-500 transition-colors" title="Mover acima">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
          </button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 disabled:hover:text-zinc-500 transition-colors" title="Mover abaixo">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </button>
          <button onClick={onJumpTo} className="p-1 text-zinc-500 hover:text-violet-300 transition-colors" title="Pular pra este bloco">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button onClick={onRemove} className="p-1 text-zinc-500 hover:text-red-400 transition-colors" title="Remover (Del)">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
      <textarea
        value={b.text}
        onChange={e => onUpdateText(e.target.value)}
        placeholder="Digite o texto desse bloco..."
        className="w-full bg-transparent px-3 py-2.5 text-[13px] text-zinc-200 placeholder-zinc-600 outline-none resize-none leading-relaxed"
        rows={3}
      />

      {isAvatar && (
        <div className="px-3 py-2 border-t border-white/5">
          <div className="text-[10px] text-zinc-400 mb-1.5">📐 Layout</div>
          <div className="grid grid-cols-4 gap-1.5">
            {LAYOUT_OPTIONS.map(opt => {
              const selected = (b.layout ?? 'avatar-only') === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => onSetLayout(opt.id)}
                  className="space-y-1"
                  title={opt.label}
                >
                  <LayoutThumbnail layout={opt.id} selected={selected} />
                  <div className={`text-[8px] text-center truncate ${selected ? 'text-violet-300' : 'text-zinc-500'}`}>{opt.label}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isAvatar && audioReady && duration > 0.5 && (
        <div className="px-3 py-2 border-t border-white/5 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-400">⏱ Avatar visível</span>
            <span className={`font-mono ${isPartial ? 'text-emerald-300' : 'text-zinc-300'}`}>
              {visibleSec.toFixed(1)}s
              {isPartial && <span className="text-zinc-500 ml-1">· depois B-roll {(duration - visibleSec).toFixed(1)}s</span>}
            </span>
          </div>
          <input
            type="range"
            min={0.5}
            max={duration}
            step={0.1}
            value={visibleSec}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onSetAvatarVisibleSec(Math.abs(v - duration) < 0.05 ? undefined : v);
            }}
            className="w-full h-1 accent-emerald-400 cursor-pointer"
          />
        </div>
      )}

      {isAvatar && (
        <div className="px-3 py-2 border-t border-white/5 space-y-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-400">🔍 Zoom do avatar</span>
            <span className={`font-mono ${(b.avatarZoom ?? defaultZoom) > defaultZoom + 0.05 ? 'text-violet-300' : 'text-zinc-300'}`}>
              {(b.avatarZoom ?? defaultZoom).toFixed(2)}x
              {b.avatarZoom === undefined && <span className="text-zinc-600 ml-1">(auto)</span>}
            </span>
          </div>
          <input
            type="range"
            min={0.7}
            max={3}
            step={0.05}
            value={b.avatarZoom ?? defaultZoom}
            onChange={(e) => onSetAvatarZoom(parseFloat(e.target.value))}
            className="w-full h-1 accent-violet-400 cursor-pointer"
          />
          <div className="text-[9px] text-zinc-500">HeyGen rende em 16:9; ajuste o zoom pra encaixar no aspect do reel.</div>
          {/* Vertical position slider */}
          <div className="flex items-center justify-between text-[10px] mt-2">
            <span className="text-zinc-400">↕️ Posição vertical</span>
            <span className="font-mono text-zinc-300">
              {b.avatarOffsetY === undefined || b.avatarOffsetY === 0 ? 'centro' : b.avatarOffsetY > 0 ? `+${(b.avatarOffsetY * 100).toFixed(0)}% ↓` : `${(b.avatarOffsetY * 100).toFixed(0)}% ↑`}
            </span>
          </div>
          <input
            type="range"
            min={-0.5}
            max={0.5}
            step={0.02}
            value={b.avatarOffsetY ?? 0}
            onChange={(e) => onSetAvatarOffsetY(parseFloat(e.target.value))}
            className="w-full h-1 accent-violet-400 cursor-pointer"
          />
        </div>
      )}

      <div className="px-3 py-2 border-t border-white/5 flex items-center justify-between text-[10px] text-zinc-500 font-mono">
        <span>{formatTime(b.start)} → {formatTime(b.end)}{b.dirty && <span className="ml-1.5 text-amber-400">· alterado</span>}</span>
        <span>
          {duration.toFixed(1)}s · {wordCount} palavras
          {isAvatar && cost > 0 && <span className="text-amber-400/70 ml-2">${cost.toFixed(2)}</span>}
        </span>
      </div>
    </div>
  );
};
