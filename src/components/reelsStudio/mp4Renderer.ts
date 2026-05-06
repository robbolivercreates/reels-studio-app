/**
 * Browser-side MP4 export pipeline.
 *
 * For each output frame the compositor decides which source is on-screen
 * (avatar clip ⟶ avatar block; B-roll take ⟶ B-roll block) and draws it
 * onto an OffscreenCanvas. WebCodecs encodes H.264 video + AAC audio,
 * mp4-muxer packages everything into a single .mp4 Blob.
 *
 * Performance notes:
 * - We process frames sequentially using HTMLVideoElement seek+drawImage.
 *   This is reliable across browsers but slower than a true decoder pipeline.
 *   ~30s reel renders in ~15-30s on a modern Mac.
 * - Encoder backpressure is respected via `encodeQueueSize` polling.
 * - Audio is taken from the Minimax MP3 only (B-roll audio intentionally
 *   ignored — narration consistency wins).
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ScriptBlock, AvatarClipState, ScreenTake, BlockLayout } from './types';
import { computeLayout, hitTest } from './timeline';
import { getLayoutSlots, defaultAvatarZoom, type LayoutBox } from './layouts';

export interface RenderInputs {
  blocks: ScriptBlock[];
  avatarClips: Record<string, AvatarClipState>;
  activeTake: ScreenTake | null;
  audioBlob: Blob;
  duration: number;          // seconds (raw audio duration)
  aspect: '9:16' | '16:9' | '1:1';
  quality: 'high' | 'lite';
  /** When provided, output skips silent regions; segments are in source time (0..duration). */
  silenceKeepSegments?: { start: number; end: number }[];
}

export interface RenderProgress {
  phase: 'preparing' | 'rendering' | 'audio' | 'finalizing';
  framesDone: number;
  totalFrames: number;
  message: string;
  /** Most recent frame as ImageBitmap so the modal can show a live thumbnail. */
  thumbnail?: ImageBitmap;
}

export interface RenderHandle {
  promise: Promise<Blob>;
  cancel: () => void;
}

const FRAMERATE = 30;

const dimensionsFor = (aspect: '9:16' | '16:9' | '1:1', quality: 'high' | 'lite'): { width: number; height: number } => {
  const big = quality === 'high' ? 1080 : 720;
  if (aspect === '9:16') return { width: big, height: Math.round(big * 16 / 9) };
  if (aspect === '16:9') return { width: Math.round(big * 16 / 9), height: big };
  return { width: big, height: big };
};

const bitrateFor = (quality: 'high' | 'lite'): number =>
  quality === 'high' ? 5_500_000 : 2_500_000;

interface FrameLayer {
  videoUrl: string;
  sourceSeek: number;
  box: LayoutBox; // 0..1 normalized
  zoom?: number; // optional center-zoom factor (1 = no zoom)
}

interface FrameComposition {
  layers: FrameLayer[]; // drawn in order; later layers paint on top
}

const FULL_FRAME: LayoutBox = { x: 0, y: 0, w: 1, h: 1 };

/** For a given project-time t, return all layers to composite. */
const frameAtProjectTime = (
  t: number,
  inputs: RenderInputs,
  layout: ReturnType<typeof computeLayout>,
  motionUrls: Map<string, string>, // blockId → asset:// URL
): FrameComposition => {
  const hit = hitTest(layout, t);
  if (hit.kind !== 'block') return { layers: [] };
  const block = inputs.blocks.find(b => b.id === hit.slot.blockId);
  if (!block) return { layers: [] };

  const localT = t - hit.slot.projectStart;

  // Motion-replace: motion fills the whole frame, no avatar/broll.
  if (block.motion?.layer === 'replace' && motionUrls.has(block.id)) {
    const motionUrl = motionUrls.get(block.id)!;
    const motionDur = block.motion.durationSec || 4;
    const motionSeek = localT % motionDur;
    const layers: FrameLayer[] = [{ videoUrl: motionUrl, sourceSeek: motionSeek, box: FULL_FRAME }];
    return { layers };
  }

  const blockLayout: BlockLayout = block.kind === 'avatar' ? (block.layout ?? 'avatar-only') : 'media-only';
  const slots = getLayoutSlots(blockLayout);
  const layers: FrameLayer[] = [];

  // Avatar layer.
  if (block.kind === 'avatar' && slots.avatar) {
    const stillVisible = block.avatarVisibleSec === undefined || localT < block.avatarVisibleSec;
    if (stillVisible) {
      const clip = inputs.avatarClips[block.id];
      if (clip?.videoUrl) {
        const zoom = block.avatarZoom ?? defaultAvatarZoom(inputs.aspect, block.layout);
        layers.push({ videoUrl: clip.videoUrl, sourceSeek: localT, box: slots.avatar, zoom });
      }
    } else if (inputs.activeTake) {
      const localBroll = localT - (block.avatarVisibleSec ?? 0);
      layers.push({ videoUrl: inputs.activeTake.url, sourceSeek: mapBrollTime(localBroll, inputs.activeTake), box: slots.avatar });
    }
  }

  // Media layer (B-roll take).
  if (slots.media && inputs.activeTake) {
    layers.push({ videoUrl: inputs.activeTake.url, sourceSeek: mapBrollTime(localT, inputs.activeTake), box: slots.media });
  }

  // Motion overlay: composited on top of everything else. Loop if block is longer than motion.
  if (block.motion?.layer === 'overlay' && motionUrls.has(block.id)) {
    const motionUrl = motionUrls.get(block.id)!;
    const motionDur = block.motion.durationSec || 4;
    const motionSeek = localT % motionDur;
    layers.push({ videoUrl: motionUrl, sourceSeek: motionSeek, box: FULL_FRAME });
  }

  return { layers };
};

const mapBrollTime = (localT: number, take: ScreenTake): number => {
  // No silence cut → simple offset within trim window, looping if needed.
  const trimDuration = Math.max(0.1, take.trimEnd - take.trimStart);
  if (!take.cutSilence || take.keepSegments.length === 0) {
    const wrapped = localT % trimDuration;
    return take.trimStart + wrapped;
  }
  // With silence cut: walk through keep segments to find which one contains localT.
  let remaining = localT;
  for (const seg of take.keepSegments) {
    const segLen = seg.end - seg.start;
    if (remaining < segLen) return seg.start + remaining;
    remaining -= segLen;
  }
  // Past the end → loop within keep segments.
  const totalKeep = take.keepSegments.reduce((s, k) => s + (k.end - k.start), 0);
  if (totalKeep <= 0) return take.trimStart;
  return mapBrollTime(localT % totalKeep, take);
};

const loadVideoElement = (url: string): Promise<HTMLVideoElement> =>
  new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error(`Failed to load video: ${url}`));
  });

const seekVideo = (v: HTMLVideoElement, t: number): Promise<void> =>
  new Promise((resolve) => {
    const target = Math.max(0, Math.min(v.duration || t, t));
    if (Math.abs(v.currentTime - target) < 0.02) {
      resolve();
      return;
    }
    const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve(); };
    v.addEventListener('seeked', onSeeked);
    try { v.currentTime = target; } catch { resolve(); }
  });

const decodeAudioChannelData = async (blob: Blob): Promise<{ data: Float32Array; sampleRate: number; numberOfChannels: number }> => {
  const AC: typeof AudioContext =
    (window.AudioContext as typeof AudioContext | undefined) ??
    ((window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new AC();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    // Mix down to mono.
    if (buffer.numberOfChannels === 1) {
      return { data: buffer.getChannelData(0).slice(), sampleRate: buffer.sampleRate, numberOfChannels: 1 };
    }
    const len = buffer.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const ch = buffer.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += ch[i];
    }
    for (let i = 0; i < len; i++) mono[i] /= buffer.numberOfChannels;
    return { data: mono, sampleRate: buffer.sampleRate, numberOfChannels: 1 };
  } finally {
    if (ctx.state !== 'closed') ctx.close().catch(() => {});
  }
};

export const renderMp4 = (inputs: RenderInputs, onProgress: (p: RenderProgress) => void): RenderHandle => {
  let cancelled = false;

  const promise = (async (): Promise<Blob> => {
    const { width, height } = dimensionsFor(inputs.aspect, inputs.quality);

    // Layout already accounts for trim handles (per-block trimIn/trimOut → ripple).
    const layout = computeLayout(inputs.blocks);
    const projectDuration = layout.totalDuration > 0 ? layout.totalDuration : inputs.duration;

    // Silence cut: keep segments are in SOURCE-AUDIO coords (0..inputs.duration).
    // Output time → project time is identity unless silence cut is on.
    const cutOn = !!inputs.silenceKeepSegments && inputs.silenceKeepSegments.length > 0;
    const keepSegs = cutOn ? inputs.silenceKeepSegments! : [{ start: 0, end: inputs.duration }];

    // Approximate: silence cut applied uniformly shrinks the project duration
    // proportionally. (Exact mapping needs intersecting silence ranges with each
    // block's source range — TODO when this matters in practice.)
    const totalKeepSec = cutOn ? keepSegs.reduce((s, k) => s + (k.end - k.start), 0) : projectDuration;
    const cutRatio = cutOn && inputs.duration > 0 ? totalKeepSec / inputs.duration : 1;
    const effectiveDuration = projectDuration * cutRatio;
    const totalFrames = Math.floor(effectiveDuration * FRAMERATE);

    const mapOutToProject = (outT: number): number => cutOn ? outT / cutRatio : outT;

    onProgress({ phase: 'preparing', framesDone: 0, totalFrames, message: 'Carregando mídia...' });

    // Build motion URL map: blockId → asset:// URL (only blocks with rendered MP4).
    const motionUrls = new Map<string, string>();
    for (const block of inputs.blocks) {
      if (block.motion?.videoPath) {
        motionUrls.set(block.id, convertFileSrc(block.motion.videoPath));
      }
    }

    // Pre-load all unique source videos so seeks are fast.
    const allUrls: (string | null)[] = inputs.blocks.map(b => {
      if (b.kind === 'avatar') return inputs.avatarClips[b.id]?.videoUrl ?? null;
      return inputs.activeTake?.url ?? null;
    });
    // Also include motion videos.
    for (const url of motionUrls.values()) allUrls.push(url);

    const uniqueUrls = Array.from(new Set(allUrls.filter((u): u is string => !!u)));
    const videoMap = new Map<string, HTMLVideoElement>();
    for (const url of uniqueUrls) {
      if (cancelled) throw new Error('Cancelado');
      try {
        videoMap.set(url, await loadVideoElement(url));
      } catch (err) {
        console.warn('[reels/render] failed to preload', url, err);
      }
    }

    onProgress({ phase: 'preparing', framesDone: 0, totalFrames, message: 'Decodificando áudio...' });
    const audio = await decodeAudioChannelData(inputs.audioBlob);
    if (cancelled) throw new Error('Cancelado');

    // Setup muxer + encoders.
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate: FRAMERATE },
      audio: { codec: 'aac', numberOfChannels: 1, sampleRate: 48000 },
      fastStart: 'in-memory',
    });

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { throw e; },
    });
    videoEncoder.configure({
      codec: 'avc1.640028',
      width, height,
      bitrate: bitrateFor(inputs.quality),
      framerate: FRAMERATE,
    });

    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => { throw e; },
    });
    audioEncoder.configure({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 1,
      bitrate: 128_000,
    });

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Falha ao obter contexto 2D');

    const drawBlackFrame = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    };

    /** Draw a video frame into a normalized box with cover-fit (crop). Optional center-zoom. */
    const drawIntoBox = (v: HTMLVideoElement, box: LayoutBox, zoom = 1) => {
      const srcW = v.videoWidth;
      const srcH = v.videoHeight;
      const dx = box.x * width;
      const dy = box.y * height;
      const dw = box.w * width;
      const dh = box.h * height;
      if (!srcW || !srcH) {
        ctx.fillStyle = '#000';
        ctx.fillRect(dx, dy, dw, dh);
        return;
      }
      const srcRatio = srcW / srcH;
      const dstRatio = dw / dh;
      let sx = 0, sy = 0, sw = srcW, sh = srcH;
      if (srcRatio > dstRatio) {
        sw = srcH * dstRatio;
        sx = (srcW - sw) / 2;
      } else {
        sh = srcW / dstRatio;
        sy = (srcH - sh) / 2;
      }
      // Apply zoom: shrink the source rect around its center to crop more.
      if (zoom > 1) {
        const newSw = sw / zoom;
        const newSh = sh / zoom;
        sx += (sw - newSw) / 2;
        sy += (sh - newSh) / 2;
        sw = newSw;
        sh = newSh;
      }
      ctx.drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh);
    };

    // ─── VIDEO PASS ──────────────────────────────────────────────────
    onProgress({ phase: 'rendering', framesDone: 0, totalFrames, message: 'Renderizando frames...' });

    const microsPerFrame = 1_000_000 / FRAMERATE;
    let lastThumbAt = 0;

    for (let frame = 0; frame < totalFrames; frame++) {
      if (cancelled) {
        videoEncoder.close();
        audioEncoder.close();
        throw new Error('Cancelado');
      }

      const outT = frame / FRAMERATE;
      const projT = mapOutToProject(outT);
      const composition = frameAtProjectTime(projT, inputs, layout, motionUrls);

      // Always start with a black background — covers any layout area not filled by a layer.
      drawBlackFrame();

      // Draw each layer in order. Layers are sequenced so the avatar paints over media when boxes overlap.
      for (const lyr of composition.layers) {
        const v = videoMap.get(lyr.videoUrl);
        if (!v) continue;
        await seekVideo(v, lyr.sourceSeek);
        drawIntoBox(v, lyr.box, lyr.zoom ?? 1);
      }

      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round(frame * microsPerFrame),
        duration: Math.round(microsPerFrame),
      });
      // Backpressure — wait if encoder is overwhelmed.
      while (videoEncoder.encodeQueueSize > 4) {
        await new Promise(r => setTimeout(r, 1));
      }
      videoEncoder.encode(videoFrame, { keyFrame: frame % (FRAMERATE * 2) === 0 });
      videoFrame.close();

      // Throttle thumbnail updates to ~5fps to avoid main-thread thrash.
      const now = performance.now();
      if (now - lastThumbAt > 200) {
        lastThumbAt = now;
        try {
          const thumb = await createImageBitmap(canvas);
          onProgress({ phase: 'rendering', framesDone: frame + 1, totalFrames, message: `Frame ${frame + 1}/${totalFrames}`, thumbnail: thumb });
        } catch {
          onProgress({ phase: 'rendering', framesDone: frame + 1, totalFrames, message: `Frame ${frame + 1}/${totalFrames}` });
        }
      } else {
        onProgress({ phase: 'rendering', framesDone: frame + 1, totalFrames, message: `Frame ${frame + 1}/${totalFrames}` });
      }
    }

    // ─── AUDIO PASS ──────────────────────────────────────────────────
    onProgress({ phase: 'audio', framesDone: totalFrames, totalFrames, message: 'Encodando áudio...' });

    // Resample if source rate != 48000 (most Minimax MP3s come in 44.1k or 48k).
    const targetRate = 48000;
    const srcRate = audio.sampleRate;
    let pcmFull: Float32Array;
    if (srcRate === targetRate) {
      pcmFull = audio.data;
    } else {
      const targetLen = Math.round(audio.data.length * (targetRate / srcRate));
      pcmFull = new Float32Array(targetLen);
      for (let i = 0; i < targetLen; i++) {
        const srcIdx = i * (srcRate / targetRate);
        const lo = Math.floor(srcIdx);
        const hi = Math.min(audio.data.length - 1, lo + 1);
        const frac = srcIdx - lo;
        pcmFull[i] = audio.data[lo] * (1 - frac) + audio.data[hi] * frac;
      }
    }

    // Build the output PCM by walking each slot, inserting silence for offsets, and
    // applying silence cuts within source ranges. Block silence-cut also clips the
    // intersected ranges per slot.
    const fadeMs = 5;
    const fadeSamples = Math.floor((fadeMs / 1000) * targetRate);
    const pieces: Float32Array[] = [];

    const intersect = (a: { start: number; end: number }, b: { start: number; end: number }) => ({
      start: Math.max(a.start, b.start),
      end: Math.min(a.end, b.end),
    });

    const pushPcmRange = (startSec: number, endSec: number) => {
      const startIdx = Math.max(0, Math.floor(startSec * targetRate));
      const endIdx = Math.min(pcmFull.length, Math.floor(endSec * targetRate));
      if (endIdx <= startIdx) return;
      const seg = new Float32Array(endIdx - startIdx);
      seg.set(pcmFull.subarray(startIdx, endIdx));
      for (let i = 0; i < Math.min(fadeSamples, seg.length); i++) {
        seg[i] *= 0.5 - 0.5 * Math.cos(Math.PI * (i / fadeSamples));
        seg[seg.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * (i / fadeSamples));
      }
      pieces.push(seg);
    };

    for (const slot of layout.slots) {
      // Push audio from sourceStart..sourceEnd, intersected with keepSegs if cut is on.
      const blockRange = { start: slot.sourceStart, end: slot.sourceEnd };
      if (cutOn) {
        for (const k of keepSegs) {
          const inter = intersect(blockRange, k);
          if (inter.end > inter.start) pushPcmRange(inter.start, inter.end);
        }
      } else {
        pushPcmRange(blockRange.start, blockRange.end);
      }
    }

    const totalLen = pieces.reduce((s, x) => s + x.length, 0);
    const pcm = new Float32Array(totalLen);
    {
      let off = 0;
      for (const seg of pieces) { pcm.set(seg, off); off += seg.length; }
    }

    // Push the PCM in ~1024-sample frames.
    const FRAME_SIZE = 1024;
    for (let offset = 0; offset < pcm.length; offset += FRAME_SIZE) {
      if (cancelled) {
        videoEncoder.close();
        audioEncoder.close();
        throw new Error('Cancelado');
      }
      const slice = pcm.subarray(offset, Math.min(pcm.length, offset + FRAME_SIZE));
      // Copy into a fresh ArrayBuffer to satisfy AudioData's strict BufferSource type.
      const buf = new Float32Array(slice.length);
      buf.set(slice);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: targetRate,
        numberOfFrames: buf.length,
        numberOfChannels: 1,
        timestamp: Math.round((offset / targetRate) * 1_000_000),
        data: buf,
      });
      while (audioEncoder.encodeQueueSize > 4) {
        await new Promise(r => setTimeout(r, 1));
      }
      audioEncoder.encode(audioData);
      audioData.close();
    }

    // ─── FINALISE ────────────────────────────────────────────────────
    onProgress({ phase: 'finalizing', framesDone: totalFrames, totalFrames, message: 'Empacotando MP4...' });

    await videoEncoder.flush();
    await audioEncoder.flush();
    videoEncoder.close();
    audioEncoder.close();
    muxer.finalize();

    const target = muxer.target as ArrayBufferTarget;
    const blob = new Blob([target.buffer], { type: 'video/mp4' });

    // Clean up source videos.
    for (const v of videoMap.values()) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }

    return blob;
  })();

  return {
    promise,
    cancel: () => { cancelled = true; },
  };
};
