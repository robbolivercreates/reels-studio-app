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
export type BlockTransition = 'cut' | 'fade' | 'dissolve' | 'whip-pan' | 'zoom-blur' | 'glitch' | 'light-flash';

/**
 * Tone override applied when regenerating a script in the preview panel.
 * `current` = no override (keep voiceProfile defaults).
 */
export type ToneOption = 'current' | 'more-direct' | 'more-casual' | 'more-didactic';

/**
 * Content transformation mode — how the source becomes a reel.
 *  - compress: keep wording, just shorter (good for short Reels/TikToks → Reel)
 *  - adapt:    rewrite in the user's voice, same content
 *  - trailer:  promise + glimpse + CTA-bait (NOT a tutorial — long-form → Reel)
 */
export type ContentMode = 'compress' | 'adapt' | 'trailer';

/**
 * Output language override applied per-generation (chip in the preview panel).
 * `auto` = use the voice profile's outputLanguage. Anything else overrides it.
 */
export type LanguageOption = 'auto' | 'pt-BR' | 'en-US' | 'es-ES' | 'fr-FR' | 'it-IT' | 'de-DE';

/**
 * Optional regeneration context passed to script-generation services.
 * Used by the preview panel to ask Gemini to diverge from a previous
 * attempt and apply user feedback / tone tweaks.
 */
export interface RegenerateContext {
  extraInstructions?: string;
  previousAttempt?: { kind: BlockKind; text: string }[];
  toneOverride?: ToneOption;
  /** When set (and not 'auto'), forces this output language regardless of voice profile. */
  languageOverride?: LanguageOption;
  /** When set, applies the corresponding mode prompt (compress/adapt/trailer). */
  contentMode?: ContentMode;
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
   * Avatar blocks only: per-block photo override. When set, the avatar
   * clip for this block is generated using this AvatarPhoto.id instead
   * of the project's globally selected `selectedPhotoId`. Lets the user
   * use different photos/poses across blocks of the same reel.
   * undefined = inherit the project-level photo.
   */
  avatarPhotoId?: string;
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
   * Optional per-block Gemini model override for motion generation. Holds a
   * MotionModelId value (e.g. 'gemini-3.1-pro-preview'). When set, that model
   * is the first candidate for THIS block's motion (re)generation, instead of
   * the global localStorage choice — so each block can use its own model.
   * Undefined = follow the global default.
   */
  motionModelOverride?: string;
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
   * Per-block opt-out from the asset-attachment gate. When the project folder
   * has assets but this block intentionally doesn't need one (e.g. text-only
   * motion graphic), set this to true and the motion generation runs without
   * any pinned asset for this block. Default undefined = gate applies.
   * Toggled via "Continuar sem asset" in the AssetPickerModal.
   */
  skipAssetGate?: boolean;
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

export type HeyGenModelChoice = 'avatar3' | 'avatar4' | 'avatar5';

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
  /**
   * Vertical framing shift, fraction of frame height (-0.4..0.4). Positive
   * pulls the video DOWN (revealing black at the top — e.g. clearing space
   * for a floating overlay), negative pulls it up. Edit-mode base video.
   */
  offsetY?: number;
  /** Whether to skip silent regions during playback. */
  cutSilence: boolean;
  /** Pre-computed keep segments (post-silence-detection). Empty until detection runs. */
  keepSegments: KeepSegmentSec[];
  /** Total seconds of detected silence (for UI display). */
  detectedSilenceSec: number;
}

/**
 * "Editar vídeo pronto" mode — an independent overlay element placed over the
 * base video. NOT tied 1:1 to blocks: the user drops as many as they want, each
 * with its own timing/position, and chooses per element whether it floats over
 * the video (`overlay`) or takes the whole frame (`fullscreen`). This is the
 * Wave-2 "elements editor" model — completely separate from the generative
 * `block.motion` (which is untouched). Only used when `projectMode === 'edit'`.
 */
export interface OverlayElement {
  id: string;
  /** Element type: 'text' = caption/keyword typed by user;
   * 'motion' = AI-generated HyperFrames overlay (screen-blend over the video). */
  kind: 'text' | 'motion';
  /** When it appears, on the project (audio) timeline. */
  startSec: number;
  /** How long it stays. */
  durationSec: number;
  /** overlay = floats over the video (screen-blend); fullscreen = covers it;
   * split-top/split-bottom = motion fills one half, base video the other.
   * @deprecated superseded by `placement` — kept for hydration of old projects. */
  mode: 'overlay' | 'fullscreen' | 'split-top' | 'split-bottom';
  /** Vertical anchor 0..1 (for overlay mode; centered horizontally). Default 0.58.
   * @deprecated superseded by `placement.y`. */
  y: number;
  /** Overlay band height as fraction of frame. Default 0.22 (22% = lower-third).
   * @deprecated superseded by `placement.height`. */
  overlayH?: number;
  /** Unified placement (where the motion sits). When present, wins over
   * mode/y/overlayH — resolved via `placementOfElement()` in motionLibrary. */
  placement?: import('./motionLibrary').MotionPlacement;
  text: string;
  /** Optional text styling (text kind only). */
  color?: string;
  fontScale?: number;
  /** Motion config — populated after AI generation + render (motion kind only). */
  motion?: MotionConfig;
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
  /** Cost tracking properties */
  actualCostUSD?: number;
  actualTokens?: { prompt: number; candidates: number };
  /** Cached viral breakdown — avoids re-analysing the same video. */
  viralBreakdown?: import('../../services/viralBreakdownService').ViralBreakdown;
}

/** Minimax HD 2.8 emotion presets. Drives voice expression on TTS generation. */
export type ReelEmotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'surprised';

/**
 * Global color mode applied to every motion generated in this reel.
 * 'dark'  = presets use their native dark backgrounds (default, previous behaviour).
 * 'light' = dark presets get a forced light-background override so the whole reel
 *            feels bright — useful for lifestyle, educational, or daytime content.
 * Light presets (editorial-clean, soft-pastel, warm-editorial) are unaffected by
 * this setting — they are always light.
 */
export type MotionColorMode = 'dark' | 'light';

/**
 * App-wide UI theme. Controls the COLOR OF THE APP CHROME — top bar, panels,
 * modals, sidebars. Independent from `motionColorMode`, which controls how the
 * rendered motion content looks. The two are intentionally decoupled so a user
 * can edit in a dark IDE-feel and still author light-mode motion content (or
 * vice versa).
 */
export type AppTheme = 'dark' | 'light';

export interface ReelsState {
  /** Stable identifier for this project in the named_projects store. Set on creation/migration; never changes after that. */
  activeProjectId: string | null;
  projectName: string;
  blocks: ScriptBlock[];
  audio: AudioState;
  selectedVoiceId: string;
  aspect: '9:16' | '16:9' | '1:1' | 'carousel';
  avatarClips: Record<string, AvatarClipState>; // keyed by blockId
  avatarModel: HeyGenModelChoice;
  selectedPhotoId: string | null;
  takes: ScreenTake[];
  activeTakeId: string | null;
  /** Global light/dark mode for motion generation. Default: 'dark'. */
  motionColorMode: MotionColorMode;
  /**
   * Energy/pacing nudge for motion generation. 'minimal' = slow, restraint,
   * fewer particles. 'energetic' = fast, kinetic, more punch. Default: 'energetic'.
   * Cascades into the system prompt as a single paragraph instruction.
   */
  motionEnergy: 'minimal' | 'energetic';
  /** App UI theme (top bar, panels, modals). Default: 'dark'. */
  appTheme: AppTheme;
  /**
   * Sticky layout for new avatar blocks. Whenever the user changes the layout
   * of an avatar block, this is updated; new avatar blocks (via add-block or
   * resplit-blocks) inherit this value instead of falling back to a hardcoded
   * default. Default: 'avatar-top'.
   */
  lastAvatarLayout: BlockLayout;
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
  /**
   * Project mode. 'generate' (default) = the classic script→TTS→avatar→motion
   * flow. 'edit' = "Editar vídeo pronto": an uploaded video is the full-frame
   * base track, its extracted audio is the master, and blocks are time-anchors
   * for motions/captions over it. See `baseVideoTake`.
   */
  projectMode?: 'generate' | 'edit';
  /**
   * Edit mode only: the uploaded video that serves as the full-frame base
   * layer for the entire project. Its audio drives the master clock and its
   * keepSegments (silence cut) skip both video and audio. Undefined in
   * 'generate' mode.
   */
  baseVideoTake?: ScreenTake;
  /**
   * Edit mode only: independent overlay elements (text/captions/graphics) the
   * user places over the base video. Separate from `block.motion`. Undefined
   * or empty in 'generate' mode.
   */
  overlayElements?: OverlayElement[];
}

export type ReelsAction =
  | { type: 'set-name'; name: string }
  | { type: 'set-active-project-id'; id: string | null }
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
  | { type: 'resplit-blocks'; blocks: ScriptBlock[]; words: WordTimestamp[]; removedIds: string[]; oldIdToHeadId: Record<string, string> }
  | { type: 'remove-analysis'; createdAt: number }
  | { type: 'set-avatar-visible-sec'; id: string; sec: number | undefined }
  | { type: 'set-block-layout'; id: string; layout: BlockLayout }
  | { type: 'set-avatar-zoom'; id: string; zoom: number }
  | { type: 'set-avatar-offset-y'; id: string; offsetY: number }
  | { type: 'set-block-avatar-photo'; id: string; photoId: string | undefined }
  | { type: 'set-block-motion'; id: string; motion: MotionConfig | undefined }
  | { type: 'set-block-assets'; id: string; assets: AttachedAsset[] | undefined }
  | { type: 'add-block-asset'; id: string; asset: AttachedAsset }
  | { type: 'remove-block-asset'; id: string; index: number }
  | { type: 'reorder-block-assets'; id: string; fromIndex: number; toIndex: number }
  | { type: 'set-block-skip-asset-gate'; id: string; skip: boolean }
  | { type: 'set-block-style-preset'; id: string; preset: StylePresetId | undefined }
  | { type: 'set-block-motion-model'; id: string; model: string | undefined }
  | { type: 'set-block-style-preset-cascade'; id: string; preset: StylePresetId | undefined }
  | { type: 'split-block'; id: string; atSec: number }
  | { type: 'set-voice'; voiceId: string }
  | { type: 'set-emotion'; emotion: ReelEmotion }
  | { type: 'set-voice-speed'; speed: number }
  | { type: 'set-aspect'; aspect: ReelsState['aspect'] }
  | { type: 'set-motion-color-mode'; mode: MotionColorMode }
  | { type: 'set-motion-energy'; energy: 'minimal' | 'energetic' }
  | { type: 'set-app-theme'; theme: AppTheme }
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
  /** Edit-video: vertical framing shift of the base video (fraction of frame height). */
  | { type: 'set-base-video-offset-y'; offsetY: number }
  | { type: 'update-take'; id: string; patch: Partial<ScreenTake> }
  | { type: 'set-active-take'; id: string | null }
  // Convert the CURRENT project into edit-video mode, reusing the take that's
  // already loaded as the base video (no re-import / re-transcribe).
  | { type: 'enter-edit-mode' }
  // Overlay elements (edit-video mode) — independent of block.motion.
  | { type: 'add-overlay-element'; element: OverlayElement }
  | { type: 'update-overlay-element'; id: string; patch: Partial<OverlayElement> }
  | { type: 'remove-overlay-element'; id: string }
  /** Set the MotionConfig on a 'motion' OverlayElement after AI generation + render. */
  | { type: 'set-overlay-motion'; id: string; motion: MotionConfig }
  | {
      // "Editar vídeo pronto": load an uploaded video as the base track and
      // seed blocks + master audio from its Whisper transcript.
      type: 'edit-video-loaded';
      baseVideoTake: ScreenTake;
      blocks: ScriptBlock[];
      audioUrl: string;
      duration: number;
      peaks: number[];
      words: WordTimestamp[];
    }
  | { type: 'hydrate'; state: ReelsState };

export const WAVEFORM_BUCKETS = 240;
