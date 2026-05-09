/**
 * Style presets for motion graphics generated via HyperFrames.
 *
 * Each preset is a curated bundle of: palette + typography + animation grammar.
 * Gemini receives these as constraints when generating the HTML composition,
 * so output stays visually consistent across blocks while still being unique
 * per content.
 *
 * The user picks a preset; Gemini generates HTML respecting it.
 */

export type StylePresetId =
  | 'editorial-clean'
  | 'bold-pop'
  | 'glass-tech'
  | 'kinetic-bold'
  | 'soft-pastel'
  | 'cinematic-dark'
  | 'apple-system'
  | 'warm-editorial';

/**
 * Whether the preset's intrinsic mood is dark, light, or warm cream/paper.
 * Used to drive the no-brand fallback in motionService — a preset like
 * `warm-editorial` should never fall back to pure #000000 + #ffffff just
 * because Gemini didn't find brand colours.
 */
export type PresetBgType = 'dark' | 'light' | 'warm';

/**
 * Atmosphere palette baked into each preset. Replaces the previous global
 * "ATMOSPHERE BAKE A/B/C" picker that competed with the preset's own
 * colour story. Each motion's track-0 background is rendered from this
 * palette so atmosphere stays coherent with the chosen style.
 */
export interface AtmospherePalette {
  /** CSS background colour for the base layer (no gradient — flat). */
  baseBg: string;
  /** First radial glow (top-leftish corner) — `[colour, alphaPct]`. */
  warmGlow: { color: string; alpha: number; pos: string };
  /** Second radial glow (opposite corner). */
  coolGlow: { color: string; alpha: number; pos: string };
  /** Vignette opacity 0–1 (multiplier on the host CSS box-shadow). */
  vignetteIntensity: number;
}

export interface StylePreset {
  id: StylePresetId;
  /** Display name in PT-BR. */
  label: string;
  /** Short PT-BR description shown to user. */
  description: string;
  /** Single emoji icon for the picker chip. */
  emoji: string;
  /** When this preset shines (a sentence to help the user choose). */
  bestFor: string;
  /** Intrinsic mood for fallback decisions. */
  bgType: PresetBgType;
  /** Atmosphere baked into the preset (replaces generic ATMOSPHERE BAKE). */
  atmosphere: AtmospherePalette;
  /** Detailed style brief sent to Gemini. Written in English (LLMs respond better). */
  geminiBrief: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'editorial-clean',
    label: 'Editorial limpo',
    description: 'Tipografia grande, fundo neutro, motion sutil.',
    emoji: '📰',
    bestFor: 'Conteúdo informativo, didático, profissional.',
    bgType: 'light',
    atmosphere: {
      baseBg: '#fafafa',
      warmGlow: { color: '#000000', alpha: 0.04, pos: '20% 30%' },
      coolGlow: { color: '#000000', alpha: 0.03, pos: '80% 70%' },
      vignetteIntensity: 0.3,
    },
    geminiBrief: `
PALETTE: USE THE BRAND IDENTITY COLORS PROVIDED ABOVE — do not invent colors.
  bg: brandBackgroundColor
  text: brandTextColor
  accent: brandPrimaryColor (sparingly)
  muted: brandSecondaryColor

TYPOGRAPHY:
  primary: "Inter", system-ui, sans-serif
  weights: 400 (body), 600 (headings), 800 (display)
  display sizes: 96-180px
  letter-spacing: -2 to -4 on display
  line-height: 1.05 on display, 1.4 on body

LAYOUT:
  generous whitespace, content centered or thirds
  no decorative borders, minimal use of accent color
  one focal element at a time

MOTION:
  ease: power3.inOut, power2.out
  durations: 0.6-1.2s for entries, 0.4-0.8s for exits
  prefer fade + small translate (8-20px) over scale
  no rotation, no overshoot
  staggered reveals (0.04-0.08s stagger)`.trim(),
  },
  {
    id: 'bold-pop',
    label: 'Bold pop',
    description: 'Cores vibrantes, transições rápidas, energia alta.',
    emoji: '🔥',
    bestFor: 'Vídeos virais, hooks emocionais, conteúdo de venda.',
    bgType: 'dark',
    atmosphere: {
      baseBg: '#0a0a0f',
      warmGlow: { color: '#ff5a3c', alpha: 0.18, pos: '20% 25%' },
      coolGlow: { color: '#7b3cff', alpha: 0.16, pos: '80% 75%' },
      vignetteIntensity: 0.7,
    },
    geminiBrief: `
PALETTE: USE THE BRAND IDENTITY COLORS PROVIDED ABOVE — do not invent colors.
  bg: linear-gradient(135deg, brandBackgroundColor 0%, [a 15% lighter shade of brandBackgroundColor] 100%) — keep it dark, the gradient should be subtle, derived from the brand bg color
  text: brandTextColor
  accent1: brandPrimaryColor
  accent2: brandAccentColor
  accent3: brandSecondaryColor

TYPOGRAPHY:
  primary: "Inter", system-ui, sans-serif
  weights: 700 (body bold), 900 (display)
  display sizes: 110-220px
  letter-spacing: -3 to -5
  text-shadow on display: 0 0 40px accent

LAYOUT:
  large blocky shapes
  layered geometric backgrounds (circles, rotated rects)
  text often has accent box behind it

MOTION:
  ease: back.out(2), elastic.out, power4.out
  durations: 0.3-0.7s (fast)
  use scale (0.5 → 1.05 → 1.0 overshoot)
  rotation accents (-12deg → 0)
  particle bursts on focal moments
  staggered word-by-word reveals`.trim(),
  },
  {
    id: 'glass-tech',
    label: 'Glass tech',
    description: 'Frosted glass, gradiente cyan, vibe tecnológica.',
    emoji: '💎',
    bestFor: 'Conteúdo sobre tecnologia, IA, software, ferramentas.',
    bgType: 'dark',
    atmosphere: {
      baseBg: '#08080f',
      warmGlow: { color: '#7850c8', alpha: 0.18, pos: '20% 30%' },
      coolGlow: { color: '#ff8c3c', alpha: 0.14, pos: '80% 70%' },
      vignetteIntensity: 0.7,
    },
    geminiBrief: `
PALETTE: USE THE BRAND IDENTITY COLORS PROVIDED ABOVE — do not invent colors.
  bg: radial-gradient(ellipse at top, brandBackgroundColor 0%, #000 80%)
  text: brandTextColor
  accent: brandPrimaryColor
  glow: brandPrimaryColor at 60% alpha (use rgba conversion)
  glass-bg: rgba(255,255,255,0.08)
  glass-border: rgba(255,255,255,0.18)

TYPOGRAPHY:
  primary: "Inter", system-ui, sans-serif
  weights: 500, 700
  display sizes: 80-160px
  letter-spacing: -1.5 to -2.5

LAYOUT:
  frosted glass cards (backdrop-filter: blur(20px))
  thin glowing borders in brandPrimaryColor
  brandPrimaryColor accent particles drifting in background
  grid lines very faint at 8% opacity

MOTION:
  ease: power2.inOut, sine.inOut
  durations: 0.8-1.5s (calm, deliberate)
  prefer opacity + filter (blur 20px → 0)
  subtle floating animation on glass cards (continuous)
  glow pulse on accents (yoyo)`.trim(),
  },
  {
    id: 'kinetic-bold',
    label: 'Kinetic bold',
    description: 'Tipografia como protagonista, palavras explodindo.',
    emoji: '🎯',
    bestFor: 'Frases de impacto, manchetes, declarações.',
    bgType: 'dark',
    atmosphere: {
      baseBg: '#000000',
      warmGlow: { color: '#ffffff', alpha: 0.05, pos: '50% 40%' },
      coolGlow: { color: '#ffffff', alpha: 0.03, pos: '50% 80%' },
      vignetteIntensity: 0.5,
    },
    geminiBrief: `
PALETTE: USE THE BRAND IDENTITY COLORS PROVIDED ABOVE — do not invent colors.
  bg: brandBackgroundColor (or pure #000 if bg is dark)
  text: brandTextColor
  highlight-bg: brandPrimaryColor (block behind keyword)
  alt-color: brandAccentColor

TYPOGRAPHY:
  primary: "Inter", system-ui, sans-serif
  weights: 800, 900
  display sizes: 140-280px (HUGE)
  letter-spacing: -4 to -8
  line-height: 0.9 (tight)

LAYOUT:
  text fills the canvas
  one or two words on screen at a time
  important word gets brandPrimaryColor block background
  mask-style reveals (clip-path)

MOTION:
  ease: power4.out, expo.out
  durations: 0.25-0.5s (snappy)
  word-by-word reveals with stagger (0.06-0.1s)
  use clip-path: inset(0 100% 0 0) → inset(0 0 0 0) for wipe-in
  highlighted words get a quick scale punch (1 → 1.08 → 1)
  no fade — only motion + clip-path`.trim(),
  },
  {
    id: 'soft-pastel',
    label: 'Suave pastel',
    description: 'Tons claros, animações orgânicas, lifestyle.',
    emoji: '🌸',
    bestFor: 'Conteúdo lifestyle, feminino, beleza, bem-estar.',
    bgType: 'light',
    atmosphere: {
      baseBg: '#fdf2f8',
      warmGlow: { color: '#ec4899', alpha: 0.20, pos: '25% 25%' },
      coolGlow: { color: '#c026d3', alpha: 0.15, pos: '75% 75%' },
      vignetteIntensity: 0.25,
    },
    geminiBrief: `
PALETTE: USE THE BRAND IDENTITY COLORS PROVIDED ABOVE if they fit a soft/pastel mood.
  Otherwise default to the soft-pastel palette below.
  bg: linear-gradient(135deg, brandBackgroundColor or #FDF2F8 0%, lighter shade 50%, lighter shade 100%)
  text: brandTextColor or #831843 (deep rose)
  accent1: brandPrimaryColor or #EC4899 (pink)
  accent2: brandAccentColor or #C026D3 (fuchsia)
  decoration: brandSecondaryColor or #F9A8D4

TYPOGRAPHY:
  primary: "Playfair Display", serif (for display)
  body: "Inter", sans-serif
  weights: 400, 600
  display sizes: 80-140px
  italic on display sometimes
  letter-spacing: -1

LAYOUT:
  organic blob shapes in background (SVG)
  floating decorative dots
  soft drop shadows (0 4px 20px rgba)

MOTION:
  ease: sine.inOut, power1.inOut
  durations: 1.0-1.8s (gentle)
  vertical drift on background blobs (continuous, slow)
  fade + scale 0.95 → 1 entries
  no overshoot, no snap`.trim(),
  },
  {
    id: 'cinematic-dark',
    label: 'Cinemático escuro',
    description: 'Filmico, vinheta, baixo contraste, dramático.',
    emoji: '🎬',
    bestFor: 'Storytelling, momentos emocionais, drama.',
    bgType: 'dark',
    atmosphere: {
      baseBg: '#08080a',
      warmGlow: { color: '#3a2a1a', alpha: 0.25, pos: '30% 25%' },
      coolGlow: { color: '#1a2030', alpha: 0.20, pos: '70% 75%' },
      vignetteIntensity: 0.85,
    },
    geminiBrief: `
PALETTE: USE THE BRAND IDENTITY COLORS PROVIDED ABOVE — do not invent colors.
  bg: brandBackgroundColor → slightly lighter shade (radial)
  text: brandTextColor
  accent: brandPrimaryColor (or brandAccentColor for highlights)
  vignette: rgba(0,0,0,0.6)

TYPOGRAPHY:
  primary: "Inter", system-ui, sans-serif
  weights: 300 (light), 700 (bold)
  display sizes: 60-120px
  letter-spacing: 1-3 (wider, cinematic)
  uppercase common
  line-height: 1.5

LAYOUT:
  letterboxed feel (16:9 framing inside the 9:16 canvas)
  strong vertical asymmetry
  film grain overlay (very subtle, 4% opacity)
  vignette on edges

MOTION:
  ease: power3.inOut
  durations: 1.2-2.0s (slow, deliberate)
  long fades (0.8-1.5s)
  almost no movement on text — just opacity
  background may have very slow zoom (1.0 → 1.05 over 5s)
  film burn / light leak transitions`.trim(),
  },
  {
    id: 'apple-system',
    label: 'Sistema Apple',
    description: 'Precisão de OS, glass frosted, easing suave.',
    emoji: '🍎',
    bestFor: 'Demos de app, walkthroughs técnicos, tutoriais de produto.',
    bgType: 'dark',
    atmosphere: {
      baseBg: '#1a1a1a',
      warmGlow: { color: '#ffffff', alpha: 0.04, pos: '20% 25%' },
      coolGlow: { color: '#0084ff', alpha: 0.10, pos: '80% 75%' },
      vignetteIntensity: 0.55,
    },
    geminiBrief: `
PALETTE: Apple OS aesthetic — restrained, system-grade.
  bg: brandBackgroundColor if it is dark (#0a0a0a–#1a1a1a) OR pure '#1a1a1a'
      For "tutorial" / "configuração" / "como" content, you MAY swap to a light
      variant: '#f5f5f7' bg with '#1d1d1f' text and '#0084ff' accent. Pick light
      OR dark, never mix.
  text: brandTextColor (or '#ffffff' on dark / '#1d1d1f' on light)
  accent: '#0084ff' (Apple system blue) — overrides brandPrimaryColor for highlights
  glass-bg: rgba(255,255,255,0.08) on dark / rgba(0,0,0,0.04) on light
  glass-border: rgba(255,255,255,0.18) on dark / rgba(0,0,0,0.10) on light
  separator: rgba(255,255,255,0.12) on dark / rgba(0,0,0,0.10) on light

TYPOGRAPHY:
  primary: "Space Grotesk", "Inter", system-ui, -apple-system, sans-serif (use class="font-tech")
  weights: 500 (body), 600 (headings) — NEVER 800-900, that's not Apple
  display sizes: 64-128px (more restrained than other presets)
  letter-spacing: -0.02em on display, -0.01em on body
  line-height: 1.1 on display, 1.4 on body

LAYOUT:
  snap-to-grid 12px (every position should be a multiple of 12)
  generous breathing room — minimum 48px gutters
  glass-frosted cards with backdrop-filter: blur(20px) saturate(180%)
  rounded corners: 14px (cards), 18px (windows), 9px (buttons)
  thin 1px borders using glass-border colour
  optional macOS window chrome: three traffic-light dots (red #ff5f57, amber #febc2e, green #28c840) at top-left, 12px each, 8px gaps
  optional REC badge or filename pill in corner
  selected items get a 2px '#0084ff' border or '#0084ff' fill at 0.18 alpha

MOTION:
  ease: power3.out, power3.inOut (cubic — NEVER back.out, NEVER elastic)
  durations: 0.4-0.8s (snappy but smooth, not bouncy)
  prefer fade + small translate (≤40px), short scale 0.95→1
  no rotation accidents, no overshoot
  staggers: 0.04-0.06s
  selection highlight pulses subtly (opacity 1.0 ↔ 0.85 over 1.2s)
  visual signature: a card "snaps" into a slot — quick scale punch from 0.92→1 with a 1px border highlight that fades at 0.4s

VOICE:
  Quiet, precise, OS-like. The motion should feel like macOS itself, not
  like a flashy reel. Less is more. If a frame can be calmer without losing
  meaning, calm it.`.trim(),
  },
  {
    id: 'warm-editorial',
    label: 'Editorial aquecido',
    description: 'Cream paper, terracotta, motion contemplativo.',
    emoji: '🍂',
    bestFor: 'Lifestyle, viagem, beleza, story humano.',
    bgType: 'warm',
    atmosphere: {
      baseBg: '#f5ede0',
      warmGlow: { color: '#d4714d', alpha: 0.22, pos: '25% 25%' },
      coolGlow: { color: '#c9a563', alpha: 0.18, pos: '78% 78%' },
      vignetteIntensity: 0.20,
    },
    geminiBrief: `
PALETTE: Warm editorial — cream paper, deep brown ink, terracotta accent.
  bg: '#f5ede0' (warm cream paper) — DO NOT make it pure white, DO NOT make it dark
  text: '#2d2d2d' (deep warm brown — NEVER pure black '#000000')
  accent: '#d4714d' (terracotta) — overrides brandPrimaryColor unless brand is already a warm earth tone
  secondary: '#c9a563' (warm gold)
  muted: '#8b7355' (warm taupe)
  shadows: ALL shadows must be warm — '0 8px 30px rgba(120, 80, 40, 0.18)' style. NEVER black shadows.

TYPOGRAPHY:
  primary display: "Anton", "Inter", sans-serif (class="font-display") — for impact words
  body / pull-quote: "Inter", sans-serif italic where it fits (for storytelling lines)
  weights: 400 (body), 500 (italic body), 700 (display when bold needed)
  display sizes: 88-180px
  letter-spacing: -0.01em on display, normal on body
  line-height: 1.05 on display, 1.5 on body

LAYOUT:
  generous whitespace — composition feels "magazine spread", not packed
  off-center alignments OK, even encouraged for emotional weight
  organic blob shapes (low-opacity radial gradients in warmGlow / coolGlow)
  thin hairline rules in '#8b7355' at 30% alpha as section dividers
  framed photo treatment when assets are present: 12-16px border using '#f5ede0' brightened

MOTION:
  ease: sine.inOut, power1.inOut (gentle, contemplative)
  durations: 1.2-2.0s (slower — we breathe, not jump)
  scale 0.96→1 + fade for entries; no rotation
  background blobs drift slowly (yoyo, 4-5s cycle)
  no clip-path snap reveals, no elastic, no overshoot
  pull-quote text fades in word-by-word with 0.10s stagger (slow)

VOICE:
  Warm, human, unhurried. Think the opening of a travel documentary or a
  perfume ad — the motion supports a feeling, doesn't shout for attention.`.trim(),
  },
];

export const findStylePreset = (id: StylePresetId): StylePreset =>
  STYLE_PRESETS.find(p => p.id === id) ?? STYLE_PRESETS[0];

// ─── ANIMATION GRAMMARS (sent to Gemini as common patterns) ────────────

export const ANIMATION_GRAMMAR_BRIEF = `
ANIMATION PATTERNS the AI may use freely (GSAP):

1. ENTRY — element appears
   gsap.from(".clip", { opacity: 0, y: 30, duration: 0.8, ease: "power3.out" })

2. WORD-BY-WORD REVEAL — text appears letter/word at a time
   wrap each word in <span class="word">; gsap.from(".word", { opacity: 0, y: 24, stagger: 0.05, duration: 0.6 })

3. CLIP-PATH WIPE — text wipes in from one side
   gsap.from(".heading", { clipPath: "inset(0 100% 0 0)", duration: 0.7, ease: "power4.out" })

4. SCALE PUNCH — element pops with overshoot
   gsap.from(".accent", { scale: 0, duration: 0.5, ease: "back.out(2)" })

5. SHAPE BURST — particles fly out (use Array.from + many divs)
   for each particle: gsap.fromTo(particle, { x:0, y:0, opacity:1 }, { x: dx, y: dy, opacity: 0, duration: 0.8, ease: "power2.out" })

6. CONTINUOUS FLOAT — background element drifts (FINITE REPEAT REQUIRED)
   const cycle = 3;
   gsap.to(".bg-shape", { y: 20, duration: cycle, repeat: Math.floor(DURATION_SEC / cycle) - 1, yoyo: true, ease: "sine.inOut" })
   // NEVER repeat: -1 — HyperFrames is deterministic, infinite loops freeze the render.

7. STROKE DRAW — SVG path animates as it's drawn
   gsap.from("path", { strokeDashoffset: pathLength, duration: 1.2, ease: "power2.out" })

8. NUMBER COUNT-UP — numeric value tweens
   gsap.to(obj, { value: target, duration: 2, ease: "power2.out", onUpdate: () => el.textContent = Math.round(obj.value) })

Combine these freely. Use timeline (gsap.timeline) to orchestrate. Keep the timeline PAUSED and registered on window.__timelines["<composition-id>"].
`.trim();

// ─── FORBIDDEN PATTERNS (anti-patterns Gemini must avoid) ──────────────

export const FORBIDDEN_PATTERNS = `
FORBIDDEN — your output MUST NOT contain:

- repeat: -1  ← THIS WILL BREAK THE RENDERER. HyperFrames is a deterministic frame capturer — infinite loops are not allowed. For looping effects, calculate the repeat count from the duration: repeat: Math.floor(DURATION_SEC / CYCLE_SEC) - 1  (e.g. for a 0.8s pulse in a 4s block: repeat: Math.floor(4/0.8)-1 = 4)
- yoyo: true without a finite repeat — always pair yoyo with a calculated repeat count
- Date.now(), Math.random(), performance.now() — render must be deterministic
- fetch(), XMLHttpRequest — no network
- setTimeout, setInterval — use GSAP timelines only
- requestAnimationFrame — let GSAP drive it
- external image URLs from the internet (http://, https://) — EXCEPTION: asset:// URLs provided in PROJECT ASSETS are allowed
- adding NEW external font URLs in the HTML body. The host page already preloads Inter, Anton, and Space Grotesk via <link> tags in <head>. Use ONLY those three families (and "system-ui"/"sans-serif" as last-resort fallbacks). Do not add @import of fonts.googleapis.com — they will fail at render time and the text will fall back to a generic sans.
- video or audio tags — motion is visual only · EXCEPTION: when PINNED ASSET is a video, ONE <video muted autoplay loop playsinline> tag is allowed (the asset itself).
- any feature that depends on user interaction (click, hover, scroll)
- console.log, alert, debugger
- GSAP-targeting ::before / ::after pseudo-elements — GSAP CANNOT animate them. If a sheen/border/glow effect would normally use ::before, create a real <div class="sheen"></div> child instead and animate that.
- gsap.to/from on a .clip element directly — the .clip is a TIMING SHELL that HyperFrames controls. Always wrap your animatable content in an INNER <div> inside the .clip, and animate the inner div. Pattern:
    <div id="hero-shell" class="clip" data-start="0" data-duration="3" data-track-index="3">
      <div id="hero-anim">…content…</div>
    </div>
    gsap.from("#hero-anim", { … })  // ← CORRECT (target by id)
    gsap.from(".clip",      { … })  // ← FORBIDDEN
- two clips on the SAME data-track-index that overlap in time, even by 0.001s. If a track gets crowded, split onto a separate track-index. Tracks 0..9 are cheap — use them.
- a .clip without an id="…" attribute. Every timeline-visible element (every <div class="clip">, <video src=…>, <img src=…>, <canvas data-start=…>) MUST carry a stable, human-readable id like id="hero-title", id="bg-mesh", id="scene-card-1". Lint code: studio_missing_editable_id.
- ANY element with data-start (or any timing attribute) that LACKS class="clip". Lint code: timed_element_missing_clip_class. Fix: every timed element has class="clip" — including <canvas data-start=…>, not just <div>.
- NESTED timed elements. Two elements that both carry data-start cannot be parent-and-child. The OUTER one must drop its timing (be a static <div>) or the INNER must drop its timing. Wrapping a <video data-start> inside a <div class="clip" data-start> is FORBIDDEN — lint code: video_nested_in_timed_element. Same applies to canvas/img inside a timed shell. Rule of thumb: if the inner element needs its own timeline (video, canvas with data-start), then the outer wrapper is a plain non-timed <div> with NO class="clip" and NO data-start.
- two clips on the SAME data-track-index that overlap in time at all (lint code: overlapping_clips_same_track). Background layer (vignette, mesh, gradient, bg-shell) and any other element on track 0 ALWAYS collide — keep ONLY ONE element on track 0 (the background), and put everything else on tracks 1+. If you need both a brand-chrome layer AND a bg gradient, put bg on track 0 and chrome on track 1.
`.trim();
