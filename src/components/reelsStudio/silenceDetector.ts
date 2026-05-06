/**
 * Silence detection from a video/audio Blob.
 *
 * Uses Web Audio API to decode the audio track and compute RMS energy in
 * fixed-size windows. Stretches of low-RMS windows longer than `minSilenceMs`
 * become silence segments (with a small "breath" buffer kept on each side).
 *
 * Returns segments to KEEP (i.e. non-silent regions). The video plays the
 * concatenation of these ranges.
 *
 * NOTE: this is a "good enough for 80%" implementation — pure RMS threshold.
 * The standalone Tauri build will swap this for Whisper VAD for studio quality.
 */

export interface KeepSegment {
  start: number; // seconds
  end: number;   // seconds
}

export interface DetectionOptions {
  minSilenceMs: number;       // silence shorter than this is preserved
  thresholdDb: number;        // RMS dBFS threshold under which we call it silent
  breathMs: number;           // padding kept on each side of speech
  windowMs: number;           // analysis window size
}

export const DEFAULT_DETECTION: DetectionOptions = {
  minSilenceMs: 500,
  thresholdDb: -25,   // RELATIVE to the peak of this audio (loudness-normalized TTS friendly)
  breathMs: 100,
  windowMs: 30,
};

export type AudioSilencePreset = 'natural' | 'fast' | 'super';

// thresholdDb here is RELATIVE to the audio's own peak — works on normalized TTS output
// where absolute -38dB never gets crossed because everything's lifted to -18 LUFS.
export const PRESET_OPTIONS: Record<AudioSilencePreset, DetectionOptions> = {
  natural: { minSilenceMs: 800, thresholdDb: -28, breathMs: 120, windowMs: 30 },
  fast:    { minSilenceMs: 400, thresholdDb: -25, breathMs: 100, windowMs: 30 },
  super:   { minSilenceMs: 200, thresholdDb: -20, breathMs: 60,  windowMs: 25 },
};

export interface DetectionResult {
  duration: number;
  totalSilent: number;
  keep: KeepSegment[];
  /** All detected silent ranges before merging — useful for debugging UIs. */
  silentRaw: KeepSegment[];
}

const dbToLinear = (db: number) => Math.pow(10, db / 20);

const decodeBlobToAudioBuffer = async (blob: Blob): Promise<AudioBuffer> => {
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

const computeRmsWindows = (channel: Float32Array, sampleRate: number, windowMs: number): { rms: Float32Array; samplesPerWindow: number } => {
  const samplesPerWindow = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
  const numWindows = Math.floor(channel.length / samplesPerWindow);
  const rms = new Float32Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    let sum = 0;
    const start = w * samplesPerWindow;
    const end = start + samplesPerWindow;
    for (let i = start; i < end; i++) {
      const s = channel[i];
      sum += s * s;
    }
    rms[w] = Math.sqrt(sum / samplesPerWindow);
  }
  return { rms, samplesPerWindow };
};

export const detectKeepSegments = async (blob: Blob, opts: DetectionOptions = DEFAULT_DETECTION): Promise<DetectionResult> => {
  let buffer: AudioBuffer;
  try {
    buffer = await decodeBlobToAudioBuffer(blob);
  } catch (err) {
    console.warn('[reels/silence] decode failed, treating whole take as keep:', err);
    return { duration: 0, totalSilent: 0, keep: [{ start: 0, end: Number.POSITIVE_INFINITY }], silentRaw: [] };
  }

  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const duration = buffer.duration;

  // Sweep through the whole audio to find the actual peak amplitude — we use this
  // as the reference for a RELATIVE threshold (works on normalized TTS output).
  let peak = 0;
  for (let i = 0; i < channel.length; i++) {
    const v = Math.abs(channel[i]);
    if (v > peak) peak = v;
  }
  if (peak < 0.001) {
    // Effectively silent track — nothing to cut.
    return { duration, totalSilent: 0, keep: [{ start: 0, end: duration }], silentRaw: [] };
  }

  const { rms } = computeRmsWindows(channel, sampleRate, opts.windowMs);

  // Compute RMS of the whole signal too, for log/diagnostics.
  let rmsSum = 0;
  let rmsMax = 0;
  for (let i = 0; i < rms.length; i++) {
    rmsSum += rms[i];
    if (rms[i] > rmsMax) rmsMax = rms[i];
  }
  const rmsAvg = rmsSum / Math.max(1, rms.length);

  // Threshold is now RELATIVE to the loudest RMS window in the audio.
  // For -25dB → 0.0562× of the max RMS.
  const threshold = rmsMax * dbToLinear(opts.thresholdDb);
  const windowSec = opts.windowMs / 1000;
  const minSilenceWindows = Math.ceil(opts.minSilenceMs / opts.windowMs);

  console.log('[reels/silence] analysis:', {
    duration: duration.toFixed(2),
    peak: (20 * Math.log10(peak)).toFixed(1) + 'dBFS',
    rmsMax: (20 * Math.log10(rmsMax || 1e-6)).toFixed(1) + 'dBFS',
    rmsAvg: (20 * Math.log10(rmsAvg || 1e-6)).toFixed(1) + 'dBFS',
    thresholdRelativeDb: opts.thresholdDb,
    thresholdAbsoluteDbfs: (20 * Math.log10(threshold || 1e-6)).toFixed(1) + 'dBFS',
    minSilenceMs: opts.minSilenceMs,
  });

  // Pass 1: find continuous silent runs.
  const silentRaw: KeepSegment[] = [];
  let runStart: number | null = null;
  for (let w = 0; w < rms.length; w++) {
    const isSilent = rms[w] < threshold;
    if (isSilent && runStart === null) runStart = w;
    if (!isSilent && runStart !== null) {
      const runLen = w - runStart;
      if (runLen >= minSilenceWindows) {
        silentRaw.push({ start: runStart * windowSec, end: w * windowSec });
      }
      runStart = null;
    }
  }
  if (runStart !== null) {
    const runLen = rms.length - runStart;
    if (runLen >= minSilenceWindows) {
      silentRaw.push({ start: runStart * windowSec, end: rms.length * windowSec });
    }
  }

  // Pass 2: invert into "keep" segments and apply breath padding.
  const breath = opts.breathMs / 1000;
  const keep: KeepSegment[] = [];
  let cursor = 0;
  for (const sil of silentRaw) {
    // Trim breath off both sides of the silence (effectively padding speech).
    const cutStart = Math.min(duration, sil.start + breath);
    const cutEnd = Math.max(0, sil.end - breath);
    if (cutEnd <= cutStart) continue;
    if (cutStart > cursor) keep.push({ start: cursor, end: cutStart });
    cursor = cutEnd;
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration });

  // Merge tiny adjacent keep segments separated by < 80ms — avoids choppy cuts.
  const merged: KeepSegment[] = [];
  for (const seg of keep) {
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end < 0.08) {
      last.end = seg.end;
    } else {
      merged.push({ ...seg });
    }
  }

  const totalSilent = duration - merged.reduce((s, k) => s + (k.end - k.start), 0);
  return { duration, totalSilent, keep: merged, silentRaw };
};

/** Total duration after applying trim + (optional) silence cuts. */
export const computeEffectiveDuration = (
  durationSec: number,
  trimStart: number,
  trimEnd: number,
  cutSilence: boolean,
  silenceTotalSec: number,
): number => {
  const trimmed = Math.max(0, trimEnd - trimStart);
  if (!cutSilence) return trimmed;
  return Math.max(0, trimmed - silenceTotalSec);
};
