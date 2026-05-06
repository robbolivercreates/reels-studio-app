/**
 * Slices a full audio Blob (MP3) into per-block WAV Blobs based on start/end times.
 * Output is mono 16-bit PCM WAV at the source sample rate — HeyGen accepts both
 * WAV and MP3 and WAV avoids re-encoding artifacts on small slices.
 */

const audioContext = (): AudioContext => {
  const AC: typeof AudioContext =
    (window.AudioContext as typeof AudioContext | undefined) ??
    ((window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  return new AC();
};

const decodeFullBlob = async (blob: Blob): Promise<AudioBuffer> => {
  const ctx = audioContext();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    if (ctx.state !== 'closed') ctx.close().catch(() => {});
  }
};

const sliceChannel = (channel: Float32Array, start: number, end: number, sampleRate: number): Float32Array => {
  const startIdx = Math.max(0, Math.floor(start * sampleRate));
  const endIdx = Math.min(channel.length, Math.floor(end * sampleRate));
  return channel.subarray(startIdx, endIdx);
};

const float32ToInt16 = (float32: Float32Array): Int16Array => {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
};

const encodeWav = (samples: Int16Array, sampleRate: number): Blob => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);             // PCM chunk size
  view.setUint16(20, 1, true);              // PCM format
  view.setUint16(22, 1, true);              // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);              // block align
  view.setUint16(34, 16, true);             // bits per sample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, samples[i], true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

export interface AudioSlice {
  blockId: string;
  blob: Blob;
  duration: number;
  start: number;
  end: number;
}

export const sliceAudioByBlocks = async (
  fullBlob: Blob,
  ranges: { blockId: string; start: number; end: number }[],
): Promise<AudioSlice[]> => {
  const buffer = await decodeFullBlob(fullBlob);
  const sampleRate = buffer.sampleRate;
  const channel = buffer.getChannelData(0);

  return ranges.map(r => {
    const samples = sliceChannel(channel, r.start, r.end, sampleRate);
    const int16 = float32ToInt16(samples);
    const wavBlob = encodeWav(int16, sampleRate);
    return {
      blockId: r.blockId,
      blob: wavBlob,
      duration: r.end - r.start,
      start: r.start,
      end: r.end,
    };
  });
};
