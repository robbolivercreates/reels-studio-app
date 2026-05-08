/**
 * IndexedDB persistence for Reels Studio.
 *
 * Stores:
 *  - project: serialized state snapshot (no Blobs / no object URLs)
 *  - audio:   the full MP3 Blob produced by Minimax
 *  - clips:   per-block MP4 Blobs downloaded from HeyGen (so they survive the 7-day URL expiry)
 *
 * Design notes:
 *  - We rehydrate Blobs into fresh `URL.createObjectURL()` on load — old object URLs from
 *    a previous session are dead, so we never persist them.
 *  - Single project for now (key = 'current'). Multi-project galaxy can wrap this later.
 */

const DB_NAME = 'reels_studio_v1';
const DB_VERSION = 3;
const STORE_PROJECT = 'project';
const STORE_AUDIO = 'audio'; // ALWAYS the pristine Minimax output. Cuts live in memory only.
const STORE_CLIPS = 'clips';
const STORE_TAKES = 'takes';
const STORE_EXPORTS = 'exports';
const PROJECT_KEY = 'current';
const AUDIO_KEY = 'current';

import type { ReelsState } from './types';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // If an older version of the DB is open in another tab, this fires.
    req.onblocked = () => {
      console.warn('[reels/persistence] IndexedDB upgrade blocked — close other tabs of this app');
      reject(new Error('Outra aba do app está aberta. Feche-a e tente de novo.'));
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECT)) db.createObjectStore(STORE_PROJECT);
      if (!db.objectStoreNames.contains(STORE_AUDIO)) db.createObjectStore(STORE_AUDIO);
      if (!db.objectStoreNames.contains(STORE_CLIPS)) db.createObjectStore(STORE_CLIPS); // key = blockId
      if (!db.objectStoreNames.contains(STORE_TAKES)) db.createObjectStore(STORE_TAKES); // key = takeId
      if (!db.objectStoreNames.contains(STORE_EXPORTS)) db.createObjectStore(STORE_EXPORTS); // key = exportId
    };
    req.onsuccess = () => {
      const db = req.result;
      // If another tab triggers a version upgrade, close this connection so it can proceed.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
};

/** Synchronous IDBRequest wrapper — preferred form, doesn't risk transaction auto-commit. */
const reqOf = <T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  openDB().then(db => new Promise<T>((resolve, reject) => {
    let result: T | undefined;
    let settled = false;
    const transaction = db.transaction(store, mode);
    const objStore = transaction.objectStore(store);
    const request = run(objStore);
    request.onsuccess = () => { result = request.result as T; };
    request.onerror = () => { if (!settled) { settled = true; reject(request.error); } };
    transaction.oncomplete = () => { if (!settled) { settled = true; resolve(result as T); } };
    transaction.onerror = () => { if (!settled) { settled = true; reject(transaction.error); } };
    transaction.onabort = () => { if (!settled) { settled = true; reject(transaction.error ?? new Error('Transaction aborted')); } };
  }));

// ─── PROJECT (state snapshot) ───────────────────────────────────────────

/**
 * Serializable subset of ReelsState — strips object URLs / object-URL-derived peaks
 * arrays we'll rebuild from the audio Blob.
 */
export interface PersistedProject {
  projectName: string;
  blocks: ReelsState['blocks'];
  audio: Omit<ReelsState['audio'], 'url'> & { url: null };
  selectedVoiceId: string;
  aspect: ReelsState['aspect'];
  avatarClips: ReelsState['avatarClips']; // videoUrls here are stale on load — we rebuild from STORE_CLIPS
  avatarModel: ReelsState['avatarModel'];
  selectedPhotoId: string | null;
  takes: Array<Omit<ReelsState['takes'][number], 'url'> & { url: null }>;
  activeTakeId: string | null;
  /** Last video-reference analysis (persisted so the production plan survives reload). */
  lastAnalysis?: ReelsState['lastAnalysis'];
  /** History of analyses (newest first, capped). */
  analyses?: ReelsState['analyses'];
  emotion?: ReelsState['emotion'];
  voiceSpeed?: number;
  savedAt: number;
}

export const saveProject = async (state: ReelsState): Promise<void> => {
  const snapshot: PersistedProject = {
    projectName: state.projectName,
    // When cuts are applied, blocks are remapped to compressed timeline.
    // We persist the ORIGINAL blocks so reloading the app brings the user back
    // to a clean state (cut state is reconstructed in-memory only on demand).
    blocks: state.audio.cutsApplied && state.audio.originalBlocks
      ? state.audio.originalBlocks
      : state.blocks,
    audio: {
      ...state.audio,
      url: null,
      // Drop transient flags + cut snapshots — these live only during a session.
      applyingCuts: false,
      cutsApplied: false,
      originalBlocks: undefined,
      originalWords: undefined,
      originalDuration: undefined,
      originalPeaks: undefined,
      // If cuts were applied, the duration/peaks/words in state reflect the cut.
      // Persist the ORIGINAL values so a reload starts clean.
      duration: state.audio.cutsApplied && state.audio.originalDuration
        ? state.audio.originalDuration
        : state.audio.duration,
      peaks: state.audio.cutsApplied && state.audio.originalPeaks
        ? state.audio.originalPeaks
        : state.audio.peaks,
      words: state.audio.cutsApplied && state.audio.originalWords
        ? state.audio.originalWords
        : state.audio.words,
    },
    selectedVoiceId: state.selectedVoiceId,
    aspect: state.aspect,
    avatarClips: state.avatarClips,
    avatarModel: state.avatarModel,
    selectedPhotoId: state.selectedPhotoId,
    takes: state.takes.map(t => ({ ...t, url: null })),
    activeTakeId: state.activeTakeId,
    lastAnalysis: state.lastAnalysis,
    analyses: state.analyses,
    emotion: state.emotion,
    voiceSpeed: state.voiceSpeed,
    savedAt: Date.now(),
  };
  await reqOf(STORE_PROJECT, 'readwrite', s => s.put(snapshot, PROJECT_KEY));
};

export const loadProject = async (): Promise<PersistedProject | null> => {
  try {
    const result = await reqOf(STORE_PROJECT, 'readonly', s => s.get(PROJECT_KEY));
    return (result as PersistedProject | undefined) ?? null;
  } catch {
    return null;
  }
};

// ─── AUDIO ────────────────────────────────────────────────────────────

// Stored as ArrayBuffer (+ MIME) instead of Blob directly. WebKit (Tauri's
// engine) has a bug where Blobs persisted across app sessions become "zombie"
// — the JS reference looks valid but the underlying data can't be read,
// causing 'WebKitBlobResource error 1' / NotFoundError when consumed by
// <audio>, <video>, or fetch. ArrayBuffers don't have this problem; we
// reconstruct a fresh Blob on load.
interface PersistedAudio {
  buffer: ArrayBuffer;
  type: string;
}

export const saveAudioBlob = async (blob: Blob): Promise<void> => {
  const buffer = await blob.arrayBuffer();
  const payload: PersistedAudio = { buffer, type: blob.type || 'audio/mpeg' };
  await reqOf(STORE_AUDIO, 'readwrite', s => s.put(payload, AUDIO_KEY));
};

export const loadAudioBlob = async (): Promise<Blob | null> => {
  try {
    const result = await reqOf(STORE_AUDIO, 'readonly', s => s.get(AUDIO_KEY));
    if (!result) return null;
    // New format: { buffer, type }
    if (typeof (result as PersistedAudio).buffer === 'object' && (result as PersistedAudio).buffer instanceof ArrayBuffer) {
      const p = result as PersistedAudio;
      return new Blob([p.buffer], { type: p.type });
    }
    // Legacy format: raw Blob (may be a zombie — try to revive by reading bytes)
    if (result instanceof Blob) {
      try {
        const buffer = await result.arrayBuffer();
        return new Blob([buffer], { type: result.type || 'audio/mpeg' });
      } catch {
        return null;
      }
    }
    return null;
  } catch {
    return null;
  }
};

export const clearAudioBlob = async (): Promise<void> => {
  await reqOf(STORE_AUDIO, 'readwrite', s => s.delete(AUDIO_KEY));
};

// Revive a stored value (new format = {buffer,type}, legacy = raw Blob) into
// a fresh, readable Blob. Returns null if the value can't be revived.
const reviveStoredBlob = async (raw: unknown, defaultMime: string): Promise<Blob | null> => {
  if (!raw) return null;
  const obj = raw as Partial<PersistedAudio>;
  if (obj && obj.buffer instanceof ArrayBuffer) {
    return new Blob([obj.buffer], { type: obj.type || defaultMime });
  }
  if (raw instanceof Blob) {
    try {
      const buffer = await raw.arrayBuffer();
      return new Blob([buffer], { type: raw.type || defaultMime });
    } catch {
      return null;
    }
  }
  return null;
};

// ─── CLIPS (per-block video Blobs) ──────────────────────────────────

export const saveClipBlob = async (blockId: string, blob: Blob): Promise<void> => {
  const buffer = await blob.arrayBuffer();
  await reqOf(STORE_CLIPS, 'readwrite', s => s.put({ buffer, type: blob.type || 'video/mp4' }, blockId));
};

export const loadClipBlob = async (blockId: string): Promise<Blob | null> => {
  try {
    const result = await reqOf(STORE_CLIPS, 'readonly', s => s.get(blockId));
    return await reviveStoredBlob(result, 'video/mp4');
  } catch {
    return null;
  }
};

export const loadAllClipBlobs = async (): Promise<Record<string, Blob>> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_CLIPS, 'readonly');
    const store = transaction.objectStore(STORE_CLIPS);
    const raws: Record<string, unknown> = {};
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        raws[String(cursor.key)] = cursor.value;
        cursor.continue();
      } else {
        // Revive each blob asynchronously, then resolve.
        const entries = Object.entries(raws);
        Promise.all(entries.map(async ([k, v]) => [k, await reviveStoredBlob(v, 'video/mp4')] as const))
          .then(pairs => {
            const result: Record<string, Blob> = {};
            for (const [k, blob] of pairs) if (blob) result[k] = blob;
            resolve(result);
          })
          .catch(reject);
      }
    };
    req.onerror = () => reject(req.error);
  });
};

export const clearAllClips = async (): Promise<void> => {
  await reqOf(STORE_CLIPS, 'readwrite', s => s.clear());
};

// ─── REMOTE CLIP DOWNLOAD ──────────────────────────────────────────
// HeyGen video URLs expire after ~7 days. We fetch the MP4 immediately and
// store the Blob locally so the project survives indefinitely.

export const downloadAndStoreClip = async (blockId: string, videoUrl: string): Promise<Blob> => {
  // Try a plain fetch first — most HeyGen output URLs allow it.
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Failed to download clip: HTTP ${res.status}`);
  const blob = await res.blob();
  await saveClipBlob(blockId, blob);
  return blob;
};

// ─── TAKES (screen recordings) ──────────────────────────────────

export const saveTakeBlob = async (takeId: string, blob: Blob): Promise<void> => {
  const buffer = await blob.arrayBuffer();
  await reqOf(STORE_TAKES, 'readwrite', s => s.put({ buffer, type: blob.type || 'video/mp4' }, takeId));
};

export const loadTakeBlob = async (takeId: string): Promise<Blob | null> => {
  try {
    const result = await reqOf(STORE_TAKES, 'readonly', s => s.get(takeId));
    return await reviveStoredBlob(result, 'video/mp4');
  } catch {
    return null;
  }
};

export const loadAllTakeBlobs = async (): Promise<Record<string, Blob>> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TAKES, 'readonly');
    const store = transaction.objectStore(STORE_TAKES);
    const raws: Record<string, unknown> = {};
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        raws[String(cursor.key)] = cursor.value;
        cursor.continue();
      } else {
        const entries = Object.entries(raws);
        Promise.all(entries.map(async ([k, v]) => [k, await reviveStoredBlob(v, 'video/mp4')] as const))
          .then(pairs => {
            const result: Record<string, Blob> = {};
            for (const [k, blob] of pairs) if (blob) result[k] = blob;
            resolve(result);
          })
          .catch(reject);
      }
    };
    req.onerror = () => reject(req.error);
  });
};

export const deleteTakeBlob = async (takeId: string): Promise<void> => {
  await reqOf(STORE_TAKES, 'readwrite', s => s.delete(takeId));
};

export const clearAllTakes = async (): Promise<void> => {
  await reqOf(STORE_TAKES, 'readwrite', s => s.clear());
};

// ─── EXPORTS (rendered MP4 history) ──────────────────────────────

export interface ExportRecord {
  id: string;
  projectName: string;
  createdAt: number;
  durationSec: number;
  aspect: '9:16' | '16:9' | '1:1';
  quality: 'high' | 'lite';
  fileSize: number;
  blob: Blob;
}

export const saveExport = async (record: ExportRecord): Promise<void> => {
  await reqOf(STORE_EXPORTS, 'readwrite', s => s.put(record, record.id));
};

export const loadAllExports = async (): Promise<ExportRecord[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_EXPORTS, 'readonly');
    const store = transaction.objectStore(STORE_EXPORTS);
    const result: ExportRecord[] = [];
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        result.push(cursor.value as ExportRecord);
        cursor.continue();
      } else {
        resolve(result.sort((a, b) => b.createdAt - a.createdAt));
      }
    };
    req.onerror = () => reject(req.error);
  });
};

export const deleteExport = async (id: string): Promise<void> => {
  await reqOf(STORE_EXPORTS, 'readwrite', s => s.delete(id));
};

export const clearAllExports = async (): Promise<void> => {
  await reqOf(STORE_EXPORTS, 'readwrite', s => s.clear());
};

// ─── HARD RESET ──────────────────────────────────────────────────

export const clearAllProjectData = async (): Promise<void> => {
  await reqOf(STORE_PROJECT, 'readwrite', s => s.delete(PROJECT_KEY));
  await clearAudioBlob();
  await clearAllClips();
  await clearAllTakes();
  await clearAllExports();
};

// ─── STORAGE ESTIMATE ─────────────────────────────────────────────

export const getStorageInfo = async (): Promise<{ used: number; quota: number } | null> => {
  if (!navigator.storage?.estimate) return null;
  try {
    const e = await navigator.storage.estimate();
    return { used: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
};
