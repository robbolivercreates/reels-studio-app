import { generateSpeech, DEFAULT_VOICE_SETTINGS, type MinimaxEmotion, type TtsLanguage } from '../../services/minimaxService';
import type { ScriptBlock, WordTimestamp, ReelEmotion } from './types';
import { WAVEFORM_BUCKETS } from './types';

export interface AudioGenerationResult {
  url: string;
  blob: Blob;
  duration: number;
  peaks: number[];
  words: WordTimestamp[];
}

const tokenize = (text: string): string[] => {
  return text
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}'-]/gu, ''))
    .filter(Boolean);
};

const decodeBlob = async (blob: Blob): Promise<AudioBuffer> => {
  const AC: typeof AudioContext =
    (window.AudioContext as typeof AudioContext | undefined) ??
    ((window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new AC();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    if (ctx.state !== 'closed') ctx.close().catch(() => {});
  }
};

export const computePeaks = (buffer: AudioBuffer, buckets = WAVEFORM_BUCKETS): number[] => {
  const channel = buffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.floor(channel.length / buckets));
  const peaks: number[] = new Array(buckets);
  let max = 0.0001;
  for (let b = 0; b < buckets; b++) {
    const startIdx = b * samplesPerBucket;
    const endIdx = b === buckets - 1 ? channel.length : startIdx + samplesPerBucket;
    let peak = 0;
    for (let i = startIdx; i < endIdx; i++) {
      const v = Math.abs(channel[i]);
      if (v > peak) peak = v;
    }
    peaks[b] = peak;
    if (peak > max) max = peak;
  }
  return peaks.map(p => p / max);
};

const buildWordTimestamps = (blocks: ScriptBlock[], totalDuration: number): WordTimestamp[] => {
  const blockTokens = blocks.map(b => ({ block: b, words: tokenize(b.text) }));
  const totalWords = blockTokens.reduce((sum, b) => sum + b.words.length, 0);
  if (totalWords === 0) return [];

  const perWordDuration = totalDuration / totalWords;
  const result: WordTimestamp[] = [];
  let cursor = 0;
  for (const { block, words } of blockTokens) {
    for (const word of words) {
      const start = cursor;
      const end = cursor + perWordDuration;
      result.push({ word, start, end, blockId: block.id });
      cursor = end;
    }
  }
  return result;
};

export const recomputeBlockTimings = (
  blocks: ScriptBlock[],
  words: WordTimestamp[],
  totalDuration: number,
): ScriptBlock[] => {
  return blocks.map(b => {
    const blockWords = words.filter(w => w.blockId === b.id);
    if (blockWords.length === 0) {
      return { ...b, start: b.start, end: b.end, dirty: false };
    }
    return {
      ...b,
      start: blockWords[0].start,
      end: blockWords[blockWords.length - 1].end,
      dirty: false,
    };
  }).map((b, idx, arr) => {
    // Bridge tiny gaps so the timeline appears continuous up to totalDuration.
    if (idx === arr.length - 1) return { ...b, end: totalDuration };
    return { ...b, end: arr[idx + 1].start };
  });
};

export interface AudioGenerationOptions {
  /** Minimax language_boost. Defaults to 'auto' (let Minimax detect from text). */
  language?: TtsLanguage;
  emotion?: ReelEmotion;
  speed?: number; // 0.85..1.2
}

export const generateProjectAudio = async (
  blocks: ScriptBlock[],
  voiceId: string,
  options: AudioGenerationOptions = {},
): Promise<AudioGenerationResult> => {
  const fullText = blocks.map(b => b.text.trim()).filter(Boolean).join(' ');
  if (!fullText) throw new Error('Script vazio.');

  const language: TtsLanguage = options.language ?? 'auto';
  const emotion: MinimaxEmotion = options.emotion ?? 'neutral';
  const speed = Math.max(0.85, Math.min(1.2, options.speed ?? 1.0));

  const settings = {
    ...DEFAULT_VOICE_SETTINGS,
    speed,
    emotion,
  };

  const blob = await generateSpeech(fullText, voiceId, settings, language);
  const url = URL.createObjectURL(blob);
  const buffer = await decodeBlob(blob);
  const duration = buffer.duration;
  const peaks = computePeaks(buffer);
  const words = buildWordTimestamps(blocks, duration);
  return { url, blob, duration, peaks, words };
};

export const estimateScriptDuration = (blocks: ScriptBlock[]): number => {
  // Rough heuristic: 2.5 words per second (Brazilian Portuguese conversational pace).
  const words = blocks.reduce((sum, b) => sum + tokenize(b.text).length, 0);
  return words / 2.5;
};
