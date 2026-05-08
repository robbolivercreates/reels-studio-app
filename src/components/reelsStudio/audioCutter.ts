/**
 * Re-encode an MP3 keeping only the requested time ranges.
 *
 * Runs on the main thread because the Tauri WebView's Web Workers don't
 * reliably expose AudioContext / OfflineAudioContext in worker scope. The
 * encoding takes ~600ms for a 40-second reel which is short enough that we
 * accept the brief UI stall. If this becomes a problem we can revisit
 * worker-based encoding later.
 *
 * Input ranges are *in source-time*. They must be sorted, non-overlapping,
 * and inside [0, sourceDuration]. We do not validate — caller is `keepSegments`
 * from the silence detector, which already satisfies these.
 */

import lamejs from '@breezystack/lamejs';
import { WAVEFORM_BUCKETS } from './types';

interface CutAudioResult {
  blob: Blob;
  duration: number;
  peaks: number[];
}

const computePeaksFromMono = (samples: Float32Array, buckets: number): number[] => {
  const samplesPerBucket = Math.max(1, Math.floor(samples.length / buckets));
  const peaks: number[] = new Array(buckets);
  let max = 0.0001;
  for (let b = 0; b < buckets; b++) {
    const start = b * samplesPerBucket;
    const end = b === buckets - 1 ? samples.length : start + samplesPerBucket;
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    peaks[b] = peak;
    if (peak > max) max = peak;
  }
  return peaks.map(p => p / max);
};

const float32ToInt16 = (samples: Float32Array): Int16Array => {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    if (s > 1) s = 1;
    if (s < -1) s = -1;
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
};

const decodeMp3 = async (blob: Blob): Promise<{ left: Float32Array; right: Float32Array | null; sampleRate: number }> => {
  const AC: typeof AudioContext =
    (window.AudioContext as typeof AudioContext | undefined) ??
    ((window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new AC();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const left = buffer.getChannelData(0).slice();
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : null;
    return { left, right, sampleRate: buffer.sampleRate };
  } finally {
    if (ctx.state !== 'closed') ctx.close().catch(() => {});
  }
};

export const cutAudioByKeepSegments = async (
  sourceBlob: Blob,
  keepSegments: { start: number; end: number }[],
): Promise<CutAudioResult> => {
  const { left, right, sampleRate } = await decodeMp3(sourceBlob);

  const sliceChannel = (ch: Float32Array): Float32Array => {
    // Resolve start/end indices first so the total matches what we actually
    // write below. Computing total via `floor((end-start)*rate)` separately
    // and the slice via `floor(start*rate)`/`floor(end*rate)` produces
    // off-by-one mismatches due to rounding, which throws RangeError when
    // the slice runs past the allocated buffer.
    const ranges: { startIdx: number; endIdx: number }[] = [];
    let total = 0;
    for (const seg of keepSegments) {
      const startIdx = Math.max(0, Math.floor(seg.start * sampleRate));
      const endIdx = Math.min(ch.length, Math.floor(seg.end * sampleRate));
      const len = endIdx - startIdx;
      if (len <= 0) continue;
      ranges.push({ startIdx, endIdx });
      total += len;
    }
    const out = new Float32Array(total);
    let cursor = 0;
    for (const { startIdx, endIdx } of ranges) {
      out.set(ch.subarray(startIdx, endIdx), cursor);
      cursor += endIdx - startIdx;
    }
    return out;
  };

  const cutLeft = sliceChannel(left);
  const cutRight = right ? sliceChannel(right) : null;

  const channels = cutRight ? 2 : 1;
  const kbps = 128;
  const leftInt16 = float32ToInt16(cutLeft);
  const rightInt16 = cutRight ? float32ToInt16(cutRight) : null;

  console.log('[audioCutter] starting MP3 encode · samples=', leftInt16.length, '· rate=', sampleRate);
  const encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
  const chunkSize = 1152;
  const mp3Buffers: Uint8Array[] = [];
  // Yield to the event loop every 200 chunks (~230ms of audio) so the UI
  // can repaint and any errors surface promptly. Without this the entire
  // encode runs in one tick and any internal failure looks like a hang.
  const YIELD_EVERY = 200;
  let chunkIdx = 0;
  for (let i = 0; i < leftInt16.length; i += chunkSize) {
    const leftChunk = leftInt16.subarray(i, i + chunkSize);
    const rightChunk = rightInt16 ? rightInt16.subarray(i, i + chunkSize) : null;
    const buf = rightChunk
      ? encoder.encodeBuffer(leftChunk, rightChunk)
      : encoder.encodeBuffer(leftChunk);
    if (buf.length > 0) mp3Buffers.push(buf);
    chunkIdx++;
    if (chunkIdx % YIELD_EVERY === 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 0));
    }
  }
  console.log('[audioCutter] encoded all chunks · count=', chunkIdx);
  const tail = encoder.flush();
  if (tail.length > 0) mp3Buffers.push(tail);
  console.log('[audioCutter] flushed encoder');

  const totalBytes = mp3Buffers.reduce((s, b) => s + b.length, 0);
  const mp3Out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const b of mp3Buffers) {
    mp3Out.set(b, offset);
    offset += b.length;
  }

  const duration = cutLeft.length / sampleRate;
  const peaks = computePeaksFromMono(cutLeft, WAVEFORM_BUCKETS);

  return {
    blob: new Blob([mp3Out], { type: 'audio/mpeg' }),
    duration,
    peaks,
  };
};
