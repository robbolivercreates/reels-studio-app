/**
 * Editing playbook — direction rules distilled from production short-form
 * workflows (IBRA motion-pack ecosystem: short-form-video playbook + Motion
 * Philosophy "gold standard" deconstruction).
 *
 * These are PROMPT CONSTANTS injected into Gemini motion generation:
 *   - EDITING_PACING_RULES → only when generating overlays for the
 *     video-editing pipeline (overlayMode / layer 'overlay')
 *   - MOTION_LAWS_BRIEF + EASING_DICTIONARY → all freeform generations
 *
 * Keep them short — every token here is paid on every generation.
 */

/** Pacing rules for motion overlays composited over real footage. */
export const EDITING_PACING_RULES = `
--- OVERLAY PACING RULES (footage-overlay direction) ---
1. NO dead frames: at least one element must be animating every 100ms. If primaries land early, add secondary motion (drift, pulse, shimmer) through the full duration.
2. One attention moment per ~5s: a typography slam, stamp, glitch or whip — not more (exhausting), not less (boring).
3. Entrances start 0.1-0.3s AFTER the scene begins — never at t=0 (feels machine-cut).
4. Any reveal must HOLD at least 1s on screen before exiting.
5. Stamp/badge overlays land AFTER their target text is fully visible — 0.10-0.25s after the target's entrance completes (setup, then punchline).
6. Vary easing across entrances — two consecutive elements must not share the same ease.
7. The overlay must never cover the speaker's face. Keep primary content in the lower half unless explicitly told otherwise.`.trim();

/** The 11 motion laws, compressed to what changes generation output. */
export const MOTION_LAWS_BRIEF = `
--- MOTION LAWS (premium grammar) ---
- ONE idea per beat. A scene states a single concept, then moves on (~1.5-2s average).
- Light over color: premium feel comes from gradients, halos, glows and vignettes — not saturated hues. Max 5 active colors, each with ONE assigned meaning (e.g. green=success, red=problem). Never decorative color.
- Typography is performance: display type scales big (or morphs/compresses); it carries ~60% of the story.
- Continuous motion: even "static" holds breathe (drift, rotation, particle float). Stillness reads as death — EXCEPT hero moments (logo/CTA/final stat), which earn a deliberate 2-5s hold.
- Timeline integrity: end every timeline with a no-op anchor tl.to({}, { duration: TOTAL_SECONDS }, 0) so the composition never goes black before its slot ends.`.trim();

/** Easing/stagger dictionary — concrete numbers beat adjectives. */
export const EASING_DICTIONARY = `
--- EASING DICTIONARY ---
word/text reveals: expo.out 0.20-0.33s · generic entries: power2.out 0.2-0.5s · exits: power2.in 0.2-0.33s · whips/transitions: expo.in 0.2-0.33s · bouncy settle: back.out(1.2-1.5) 0.3-0.5s · camera pans: power2.inOut 1.2-2.3s · staggers: 0.04s/element (grids: 0.019s/column)`.trim();

/**
 * Karaoke caption spec — concrete values for word-sync caption generation.
 * (Reserved for when karaoke-captions is reimplemented as a native preset.)
 */
export const KARAOKE_CAPTION_SPEC = `
--- KARAOKE CAPTION SPEC ---
Font weight 900, 46-58px, 100% white. Active word: scale pop to 1.08 (0.08-0.12s) + accent color + readability stroke via text-shadow (NEVER -webkit-text-stroke). One <span> per word. No background pill.`.trim();

/**
 * Caption/typography tone table + timing semantics — straight from the
 * HyperFrames prompting guide. Injected into ALL freeform generations so the
 * model picks typography + animation + scale coherent with the content's tone
 * instead of defaulting to one generic look.
 */
export const CAPTION_TONES = `
--- TONE → TYPOGRAPHY/ANIMATION TABLE (pick ONE per composition, match the speech's energy) ---
Hype:         heavy weight (800-900), scale-pop entrances, 72-96px headline
Corporate:    clean sans 600-700, fade + slide entrances, 56-72px
Tutorial:     monospace, typewriter reveals, 48-64px
Storytelling: serif or soft sans, slow fades, 44-56px
Social:       rounded playful sans 700-800, bounce entrances, 56-80px

--- TIMING SEMANTICS (entrance/transition durations carry meaning) ---
fast 0.2s = energy · medium 0.4s = professional · slow 0.6s = luxury · very slow 1-2s = cinematic
Pick durations from the TONE you chose, not at random.`.trim();
