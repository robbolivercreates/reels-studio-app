// ─── AUDIO PROCESSOR ─────────────────────────────────────────────────────────
// Cloud-based acoustic post-processing for TTS output.
//
// Pipeline:
//   Minimax TTS → raw audio Blob
//     → fal.ai audio-postprocess (environment profile)
//     → optionally mix SFX layers
//     → final WAV Blob
// ─────────────────────────────────────────────────────────────────────────────

import { cloudPostProcess, type EnvironmentProfile } from './audioPostProcessService';

export type { EnvironmentProfile } from './audioPostProcessService';
export { ENVIRONMENT_PROFILES } from './audioPostProcessService';

// ── WAV encoder (16-bit PCM) — used by mixAudioLayers ──────────────────────

export function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const rate  = buffer.sampleRate;
  const n     = buffer.length;
  const bps   = 16;
  const bAlign = numCh * bps / 8;
  const dataSize = n * bAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const v  = new DataView(ab);

  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };

  str(0,  'RIFF'); v.setUint32(4, 36 + dataSize, true);
  str(8,  'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16,           true);
  v.setUint16(20, 1,             true);
  v.setUint16(22, numCh,         true);
  v.setUint32(24, rate,          true);
  v.setUint32(28, rate * bAlign, true);
  v.setUint16(32, bAlign,        true);
  v.setUint16(34, bps,           true);
  str(36, 'data'); v.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      v.setInt16(off, s < 0 ? s * 32768 : s * 32767, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// ── Silence padding — appends silent samples to prevent last-word cutoff ────

export async function padSilence(blob: Blob, durationMs = 300): Promise<Blob> {
  const ctx = new AudioContext();
  const raw = await blob.arrayBuffer();
  const decoded = await ctx.decodeAudioData(raw);
  const silentSamples = Math.ceil((durationMs / 1000) * decoded.sampleRate);
  const totalLength = decoded.length + silentSamples;

  const off = new OfflineAudioContext(decoded.numberOfChannels, totalLength, decoded.sampleRate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  await ctx.close();
  return encodeWav(rendered);
}

// ── Main exports ────────────────────────────────────────────────────────────

/** A single ambient sound layer to be mixed into the final render. */
export interface AmbientLayer {
  blob: Blob;
  gain: number;
}

/**
 * Apply an environment profile to audio via fal.ai cloud post-processing.
 * Replaces the old applyRoomAcoustics() with a simple profile-based call.
 */
export async function applyEnvironmentProfile(
  blob: Blob,
  profile: EnvironmentProfile,
): Promise<Blob> {
  try {
    return await cloudPostProcess(blob, profile);
  } catch (err) {
    console.warn('[audioProcessor] Environment post-processing failed, using raw audio:', err);
    return blob;
  }
}

/**
 * Simple gain-based mixing of voice + ambient layers WITHOUT room acoustics.
 * Used when the user still has SFX or ambient layers to mix in.
 */
export async function mixAudioLayers(
  voiceBlob: Blob,
  voiceGain: number,
  layers: AmbientLayer[],
): Promise<Blob> {
  const tmpCtx = new AudioContext();
  const voiceRaw = await voiceBlob.arrayBuffer();
  const voiceBuf = await tmpCtx.decodeAudioData(voiceRaw);

  const layerBufs: { buf: AudioBuffer; gain: number }[] = [];
  for (const layer of layers) {
    try {
      const raw = await layer.blob.arrayBuffer();
      layerBufs.push({ buf: await tmpCtx.decodeAudioData(raw), gain: layer.gain });
    } catch { /* skip bad decode */ }
  }
  await tmpCtx.close();

  const { sampleRate, numberOfChannels, length } = voiceBuf;
  const off = new OfflineAudioContext(Math.max(numberOfChannels, 2), length, sampleRate);

  const voiceNode = off.createBufferSource();
  voiceNode.buffer = voiceBuf;
  const vGain = off.createGain();
  vGain.gain.value = voiceGain;
  voiceNode.connect(vGain);
  vGain.connect(off.destination);
  voiceNode.start(0);

  for (const { buf, gain } of layerBufs) {
    const g = off.createGain();
    g.gain.value = gain;
    g.connect(off.destination);
    let offset = 0;
    while (offset < length) {
      const tile = off.createBufferSource();
      tile.buffer = buf;
      tile.connect(g);
      tile.start(offset / sampleRate);
      offset += buf.length;
    }
  }

  const rendered = await off.startRendering();
  return encodeWav(rendered);
}
