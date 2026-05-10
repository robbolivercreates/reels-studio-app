export type BlockKind = 'avatar' | 'broll';

import type { MotionConfig } from './motionLibrary';
import type { StylePresetId } from './motionStylePresets';

/**
 * Visual layouts for avatar blocks. Determines how avatar + B-roll share the screen.
 *  - avatar-only:   avatar fills the whole frame (default, current behaviour)
 *  - media-only:    B-roll fills the frame; avatar is hidden (audio still plays)
 *  - avatar-top:    upper half = avatar, lower half = B-roll
 *  - media-top:     upper half = B-roll, lower half = avatar
 */
export type BlockLayout = 'avatar-only' | 'media-only' | 'avatar-top' | 'media-top';

/**
 * Transition that plays AT THE END of this block, into the next one.
 *  - cut:      no transition, hard cut (no black, no dissolve)
 *  - fade:     fade to black at end + fade in next block from black (legacy default ~333ms)
 *  - dissolve: cross-dissolve avatar A → avatar B over ~333ms with audio cross-fade
 * undefined = 'fade' (current behaviour, kept for back-compat).
 */
export type BlockTransition = 'cut' | 'fade' | 'dissolve';

/**
 * Tone override applied when regenerating a script in the preview panel.
 * `current` = no override (keep voiceProfile defaults).
 */
export type ToneOption = 'current' | 'more-direct' | 'more-casual' | 'more-didactic';

/**
 * Optional regeneration context passed to script-generation services.
 * Used by the preview panel to ask Gemini to diverge from a previous
 * attempt and apply user feedback / tone tweaks.
 */
export interface RegenerateContext {
  extraInstructions?: string;
  previousAttempt?: { kind: BlockKind; text: string }[];
  toneOverride?: ToneOption;
}

/**
 * Asset attached by the user to a single block. Shown as overlay on the top
 * half (50/50 split with avatar). When present, motion generation prioritises
 * this asset as the visual centerpiece instead of choosing freely from the
 * project's universal Assets folder.
 */
export interface AttachedAsset {
  /** Filename, e.g. "logo.png" — used as label in the UI. */
  name: string;
  /** Absolute path on disk (Tauri `convertFileSrc` converts to asset://). */
  path: string;
  /** Drives whether the timeline plays it as <video> or shows as <img>. */
  type: 'image' | 'video';
}

export interface ScriptBlock {
  id: string;
  kind: BlockKind;
  text: string;
  /** Source timestamps in the Minimax audio (seconds). */
  start: number;
  end: number;
  /** True if text changed (or visibility changed) after audio/clip was generated. */
  dirty?: boolean;
  /**
   * Avatar-only: how many seconds of the block the avatar is visible (from the start).
   * The audio still plays the full block; once the avatar disappears, B-roll covers it.
   * undefined = avatar visible for the full block.
   */
  avatarVisibleSec?: number;
  /**
   * Avatar blocks only: which visual layout to use for this block.
   * undefined = avatar-only (default).
   */
  layout?: BlockLayout;
  /**
   * Avatar blocks only: zoom factor applied to the avatar video (1 = no zoom, 2 = 2x crop).
   * Used to crop a 16:9 avatar into a 9:16 reel without letterbox bars.
   * undefined = 1.0 (no zoom).
   */
  avatarZoom?: number;
  /**
   * Avatar blocks only: vertical offset for the avatar within its slot.
   * Range -0.5..0.5 (fraction of slot height). Positive = move down, negative = move up.
   * undefined = 0 (centered).
   */
  avatarOffsetY?: number;
  /**
   * Optional motion graphic associated with this block. Rendered by Remotion.
   * undefined = no motion. Picker assigns this via `set-block-motion`.
   */
  motion?: MotionConfig;
  /**
   * Optional per-block style preset override. When set, motion generation
   * uses this preset instead of the seed default ('glass-tech'). Lets the
   * user pick a vibe per block without entering the advanced motion editor.
   */
  stylePresetOverride?: StylePresetId;
  /**
   * Optional ordered list of user-attached assets (images/videos) from the
   * project's universal Assets folder. When the list has at least one item,
   * the block auto-uses a media layout (split for avatar, full for broll) and
   * motion generation builds a sequential carousel:
   *   - 1 asset:    asset is the protagonist for the full block duration
   *   - N assets:   each gets `block_duration / N` seconds, fade transitions
   *
   * Legacy field `attachedAsset` (single) is migrated to a 1-element array on
   * hydration. New code reads/writes `attachedAssets` exclusively.
   */
  attachedAssets?: AttachedAsset[];
  /** @deprecated kept on the type only so the hydrator can still see it. Migrated to attachedAssets. */
  attachedAsset?: AttachedAsset;
  /**
   * Transition into the NEXT block. undefined = default fade (back-compat).
   * Last block's value is ignored (no next block).
   */
  transition?: BlockTransition;
}

export type AudioStatus = 'idle' | 'generating' | 'ready' | 'error';

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  blockId: string;
}

export type SilencePreset = 'natural' | 'fast' | 'super';

export interface AudioState {
  status: AudioStatus;
  /** Object URL pointing to the active MP3 blob (cut or original). */
  url: string | null;
  /** Total duration in seconds (of the current url). */
  duration: number;
  /** Per-sample peaks for waveform rendering, normalised 0..1, length = WAVEFORM_BUCKETS. */
  peaks: number[];
  /** Word-level timestamps. When cuts are applied, these are remapped too. */
  words: WordTimestamp[];
  /** Voice id used for the most recent generation. */
  voiceId: string | null;
  /** Error message if status === 'error'. */
  error: string | null;
  /** When true, playback + export use the cut audio. */
  silenceCut: boolean;
  /** Aggressiveness preset for silence detection. */
  silencePreset: SilencePreset;
  /** Non-silent regions to keep, in seconds (in *source* time of the original audio). */
  keepSegments: { start: number; end: number }[];
  /** Total seconds detected as silence under the current preset. */
  detectedSilenceSec: number;
  /** True while running detection in background. */
  detectingSilence: boolean;
  /** True while the worker is re-encoding the cut MP3. */
  applyingCuts?: boolean;
  /**
   * When cuts are applied, this is true and the state's `url`, `duration`,
   * `peaks`, `words` and `blocks` are all in compressed timeline; original
   * data is restored from IndexedDB on revert.
   */
  cutsApplied?: boolean;
  /**
   * When cuts are applied, snapshot of the original block timings so we can
   * revert without re-running word alignment.
   */
  originalBlocks?: ScriptBlock[];
  /** When cuts are applied, snapshot of the original word timings. */
  originalWords?: WordTimestamp[];
  /** When cuts are applied, snapshot of original duration. */
  originalDuration?: number;
  /** When cuts are applied, snapshot of original peaks. */
  originalPeaks?: number[];
}

export type ClipStatus = 'idle' | 'queued' | 'uploading' | 'submitting' | 'rendering' | 'ready' | 'error';

export interface AvatarClipState {
  blockId: string;
  status: ClipStatus;
  message?: string;
  videoUrl?: string;
  error?: string;
}

export type HeyGenModelChoice = 'avatar3' | 'avatar4';

export interface KeepSegmentSec {
  start: number;
  end: number;
}

export interface ScreenTake {
  id: string;
  name: string;
  durationMs: number;
  /** Object URL pointing to the blob in IndexedDB. Recreated on hydration. */
  url: string;
  hasAudio: boolean;
  createdAt: number;
  /** Source of the take. */
  source: 'recording' | 'upload';
  /** Trim points in seconds. trimEnd defaults to full duration. */
  trimStart: number;
  trimEnd: number;
  /** Whether to skip silent regions during playback. */
  cutSilence: boolean;
  /** Pre-computed keep segments (post-silence-detection). Empty until detection runs. */
  keepSegments: KeepSegmentSec[];
  /** Total seconds of detected silence (for UI display). */
  detectedSilenceSec: number;
}

/**
 * Snapshot of the most recent video-reference analysis. Persisted with the project
 * so the production plan stays available after reload. We store it as `unknown`-shaped
 * lightweight data here to avoid circular imports with the service layer.
 */
export interface PersistedAnalysis {
  language: string;
  format: string;
  hookStyle: string;
  tone: string[];
  durationSec: number;
  /** Block ids in the script at the time of analysis. Direction[i] aligns with this list. */
  blockIds: string[];
  directions: {
    blockIndex: number;
    delivery: string;
    framing: string;
    screenAction?: string;
    mood: string;
  }[];
  brollSuggestions: { blockText: string; idea: string }[];
  production: {
    setup: string;
    watchOuts: string[];
    soundbed: string;
  };
  /**
   * Faithful transcript of the original creator's audio, with timestamps.
   * Always in the SOURCE language — used in the production plan to show
   * what the other person actually did, regardless of the user's rewrite level.
   */
  originalTranscript: { start: number; end: number; text: string }[];
  /**
   * Per-block originals (kind + verbatim text in source language). Same length
   * as `directions`. The user's blocks (reels state) may have been rewritten,
   * but this stays untouched as a reference for the plan.
   */
  originalBlocks: { kind: 'avatar' | 'broll'; text: string }[];
  /** Source reference file name + url (for traceability). */
  sourceFileName?: string;
  sourceUrl?: string;
  /** When the analysis was generated. */
  createdAt: number;
}

/** Minimax HD 2.8 emotion presets. Drives voice expression on TTS generation. */
export type ReelEmotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'surprised';

export interface ReelsState {
  projectName: string;
  blocks: ScriptBlock[];
  audio: AudioState;
  selectedVoiceId: string;
  aspect: '9:16' | '16:9' | '1:1';
  avatarClips: Record<string, AvatarClipState>; // keyed by blockId
  avatarModel: HeyGenModelChoice;
  selectedPhotoId: string | null;
  takes: ScreenTake[];
  activeTakeId: string | null;
  /** Most recent video-reference analysis. Cleared by `replace-blocks` only when not provided. */
  lastAnalysis?: PersistedAnalysis;
  /** History of analyses (newest first). Capped to keep storage bounded. */
  analyses: PersistedAnalysis[];
  /** Selected voice emotion (applied to all blocks on next audio generation). */
  emotion: ReelEmotion;
  /** Voice pacing multiplier 0.85..1.2 (Minimax `speed`). 1.0 = normal. */
  voiceSpeed: number;
  /**
   * Cached brand identity for the reel. Set once when the FIRST motion is
   * generated (via Gemini Google Search grounding). All subsequent motions in
   * this reel reuse it so the visual identity stays consistent across blocks.
   * Cleared when blocks are replaced (replace-blocks action).
   * Stored as Record<string, unknown> to avoid circular import with the service.
   */
  brandIdentity?: Record<string, unknown>;
}

export type ReelsAction =
  | { type: 'set-name'; name: string }
  | { type: 'add-block'; afterId?: string }
  | { type: 'duplicate-block'; id: string }
  | { type: 'remove-block'; id: string }
  | { type: 'update-block-text'; id: string; text: string }
  | { type: 'toggle-block-kind'; id: string }
  | { type: 'move-block'; id: string; direction: 'up' | 'down' }
  | { type: 'reorder-blocks'; orderedIds: string[] }
  | { type: 'set-block-transition'; id: string; transition: BlockTransition }
  | { type: 'set-brand-identity'; brand: Record<string, unknown> | undefined }
  | { type: 'replace-blocks'; blocks: ScriptBlock[]; analysis?: PersistedAnalysis }
  | { type: 'remove-analysis'; createdAt: number }
  | { type: 'set-avatar-visible-sec'; id: string; sec: number | undefined }
  | { type: 'set-block-layout'; id: string; layout: BlockLayout }
  | { type: 'set-avatar-zoom'; id: string; zoom: number }
  | { type: 'set-avatar-offset-y'; id: string; offsetY: number }
  | { type: 'set-block-motion'; id: string; motion: MotionConfig | undefined }
  | { type: 'set-block-assets'; id: string; assets: AttachedAsset[] | undefined }
  | { type: 'add-block-asset'; id: string; asset: AttachedAsset }
  | { type: 'remove-block-asset'; id: string; index: number }
  | { type: 'reorder-block-assets'; id: string; fromIndex: number; toIndex: number }
  | { type: 'set-block-style-preset'; id: string; preset: StylePresetId | undefined }
  | { type: 'set-block-style-preset-cascade'; id: string; preset: StylePresetId | undefined }
  | { type: 'split-block'; id: string; atSec: number }
  | { type: 'set-voice'; voiceId: string }
  | { type: 'set-emotion'; emotion: ReelEmotion }
  | { type: 'set-voice-speed'; speed: number }
  | { type: 'set-aspect'; aspect: ReelsState['aspect'] }
  | { type: 'audio-start' }
  | { type: 'audio-success'; url: string; duration: number; peaks: number[]; words: WordTimestamp[]; voiceId: string }
  | { type: 'audio-error'; error: string }
  | { type: 'reset-audio' }
  | { type: 'audio-silence-toggle'; on: boolean }
  | { type: 'audio-silence-preset'; preset: SilencePreset }
  | { type: 'audio-silence-detect-start' }
  | { type: 'audio-silence-detect-done'; keepSegments: { start: number; end: number }[]; detectedSilenceSec: number }
  | { type: 'audio-cuts-applying' }
  | {
      type: 'audio-cuts-apply-done';
      url: string;
      duration: number;
      peaks: number[];
      words: WordTimestamp[];
      blocks: ScriptBlock[];
      // Snapshots so revert doesn't need to re-run anything.
      originalBlocks: ScriptBlock[];
      originalWords: WordTimestamp[];
      originalDuration: number;
      originalPeaks: number[];
    }
  | { type: 'audio-cuts-revert'; url: string }
  | { type: 'audio-cuts-cancel' }
  | { type: 'set-avatar-model'; model: HeyGenModelChoice }
  | { type: 'set-photo'; photoId: string }
  | { type: 'clip-update'; blockId: string; status: ClipStatus; message?: string; videoUrl?: string; error?: string }
  | { type: 'clear-clips' }
  | { type: 'add-take'; take: ScreenTake }
  | { type: 'remove-take'; id: string }
  | { type: 'rename-take'; id: string; name: string }
  | { type: 'update-take'; id: string; patch: Partial<ScreenTake> }
  | { type: 'set-active-take'; id: string | null }
  | { type: 'hydrate'; state: ReelsState };

export const WAVEFORM_BUCKETS = 240;
