/**
 * Cache for "import_from_video_url" results.
 *
 * Without this, every "importa esse reel <URL>" round-trip in the chat
 * re-runs yt-dlp + Gemini Vision (~30–50 s total, plus tokens). The video
 * file itself is already cached on disk by the Rust side (References/),
 * but the analysis isn't — so we persist {blocks, language, tone} keyed
 * by the canonical URL + voice profile (because blocks depend on the
 * injected profile, so cache must invalidate when profile changes).
 *
 * Keep this in its own IndexedDB instance — the reducer's DB
 * (`reels_studio_v1`) is bumped on schema changes and we don't want that
 * to wipe the cache, nor we want our schema to force a reducer migration.
 */

import type { ScriptBlock } from '../reelsStudio/types';

const DB_NAME = 'reels_agent_cache_v1';
const DB_VERSION = 1;
const STORE = 'reel_analysis';

export interface ReelAnalysisCacheEntry {
  /** Canonical URL used as cache key. */
  sourceUrl: string;
  /** Voice profile id at the time of analysis (entry is invalid for other profiles). */
  profileId: string | null;
  /** Profile's last-updated timestamp — invalidates entry when the user edits the profile. */
  profileUpdatedAt: number;
  blocks: ScriptBlock[];
  language?: string;
  tone?: string[];
  analyzedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
};

const cacheKey = (sourceUrl: string, profileId: string | null, profileUpdatedAt: number): string =>
  `${sourceUrl}|${profileId ?? 'none'}|${profileUpdatedAt}`;

/// Strip ephemeral query params and trailing slashes so equivalent URLs
/// share a cache row. Instagram reels usually arrive with ?igsh=… or
/// ?utm_*, which would otherwise mint a fresh cache row every paste.
export function normalizeReelUrl(url: string): string {
  try {
    const u = new URL(url);
    // Drop tracking/share params. We keep nothing — the path alone is
    // canonical for reels/posts/articles.
    u.search = '';
    u.hash = '';
    // Normalise trailing slash so /reel/X and /reel/X/ collide.
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    return `${u.origin}${pathname}`;
  } catch {
    return url.trim();
  }
}

export async function getCachedAnalysis(
  sourceUrl: string,
  profileId: string | null,
  profileUpdatedAt: number,
): Promise<ReelAnalysisCacheEntry | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(cacheKey(sourceUrl, profileId, profileUpdatedAt));
      req.onsuccess = () => resolve((req.result as ReelAnalysisCacheEntry | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('[reelAnalysisCache] read failed', e);
    return null;
  }
}

export async function putCachedAnalysis(entry: ReelAnalysisCacheEntry): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry, cacheKey(entry.sourceUrl, entry.profileId, entry.profileUpdatedAt));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[reelAnalysisCache] write failed', e);
  }
}

export async function clearReelAnalysisCache(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
