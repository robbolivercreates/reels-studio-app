export type BlockKind = 'avatar' | 'broll';

import type { MotionConfig } from './motionLibrary';

/**
 * Visual layouts for avatar blocks. Determines how avatar + B-roll share the screen.
 *  - avatar-only:   avatar fills the whole frame (default, current behaviour)
 *  - media-only:    B-roll fills the frame; avatar is hidden (audio still plays)
 *  - avatar-top:    upper half = avatar, lower half = B-roll
 *  - media-top:     upper half = B-roll, lower half = avatar
 */
export type BlockLayout = 'avatar-only' | 'media-only' | 'avatar-top' | 'media-top';

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
  /** Object URL pointing to the generated MP3 blob. */
  url: string | null;
  /** Total duration in seconds (from decoded buffer). */
  duration: number;
  /** Per-sample peaks for waveform rendering, normalised 0..1, length = WAVEFORM_BUCKETS. */
  peaks: number[];
  /** Word-level timestamps (estimated proportionally from text + duration). */
  words: WordTimestamp[];
  /** Voice id used for the most recent generation. */
  voiceId: string | null;
  /** Error message if status === 'error'. */
  error: string | null;
  /** When true, playback + export skip silent regions in keepSegments. */
  silenceCut: boolean;
  /** Aggressiveness preset for silence detection. */
  silencePreset: SilencePreset;
  /** Non-silent regions to keep, in seconds. Empty when not yet detected. */
  keepSegments: { start: number; end: number }[];
  /** Total seconds detected as silence under the current preset. */
  detectedSilenceSec: number;
  /** True while running detection in background. */
  detectingSilence: boolean;
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
}

export type ReelsAction =
  | { type: 'set-name'; name: string }
  | { type: 'add-block'; afterId?: string }
  | { type: 'remove-block'; id: string }
  | { type: 'update-block-text'; id: string; text: string }
  | { type: 'toggle-block-kind'; id: string }
  | { type: 'move-block'; id: string; direction: 'up' | 'down' }
  | { type: 'replace-blocks'; blocks: ScriptBlock[]; analysis?: PersistedAnalysis }
  | { type: 'remove-analysis'; createdAt: number }
  | { type: 'set-avatar-visible-sec'; id: string; sec: number | undefined }
  | { type: 'set-block-layout'; id: string; layout: BlockLayout }
  | { type: 'set-avatar-zoom'; id: string; zoom: number }
  | { type: 'set-avatar-offset-y'; id: string; offsetY: number }
  | { type: 'set-block-motion'; id: string; motion: MotionConfig | undefined }
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
