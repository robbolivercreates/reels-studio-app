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

// Targeting "visually lossless for 1080p/30fps high-motion content" on `high`
// and a comfortable margin above starvation on `lite`. The previous 5.5/2.5
// were producing visible blocking + edge-smear during fast motion graphics
// (window expansions, rapid pans, click feedback animations). Industry guidance
// for 1080p H.264 high-motion: 8-10 Mbps. 10 Mbps is generous but the export
// is a one-shot operation, not a stream — file size remains manageable
// (~50MB for a 40s Reel).
const bitrateFor = (quality: 'high' | 'lite'): number =>
  quality === 'high' ? 10_000_000 : 5_000_000;

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
  offsetX?: number;         // horizontal shift within box (-1..1 fraction of viewport width) — used by whip-pan
  alpha?: number;           // 0..1 global opacity for this layer (default 1)
  blend?: BlendMode;        // canvas globalCompositeOperation (default source-over)
  /** Optional per-frame filter for transition effects (CSS filter syntax). */
  filter?: string;
  /** Optional RGB split for glitch transitions — offsets in pixels for R, G, B channels. */
  rgbSplit?: { r: number; g: number; b: number };
}

interface FrameDecoration {
  kind: 'bottom-gradient' | 'split-seam' | 'vignette' | 'flash';
  splitY?: number; // for split-seam only (0..1 normalized)
  /** Flash overlay: hex colour + alpha 0..1. */
  flashColor?: string;
  flashAlpha?: number;
}

interface FrameComposition {
  layers: FrameLayer[];
  decorations: FrameDecoration[];
  fadeAlpha: number; // 0..1 cross-fade at block boundaries
}

const FULL_FRAME: LayoutBox = { x: 0, y: 0, w: 1, h: 1 };

// Avatar tail-cut was an early misdiagnosis: the assumption was that HeyGen
// freezes the avatar's last frames into a "robot pose" after the audio ends.
// In reality, the audioSlicer feeds HeyGen the block audio + 0.18s of tail
// padding precisely so the avatar animates the final phoneme decay — those
// last frames are NOT frozen, they contain real lipsync content. Cutting
// them produced visible desync (audio still playing while avatar already
// gone). Set to 0 — defer to overrunAlpha which fades only when the clip
// is genuinely shorter than the block (HeyGen occasionally under-renders).
const AVATAR_TAIL_CUT_FRAMES = 0;

// 3 frames (~100ms) at 30fps. Reels/TikTok pacing prefers sub-100ms scene
// changes — a 200ms cross-fade reads as sluggish on short-form content.
// Was 6 frames originally; reduced because the user explicitly noted "tela
// preta longa" at every transition. 3 frames is the sweet spot: still
// perceptually smooth (the eye can't isolate 1 frame, 3 reads as a fade)
// without holding the dark midpoint long enough to break the watch loop.
const FADE_FRAMES = 3;

/**
 * For any video layer whose actual MP4 duration may differ from the block's
 * logical duration (HeyGen often delivers ±50–180ms off; motion graphics are
 * usually shorter than the block; b-roll takes are usually longer), return
 * an alpha multiplier in 0..1 that:
 *   - = 1 while localT is comfortably within the clip's playable range
 *   - fades down to 0 across the overrun (instead of holding a frozen final frame)
 * Window of 6 frames (~200ms at 30fps) chosen to fully cover audioSlicer's
 * TAIL_PADDING_SEC=0.18s with a small safety margin, matching FADE_FRAMES.
 */
const OVERRUN_FADE = 6 / FRAMERATE;
const overrunAlpha = (localT: number, clipDur: number | undefined, fallbackDur?: number): number => {
  // Pick the most restrictive valid duration: measured (if known) vs.
  // block-intended (fallback). Falling back to "no fade" when measured is
  // missing produced a hard freeze on the last frame whenever a video had
  // not been profiled yet (most commonly: video assets the renderer doesn't
  // own, and clips whose preload timeout fired). Always pass a fallback at
  // the callsite so we still get a graceful 200ms fade-out instead.
  const candidates: number[] = [];
  if (clipDur !== undefined && Number.isFinite(clipDur) && clipDur > 0) candidates.push(clipDur);
  if (fallbackDur !== undefined && Number.isFinite(fallbackDur) && fallbackDur > 0) candidates.push(fallbackDur);
  if (candidates.length === 0) return 1;
  const dur = Math.min(...candidates);
  const slack = dur - localT;
  if (slack >= OVERRUN_FADE) return 1;
  if (slack <= 0) return 0;
  return slack / OVERRUN_FADE;
};

/** Render layers + decorations for a single block at a given local time (no fade logic). */
const composeForBlock = (
  block: ScriptBlock,
  localT: number,
  inputs: RenderInputs,
  motionUrls: Map<string, string>,
  clipDurations: Map<string, number>,
): { layers: FrameLayer[]; decorations: FrameDecoration[] } => {
  // Derive motion layer from block.layout — the layout is the user's current
  // intent, while motion.layer was captured at generation time (often before
  // the user chose the final layout). Without this, generating a motion under
  // "split-bottom" and later switching to "avatar-only" would still render
  // 50/50 in the export, mismatching what the preview shows. Mirrors the
  // preview's derivation in ReelsStudio.tsx so preview and export agree.
  const motionLayer: NonNullable<ScriptBlock['motion']>['layer'] | undefined = (() => {
    const raw = block.motion?.layer;
    if (!raw) return undefined;
    if (block.kind === 'broll') return raw;
    switch (block.layout) {
      case 'avatar-only': return 'overlay';
      case 'avatar-top':  return 'split-bottom';
      case 'media-top':   return 'split-top';
      case 'media-only':  return 'replace';
      default:            return raw;
    }
  })();
  const motionUrl = motionUrls.get(block.id);
  // ACTUAL measured MP4 duration of the motion clip — when the Hyperframes
  // timeline is shorter than the block (frequent: Gemini animates 3-4s but
  // block lasts 6s), the player holds the last frame for the gap. Using the
  // configured `block.motion.durationSec` (a 4s default) misses this entirely.
  // Falls back to the configured value if the URL hasn't been measured yet.
  const measuredMotionDur = motionUrl ? clipDurations.get(motionUrl) : undefined;
  const motionDur = measuredMotionDur ?? (block.motion?.durationSec || 4);
  // Seek is clamped slightly before clip end to avoid WebKit seek-to-end
  // timeouts; the fade is done via motionAlpha (overrunAlpha) so the visible
  // last-frame freeze becomes a fade-out instead of a hard hold.
  const motionSeek = Math.min(localT, motionDur - 0.05);
  // Skip the overrun fade entirely when the motion clip is at least as long
  // as the block — the clip has frames for every moment of the block, so
  // there's nothing to mask and the artificial dimming was reading as a
  // "piscada" on every transition (the screen briefly darkens in the last
  // 200ms of each block before the cross-dissolve catches up). The fade
  // remains active only when the clip is genuinely shorter than the block,
  // which is the case the helper was originally designed for.
  //
  // 0.05s tolerance (~1.5 frame) absorbs float mismatch between the
  // configured durationSec and the measured MP4 length from HyperFrames.
  const blockDur = block.end - block.start;
  const motionCoversBlock = motionDur >= blockDur - 0.05;
  const motionAlpha = motionCoversBlock
    ? 1
    : overrunAlpha(localT, motionDur, motionDur);

  // Hide the avatar in the last AVATAR_TAIL_CUT_FRAMES of every block. HeyGen
  // freezes the avatar's last frames after the audio ends (no more lipsync
  // signal → mouth stops), and showing those frozen frames reads as "robot
  // pose held mid-air" right before each transition. Cutting them early lets
  // the next block's content cover what would otherwise be a dead robot face.
  // Computed once per frame and reused by both split and standalone avatar
  // codepaths below.
  const avatarVisibleDur = block.avatarVisibleSec ?? blockDur;
  const avatarCutBeforeSec = AVATAR_TAIL_CUT_FRAMES / FRAMERATE;
  const avatarEarlyCut = localT >= Math.max(0, avatarVisibleDur - avatarCutBeforeSec);

  // Motion-replace: full frame.
  if (motionLayer === 'replace' && motionUrl) {
    if (motionAlpha <= 0) return { layers: [], decorations: [] };
    return { layers: [{ videoUrl: motionUrl, sourceSeek: motionSeek, box: FULL_FRAME, alpha: motionAlpha }], decorations: [] };
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
    if (clip?.videoUrl && !avatarEarlyCut) {
      const zoom = block.avatarZoom ?? 1;
      // Fallback: block's intended avatar visibility (avatarVisibleSec or full
      // block). Without this fallback, an unmeasured avatar clip would skip
      // the overrun fade entirely and freeze on its last frame at boundary.
      const avatarFallbackDur = block.avatarVisibleSec ?? (block.end - block.start);
      const alpha = overrunAlpha(localT, clipDurations.get(clip.videoUrl), avatarFallbackDur);
      if (alpha > 0) {
        layers.push({ videoUrl: clip.videoUrl, sourceSeek: localT, box: avatarBox, zoom, offsetY: block.avatarOffsetY, alpha });
      }
    }
    if (motionAlpha > 0) {
      layers.push({ videoUrl: motionUrl, sourceSeek: motionSeek, box: motionBox, alpha: motionAlpha });
    }
    return { layers, decorations: [{ kind: 'split-seam', splitY: 0.5 }] };
  }

  const blockLayout: BlockLayout = block.kind === 'avatar' ? (block.layout ?? 'avatar-only') : 'media-only';
  const slots = getLayoutSlots(blockLayout);
  const layers: FrameLayer[] = [];
  const decorations: FrameDecoration[] = [];

  // Avatar layer.
  if (block.kind === 'avatar' && slots.avatar) {
    const stillVisible = block.avatarVisibleSec === undefined || localT < block.avatarVisibleSec;
    if (stillVisible && !avatarEarlyCut) {
      const clip = inputs.avatarClips[block.id];
      if (clip?.videoUrl) {
        const zoom = block.avatarZoom ?? defaultAvatarZoom(inputs.aspect, block.layout);
        const avatarFallbackDur = block.avatarVisibleSec ?? (block.end - block.start);
        const alpha = overrunAlpha(localT, clipDurations.get(clip.videoUrl), avatarFallbackDur);
        if (alpha > 0) {
          layers.push({ videoUrl: clip.videoUrl, sourceSeek: localT, box: slots.avatar, zoom, offsetY: block.avatarOffsetY, alpha });
        }
      }
    } else if (inputs.activeTake) {
      // B-roll loops via mapBrollTime — never freezes, so no overrun fade.
      const localBroll = localT - (block.avatarVisibleSec ?? 0);
      layers.push({ videoUrl: inputs.activeTake.url, sourceSeek: mapBrollTime(localBroll, inputs.activeTake), box: slots.avatar });
    }
  }

  // Media layer (B-roll take). B-roll loops, no overrun fade needed.
  if (slots.media && inputs.activeTake) {
    layers.push({ videoUrl: inputs.activeTake.url, sourceSeek: mapBrollTime(localT, inputs.activeTake), box: slots.media });
  }

  // Motion overlay — lower-third style: lives in the bottom 33% so the
  // avatar's face stays clean (TV news kicker pattern). Screen blend + contrast
  // tweak makes the motion's black backdrop disappear so the type/graphics
  // float over the bottom of the frame like a real broadcast lower-third.
  if (motionLayer === 'overlay' && motionUrl && motionAlpha > 0) {
    // Floating overlay band (NOT a TV-style lower-third). Lives at y:0.58–0.80
    // of the frame — center-lower, above the platform UI zone (bottom 15-20%
    // of Reels/TikTok/Shorts is occluded by likes/comments/caption rail).
    const LOWER_THIRD: LayoutBox = { x: 0, y: 0.58, w: 1, h: 0.22 };
    layers.push({
      videoUrl: motionUrl,
      sourceSeek: motionSeek,
      box: LOWER_THIRD,
      alpha: motionAlpha,
      blend: 'screen',
      filter: 'contrast(1.35) brightness(1.05)',
    });
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
  clipDurations: Map<string, number>,
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
  // Default transition for middle blocks is now 'cut' (hard cut). Modern
  // short-form (Reels/TikTok) pacing prefers cuts: motion graphics already
  // animate their own entrances via GSAP, and any cross-fade applied on top
  // dims the first 100ms perceptibly. First-block-incoming and last-block-
  // outgoing keep 'fade' so the reel opens/closes from/to black cleanly.
  const incomingTransition: BlockTransition = prevBlock ? (prevBlock.transition ?? 'cut') : 'fade';
  const outgoingTransition: BlockTransition = block.transition ?? (nextBlock ? 'cut' : 'fade');

  const inFadeRegion = localFrame < FADE_FRAMES;
  const outFadeRegion = localFrame > totalBlockFrames - FADE_FRAMES;

  const own = composeForBlock(block, localT, inputs, motionUrls, clipDurations);
  const layers: FrameLayer[] = [...own.layers];
  const decorations: FrameDecoration[] = [...own.decorations];

  // Transition logic — black fade / cross-blend / new effects.
  // For "fancy" transitions (whip-pan, zoom-blur, glitch, light-flash) we still
  // use cross-blend as the base but tweak layer offsets/filters for the effect.
  let fadeAlpha = 1;
  if (inFadeRegion) {
    if (incomingTransition === 'fade' || (!prevBlock && true)) {
      fadeAlpha = Math.min(fadeAlpha, localFrame / FADE_FRAMES);
    } else if (prevBlock && prevSlot && incomingTransition !== 'cut') {
      const prevDur = prevSlot.sourceEnd - prevSlot.sourceStart;
      const prevLocalT = prevDur - ((FADE_FRAMES - localFrame) / FRAMERATE);
      // When the previous block is shorter than the fade window, prevLocalT
      // goes negative. Clamping to 0 (the old behavior) drew the FIRST frame
      // of the previous block during the fade-in — a visible time-jump back
      // to the start of that clip. Falling through to "last available frame"
      // instead keeps the transition reading as a clean cross-dissolve from
      // the end of prev into the start of own.
      const safePrevLocalT = prevLocalT < 0
        ? Math.max(0, prevDur - 1 / FRAMERATE)
        : prevLocalT;
      const prev = composeForBlock(prevBlock, safePrevLocalT, inputs, motionUrls, clipDurations);
      const t = localFrame / FADE_FRAMES; // 0..1 (going from prev → current)
      applyTransition(incomingTransition, prev.layers, layers, decorations, t, 'in');
    }
    // 'cut': nothing extra — just show this frame at full alpha.
  }
  if (outFadeRegion) {
    if (outgoingTransition === 'fade' || !nextBlock) {
      fadeAlpha = Math.min(fadeAlpha, (totalBlockFrames - localFrame) / FADE_FRAMES);
    }
    // 'dissolve' / other cross-fade transitions intentionally skip the
    // outgoing region — the cross-fade is now done ENTIRELY in the
    // incoming region of the next block. Running it on both sides created
    // a discontinuity at the boundary (B's alpha jumped from ~0.83 at A's
    // last frame down to 0 at B's first frame, then climbed back to 1
    // across B's first 6 frames), which the eye reads as a flash. With
    // the fade only on B's incoming side, A plays to its last frame at
    // full alpha and B cleanly fades in on top of it for 6 frames.
  }
  fadeAlpha = Math.max(0, Math.min(1, fadeAlpha));

  return { layers, decorations, fadeAlpha };
};

/**
 * Apply a transition effect during the FADE_FRAMES window.
 * - `incoming` (mode='in'):  fromLayers = prev (going OUT), toLayers = own (already in `layers`, COMING IN). t goes 0→1.
 * - `outgoing` (mode='out'): fromLayers = own (going OUT, already in `layers`), toLayers = next (COMING IN). t goes 0→1.
 *
 * For 'in' mode we PREPEND prev layers (drawn first / underneath).
 * For 'out' mode we APPEND next layers (drawn last / on top).
 *
 * The layers param is mutated in-place to keep allocations down — this runs
 * inside the per-frame hot path.
 */
const applyTransition = (
  type: BlockTransition,
  fromLayers: FrameLayer[],
  toLayers: FrameLayer[],
  decorations: FrameDecoration[],
  t: number,
  mode: 'in' | 'out',
): void => {
  // The caller's `layers` (the array that's actually rendered) is `toLayers` in
  // 'in' mode and `fromLayers` in 'out' mode — that's because the caller passes
  // (prev, own) for 'in' and (own, next) for 'out'. Resolve the visible container
  // once so both helpers and the math below read symmetrically.
  const visible = mode === 'in' ? toLayers : fromLayers;
  const leavingLayers = fromLayers;
  const enteringLayers = mode === 'in' ? fromLayers : toLayers;

  // prependFrom: take "leaving" layers, mutate, and prepend them to the visible
  // stack so they draw underneath. For 'out' the leaving layers ARE the visible
  // ones — mutate in place (no prepend needed).
  const prependFrom = (mutators: (l: FrameLayer) => FrameLayer) => {
    if (mode === 'in') {
      for (let i = leavingLayers.length - 1; i >= 0; i--) {
        visible.unshift(mutators(leavingLayers[i]));
      }
    } else {
      for (let i = 0; i < visible.length; i++) {
        visible[i] = mutators(visible[i]);
      }
    }
  };
  // appendTo: take "entering" layers (in 'in' the own layers already in visible
  // at offset prev.length; in 'out' the next block's layers separate from
  // visible) and apply mutators + ensure they sit at the end of visible.
  const appendTo = (mutators: (l: FrameLayer) => FrameLayer) => {
    if (mode === 'in') {
      const start = leavingLayers.length;
      for (let i = start; i < visible.length; i++) {
        visible[i] = mutators(visible[i]);
      }
    } else {
      for (const lyr of enteringLayers) {
        visible.push(mutators(lyr));
      }
    }
  };

  switch (type) {
    case 'dissolve': {
      // Cross-blend correto: o canvas2d com source-over já produz a fórmula
      // ideal `final = entering*t + leaving*(1-t)` quando o leaving é
      // desenhado em alpha=1 e o entering em cima com alpha=t. O código
      // antigo aplicava (1-t) também no leaving, o que com source-over vira
      // `entering*t + leaving*(1-t)²` — midpoint do fade ficava com 25% de
      // dimming, lido pelo olho humano como uma "piscada escura" entre os
      // blocos. Leaving fica em alpha cheio; só o entering varia.
      const enteringAlpha = t;
      prependFrom(l => ({ ...l, alpha: l.alpha ?? 1 }));
      appendTo(l => ({ ...l, alpha: (l.alpha ?? 1) * enteringAlpha }));
      return;
    }

    case 'whip-pan': {
      // Horizontal whip — leaving slides left, entering enters from right.
      // Both keep full alpha; motion is felt through translation + slight blur.
      const motionBlur = Math.sin(t * Math.PI) * 8; // peak blur at midpoint
      const blurFilter = motionBlur > 0.5 ? `blur(${motionBlur}px)` : undefined;
      prependFrom(l => ({
        ...l,
        offsetX: (l.offsetX ?? 0) - t,           // -0 → -1 (off-screen left)
        filter: blurFilter,
      }));
      appendTo(l => ({
        ...l,
        offsetX: (l.offsetX ?? 0) + (1 - t),     // +1 → 0
        filter: blurFilter,
      }));
      return;
    }

    case 'zoom-blur': {
      // Dramatic zoom — leaving shrinks + blurs out, entering blows up + blurs in.
      const leavingZoom = 1 + t * 0.4;            // 1.0 → 1.4 (zoom IN as it leaves)
      const enteringZoom = 1.3 - t * 0.3;         // 1.3 → 1.0
      const leavingBlur = t * 18;                  // 0 → 18px
      const enteringBlur = (1 - t) * 18;           // 18 → 0
      prependFrom(l => ({
        ...l,
        zoom: (l.zoom ?? 1) * leavingZoom,
        alpha: (l.alpha ?? 1) * (1 - t),
        filter: leavingBlur > 0.5 ? `blur(${leavingBlur}px)` : undefined,
      }));
      appendTo(l => ({
        ...l,
        zoom: (l.zoom ?? 1) * enteringZoom,
        alpha: (l.alpha ?? 1) * t,
        filter: enteringBlur > 0.5 ? `blur(${enteringBlur}px)` : undefined,
      }));
      return;
    }

    case 'glitch': {
      // Digital RGB split + frame jitter. Deterministic — uses t to seed a
      // pseudo-random shift so each frame in the transition is consistent.
      // We base the jitter on t so it's reproducible across renders.
      const intensity = Math.sin(t * Math.PI); // peaks at midpoint
      const seed = Math.floor(t * 6) / 6;       // 6 discrete jitter steps across the window
      const rgbR = (seed * 17) % 1 * 12 - 6;    // -6..+6 px R offset
      const rgbB = (seed * 13) % 1 * 12 - 6;    // -6..+6 px B offset
      const xJitter = ((seed * 11) % 1) * 0.04 - 0.02; // ±2% width
      const split = {
        r: rgbR * intensity,
        g: 0,
        b: rgbB * intensity,
      };
      const leavingAlpha = 1 - t;
      const enteringAlpha = t;
      prependFrom(l => ({
        ...l,
        offsetX: (l.offsetX ?? 0) + xJitter,
        alpha: (l.alpha ?? 1) * leavingAlpha,
        rgbSplit: split,
      }));
      appendTo(l => ({
        ...l,
        offsetX: (l.offsetX ?? 0) + xJitter,
        alpha: (l.alpha ?? 1) * enteringAlpha,
        rgbSplit: split,
      }));
      return;
    }

    case 'light-flash': {
      // White flash at the midpoint + cross-blend.
      const leavingAlpha = 1 - t;
      const enteringAlpha = t;
      prependFrom(l => ({ ...l, alpha: (l.alpha ?? 1) * leavingAlpha }));
      appendTo(l => ({ ...l, alpha: (l.alpha ?? 1) * enteringAlpha }));
      // Flash peaks at t=0.5, fades fast on both sides.
      const flashAlpha = Math.max(0, 1 - Math.abs(t - 0.5) * 4); // 0 at t=0.25/0.75, 1 at t=0.5
      if (flashAlpha > 0) {
        decorations.push({ kind: 'flash', flashColor: '#ffffff', flashAlpha });
      }
      return;
    }

    default: {
      // 'cut' and 'fade' are handled outside this function.
      return;
    }
  }
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
    // Snapshot each video's actual MP4 duration so the composer can detect
    // overrun (audio longer than HeyGen clip) and fade the avatar out instead
    // of holding a frozen final frame.
    const clipDurations = new Map<string, number>();
    for (const [url, v] of videoMap.entries()) {
      if (Number.isFinite(v.duration) && v.duration > 0) clipDurations.set(url, v.duration);
    }
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

    /** Draw a video frame into a normalized box with cover-fit (crop). Respects alpha + blend + offsetY/X + filter + rgbSplit. */
    const drawIntoBox = (
      v: HTMLVideoElement,
      box: LayoutBox,
      zoom = 1,
      alpha = 1,
      blend: BlendMode = 'source-over',
      offsetY = 0,
      offsetX = 0,
      filter?: string,
      rgbSplit?: { r: number; g: number; b: number },
    ) => {
      const srcW = v.videoWidth;
      const srcH = v.videoHeight;
      const dx = box.x * width + offsetX * width;
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
      if (filter) ctx.filter = filter;
      if (rgbSplit) {
        // Cheap RGB channel split: 3 passes with channel-tinted compositing.
        // Each pass offsets the frame slightly in x for that channel. Cost: 3x drawImage
        // but only runs during a transition window (~6 frames), so the total per-render
        // cost is negligible.
        ctx.globalCompositeOperation = 'lighter';
        // Red channel
        ctx.filter = `${filter ?? ''} url(#__no_red__)`.trim();
        // Without SVG filters, we approximate by tinting via globalCompositeOperation 'lighter'
        // and drawing 3 offset copies — the visual effect of RGB shear is good enough.
        ctx.drawImage(v, sx, sy, sw, sh, dx + rgbSplit.r, dy, dw, dh);
        ctx.drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh);
        ctx.drawImage(v, sx, sy, sw, sh, dx + rgbSplit.b, dy, dw, dh);
        ctx.filter = 'none';
        ctx.globalCompositeOperation = blend;
      } else {
        ctx.drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh);
      }
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    // ─── VIDEO PASS ──────────────────────────────────────────────────
    onProgress({ phase: 'rendering', framesDone: 0, totalFrames, message: 'Renderizando frames...' });

    const microsPerFrame = 1_000_000 / FRAMERATE;
    let lastThumbAt = 0;
    // Track which block is being rendered so we can scope the seek-timeout
    // counter per block. Without this, three slow seeks across a transition
    // (3 layers × ~400ms each in a single fade frame) flag the video as
    // permanently broken for the rest of the export — even if the video is
    // perfectly fine and the slowness was just temporary I/O pressure.
    let lastFrameBlockId: string | null = null;

    for (let frame = 0; frame < totalFrames; frame++) {
      if (cancelled) {
        videoEncoder.close();
        audioEncoder?.close();
        throw new Error('Cancelado');
      }

      const outT = frame / FRAMERATE;
      const projT = mapOutToProject(outT);
      const composition = frameAtProjectTime(projT, inputs, layout, motionUrls, clipDurations);

      // Reset seek-timeout counters on block boundaries. This keeps the
      // "broken video" classification scoped to a single block — a video
      // that timed-out once at a transition is given a fresh budget at the
      // next block instead of being silently skipped for the whole export.
      // `brokenVideoUrls` is intentionally NOT cleared: a video that hits 3
      // consecutive timeouts within a single block is genuinely broken.
      const frameHit = hitTest(layout, projT);
      const currentBlockId = frameHit.kind === 'block' ? frameHit.slot.blockId : null;
      // Capture the boundary BEFORE we mutate lastFrameBlockId so the encoder
      // below can force a keyframe on the first frame of every new block. An
      // I-frame at the boundary keeps the bloco-trocou transition crisp instead
      // of relying on P-frame motion compensation across a large visual delta.
      const blockBoundaryNow = currentBlockId !== lastFrameBlockId;
      if (blockBoundaryNow) {
        for (const v of videoMap.values()) timeoutCount.delete(v);
        lastFrameBlockId = currentBlockId;
      }

      drawBlackFrame();

      // Empty-block fallback: only paint the text-placeholder slide when
      // the block was genuinely never given any visual — no motion configured,
      // no avatar clip available, no active take. Without that guard the
      // placeholder also triggered whenever a configured motion *temporarily*
      // produced no layers (motionAlpha=0 during the tail overrun fade, or a
      // replace-motion that ended a beat before the block did) and rendered
      // the block's spoken text on a dark gradient — a jarring "ghost caption"
      // mid-reel. Showing nothing (black) for those one-or-two frames is far
      // less surprising than burning in the spoken sentence.
      const decodedLayers = composition.layers.filter(l => videoMap.has(l.videoUrl));
      if (decodedLayers.length === 0) {
        // Reuse the hitTest computed above for block-boundary tracking.
        if (frameHit.kind === 'block') {
          const block = inputs.blocks.find(b => b.id === frameHit.slot.blockId);
          if (block) {
            const hasMotion = !!block.motion?.videoPath;
            const hasAvatarClip = block.kind === 'avatar' && !!inputs.avatarClips[block.id]?.videoUrl;
            const hasTake = !!inputs.activeTake;
            if (!hasMotion && !hasAvatarClip && !hasTake) {
              drawTextPlaceholder(block.text);
            }
          }
        }
      }

      // Draw video layers with their blend mode + alpha.
      for (const lyr of composition.layers) {
        const v = videoMap.get(lyr.videoUrl);
        if (!v) continue;
        await seekVideo(v, lyr.sourceSeek, cancelSignal);
        // Defensive verification: the `seeked` event can fire before the
        // decoder has actually presented the new frame for `drawImage` to
        // read (race common with heavy H.264 streams — e.g. when motion
        // contains an embedded asset video). If currentTime didn't land
        // within 1.5 frames of the target, retry the seek once. After this
        // single retry we draw regardless; a 1-frame mismatch is preferable
        // to freezing the previous frame.
        if (!brokenVideoUrls.has(v)) {
          const target = Math.max(0, Math.min(v.duration || lyr.sourceSeek, lyr.sourceSeek));
          if (Math.abs(v.currentTime - target) > 0.05) {
            console.warn('[render] currentTime mismatch after seek · target=', target.toFixed(3), '· cur=', v.currentTime.toFixed(3), '· retrying');
            await seekVideo(v, lyr.sourceSeek, cancelSignal);
          }
        }
        drawIntoBox(v, lyr.box, lyr.zoom ?? 1, lyr.alpha ?? 1, lyr.blend ?? 'source-over', lyr.offsetY ?? 0, lyr.offsetX ?? 0, lyr.filter, lyr.rgbSplit);
      }

      // Draw decorations (gradients, seam, vignette, transition flash) on top of video layers.
      for (const dec of composition.decorations) {
        if (dec.kind === 'bottom-gradient') drawBottomGradient();
        else if (dec.kind === 'vignette') drawVignette();
        else if (dec.kind === 'split-seam' && dec.splitY != null) drawSplitSeam(dec.splitY * height);
        else if (dec.kind === 'flash' && dec.flashAlpha != null) {
          ctx.globalAlpha = dec.flashAlpha;
          ctx.fillStyle = dec.flashColor ?? '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.globalAlpha = 1;
        }
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
      // Force keyframe on the first frame of each block in addition to the
      // 2s heartbeat. Without this, the first frame of a new block depends on
      // P-frame motion compensation from the previous block's last frame — a
      // big visual delta that the encoder approximates poorly at any bitrate,
      // showing up as a "piscada" / smeared frame in the user-perceived
      // transition. Cost: ~1 extra I-frame per block (~5-10% byte overhead
      // local to that frame, amortized over the whole clip).
      const forceKeyframe = blockBoundaryNow || frame % (FRAMERATE * 2) === 0;
      if (blockBoundaryNow) {
        console.log('[render] keyframe forced at block boundary · frame=', frame, '· blockId=', currentBlockId);
      }
      videoEncoder.encode(videoFrame, { keyFrame: forceKeyframe });
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
