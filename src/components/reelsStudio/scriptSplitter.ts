/**
 * Splits long script blocks at natural pauses so no single block
 * exceeds the user's configured max-seconds cap (Settings → Avançado).
 *
 * Why: Gemini Vision returns one block per source sentence. Dense
 * sentences (24+ words) become 8-10s avatar blocks that are
 * expensive on HeyGen and feel sluggish in the reel. Splitting on
 * the nearest sentence terminator (then comma as fallback) keeps the
 * cut natural and gives the editor more dynamism — short blocks
 * make room for more B-roll variety.
 *
 * Algorithm:
 *   1. Estimate block duration from word count (PT/EN at ~155 wpm).
 *   2. If under the cap → keep block as-is.
 *   3. Find the latest sentence boundary (`.!?`) at or before the cap.
 *   4. If none, fall back to the latest comma (`,;:`).
 *   5. If still nothing, split at the latest word break.
 *   6. Tail-split the remainder recursively.
 *
 * The first half keeps the block's original `kind` (usually avatar);
 * subsequent halves flip to broll, since the speaker has already
 * appeared on camera and visual variety is what the cuts are for.
 * Override with `allFlipToBroll: false` to keep all halves on the
 * original kind.
 */

export type BlockKind = 'avatar' | 'broll';

export interface SplittableBlock {
  kind: BlockKind;
  text: string;
}

export interface SplitOptions {
  /** Max duration per block in seconds. `null` = no cap. */
  maxSec: number | null;
  /** Minimum block duration. Pieces under this get merged back into a
   *  neighbour after split. Default 1.2s. */
  minSec?: number;
  /** Words per second used to estimate duration. ~2.58 = 155 wpm,
   *  the average PT-BR / EN-US conversational pace. */
  wordsPerSecond?: number;
  /** When true (default), all but the first piece flip to broll.
   *  Set false to keep every piece on the original kind. */
  flipTailToBroll?: boolean;
  /** When true, the first and last block of the reel bias toward
   *  broll. Short avatar hooks (< 4s) are kept on avatar — they
   *  read better as a direct talking-head moment. */
  brollBookends?: boolean;
}

const DEFAULT_WPS = 2.58;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function estimateDuration(text: string, wps: number): number {
  return wordCount(text) / wps;
}

/// Returns the byte index of the latest character in `chars` at or
/// before `maxChar`, or -1 if none. Used to pick a "break point" in
/// the middle of a string near a target position.
function lastIndexOfAny(text: string, chars: string, maxChar: number): number {
  let best = -1;
  for (let i = 0; i <= maxChar && i < text.length; i++) {
    if (chars.includes(text[i])) best = i;
  }
  return best;
}

/// Find the best split point near `targetSec` worth of text. Prefers
/// sentence terminators, falls back to commas, then to word breaks.
/// Returns the index AFTER the break character (so the first half
/// includes the punctuation).
function findSplitPoint(text: string, targetSec: number, wps: number): number {
  const targetWords = targetSec * wps;
  // Approximate char count for the target. Use the average word
  // length in the actual text to stay calibrated for short/long
  // languages.
  const avgCharsPerWord = text.length / Math.max(1, wordCount(text));
  const targetChar = Math.min(text.length - 1, Math.floor(targetWords * avgCharsPerWord));

  // Prefer hard sentence endings.
  const sentenceEnd = lastIndexOfAny(text, '.!?', targetChar);
  if (sentenceEnd > 0 && sentenceEnd >= text.length * 0.25) {
    return sentenceEnd + 1;
  }

  // Fallback: clause boundary.
  const clauseEnd = lastIndexOfAny(text, ',;:', targetChar);
  if (clauseEnd > 0 && clauseEnd >= text.length * 0.25) {
    return clauseEnd + 1;
  }

  // Last resort: word boundary at or before the target char.
  const wordEnd = lastIndexOfAny(text, ' ', targetChar);
  if (wordEnd > 0) return wordEnd + 1;

  // Nothing reasonable found — keep block intact.
  return -1;
}

/// Public entry point: splits a list of blocks so none exceed the
/// configured cap. Order is preserved. When `maxSec` is null, the
/// input is returned unchanged.
export function splitLongBlocks(
  blocks: SplittableBlock[],
  opts: SplitOptions,
): SplittableBlock[] {
  const maxSec = opts.maxSec;
  if (maxSec == null || maxSec <= 0) return blocks;
  const wps = opts.wordsPerSecond ?? DEFAULT_WPS;
  const minSec = opts.minSec ?? 1.5;
  const flipTail = opts.flipTailToBroll ?? true;
  const brollBookends = opts.brollBookends ?? true;

  // Step 1 — split anything over maxSec.
  const split: SplittableBlock[] = [];
  for (const block of blocks) {
    split.push(...splitOne(block, maxSec, wps, flipTail));
  }

  // Step 2 — merge pieces shorter than minSec into a neighbour. Same
  // logic as scriptResplit but using estimated duration (no audio
  // timings available at import time).
  const merged: SplittableBlock[] = [...split];
  for (let i = merged.length - 1; i >= 0; i--) {
    if (estimateDuration(merged[i].text, wps) >= minSec) continue;
    if (i === 0 && merged.length > 1) {
      merged[i + 1] = { ...merged[i + 1], text: `${merged[i].text} ${merged[i + 1].text}`.trim() };
      merged.splice(i, 1);
    } else if (i > 0) {
      merged[i - 1] = { ...merged[i - 1], text: `${merged[i - 1].text} ${merged[i].text}`.trim() };
      merged.splice(i, 1);
    }
  }

  // Step 3 — broll bookends, with a hook-tolerant escape hatch.
  if (brollBookends && merged.length > 0) {
    const HOOK_MAX_SEC = 4;
    const first = merged[0];
    if (first.kind === 'avatar' && estimateDuration(first.text, wps) >= HOOK_MAX_SEC) {
      merged[0] = { ...first, kind: 'broll' };
    }
    if (merged.length > 1) {
      const last = merged[merged.length - 1];
      if (last.kind === 'avatar' && estimateDuration(last.text, wps) >= HOOK_MAX_SEC) {
        merged[merged.length - 1] = { ...last, kind: 'broll' };
      }
    }
  }

  return merged;
}

function splitOne(
  block: SplittableBlock,
  maxSec: number,
  wps: number,
  flipTail: boolean,
): SplittableBlock[] {
  const text = block.text.trim();
  if (!text) return [block];
  if (estimateDuration(text, wps) <= maxSec) return [block];

  const cut = findSplitPoint(text, maxSec, wps);
  if (cut <= 0 || cut >= text.length) return [block];

  const first = text.slice(0, cut).trim();
  const rest = text.slice(cut).trim();
  if (!first || !rest) return [block];

  const tailKind: BlockKind = flipTail ? 'broll' : block.kind;
  const tailBlock: SplittableBlock = { kind: tailKind, text: rest };

  return [
    { kind: block.kind, text: first },
    ...splitOne(tailBlock, maxSec, wps, flipTail),
  ];
}
