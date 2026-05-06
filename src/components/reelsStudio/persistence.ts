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
const STORE_AUDIO = 'audio';
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
    blocks: state.blocks,
    audio: { ...state.audio, url: null },
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

export const saveAudioBlob = async (blob: Blob): Promise<void> => {
  await reqOf(STORE_AUDIO, 'readwrite', s => s.put(blob, AUDIO_KEY));
};

export const loadAudioBlob = async (): Promise<Blob | null> => {
  try {
    const result = await reqOf(STORE_AUDIO, 'readonly', s => s.get(AUDIO_KEY));
    return (result as Blob | undefined) ?? null;
  } catch {
    return null;
  }
};

export const clearAudioBlob = async (): Promise<void> => {
  await reqOf(STORE_AUDIO, 'readwrite', s => s.delete(AUDIO_KEY));
};

// ─── CLIPS (per-block video Blobs) ──────────────────────────────────

export const saveClipBlob = async (blockId: string, blob: Blob): Promise<void> => {
  await reqOf(STORE_CLIPS, 'readwrite', s => s.put(blob, blockId));
};

export const loadClipBlob = async (blockId: string): Promise<Blob | null> => {
  try {
    const result = await reqOf(STORE_CLIPS, 'readonly', s => s.get(blockId));
    return (result as Blob | undefined) ?? null;
  } catch {
    return null;
  }
};

export const loadAllClipBlobs = async (): Promise<Record<string, Blob>> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_CLIPS, 'readonly');
    const store = transaction.objectStore(STORE_CLIPS);
    const result: Record<string, Blob> = {};
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        result[String(cursor.key)] = cursor.value as Blob;
        cursor.continue();
      } else {
        resolve(result);
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
  await reqOf(STORE_TAKES, 'readwrite', s => s.put(blob, takeId));
};

export const loadTakeBlob = async (takeId: string): Promise<Blob | null> => {
  try {
    const result = await reqOf(STORE_TAKES, 'readonly', s => s.get(takeId));
    return (result as Blob | undefined) ?? null;
  } catch {
    return null;
  }
};

export const loadAllTakeBlobs = async (): Promise<Record<string, Blob>> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_TAKES, 'readonly');
    const store = transaction.objectStore(STORE_TAKES);
    const result: Record<string, Blob> = {};
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        result[String(cursor.key)] = cursor.value as Blob;
        cursor.continue();
      } else {
        resolve(result);
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
