import { useEffect, useRef, useState } from 'react';
import {
  saveProject,
  loadProject,
  loadAudioBlob,
  loadAllClipBlobs,
  loadAllTakeBlobs,
  saveAudioBlob,
  downloadAndStoreClip,
  clearAllProjectData,
} from './persistence';
import { computePeaks } from './audioEngine';
import type { AvatarClipState, ReelsAction, ReelsState, ScreenTake } from './types';

const SAVE_DEBOUNCE_MS = 600;

interface Options {
  state: ReelsState;
  dispatch: React.Dispatch<ReelsAction>;
  onHydrated?: () => void;
}

export const useReelsPersistence = ({ state, dispatch, onHydrated }: Options) => {
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const downloadingRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);

  // ─── HYDRATE ON MOUNT ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // A pending project name (set by the "Novo projeto" flow before
        // it reloads the page) takes priority: we apply it before
        // hydration so the new project gets its OWN assets directory
        // instead of inheriting "Reel sem título"'s.
        const pendingName = typeof window !== 'undefined'
          ? window.localStorage?.getItem('reels.pendingProjectName')
          : null;
        if (pendingName) {
          window.localStorage.removeItem('reels.pendingProjectName');
          dispatch({ type: 'set-name', name: pendingName });
        }

        const persisted = await loadProject();
        if (cancelled) return;
        if (!persisted) {
          setHydrated(true);
          hydratedRef.current = true;
          return;
        }

        // Restore audio Blob → object URL + recompute peaks (cheap, < 50ms)
        const audioBlob = await loadAudioBlob();
        if (cancelled) return;

        let audioUrl: string | null = null;
        let peaks: number[] = persisted.audio.peaks;
        let duration = persisted.audio.duration;

        if (audioBlob) {
          audioUrl = URL.createObjectURL(audioBlob);
          // Re-decode to get fresh peaks if persisted ones are missing.
          if (!peaks || peaks.length === 0) {
            try {
              const decoded = await decodeBlobForPeaks(audioBlob);
              peaks = decoded.peaks;
              duration = decoded.duration;
            } catch {
              // peaks stay empty; not fatal.
            }
          }
        }

        // Restore clip Blobs → object URLs, replacing any stale remote URLs.
        const clipBlobs = await loadAllClipBlobs();
        if (cancelled) return;

        // Persisted videoUrls are blob: URLs from a prior session — invalid now.
        // Only restore clips whose Blob actually exists in IndexedDB; otherwise the
        // <video> would spam the console with WebKitBlobResource errors trying to
        // load a dead URL until something else replaced it.
        const restoredClips: Record<string, AvatarClipState> = {};
        for (const [blockId, blob] of Object.entries(clipBlobs)) {
          const url = URL.createObjectURL(blob);
          restoredClips[blockId] = {
            blockId,
            status: 'ready',
            videoUrl: url,
          };
        }
        // Carry over non-ready statuses (queued/rendering/error) so the UI keeps
        // showing them — they don't need a videoUrl.
        for (const [blockId, clip] of Object.entries(persisted.avatarClips)) {
          if (restoredClips[blockId]) continue;
          if (clip.status === 'ready') continue; // ready without a blob = stale, drop
          restoredClips[blockId] = { ...clip, videoUrl: undefined };
        }

        // Restore take Blobs → object URLs.
        const takeBlobs = await loadAllTakeBlobs();
        if (cancelled) return;

        const restoredTakes: ScreenTake[] = (persisted.takes ?? [])
          .filter(t => takeBlobs[t.id]) // drop takes whose blob disappeared
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

        // Migrate legacy single-asset blocks (and motion snapshots) into the
        // new array-based shape. Older projects had `attachedAsset` (single)
        // and `motion.assetSnapshot` (single) — convert to 1-element arrays.
        const migratedBlocks = persisted.blocks.map(b => {
          const next: typeof b = { ...b };
          // Block-level: attachedAsset → attachedAssets
          const legacyAsset = (b as { attachedAsset?: { name: string; path: string; type: 'image' | 'video' } }).attachedAsset;
          if (legacyAsset && (!next.attachedAssets || next.attachedAssets.length === 0)) {
            next.attachedAssets = [legacyAsset];
          }
          // Strip the legacy field so it doesn't leak forward.
          delete (next as { attachedAsset?: unknown }).attachedAsset;
          // Motion-level: assetSnapshot → assetSnapshots
          if (next.motion) {
            const legacySnap = (next.motion as { assetSnapshot?: { path: string; name: string } }).assetSnapshot;
            if (legacySnap && (!next.motion.assetSnapshots || next.motion.assetSnapshots.length === 0)) {
              next.motion = { ...next.motion, assetSnapshots: [legacySnap] };
            }
            delete (next.motion as { assetSnapshot?: unknown }).assetSnapshot;
          }
          return next;
        });

        const restoredState: ReelsState = {
          projectName: persisted.projectName,
          blocks: migratedBlocks,
          audio: {
            ...persisted.audio,
            silenceCut: persisted.audio.silenceCut ?? false,
            silencePreset: persisted.audio.silencePreset ?? 'fast',
            keepSegments: persisted.audio.keepSegments ?? [],
            detectedSilenceSec: persisted.audio.detectedSilenceSec ?? 0,
            detectingSilence: false,
            // Cut state is in-memory only — never trust the persisted values.
            // The cut audio blob lives only as an object URL during a session;
            // on reload we always start from the pristine source and let the
            // user re-enable cuts if they want them.
            applyingCuts: false,
            cutsApplied: false,
            originalBlocks: undefined,
            originalWords: undefined,
            originalDuration: undefined,
            originalPeaks: undefined,
            url: audioUrl,
            peaks,
            duration,
            // If we have an audio blob the audio is "ready"; otherwise reset to idle.
            status: audioBlob ? 'ready' : 'idle',
          },
          selectedVoiceId: persisted.selectedVoiceId,
          aspect: persisted.aspect,
          avatarClips: restoredClips,
          avatarModel: persisted.avatarModel,
          selectedPhotoId: persisted.selectedPhotoId,
          takes: restoredTakes,
          activeTakeId: persisted.activeTakeId && restoredTakes.some(t => t.id === persisted.activeTakeId)
            ? persisted.activeTakeId
            : (restoredTakes[0]?.id ?? null),
          lastAnalysis: persisted.lastAnalysis,
          analyses: persisted.analyses ?? (persisted.lastAnalysis ? [persisted.lastAnalysis] : []),
          emotion: persisted.emotion ?? 'neutral',
          voiceSpeed: persisted.voiceSpeed ?? 1.0,
          motionColorMode: persisted.motionColorMode ?? 'dark',
          appTheme: persisted.appTheme ?? 'dark',
        };

        dispatch({ type: 'hydrate', state: restoredState });
        setSavedAt(persisted.savedAt);
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

  // ─── DEBOUNCED AUTO-SAVE OF PROJECT ────────────────────────────────
  useEffect(() => {
    if (!hydratedRef.current) return;
    setSaving(true);
    const handle = setTimeout(async () => {
      try {
        await saveProject(state);
        setSavedAt(Date.now());
      } catch (err) {
        console.warn('[reels/persistence] saveProject failed:', err);
      } finally {
        setSaving(false);
      }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [state]);

  // ─── DOWNLOAD FRESH HEYGEN CLIPS ───────────────────────────────────
  // When a clip transitions to status === 'ready' with a remote (https) URL,
  // download the MP4 immediately and replace the URL with a local blob: URL.
  useEffect(() => {
    if (!hydratedRef.current) return;
    for (const [blockId, clip] of Object.entries(state.avatarClips)) {
      if (clip.status !== 'ready') continue;
      if (!clip.videoUrl) continue;
      if (clip.videoUrl.startsWith('blob:')) continue; // already local
      if (downloadingRef.current.has(blockId)) continue;
      downloadingRef.current.add(blockId);
      (async () => {
        try {
          const blob = await downloadAndStoreClip(blockId, clip.videoUrl!);
          const localUrl = URL.createObjectURL(blob);
          dispatch({ type: 'clip-update', blockId, status: 'ready', videoUrl: localUrl });
        } catch (err) {
          console.warn('[reels/persistence] clip download failed for', blockId, err);
          // We keep the remote URL — it still works for ~7 days.
        } finally {
          downloadingRef.current.delete(blockId);
        }
      })();
    }
  }, [state.avatarClips, dispatch]);

  // ─── PERSIST AUDIO BLOB WHEN URL CHANGES ──────────────────────────
  // The audio Blob is created inside audioEngine and its object URL flows through state.
  // We snapshot the Blob to IndexedDB on first ready event.
  // IMPORTANT: only persist when cuts have NOT been applied — `state.audio.url`
  // points at the in-memory cut audio when cutsApplied is true, and we never
  // want to overwrite the pristine source with a cut copy. Cuts are recomputed
  // from the original on demand, so we don't lose anything.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (state.audio.status !== 'ready') return;
    if (!state.audio.url) return;
    if (state.audio.cutsApplied) return; // skip saving cut audio
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
    // Caller should reset the in-memory state by reloading the page or dispatching a reset.
  };

  return { hydrated, savedAt, saving, clearProject };
};

// Lightweight helper duplicated from audioEngine so we don't import its full graph here.
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
