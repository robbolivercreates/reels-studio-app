/**
 * Persists viral breakdown results in localStorage so users can review past
 * analyses without spending API credits again.
 *
 * Key: "reels-breakdown-history"
 * Format: BreakdownRecord[] (newest first, capped at MAX_RECORDS)
 */

import type { ViralBreakdown } from './viralBreakdownService';

export interface BreakdownRecord {
  id: string;
  /** The URL the video was downloaded from (if any). */
  url?: string;
  /** Filename on disk after download. */
  fileName: string;
  /** Human-readable title (from social stats or Gemini). */
  title: string;
  /** Platform (Instagram, TikTok, YouTube, …). */
  platform?: string;
  /** View count at analysis time. */
  view_count?: number;
  /** Virality score 0–100. */
  virality_score: number;
  /** Full breakdown result. */
  breakdown: ViralBreakdown;
  /** Unix ms timestamp of when this was analysed. */
  analyzedAt: number;
}

const KEY = 'reels-breakdown-history';
const MAX_RECORDS = 20;

const load = (): BreakdownRecord[] => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BreakdownRecord[];
  } catch {
    return [];
  }
};

const save = (records: BreakdownRecord[]): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    // localStorage full — drop oldest entries and retry
    try {
      localStorage.setItem(KEY, JSON.stringify(records.slice(0, Math.floor(MAX_RECORDS / 2))));
    } catch { /* give up */ }
  }
};

/** Save a new breakdown result. Replaces existing entry with the same fileName or URL. */
export const saveBreakdownRecord = (record: BreakdownRecord): void => {
  const records = load().filter(r =>
    r.fileName !== record.fileName && (!record.url || r.url !== record.url)
  );
  records.unshift(record);
  save(records.slice(0, MAX_RECORDS));
};

/** List all saved breakdowns, newest first. */
export const listBreakdownRecords = (): BreakdownRecord[] => load();

/** Find a record by URL or fileName. Returns null if not found. */
export const findBreakdownRecord = (urlOrFile: string): BreakdownRecord | null =>
  load().find(r => r.url === urlOrFile || r.fileName === urlOrFile) ?? null;

/** Delete a record by id. */
export const deleteBreakdownRecord = (id: string): void => {
  save(load().filter(r => r.id !== id));
};

/** Generate a stable id for a new record. */
export const newBreakdownId = (): string =>
  `bd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
