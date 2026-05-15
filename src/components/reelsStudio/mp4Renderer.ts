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
import type { ScriptBlock, AvatarClipState, ScreenTake, BlockLayout, BlockTransition } from './types';
import { computeLayout, hitTest } from './timeline';
import { getLayoutSlots, defaultAvatarZoom, type LayoutBox } from './layouts';

export interface RenderInputs {
  blocks: ScriptBlock[];
  avatarClips: Record<string, AvatarClipState>;
  activeTake: ScreenTake | null;
  audioBlob: Blob;
  duration: number;          // seconds (effective audio duration)
  aspect: '9:16' | '16:9' | '1:1' | 'carousel';
  quality: 'high' | 'lite';
  /** When true, render video track only — no AAC encoding. Use for ffmpeg mux path. */
  videoOnly?: boolean;
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

const dimensionsFor = (aspect: '9:16' | '16:9' | '1:1' | 'carousel', quality: 'high' | 'lite'): { width: number; height: number } => {
  const big = quality === 'high' ? 1080 : 720;
  if (aspect === '9:16') return { width: big, height: Math.round(big * 16 / 9) };
  if (aspect === '16:9') return { width: Math.round(big * 16 / 9), height: big };
  // carousel = 4:5 Instagram portrait format (1080×1350)
  if (aspect === 'carousel') return { width: big, height: Math.round(big * 5 / 4) };
  return { width: big, height: big };
};

const bitrateFor = (quality: 'high' | 'lite'): number =>
  quality === 'high' ? 5_500_000 : 2_500_000;

type BlendMode =
  | 'source-over'   // normal composite
  | 'screen'        // lighten — good for light motion graphics on dark bg
  | 'multiply'      // darken — good for dark overlays
  | 'overlay'       // contrast boost — blends mid-tones
  | 'soft-light';   // subtle texture/color overlay

interface FrameLayer {
  videoUrl: string;
  sourceSeek: number;
  box: LayoutBox;           // 0..1 normalized
  zoom?: number;            // optional center-zoom factor (1 = no zoom)
  offsetY?: number;         // vertical shift within box (-0.5..0.5 fraction of box height)
  alpha?: number;           // 0..1 global opacity for this layer (default 1)
  blend?: BlendMode;        // canvas globalCompositeOperation (default source-over)
}

interface FrameDecoration {
  kind: 'bottom-gradient' | 'split-seam' | 'vignette';
  splitY?: number; // for split-seam only (0..1 normalized)
}

interface FrameComposition {
  layers: FrameLayer[];
  decorations: FrameDecoration[];
  fadeAlpha: number; // 0..1 cross-fade at block boundaries
}

const FULL_FRAME: LayoutBox = { x: 0, y: 0, w: 1, h: 1 };

const FADE_FRAMES = 6; // ~200ms at 30fps — modern Reels/TikTok pacing

/** Render layers + decorations for a single block at a given local time (no fade logic). */
const composeForBlock = (
  block: ScriptBlock,
  localT: number,
  inputs: RenderInputs,
  motionUrls: Map<string, string>,
): { layers: FrameLayer[]; decorations: FrameDecoration[] } => {
  const motionLayer = block.motion?.layer;
  const motionUrl = motionUrls.get(block.id);
  const motionDur = block.motion?.durationSec || 4;
  // Motion plays ONCE and freezes on its last frame for the rest of the block.
  // No looping — looping motion graphics looks amateurish.
  const motionSeek = Math.min(localT, motionDur - 0.05);

  // Motion-replace: full frame.
  if (motionLayer === 'replace' && motionUrl) {
    return { layers: [{ videoUrl: motionUrl, sourceSeek: motionSeek, box: FULL_FRAME }], decorations: [] };
  }

  // Motion split: avatar occupies one half, motion the other.
  if ((motionLayer === 'split-bottom' || motionLayer === 'split-top') && motionUrl) {
    const avatarBox: LayoutBox = motionLayer === 'split-bottom'
      ? { x: 0, y: 0,   w: 1, h: 0.5 }
      : { x: 0, y: 0.5, w: 1, h: 0.5 };
    const motionBox: LayoutBox = motionLayer === 'split-bottom'
      ? { x: 0, y: 0.5, w: 1, h: 0.5 }
      : { x: 0, y: 0,   w: 1, h: 0.5 };
    const layers: FrameLayer[] = [];
    const clip = block.kind === 'avatar' ? inputs.avatarClips[block.id] : null;
    if (clip?.videoUrl) {
      const zoom = block.avatarZoom ?? 1;
      layers.push({ videoUrl: clip.videoUrl, sourceSeek: localT, box: avatarBox, zoom, offsetY: block.avatarOffsetY });
    }
    layers.push({ videoUrl: motionUrl, sourceSeek: motionSeek, box: motionBox });
    return { layers, decorations: [{ kind: 'split-seam', splitY: 0.5 }] };
  }

  const blockLayout: BlockLayout = block.kind === 'avatar' ? (block.layout ?? 'avatar-only') : 'media-only';
  const slots = getLayoutSlots(blockLayout);
  const layers: FrameLayer[] = [];
  const decorations: FrameDecoration[] = [];

  // Avatar layer.
  if (block.kind === 'avatar' && slots.avatar) {
    const stillVisible = block.avatarVisibleSec === undefined || localT < block.avatarVisibleSec;
    if (stillVisible) {
      const clip = inputs.avatarClips[block.id];
      if (clip?.videoUrl) {
        const zoom = block.avatarZoom ?? defaultAvatarZoom(inputs.aspect, block.layout);
        layers.push({ videoUrl: clip.videoUrl, sourceSeek: localT, box: slots.avatar, zoom, offsetY: block.avatarOffsetY });
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

  // Motion overlay: screen blend at 0.88 alpha — mixes with avatar instead of covering it.
  if (motionLayer === 'overlay' && motionUrl) {
    layers.push({ videoUrl: motionUrl, sourceSeek: motionSeek, box: FULL_FRAME, alpha: 0.88, blend: 'screen' });
  }

  // Decorations.
  if (blockLayout === 'avatar-top') decorations.push({ kind: 'split-seam', splitY: 0.5 });
  if (blockLayout === 'media-top') decorations.push({ kind: 'split-seam', splitY: 0.5 });

  return { layers, decorations };
};

/** For a given project-time t, return all layers + decorations + fade alpha. */
const frameAtProjectTime = (
  t: number,
  inputs: RenderInputs,
  layout: ReturnType<typeof computeLayout>,
  motionUrls: Map<string, string>,
): FrameComposition => {
  const empty: FrameComposition = { layers: [], decorations: [], fadeAlpha: 1 };
  const hit = hitTest(layout, t);
  if (hit.kind !== 'block') return empty;
  const block = inputs.blocks.find(b => b.id === hit.slot.blockId);
  if (!block) return empty;

  const localT = t - hit.slot.projectStart;
  const blockDurSec = hit.slot.sourceEnd - hit.slot.sourceStart;
  const totalBlockFrames = Math.max(1, Math.floor(blockDurSec * FRAMERATE));
  const localFrame = Math.floor(localT * FRAMERATE);

  const slotIdx = layout.slots.findIndex(s => s.blockId === block.id);
  const prevSlot = slotIdx > 0 ? layout.slots[slotIdx - 1] : null;
  const prevBlock = prevSlot ? inputs.blocks.find(b => b.id === prevSlot.blockId) ?? null : null;
  const nextSlot = slotIdx >= 0 && slotIdx < layout.slots.length - 1 ? layout.slots[slotIdx + 1] : null;
  const nextBlock = nextSlot ? inputs.blocks.find(b => b.id === nextSlot.blockId) ?? null : null;

  // Default between-block transition is cross-dissolve (Apple/CapCut style —
  // no black flash). The reel's intro/outro still uses 'fade' to black for
  // a clean entry/exit. User can override per-block via block.transition.
  const incomingTransition: BlockTransition = prevBlock ? (prevBlock.transition ?? 'dissolve') : 'fade';
  const outgoingTransition: BlockTransition = block.transition ?? (nextBlock ? 'dissolve' : 'fade');

  const inFadeRegion = localFrame < FADE_FRAMES;
  const outFadeRegion = localFrame > totalBlockFrames - FADE_FRAMES;

  const own = composeForBlock(block, localT, inputs, motionUrls);
  const layers: FrameLayer[] = [...own.layers];
  const decorations: FrameDecoration[] = [...own.decorations];

  // Black fade-to/fade-from logic. 'cut' skips it. 'dissolve' replaces it with cross-blend.
  let fadeAlpha = 1;
  if (inFadeRegion) {
    if (incomingTransition === 'fade' || (!prevBlock && true)) {
      fadeAlpha = Math.min(fadeAlpha, localFrame / FADE_FRAMES);
    } else if (incomingTransition === 'dissolve' && prevBlock && prevSlot) {
      // Cross-dissolve: previous block layers underneath at decreasing alpha.
      const prevLocalT = (prevSlot.sourceEnd - prevSlot.sourceStart) - ((FADE_FRAMES - localFrame) / FRAMERATE);
      const prev = composeForBlock(prevBlock, Math.max(0, prevLocalT), inputs, motionUrls);
      // Prev fades OUT (alpha 1 → 0); current fades IN (we draw full opacity, but composite by drawing prev FIRST).
      const t = localFrame / FADE_FRAMES; // 0..1
      const prevAlpha = 1 - t;
      for (const lyr of prev.layers) {
        layers.unshift({ ...lyr, alpha: (lyr.alpha ?? 1) * prevAlpha });
      }
      // Current layers drawn at increasing alpha so the cross-blend looks right.
      for (let i = prev.layers.length; i < layers.length; i++) {
        layers[i] = { ...layers[i], alpha: (layers[i].alpha ?? 1) * t };
      }
    }
    // 'cut': nothing extra — just show this frame at full alpha.
  }
  if (outFadeRegion) {
    if (outgoingTransition === 'fade' || !nextBlock) {
      fadeAlpha = Math.min(fadeAlpha, (totalBlockFrames - localFrame) / FADE_FRAMES);
    } else if (outgoingTransition === 'dissolve' && nextBlock && nextSlot) {
      // Cross-dissolve: next block layers on top at increasing alpha.
      const nextLocalT = ((localFrame - (totalBlockFrames - FADE_FRAMES)) / FRAMERATE);
      const next = composeForBlock(nextBlock, Math.max(0, nextLocalT), inputs, motionUrls);
      const t = (localFrame - (totalBlockFrames - FADE_FRAMES)) / FADE_FRAMES; // 0..1
      const ownAlpha = 1 - t;
      for (let i = 0; i < layers.length; i++) {
        layers[i] = { ...layers[i], alpha: (layers[i].alpha ?? 1) * ownAlpha };
      }
      for (const lyr of next.layers) {
        layers.push({ ...lyr, alpha: (lyr.alpha ?? 1) * t });
      }
    }
  }
  fadeAlpha = Math.max(0, Math.min(1, fadeAlpha));

  return { layers, decorations, fadeAlpha };
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

// Hard cap on a single seek. Healthy seeks finish in <50ms. The previous
// 1.5s ceiling let a single broken clip burn ~18s per crossfade frame
// (multiple video layers × 1.5s). 400ms keeps us forgiving but kills
// the "trava 2s no segundo X" pattern fast.
const SEEK_TIMEOUT_MS = 400;
/** After this many consecutive timeouts on the SAME video, we mark it
 * broken and short-circuit future seeks (renders last good frame).
 * Prevents one bad HEVC/fragmented MP4 from stalling an entire export. */
const MAX_TIMEOUTS_BEFORE_GIVEUP = 3;
const brokenVideoUrls = new WeakSet<HTMLVideoElement>();
const timeoutCount = new WeakMap<HTMLVideoElement, number>();

/** Reset on each new export so a previous broken-clip mark doesn't
 *  poison a retry. Called once at the start of renderMp4. */
const resetVideoHealth = (videos: HTMLVideoElement[]) => {
  for (const v of videos) {
    if (brokenVideoUrls.has(v)) {
      // WeakSet has no delete? — yes it does.
      brokenVideoUrls.delete(v);
    }
    timeoutCount.delete(v);
  }
};

const seekVideo = (v: HTMLVideoElement, t: number, signal?: { cancelled: boolean }): Promise<void> =>
  new Promise((resolve) => {
    // Already known broken — skip the seek entirely. The renderer will
    // draw whatever the last successfully-seeked frame is.
    if (brokenVideoUrls.has(v)) {
      resolve();
      return;
    }
    const target = Math.max(0, Math.min(v.duration || t, t));
    if (Math.abs(v.currentTime - target) < 0.02) {
      resolve();
      return;
    }
    let settled = false;
    const finish = (timedOut = false) => {
      if (settled) return;
      settled = true;
      v.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
      clearInterval(cancelPoll);
      if (timedOut) {
        const n = (timeoutCount.get(v) ?? 0) + 1;
        timeoutCount.set(v, n);
        if (n >= MAX_TIMEOUTS_BEFORE_GIVEUP) {
          brokenVideoUrls.add(v);
          console.warn('[render] giving up on broken video after', n, 'timeouts · src=', v.src.slice(0, 80));
        }
      } else {
        // Reset count on a successful seek — only consecutive misses count.
        timeoutCount.delete(v);
      }
      resolve();
    };
    const onSeeked = () => finish(false);
    const timer = setTimeout(() => {
      console.warn('[render] seek timeout · target=', target, '· dur=', v.duration, '· cur=', v.currentTime);
      finish(true);
    }, SEEK_TIMEOUT_MS);
    // Poll the cancel flag every 50ms — lets the user-facing Cancel
    // button break out of a seek that's still within budget.
    const cancelPoll = signal
      ? setInterval(() => { if (signal.cancelled) finish(false); }, 50)
      : 0;
    v.addEventListener('seeked', onSeeked);
    try { v.currentTime = target; } catch { finish(); }
  });

const decodeAudioChannelData = async (blob: Blob): Promise<{ data: Float32Array; sampleRate: number; numberOfChannels: number }> => {
  const AC: typeof AudioContext =
    (window.AudioContext as typeof AudioContext | undefined) ??
    ((window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new AC();
  try {
    console.log('[render/audio] decoding blob · size=', blob.size, '· type=', blob.type);
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    console.log('[render/audio] decoded · sampleRate=', buffer.sampleRate, '· duration=', buffer.duration, '· channels=', buffer.numberOfChannels);
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
  // Mutable object so deep helpers (seekVideo, anything else nested)
  // can observe the cancel flag without us threading the boolean
  // through every call site.
  const cancelSignal = { cancelled: false };
  let cancelled = false;

  const promise = (async (): Promise<Blob> => {
    const { width, height } = dimensionsFor(inputs.aspect, inputs.quality);

    // Layout already accounts for trim handles (per-block trimIn/trimOut → ripple).
    // It also reflects any silence cut already applied to the audio
    // upstream — the caller passes blocks whose start/end live on the
    // post-cut timeline, so renderer time == project time (no remap).
    // The legacy `silenceKeepSegments` param (uniform proportional
    // squish) lived here for the old flow where HeyGen rendered with
    // silences baked into the lipsync; that flow is gone (see Onda 8
    // débito 11 — silence is now cut BEFORE HeyGen).
    const layout = computeLayout(inputs.blocks);
    const projectDuration = layout.totalDuration > 0 ? layout.totalDuration : inputs.duration;
    const totalFrames = Math.floor(projectDuration * FRAMERATE);
    const mapOutToProject = (outT: number): number => outT;

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

    // Diagnostic block — pinpoint missing visuals before the render
    // starts so the export modal logs reveal what's wrong.
    console.log('[render] block summary:', inputs.blocks.map(b => ({
      id: b.id,
      kind: b.kind,
      text: b.text.slice(0, 40),
      start: b.start.toFixed(2),
      end: b.end.toFixed(2),
      hasMotion: !!b.motion?.videoPath,
      hasClip: b.kind === 'avatar' ? !!inputs.avatarClips[b.id]?.videoUrl : 'n/a',
      clipStatus: b.kind === 'avatar' ? inputs.avatarClips[b.id]?.status : 'n/a',
    })));
    console.log('[render] avatarClips keys:', Object.keys(inputs.avatarClips));
    console.log('[render] activeTake:', inputs.activeTake?.url ?? 'null');
    console.log('[render] motionUrls size:', motionUrls.size);

    const uniqueUrls = Array.from(new Set(allUrls.filter((u): u is string => !!u)));
    console.log('[render] uniqueUrls count:', uniqueUrls.length, 'sample:', uniqueUrls.slice(0, 3));
    const videoMap = new Map<string, HTMLVideoElement>();
    for (const url of uniqueUrls) {
      if (cancelled) throw new Error('Cancelado');
      try {
        videoMap.set(url, await loadVideoElement(url));
      } catch (err) {
        console.warn('[reels/render] failed to preload', url, err);
      }
    }
    console.log('[render] videoMap loaded:', videoMap.size, 'of', uniqueUrls.length);
    // Reset per-video timeout counters so retries don't inherit prior broken-marks.
    resetVideoHealth(Array.from(videoMap.values()));

    onProgress({ phase: 'preparing', framesDone: 0, totalFrames, message: 'Decodificando áudio...' });
    const audio = await decodeAudioChannelData(inputs.audioBlob);
    if (cancelled) throw new Error('Cancelado');

    const videoOnly = !!inputs.videoOnly;

    // Setup muxer + encoders.
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate: FRAMERATE },
      // Only declare audio track when we're encoding it ourselves.
      // In videoOnly mode, ffmpeg will mux the audio separately.
      ...(videoOnly ? {} : { audio: { codec: 'aac', numberOfChannels: 1, sampleRate: audio.sampleRate } }),
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

    // Audio encoder only used in non-videoOnly mode.
    let audioChunksEncoded = 0;
    let audioChunksOutput = 0;
    const targetRate = audio.sampleRate;
    let audioEncoder: AudioEncoder | null = null;
    if (!videoOnly) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => {
          audioChunksOutput++;
          muxer.addAudioChunk(chunk, meta);
        },
        error: (e) => { console.error('[render/audio] encoder error:', e); throw e; },
      });
      const audioConfig: AudioEncoderConfig = {
        codec: 'mp4a.40.2',
        sampleRate: targetRate,
        numberOfChannels: 1,
        bitrate: 128_000,
      };
      try {
        const support = await AudioEncoder.isConfigSupported(audioConfig);
        console.log('[render/audio] AAC config · rate=', targetRate, '· supported?', support.supported, 'effective:', support.config);
      } catch (probeErr) {
        console.warn('[render/audio] config probe threw:', probeErr);
      }
      audioEncoder.configure(audioConfig);
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Falha ao obter contexto 2D');

    const drawBlackFrame = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    };

    /** Fallback placeholder for empty broll blocks. Renders a dark
     *  gradient background + the block's text wrapped at the centre,
     *  so the user gets a readable slide instead of black silence
     *  when an export catches a block before motion/asset/take was
     *  attached. Sized to the full frame. */
    const drawTextPlaceholder = (text: string) => {
      // Diagonal gradient background — feels "designed" rather than
      // an obvious placeholder.
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#1a1a2e');
      grad.addColorStop(1, '#0f0f1a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Subtle dot grid for texture.
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      const step = 40;
      for (let y = step; y < height; y += step) {
        for (let x = step; x < width; x += step) {
          ctx.fillRect(x, y, 2, 2);
        }
      }

      if (!text.trim()) return;

      // Word-wrap so long block texts fit. Pick a font size based on
      // the canvas height so 9:16 + 16:9 both look balanced.
      const fontSize = Math.round(height * 0.045);
      ctx.font = `600 ${fontSize}px -apple-system, "Helvetica Neue", "Segoe UI", sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxLineWidth = width * 0.82;
      const words = text.trim().split(/\s+/);
      const lines: string[] = [];
      let line = '';
      for (const w of words) {
        const tentative = line ? `${line} ${w}` : w;
        if (ctx.measureText(tentative).width > maxLineWidth && line) {
          lines.push(line);
          line = w;
        } else {
          line = tentative;
        }
      }
      if (line) lines.push(line);
      const lineHeight = fontSize * 1.25;
      const totalH = lines.length * lineHeight;
      const startY = height / 2 - totalH / 2 + lineHeight / 2;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], width / 2, startY + i * lineHeight);
      }
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    };

    /** Draw bottom-to-transparent gradient over the lower portion of the frame. */
    const drawBottomGradient = (heightFraction = 0.35, opacity = 0.72) => {
      const gradY = height * (1 - heightFraction);
      const grad = ctx.createLinearGradient(0, gradY, 0, height);
      grad.addColorStop(0, `rgba(0,0,0,0)`);
      grad.addColorStop(1, `rgba(0,0,0,${opacity})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, gradY, width, height - gradY);
    };

    /** Draw gradient seam between two halves (split layout). */
    const drawSplitSeam = (splitY: number, seamHeight = 80) => {
      const grad = ctx.createLinearGradient(0, splitY - seamHeight / 2, 0, splitY + seamHeight / 2);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, splitY - seamHeight / 2, width, seamHeight);
    };

    /** Draw subtle edge vignette over the full frame. */
    const drawVignette = (opacity = 0.45) => {
      const grad = ctx.createRadialGradient(width / 2, height / 2, height * 0.25, width / 2, height / 2, height * 0.75);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(0,0,0,${opacity})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    };

    /** Draw a video frame into a normalized box with cover-fit (crop). Respects alpha + blend mode + offsetY. */
    const drawIntoBox = (v: HTMLVideoElement, box: LayoutBox, zoom = 1, alpha = 1, blend: BlendMode = 'source-over', offsetY = 0) => {
      const srcW = v.videoWidth;
      const srcH = v.videoHeight;
      const dx = box.x * width;
      const dy = box.y * height + offsetY * box.h * height;
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
      if (zoom > 1) {
        const newSw = sw / zoom;
        const newSh = sh / zoom;
        sx += (sw - newSw) / 2;
        sy += (sh - newSh) / 2;
        sw = newSw;
        sh = newSh;
      }
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = blend;
      ctx.drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    // ─── VIDEO PASS ──────────────────────────────────────────────────
    onProgress({ phase: 'rendering', framesDone: 0, totalFrames, message: 'Renderizando frames...' });

    const microsPerFrame = 1_000_000 / FRAMERATE;
    let lastThumbAt = 0;

    for (let frame = 0; frame < totalFrames; frame++) {
      if (cancelled) {
        videoEncoder.close();
        audioEncoder?.close();
        throw new Error('Cancelado');
      }

      const outT = frame / FRAMERATE;
      const projT = mapOutToProject(outT);
      const composition = frameAtProjectTime(projT, inputs, layout, motionUrls);

      drawBlackFrame();

      // Empty-block fallback: when a block has no motion, no asset,
      // no active take, and no avatar clip — e.g. a broll piece that
      // resulted from a resplit + bookend flip but never got a motion
      // generated — the frame would otherwise be pure black. Paint a
      // designed text placeholder so the user gets a readable
      // slide-style fallback in the final MP4.
      const decodedLayers = composition.layers.filter(l => videoMap.has(l.videoUrl));
      if (decodedLayers.length === 0) {
        const hit = hitTest(layout, projT);
        if (hit.kind === 'block') {
          const block = inputs.blocks.find(b => b.id === hit.slot.blockId);
          if (block) drawTextPlaceholder(block.text);
        }
      }

      // Draw video layers with their blend mode + alpha.
      for (const lyr of composition.layers) {
        const v = videoMap.get(lyr.videoUrl);
        if (!v) continue;
        await seekVideo(v, lyr.sourceSeek, cancelSignal);
        drawIntoBox(v, lyr.box, lyr.zoom ?? 1, lyr.alpha ?? 1, lyr.blend ?? 'source-over', lyr.offsetY ?? 0);
      }

      // Draw decorations (gradients, seam, vignette) on top of video layers.
      for (const dec of composition.decorations) {
        if (dec.kind === 'bottom-gradient') drawBottomGradient();
        else if (dec.kind === 'vignette') drawVignette();
        else if (dec.kind === 'split-seam' && dec.splitY != null) drawSplitSeam(dec.splitY * height);
      }

      // Cross-fade: black overlay that fades in/out at block boundaries.
      if (composition.fadeAlpha < 1) {
        ctx.globalAlpha = 1 - composition.fadeAlpha;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
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

    // ─── AUDIO PASS (skipped in videoOnly mode) ──────────────────────
    if (!videoOnly && audioEncoder) {
      onProgress({ phase: 'audio', framesDone: totalFrames, totalFrames, message: 'Encodando áudio...' });

      const pcmFull = audio.data;

      const FADE_MS_DEFAULT = 5;
      const FADE_MS_DISSOLVE = 150;
      const pieces: Float32Array[] = [];

      const pushPcmRange = (startSec: number, endSec: number, fadeInMs: number, fadeOutMs: number) => {
        const startIdx = Math.max(0, Math.floor(startSec * targetRate));
        const endIdx = Math.min(pcmFull.length, Math.floor(endSec * targetRate));
        if (endIdx <= startIdx) return;
        const seg = new Float32Array(endIdx - startIdx);
        seg.set(pcmFull.subarray(startIdx, endIdx));
        const fadeInSamples = Math.floor((fadeInMs / 1000) * targetRate);
        const fadeOutSamples = Math.floor((fadeOutMs / 1000) * targetRate);
        for (let i = 0; i < Math.min(fadeInSamples, seg.length); i++) {
          seg[i] *= 0.5 - 0.5 * Math.cos(Math.PI * (i / fadeInSamples));
        }
        for (let i = 0; i < Math.min(fadeOutSamples, seg.length); i++) {
          seg[seg.length - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * (i / fadeOutSamples));
        }
        pieces.push(seg);
      };

      for (let s = 0; s < layout.slots.length; s++) {
        const slot = layout.slots[s];
        const prevBlock = s > 0 ? inputs.blocks.find(b => b.id === layout.slots[s - 1].blockId) : null;
        const block = inputs.blocks.find(b => b.id === slot.blockId);
        const incomingDissolve = prevBlock?.transition === 'dissolve';
        const outgoingDissolve = block?.transition === 'dissolve';
        const fadeIn = incomingDissolve ? FADE_MS_DISSOLVE : FADE_MS_DEFAULT;
        const fadeOut = outgoingDissolve ? FADE_MS_DISSOLVE : FADE_MS_DEFAULT;
        const blockRange = { start: slot.sourceStart, end: slot.sourceEnd };
        // Silence is already cut upstream — block ranges live on the
        // final timeline, so the audio pass just emits each block's
        // PCM as-is. The old `cutOn` branch (intersect with keep
        // segments) was removed in Onda 8 débito 12.
        pushPcmRange(blockRange.start, blockRange.end, fadeIn, fadeOut);
      }

      const totalLen = pieces.reduce((s, x) => s + x.length, 0);
      const pcm = new Float32Array(totalLen);
      { let off = 0; for (const seg of pieces) { pcm.set(seg, off); off += seg.length; } }

      const FRAME_SIZE = 1024;
      for (let offset = 0; offset < pcm.length; offset += FRAME_SIZE) {
        if (cancelled) { videoEncoder.close(); audioEncoder.close(); throw new Error('Cancelado'); }
        const slice = pcm.subarray(offset, Math.min(pcm.length, offset + FRAME_SIZE));
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
        while (audioEncoder.encodeQueueSize > 4) { await new Promise(r => setTimeout(r, 1)); }
        audioChunksEncoded++;
        audioEncoder.encode(audioData);
        audioData.close();
      }
    }

    // ─── FINALISE ────────────────────────────────────────────────────
    onProgress({ phase: 'finalizing', framesDone: totalFrames, totalFrames, message: 'Empacotando MP4...' });

    await videoEncoder.flush();
    if (audioEncoder) {
      await audioEncoder.flush();
      const drainDeadline = performance.now() + 3000;
      while (audioChunksOutput < audioChunksEncoded && performance.now() < drainDeadline) {
        await new Promise(r => setTimeout(r, 10));
      }
    }
    console.log('[render] flushed · audioEncoded=', audioChunksEncoded, '· audioOutput=', audioChunksOutput, '· videoOnly=', videoOnly);
    videoEncoder.close();
    audioEncoder?.close();
    muxer.finalize();

    const target = muxer.target as ArrayBufferTarget;
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    console.log('[render/finalize] MP4 blob ready · size=', blob.size, 'bytes');

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
    cancel: () => {
      cancelled = true;
      cancelSignal.cancelled = true;
    },
  };
};
