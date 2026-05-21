/**
 * Categorization helper for motion style presets.
 *
 * The 19 presets in `STYLE_PRESETS` (motionStylePresets.ts) split into two
 * conceptual families that should be treated differently in the UI:
 *
 *   STYLE — Visual mood (paleta + typography + motion grammar). Applies to any
 *           block. The user picks one based on the vibe they want.
 *
 *   EFFECT — Shot template / component with a semantic trigger. Notification
 *            banner, stat counter, browser-frame screenshot wrap, etc. Often
 *            auto-suggested by the deterministic detector based on block
 *            content (text, asset count, audio words, position).
 *
 *   NATIVE — Built programmatically in motionService without a Gemini round
 *            trip. Out of scope for the picker UI. Currently only `claude-ui`.
 *
 * This module is the single source of truth. The Inspector renders two grids
 * (one for STYLE, one for EFFECT) by filtering STYLE_PRESETS through
 * `STYLE_PRESET_IDS` / `EFFECT_PRESET_IDS`. A new preset added to
 * motionStylePresets.ts without being categorized here will fail typecheck
 * via the exhaustive switch in `categoryOf`.
 */

import type { StylePresetId } from './motionStylePresets';

export type PresetCategory = 'style' | 'effect' | 'native';

/** Style presets — full palette + typography + motion grammar definers.
 *
 * Note: `kinetic-bold` exists in the StylePresetId union and STYLE_PRESETS
 * array (so persisted motions using it still render correctly), but is
 * intentionally OMITTED from this list — the user preferred presets that
 * embrace illustration/explanation over typography-only motions. The id
 * is preserved for backwards-compat; new motions won't pick it from the
 * picker. See HIDDEN_PRESET_IDS below for the recorded exclusion. */
export const STYLE_PRESET_IDS = [
  'editorial-clean',
  'bold-pop',
  'glass-tech',
  'soft-pastel',
  'cinematic-dark',
  'apple-system',
  'warm-editorial',
  'illustrated-explainer',
  'animado-notion',
] as const satisfies readonly StylePresetId[];

/** Style/effect ids that exist in the union (so historical motions keep
 * working) but are hidden from the Inspector picker. Add ids here when a
 * preset is being deprecated without a hard migration. */
export const HIDDEN_PRESET_IDS = [
  'kinetic-bold',
  // karaoke-captions hidden until reimplemented as a NATIVE preset (no
  // Gemini). Gemini cannot reliably emit per-word timing GSAP — output
  // drifts out of sync with the TTS audio. See NOTES.md "Karaokê sync".
  'karaoke-captions',
  // Style consolidation (2026-05-19): user opted to keep only 4 focused
  // Style presets visible — editorial-clean, bold-pop, glass-tech,
  // illustrated-explainer. The 4 below stay in the union so historical
  // motions keep rendering; they just disappear from the picker. If a
  // detector rule recommends one of them, that's redirected by
  // effectDetector to a visible preset.
  'soft-pastel',
  'cinematic-dark',
  'apple-system',
  'warm-editorial',
] as const satisfies readonly StylePresetId[];

/** Effect presets — shot templates with a semantic trigger; eligible for auto-suggest. */
export const EFFECT_PRESET_IDS = [
  'social-cta-follow',
  'counter-reveal',
  'notification-pop',
  'map-zoom',
  'logo-outro',
  'browser-chrome',
  'phone-mockup',
  'pip-talking-head',
  'before-after-split',
  'karaoke-captions',
  'icon-callout',
] as const satisfies readonly StylePresetId[];

/** Native presets — bypass Gemini, built programmatically in motionService. */
export const NATIVE_PRESET_IDS = ['claude-ui'] as const satisfies readonly StylePresetId[];

/**
 * Exhaustive categorization. Each preset id maps to exactly one category.
 * If a new preset is added to `StylePresetId` but not handled here, the
 * `_exhaustive: never` line below fails compile — that's the safety net.
 */
export const categoryOf = (id: StylePresetId): PresetCategory => {
  switch (id) {
    case 'editorial-clean':
    case 'bold-pop':
    case 'glass-tech':
    case 'kinetic-bold': // hidden from picker but kept categorized for legacy motions
    case 'soft-pastel':
    case 'cinematic-dark':
    case 'apple-system':
    case 'warm-editorial':
    case 'illustrated-explainer':
    case 'animado-notion':
      return 'style';
    case 'social-cta-follow':
    case 'counter-reveal':
    case 'notification-pop':
    case 'map-zoom':
    case 'logo-outro':
    case 'browser-chrome':
    case 'phone-mockup':
    case 'pip-talking-head':
    case 'before-after-split':
    case 'karaoke-captions':
    case 'icon-callout':
      return 'effect';
    case 'claude-ui':
      return 'native';
    default: {
      const _exhaustive: never = id;
      void _exhaustive;
      return 'style';
    }
  }
};

export const isStyle = (id: StylePresetId): boolean => categoryOf(id) === 'style';
export const isEffect = (id: StylePresetId): boolean => categoryOf(id) === 'effect';
export const isNative = (id: StylePresetId): boolean => categoryOf(id) === 'native';
export const isHidden = (id: StylePresetId): boolean =>
  (HIDDEN_PRESET_IDS as readonly StylePresetId[]).includes(id);
