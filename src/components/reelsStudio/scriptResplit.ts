/**
 * Splits already-generated blocks (with `start`/`end` and audio word
 * timestamps) into smaller blocks at natural pauses, preserving the
 * audio. Used by the "Quebrar blocos longos" action in the Script
 * menu — different from `scriptSplitter.ts` (which works on text-only
 * blocks at import time).
 *
 * Key difference vs the import-time splitter:
 *   - Reads exact word timings from `state.audio.words`, so each new
 *     block lands on a real word boundary in the audio (no estimation).
 *   - Preserves `start`/`end` so the audio file doesn't have to be
 *     re-generated — HeyGen later slices the same audio at the new
 *     ranges.
 *
 * The first piece keeps the original block's kind; subsequent pieces
 * flip to broll for visual variety (matches the import-time rule).
 */

import type { ScriptBlock, WordTimestamp } from './types';

export interface ResplitOptions {
  /** Max duration per block in seconds. Blocks at/under this aren't
   *  touched. */
  maxSec: number;
  /** Pieces shorter than this get merged back into a neighbour. Avoids
   *  micro-blocks (0.3s slivers) that the split algorithm can produce
   *  when punctuation sits very near a previous break point. */
  minSec?: number;
  /** When true (default), pieces after the first flip to broll. */
  flipTailToBroll?: boolean;
  /** When true, the first and last block of the reel are forced to
   *  broll — unless they're a short avatar hook/CTA (< 4s), which
   *  works better as on-camera speech. */
  brollBookends?: boolean;
}

export interface ResplitResult {
  blocks: ScriptBlock[];
  /** Block ids that no longer exist (split into pieces). The caller
   *  should clear any clips/motion keyed by these ids. */
  removedIds: string[];
  /** Mapping from the original block id (now removed) to the id of
   *  the HEAD piece in the split — i.e. the piece that still starts
   *  at the original block's `start`. The caller can use this to
   *  migrate avatar clips, motions, etc. from the old id to the new
   *  head id (rather than dropping them entirely). */
  oldIdToHeadId: Record<string, string>;
  /** True when at least one block was split. */
  changed: boolean;
}

/// Try to find a natural break inside `words` such that the time at
/// the break is as close to `target` (relative to block start) as
/// possible, but never exceeds `target`. Prefers punctuation at word
/// end. Returns the index of the LAST word in the first piece (so
/// `words.slice(0, idx + 1)` is the first piece).
function findBreakIndex(words: WordTimestamp[], blockStart: number, target: number): number {
  // Compute the relative time at the end of each word.
  // Walk from the back so we pick the latest viable break point.
  let lastViable = -1;
  for (let i = 0; i < words.length; i++) {
    const relEnd = words[i].end - blockStart;
    if (relEnd > target) break;
    lastViable = i;
    // Prefer ending on punctuation — capture and prefer this index.
    const last = words[i].word.at(-1) ?? '';
    if ('.!?,;:'.includes(last)) {
      // Found a clause/sentence end at or before target — use it.
      // Keep scanning to find a LATER one still within target.
    }
  }
  if (lastViable < 0) return -1;

  // Walk back from lastViable looking for the closest punctuation
  // boundary. If we find one, prefer it over an arbitrary word break.
  for (let i = lastViable; i >= Math.floor(words.length * 0.25); i--) {
    const last = words[i].word.at(-1) ?? '';
    if ('.!?'.includes(last)) return i;
  }
  for (let i = lastViable; i >= Math.floor(words.length * 0.25); i--) {
    const last = words[i].word.at(-1) ?? '';
    if (',;:'.includes(last)) return i;
  }
  // Fall back to the last viable plain word.
  return lastViable;
}

function mintId(): string {
  return `b_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/// Recursively split a single block until every piece fits within
/// `maxSec`. Returns the new blocks (always at least 1).
function splitOneBlock(
  block: ScriptBlock,
  words: WordTimestamp[],
  maxSec: number,
  flipTail: boolean,
): ScriptBlock[] {
  const duration = block.end - block.start;
  if (duration <= maxSec) return [block];
  // No word timestamps for this block (rare — audio not generated for
  // this block). Don't touch it; safer than splitting blindly.
  if (words.length === 0) return [block];

  const breakIdx = findBreakIndex(words, block.start, maxSec);
  // No viable break — leave intact.
  if (breakIdx < 0 || breakIdx >= words.length - 1) return [block];

  const firstWords = words.slice(0, breakIdx + 1);
  const restWords = words.slice(breakIdx + 1);
  if (firstWords.length === 0 || restWords.length === 0) return [block];

  const firstText = firstWords.map(w => w.word).join(' ');
  const restText = restWords.map(w => w.word).join(' ');
  const cutAt = firstWords[firstWords.length - 1].end;

  const head: ScriptBlock = {
    ...block,
    id: mintId(),
    text: firstText,
    start: block.start,
    end: cutAt,
    // Default avatar blocks to avatar-top so the broll piece visible
    // beside them gets framed naturally below. User can still
    // override per block.
    layout: block.kind === 'avatar' ? (block.layout ?? 'avatar-top') : block.layout,
  };
  const tail: ScriptBlock = {
    id: mintId(),
    kind: flipTail ? 'broll' : block.kind,
    text: restText,
    start: cutAt,
    end: block.end,
    // Tail doesn't inherit motion / attached assets / avatarVisibleSec —
    // those were sized for the original duration and would be wrong
    // for the truncated piece. User can re-add per piece if wanted.
  };

  return [head, ...splitOneBlock(tail, restWords, maxSec, flipTail)];
}

export function resplitBlocksByDuration(
  blocks: ScriptBlock[],
  words: WordTimestamp[],
  opts: ResplitOptions,
): ResplitResult {
  if (opts.maxSec <= 0 || blocks.length === 0) {
    return { blocks, removedIds: [], oldIdToHeadId: {}, changed: false };
  }
  const flipTail = opts.flipTailToBroll ?? true;
  const minSec = opts.minSec ?? 1.5;
  const brollBookends = opts.brollBookends ?? true;
  const out: ScriptBlock[] = [];
  const removedIds: string[] = [];
  const oldIdToHeadId: Record<string, string> = {};

  // Step 1 — split anything over maxSec.
  for (const block of blocks) {
    const blockWords = words.filter(w => w.blockId === block.id);
    const pieces = splitOneBlock(block, blockWords, opts.maxSec, flipTail);
    if (pieces.length > 1) {
      removedIds.push(block.id);
      // The first piece always covers the start of the original block,
      // so it's the safe migration target for the clip/motion.
      oldIdToHeadId[block.id] = pieces[0].id;
    }
    out.push(...pieces);
  }

  // Step 2 — merge pieces shorter than minSec into a neighbour. The
  // split can leave tiny slivers (0.3s "Sim.") when a sentence ends
  // right after the target cut point. We fold those into the previous
  // block to keep the timeline readable.
  for (let i = out.length - 1; i >= 0; i--) {
    const dur = out[i].end - out[i].start;
    if (dur >= minSec) continue;
    if (i === 0 && out.length > 1) {
      // First block too short — merge it INTO the next one.
      const next = out[i + 1];
      out[i + 1] = {
        ...next,
        text: `${out[i].text} ${next.text}`.trim(),
        start: out[i].start,
      };
      out.splice(i, 1);
    } else if (i > 0) {
      // Otherwise merge into the previous block.
      const prev = out[i - 1];
      out[i - 1] = {
        ...prev,
        text: `${prev.text} ${out[i].text}`.trim(),
        end: out[i].end,
      };
      out.splice(i, 1);
    }
  }

  // Step 3 — broll bookends. The first and last block bias toward
  // broll because the eye expects visual variety at reel openings
  // and closings. Exception: short avatar hooks/CTAs (under 4s) stay
  // avatar — they read better as a direct talking-head moment.
  if (brollBookends && out.length > 0) {
    const HOOK_MAX_SEC = 4;
    const first = out[0];
    if (first.kind === 'avatar' && first.end - first.start >= HOOK_MAX_SEC) {
      out[0] = { ...first, kind: 'broll' };
    }
    if (out.length > 1) {
      const last = out[out.length - 1];
      if (last.kind === 'avatar' && last.end - last.start >= HOOK_MAX_SEC) {
        out[out.length - 1] = { ...last, kind: 'broll' };
      }
    }
  }

  // `changed` reflects *any* mutation, not just splits — merges and
  // bookend kind flips also count, so the UI doesn't say "nada pra
  // quebrar" when those happened.
  const changed =
    removedIds.length > 0 ||
    out.length !== blocks.length ||
    blocks.some((b, i) => {
      const o = out[i];
      return !o || o.id !== b.id || o.kind !== b.kind;
    });
  return { blocks: out, removedIds, oldIdToHeadId, changed };
}

/// Re-tags words with the new blockIds so the audio engine can still
/// answer "which block is this word in?" after a resplit.
export function remapWordsToBlocks(
  words: WordTimestamp[],
  newBlocks: ScriptBlock[],
): WordTimestamp[] {
  return words.map(w => {
    // Find the block whose [start, end] contains this word's start.
    const hit = newBlocks.find(b => w.start >= b.start && w.start < b.end);
    if (hit) return { ...w, blockId: hit.id };
    // Edge case: word at the very end — match the last block.
    if (newBlocks.length > 0 && w.start >= newBlocks[newBlocks.length - 1].end - 0.01) {
      return { ...w, blockId: newBlocks[newBlocks.length - 1].id };
    }
    return w;
  });
}
