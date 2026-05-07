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
  | 'cinematic-dark';

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
  thin glowing borders
  cyan accent particles drifting in background
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
  important word gets amber block background
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

6. CONTINUOUS FLOAT — background element drifts
   gsap.to(".bg-shape", { y: 20, duration: 3, repeat: -1, yoyo: true, ease: "sine.inOut" })

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
- external font URLs (use system fonts: Inter, system-ui, sans-serif)
- video or audio tags — motion is visual only
- any feature that depends on user interaction (click, hover, scroll)
- console.log, alert, debugger
`.trim();
