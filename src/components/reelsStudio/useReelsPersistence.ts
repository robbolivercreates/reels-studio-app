import { useEffect, useRef, useState } from 'react';
import {
  loadProject,
  loadAudioBlob,
  loadAllClipBlobs,
  loadAllTakeBlobs,
  saveAudioBlob,
  downloadAndStoreClip,
  clearAllProjectData,
  saveNamedProject,
  loadNamedProject,
  listNamedProjects,
  type PersistedProject,
} from './persistence';
import { computePeaks } from './audioEngine';
import type { AvatarClipState, ReelsAction, ReelsState, ScreenTake } from './types';

// Aggressively short debounce so work-loss-on-kill stays under 150ms. Previous
// 600ms was wide enough for a crash/kill to land between the last edit and the
// save, destroying state. Combined with the flush-on-blur listener below, the
// window of unsaved state is now effectively zero unless the user kills the
// process during an active typing burst.
const SAVE_DEBOUNCE_MS = 120;
const ACTIVE_PROJECT_KEY = 'reels.activeProjectId';

interface Options {
  state: ReelsState;
  dispatch: React.Dispatch<ReelsAction>;
  onHydrated?: () => void;
}

const readActiveId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(ACTIVE_PROJECT_KEY); } catch { return null; }
};

const writeActiveId = (id: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    else window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
  } catch { /* localStorage quota / private mode — non-fatal */ }
};

/**
 * Reconstructs a full ReelsState from a persisted snapshot, an optional
 * audio Blob, the clip Blobs (keyed by blockId), and the take Blobs.
 * Used by both the boot hydrator and the runtime "switch project" handler.
 */
export const buildStateFromSnapshot = async (
  snapshot: PersistedProject,
  activeProjectId: string | null,
  audioBlob: Blob | null,
  clipBlobs: Record<string, Blob>,
  takeBlobs: Record<string, Blob>,
): Promise<ReelsState> => {
  let audioUrl: string | null = null;
  let peaks: number[] = snapshot.audio.peaks;
  let duration = snapshot.audio.duration;

  if (audioBlob) {
    audioUrl = URL.createObjectURL(audioBlob);
    if (!peaks || peaks.length === 0) {
      try {
        const decoded = await decodeBlobForPeaks(audioBlob);
        peaks = decoded.peaks;
        duration = decoded.duration;
      } catch { /* peaks stay empty */ }
    }
  }

  // Filter clips so we only restore ones whose Blob is actually present.
  const restoredClips: Record<string, AvatarClipState> = {};
  for (const [blockId, blob] of Object.entries(clipBlobs)) {
    // Only restore clips that belong to a block in this snapshot.
    if (!snapshot.blocks.some(b => b.id === blockId)) continue;
    restoredClips[blockId] = {
      blockId,
      status: 'ready',
      videoUrl: URL.createObjectURL(blob),
    };
  }
  // Carry over non-ready statuses (queued/rendering/error) — they don't need a videoUrl.
  for (const [blockId, clip] of Object.entries(snapshot.avatarClips)) {
    if (restoredClips[blockId]) continue;
    if (clip.status === 'ready') continue; // ready without a blob = stale, drop
    restoredClips[blockId] = { ...clip, videoUrl: undefined };
  }

  const restoredTakes: ScreenTake[] = (snapshot.takes ?? [])
    .filter(t => takeBlobs[t.id])
    .map(t => {
      const partial = t as unknown as Partial<ScreenTake> & { id: string; durationMs: number };
      const durationSec = (partial.durationMs ?? 0) / 1000;
      return {
        id: partial.id,
        name: partial.name ?? 'Take',
        durationMs: partial.durationMs,
        hasAudio: partial.hasAudio ?? true,
        createdAt: partial.createdAt ?? Date.now(),
        source: partial.source ?? 'recording',
        trimStart: partial.trimStart ?? 0,
        trimEnd: partial.trimEnd ?? durationSec,
        cutSilence: partial.cutSilence ?? false,
        keepSegments: partial.keepSegments ?? [],
        detectedSilenceSec: partial.detectedSilenceSec ?? 0,
        url: URL.createObjectURL(takeBlobs[partial.id]),
      } satisfies ScreenTake;
    });

  // Migrate legacy single-asset blocks → array-based shape.
  const migratedBlocks = snapshot.blocks.map(b => {
    const next: typeof b = { ...b };
    const legacyAsset = (b as { attachedAsset?: { name: string; path: string; type: 'image' | 'video' } }).attachedAsset;
    if (legacyAsset && (!next.attachedAssets || next.attachedAssets.length === 0)) {
      next.attachedAssets = [legacyAsset];
    }
    delete (next as { attachedAsset?: unknown }).attachedAsset;
    if (next.motion) {
      const legacySnap = (next.motion as { assetSnapshot?: { path: string; name: string } }).assetSnapshot;
      if (legacySnap && (!next.motion.assetSnapshots || next.motion.assetSnapshots.length === 0)) {
        next.motion = { ...next.motion, assetSnapshots: [legacySnap] };
      }
      delete (next.motion as { assetSnapshot?: unknown }).assetSnapshot;
    }
    return next;
  });

  return {
    activeProjectId,
    projectName: snapshot.projectName,
    blocks: migratedBlocks,
    audio: {
      ...snapshot.audio,
      silenceCut: snapshot.audio.silenceCut ?? false,
      silencePreset: snapshot.audio.silencePreset ?? 'fast',
      keepSegments: snapshot.audio.keepSegments ?? [],
      detectedSilenceSec: snapshot.audio.detectedSilenceSec ?? 0,
      detectingSilence: false,
      applyingCuts: false,
      cutsApplied: false,
      originalBlocks: undefined,
      originalWords: undefined,
      originalDuration: undefined,
      originalPeaks: undefined,
      url: audioUrl,
      peaks,
      duration,
      status: audioBlob ? 'ready' : 'idle',
    },
    selectedVoiceId: snapshot.selectedVoiceId,
    aspect: snapshot.aspect,
    avatarClips: restoredClips,
    avatarModel: snapshot.avatarModel,
    selectedPhotoId: snapshot.selectedPhotoId,
    takes: restoredTakes,
    activeTakeId: snapshot.activeTakeId && restoredTakes.some(t => t.id === snapshot.activeTakeId)
      ? snapshot.activeTakeId
      : (restoredTakes[0]?.id ?? null),
    lastAnalysis: snapshot.lastAnalysis,
    analyses: snapshot.analyses ?? (snapshot.lastAnalysis ? [snapshot.lastAnalysis] : []),
    emotion: snapshot.emotion ?? 'neutral',
    voiceSpeed: snapshot.voiceSpeed ?? 1.0,
    motionColorMode: snapshot.motionColorMode ?? 'dark',
    motionEnergy: (snapshot as { motionEnergy?: ReelsState['motionEnergy'] }).motionEnergy ?? 'energetic',
    appTheme: snapshot.appTheme ?? 'dark',
    lastAvatarLayout: (snapshot as { lastAvatarLayout?: ReelsState['lastAvatarLayout'] }).lastAvatarLayout ?? 'avatar-top',
  };
};

export const useReelsPersistence = ({ state, dispatch, onHydrated }: Options) => {
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const downloadingRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);
  const persistedClipKeys = useRef<Set<string>>(new Set());

  // ─── HYDRATE ON MOUNT ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // A pending project name (set by the legacy "Novo projeto" flow before
        // it reloaded the page) takes priority — apply it pre-hydration so the
        // assets dir is keyed to the new name.
        const pendingName = typeof window !== 'undefined'
          ? window.localStorage?.getItem('reels.pendingProjectName')
          : null;
        if (pendingName) {
          window.localStorage.removeItem('reels.pendingProjectName');
          dispatch({ type: 'set-name', name: pendingName });
        }

        // 1. Try to load by activeProjectId from localStorage.
        let activeId = readActiveId();
        let snapshot: PersistedProject | null = null;

        if (activeId) {
          const named = await loadNamedProject(activeId);
          if (named) {
            snapshot = named.snapshot;
          } else {
            // Stale id — clear it and fall through.
            activeId = null;
            writeActiveId(null);
          }
        }

        // 2. No active id (or it was stale) → take the most recent project, if any.
        if (!snapshot) {
          const list = await listNamedProjects();
          if (cancelled) return;
          if (list.length > 0) {
            const named = await loadNamedProject(list[0].id);
            if (named) {
              snapshot = named.snapshot;
              activeId = list[0].id;
              writeActiveId(activeId);
            }
          }
        }

        // 3. Still nothing → MIGRATE from legacy 'current' slot if it exists.
        if (!snapshot) {
          const legacy = await loadProject();
          if (cancelled) return;
          if (legacy) {
            // Build a minimal ReelsState from the legacy snapshot to pass to saveNamedProject.
            // We hydrate first below from `legacy`, but we need an id for the new entry.
            snapshot = legacy;
            // Synthesize a state for the save call. Audio buffer will be picked up from STORE_AUDIO
            // by the upcoming hydration via loadAudioBlob below, but saveNamedProject needs
            // state.audio.url — at this point we don't have one. We'll save a "url-less" entry,
            // and the audio buffer is still safe in STORE_AUDIO so the auto-save effect re-snapshots it.
            const tmpState = {
              ...legacy,
              activeProjectId: null,
              avatarClips: legacy.avatarClips,
              takes: legacy.takes as unknown as ScreenTake[],
              activeTakeId: legacy.activeTakeId,
              brandIdentity: undefined,
              audio: { ...legacy.audio, url: null },
            } as unknown as ReelsState;
            const newId = await saveNamedProject(tmpState);
            activeId = newId;
            writeActiveId(newId);
          }
        }

        // 4. Nothing at all → leave INITIAL_STATE alone; auto-save will create an entry
        //    the first time the user touches anything.
        if (!snapshot) {
          setHydrated(true);
          hydratedRef.current = true;
          return;
        }

        const audioBlob = await loadAudioBlob();
        if (cancelled) return;
        const clipBlobs = await loadAllClipBlobs();
        if (cancelled) return;
        const takeBlobs = await loadAllTakeBlobs();
        if (cancelled) return;

        const restoredState = await buildStateFromSnapshot(snapshot, activeId, audioBlob, clipBlobs, takeBlobs);
        if (cancelled) return;

        dispatch({ type: 'hydrate', state: restoredState });
        setSavedAt(snapshot.savedAt);
        setHydrated(true);
        hydratedRef.current = true;
        onHydrated?.();
      } catch (err) {
        console.warn('[reels/persistence] hydrate failed:', err);
        setHydrated(true);
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── DEBOUNCED AUTO-SAVE OF PROJECT + FLUSH-ON-BLUR ─────────────────
  // Writes go to the named_projects store, keyed by state.activeProjectId.
  // First touch of an empty boot creates a new entry and adopts its id.
  // The same effect also wires up blur/visibilitychange/beforeunload
  // listeners that fire an immediate flush — that way work-loss-on-kill
  // is bounded by the time between the last interaction and the next blur
  // event (effectively zero in normal use). Listeners re-bind on each
  // state change so they always close over the latest snapshot.
  useEffect(() => {
    if (!hydratedRef.current) return;
    setSaving(true);
    const handle = setTimeout(async () => {
      try {
        const id = await saveNamedProject(state, state.activeProjectId ?? undefined);
        if (id !== state.activeProjectId) {
          writeActiveId(id);
          dispatch({ type: 'set-active-project-id', id });
        }
        setSavedAt(Date.now());
      } catch (err) {
        console.warn('[reels/persistence] saveNamedProject failed:', err);
      } finally {
        setSaving(false);
      }
    }, SAVE_DEBOUNCE_MS);

    // Immediate flush on focus loss / window close. Fire-and-forget — the
    // IDB write queues on the same connection and the transaction completes
    // even after the handler returns.
    const flush = () => {
      void saveNamedProject(state, state.activeProjectId ?? undefined).catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('blur', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(handle);
      window.removeEventListener('blur', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [state, dispatch]);

  // ─── DOWNLOAD FRESH HEYGEN CLIPS ───────────────────────────────────
  useEffect(() => {
    if (!hydratedRef.current) return;
    for (const [blockId, clip] of Object.entries(state.avatarClips)) {
      if (clip.status !== 'ready') continue;
      if (!clip.videoUrl) continue;
      if (clip.videoUrl.startsWith('blob:')) continue;
      if (downloadingRef.current.has(blockId)) continue;
      downloadingRef.current.add(blockId);
      (async () => {
        try {
          const blob = await downloadAndStoreClip(blockId, clip.videoUrl!);
          const localUrl = URL.createObjectURL(blob);
          dispatch({ type: 'clip-update', blockId, status: 'ready', videoUrl: localUrl });
        } catch (err) {
          console.warn('[reels/persistence] clip download failed for', blockId, err);
        } finally {
          downloadingRef.current.delete(blockId);
        }
      })();
    }
  }, [state.avatarClips, dispatch]);

  // ─── KEEP IDB CLIP KEYS IN SYNC WITH state.avatarClips ────────────
  // The `split-block` reducer reassigns a clip to a new blockId in state but
  // doesn't migrate the IndexedDB row — so after a reload `loadAllClipBlobs`
  // returns the blob under the *old* blockId and the snapshot filter throws
  // it away. This effect catches that: any ready clip whose blob: URL points
  // to a Blob that isn't already saved under that blockId in IDB gets persisted.
  // Cheap fetch + save — runs once per (blockId, url) pair.
  useEffect(() => {
    if (!hydratedRef.current) return;
    for (const [blockId, clip] of Object.entries(state.avatarClips)) {
      if (clip.status !== 'ready') continue;
      if (!clip.videoUrl?.startsWith('blob:')) continue;
      const key = `${blockId}::${clip.videoUrl}`;
      if (persistedClipKeys.current.has(key)) continue;
      persistedClipKeys.current.add(key);
      (async () => {
        try {
          const { loadClipBlob, saveClipBlob } = await import('./persistence');
          const existing = await loadClipBlob(blockId);
          if (existing) return; // Already saved under this blockId — nothing to do.
          const res = await fetch(clip.videoUrl!);
          const blob = await res.blob();
          await saveClipBlob(blockId, blob);
        } catch (err) {
          console.warn('[reels/persistence] re-save clip failed for', blockId, err);
          persistedClipKeys.current.delete(key); // Allow retry next render.
        }
      })();
    }
  }, [state.avatarClips]);

  // ─── PERSIST AUDIO BLOB WHEN URL CHANGES ──────────────────────────
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (state.audio.status !== 'ready') return;
    if (!state.audio.url) return;
    if (state.audio.cutsApplied) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(state.audio.url!);
        if (cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        await saveAudioBlob(blob);
      } catch (err) {
        console.warn('[reels/persistence] saveAudioBlob failed:', err);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.audio.url, state.audio.status, state.audio.cutsApplied]);

  const clearProject = async (): Promise<void> => {
    await clearAllProjectData();
    setSavedAt(null);
  };

  return { hydrated, savedAt, saving, clearProject };
};

const decodeBlobForPeaks = async (blob: Blob): Promise<{ peaks: number[]; duration: number }> => {
  const AC: typeof AudioContext =
    (window.AudioContext as typeof AudioContext | undefined) ??
    ((window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new AC();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return { peaks: computePeaks(buffer), duration: buffer.duration };
  } finally {
    if (ctx.state !== 'closed') ctx.close().catch(() => {});
  }
};
