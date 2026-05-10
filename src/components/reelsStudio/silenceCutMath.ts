/**
 * Math utilities for the "Recut-style" silence cut feature.
 *
 * Two responsibilities:
 *  1. Filter the raw keep segments by the hybrid lipsync rule:
 *     - Cuts shorter than 250ms are kept everywhere (lipsync forgives <250ms).
 *     - Cuts ≥ 250ms inside a `ready` avatar block are PRESERVED (= we put
 *       that silence back into the keep list so it's not removed).
 *     This keeps avatar lipsync intact while still letting us aggressively
 *     trim pauses between blocks and inside b-roll.
 *
 *  2. Remap block timestamps to the new (compressed) timeline.
 *     Each block's start/end gets reduced by the total silence duration
 *     that fell BEFORE it (in source time).
 *
 * Both keep-segment input and block timestamps are in seconds in source-time
 * (i.e. positions in the original Minimax MP3). Output is in the new
 * compressed timeline.
 */

import type { ScriptBlock, AvatarClipState } from './types';

/** A continuous range of audio that survives the cut. */
export interface KeepRange {
  start: number;
  end: number;
}

const LIPSYNC_TOLERANCE_SEC = 0.25;

/**
 * Hybrid filter: given the raw keep segments produced by the silence detector
 * and the current blocks/clips, return a NEW set of keep segments that
 * preserves any silence ≥ 250ms that falls inside a `ready` avatar clip.
 *
 * In other words: we ADD silence back to the keep list to protect lipsync.
 *
 * Inputs:
 *   - rawKeep: keep segments from silenceDetector (only voiced regions)
 *   - sourceDuration: total duration of the source audio
 *   - blocks: ordered list of script blocks (start/end in source seconds)
 *   - clipsByBlockId: avatar clips state (we only care about `ready` ones)
 */
export const applyLipsyncRule = (
  rawKeep: KeepRange[],
  sourceDuration: number,
  blocks: ScriptBlock[],
  _clipsByBlockId: Record<string, AvatarClipState>,
): KeepRange[] => {
  if (rawKeep.length === 0) return [{ start: 0, end: sourceDuration }];

  // Reconstruct the silence ranges (gaps between rawKeep + leading/trailing).
  const silences: KeepRange[] = [];
  let cursor = 0;
  for (const k of rawKeep) {
    if (k.start > cursor) silences.push({ start: cursor, end: k.start });
    cursor = k.end;
  }
  if (cursor < sourceDuration) silences.push({ start: cursor, end: sourceDuration });

  // Build the protected ranges: source-time ranges of ALL avatar blocks.
  // We protect regardless of clip status — the clip may not exist yet when
  // silence cut is applied, but the avatar will be generated after, and
  // HeyGen's lipsync model needs the natural speech rhythm (including pauses)
  // to stay intact. Cutting silences inside avatar blocks before clip generation
  // causes mouth misalignment because the model trained on uncut natural audio.
  const protectedRanges: { start: number; end: number }[] = [];
  for (const b of blocks) {
    if (b.kind !== 'avatar') continue;
    protectedRanges.push({ start: b.start, end: b.end });
  }

  const overlapsProtected = (sil: KeepRange): boolean => {
    for (const p of protectedRanges) {
      if (sil.end > p.start && sil.start < p.end) return true;
    }
    return false;
  };

  // Silences we want to PRESERVE (not cut):
  //   - longer than tolerance AND inside a protected (lipsynced) range
  // Short silences (<250ms) are always cut, even inside avatar clips —
  // lipsync forgives that.
  const preserved: KeepRange[] = silences.filter(s =>
    (s.end - s.start) >= LIPSYNC_TOLERANCE_SEC && overlapsProtected(s),
  );

  if (preserved.length === 0) return rawKeep;

  // Merge the original keep segments + the preserved silences, then collapse
  // overlapping/adjacent ranges into a single sorted list.
  const merged = [...rawKeep, ...preserved].sort((a, b) => a.start - b.start);
  const out: KeepRange[] = [];
  for (const r of merged) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 0.001) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push({ ...r });
    }
  }
  return out;
};

/**
 * Map a source-time second to its position in the compressed timeline,
 * given the keep segments. Times that fall inside a silence (= outside any
 * keep range) snap to the boundary of the nearest keep range.
 */
export const sourceToCompressed = (sec: number, keepSegments: KeepRange[]): number => {
  let acc = 0;
  for (const k of keepSegments) {
    if (sec <= k.start) {
      // Falls in (or before) a silence — snap to start of this keep range.
      return acc;
    }
    if (sec < k.end) {
      return acc + (sec - k.start);
    }
    acc += k.end - k.start;
  }
  return acc;
};

/**
 * Compute the total duration after applying the keep segments.
 */
export const compressedDuration = (keepSegments: KeepRange[]): number =>
  keepSegments.reduce((s, k) => s + (k.end - k.start), 0);

/**
 * Remap each block's start/end into the compressed timeline. Empty blocks
 * (start === end after compression) are kept (still represent intent), they
 * just have zero on-screen duration. Caller should still keep them in state.
 */
export const remapBlocks = (blocks: ScriptBlock[], keepSegments: KeepRange[]): ScriptBlock[] => {
  return blocks.map(b => ({
    ...b,
    start: sourceToCompressed(b.start, keepSegments),
    end: sourceToCompressed(b.end, keepSegments),
    // avatarVisibleSec is in block-relative time, so it stays valid
    // proportionally as long as we recalc against the new (block.end - block.start).
    avatarVisibleSec: b.avatarVisibleSec !== undefined
      ? Math.min(b.avatarVisibleSec, sourceToCompressed(b.end, keepSegments) - sourceToCompressed(b.start, keepSegments))
      : undefined,
  }));
};

/**
 * Remap word timestamps the same way as blocks.
 */
export const remapWords = <T extends { start: number; end: number }>(
  words: T[],
  keepSegments: KeepRange[],
): T[] => words.map(w => ({
  ...w,
  start: sourceToCompressed(w.start, keepSegments),
  end: sourceToCompressed(w.end, keepSegments),
}));
