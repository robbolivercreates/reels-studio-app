/**
 * Whisper transcript → Reels Studio blocks + word timestamps.
 *
 * The Rust `transcribe_whisper` command returns the raw openai-whisper JSON
 * (word_timestamps=True). This module turns it into the app's own
 * `WordTimestamp[]` + `ScriptBlock[]` so the "Editar vídeo pronto" mode reuses
 * the exact same downstream pipeline (timeline, silence cut, export) that the
 * generative TTS flow uses.
 *
 * Blocks are segmented from REAL word timing (not the uniform distribution
 * `audioEngine.buildWordTimestamps` does for TTS): a new block starts on a
 * pause ≥ `silenceGapSec`, a sentence-ending punctuation, or when a block hits
 * the size caps. Each block is a time-anchor over the base video — it carries
 * no avatar/TTS, just the words spoken in that range.
 */

import type { ScriptBlock, WordTimestamp } from './types';

const uid = () => `b_${Math.random().toString(36).slice(2, 9)}`;

/** Shape of one word inside the openai-whisper JSON (word_timestamps=True). */
interface WhisperWord {
  word?: string;
  start?: number;
  end?: number;
}
interface WhisperSegment {
  start?: number;
  end?: number;
  text?: string;
  words?: WhisperWord[];
}
interface WhisperJson {
  text?: string;
  language?: string;
  segments?: WhisperSegment[];
}

export interface RawWord {
  word: string;
  start: number;
  end: number;
}

export interface SegmentOptions {
  /** A pause ≥ this (seconds) between consecutive words starts a new block. */
  silenceGapSec?: number;
  /** Hard cap on a block's duration before forcing a split. */
  maxBlockSec?: number;
  /** Hard cap on words per block before forcing a split. */
  maxWordsPerBlock?: number;
}

const DEFAULTS: Required<SegmentOptions> = {
  silenceGapSec: 0.6,
  maxBlockSec: 8,
  maxWordsPerBlock: 40,
};

const SENTENCE_END = /[.!?…]["')\]]?$/;

/** Flatten the whisper JSON into a clean, ordered list of timed words. */
export const whisperJsonToWords = (json: string | WhisperJson): RawWord[] => {
  let parsed: WhisperJson;
  if (typeof json === 'string') {
    try {
      parsed = JSON.parse(json) as WhisperJson;
    } catch {
      const match = json.match(/\{[\s\S]*\}/);
      if (!match) return [];
      parsed = JSON.parse(match[0]) as WhisperJson;
    }
  } else {
    parsed = json;
  }

  const out: RawWord[] = [];
  for (const seg of parsed.segments ?? []) {
    for (const w of seg.words ?? []) {
      const text = (w.word ?? '').trim();
      if (!text) continue;
      const start = typeof w.start === 'number' ? w.start : undefined;
      const end = typeof w.end === 'number' ? w.end : undefined;
      if (start === undefined || end === undefined) continue;
      out.push({ word: text, start, end: Math.max(end, start) });
    }
  }
  // Some whisper builds omit word arrays on a segment — fall back to
  // segment-level timing so we never silently drop spoken content.
  if (out.length === 0) {
    for (const seg of parsed.segments ?? []) {
      const text = (seg.text ?? '').trim();
      if (!text || typeof seg.start !== 'number' || typeof seg.end !== 'number') continue;
      out.push({ word: text, start: seg.start, end: Math.max(seg.end, seg.start) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
};

/**
 * Group timed words into blocks + emit per-word timestamps keyed by blockId.
 * Returns the same `{ blocks, words }` pair the reducer's audio path expects.
 */
export const segmentWordsIntoBlocks = (
  words: RawWord[],
  opts: SegmentOptions = {},
): { blocks: ScriptBlock[]; words: WordTimestamp[] } => {
  const { silenceGapSec, maxBlockSec, maxWordsPerBlock } = { ...DEFAULTS, ...opts };
  if (words.length === 0) return { blocks: [], words: [] };

  const blocks: ScriptBlock[] = [];
  const outWords: WordTimestamp[] = [];

  let curId = uid();
  let curStart = words[0].start;
  let curWords: RawWord[] = [];

  const flush = (endTime: number) => {
    if (curWords.length === 0) return;
    blocks.push({
      id: curId,
      kind: 'broll',
      text: curWords.map(w => w.word).join(' ').replace(/\s+([,.!?…;:])/g, '$1').trim(),
      start: curStart,
      end: endTime,
    });
    for (const w of curWords) {
      outWords.push({ word: w.word, start: w.start, end: w.end, blockId: curId });
    }
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (curWords.length === 0) {
      curStart = w.start;
    }
    curWords.push(w);

    const prevEnd = w.end;
    const next = words[i + 1];
    const gapToNext = next ? next.start - prevEnd : Infinity;
    const blockDur = prevEnd - curStart;
    const hitGap = gapToNext >= silenceGapSec;
    const hitSentence = SENTENCE_END.test(w.word) && blockDur >= 1.0;
    const hitCap = blockDur >= maxBlockSec || curWords.length >= maxWordsPerBlock;

    if (!next || hitGap || hitSentence || hitCap) {
      flush(prevEnd);
      curId = uid();
      curWords = [];
    }
  }

  return { blocks, words: outWords };
};

/** One-shot: raw whisper JSON → blocks + words. */
export const importWhisperTranscript = (
  json: string,
  opts?: SegmentOptions,
): { blocks: ScriptBlock[]; words: WordTimestamp[] } =>
  segmentWordsIntoBlocks(whisperJsonToWords(json), opts);
