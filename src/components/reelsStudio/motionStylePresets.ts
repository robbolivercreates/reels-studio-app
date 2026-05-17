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
  | 'warm-editorial'
  | 'social-cta-follow'
  | 'counter-reveal'
  | 'notification-pop'
  | 'map-zoom'
  | 'logo-outro'
  | 'claude-ui';

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

/**
 * Narrative role this preset fulfills in an explanatory reel. User picks "Hook"
 * or "Estatística", not "bold-pop" — the mapping is internal. Multiple presets
 * may share the same role (variants), but each preset has ONE primary role.
 */
export type NarrativeRole =
  | 'hook'
  | 'concept'
  | 'problem'
  | 'stat'
  | 'step'
  | 'comparison'
  | 'example'
  | 'quote'
  | 'geo'
  | 'list'
  | 'reflection'
  | 'cta'
  | 'outro'
  | 'command'; // claude-ui

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
  /**
   * Narrative role this preset cumpre. Used by the auto-detector + role-grouped
   * UI picker. When omitted, falls back to a generic "concept" group.
   */
  role?: NarrativeRole;
  /** Short PT-BR label of the role (what the user sees in the picker). */
  roleLabel?: string;
  /** Atmosphere baked into the preset (replaces generic ATMOSPHERE BAKE). */
  atmosphere: AtmospherePalette;
  /** Detailed style brief sent to Gemini. Written in English (LLMs respond better). */
  geminiBrief: string;
  /**
   * Default typography set when MotionConfig.fontSet is not specified.
   * See FONT_SETS in motionFontSets.ts for the 6 curated palettes.
   * When omitted, motionService falls back to 'brand'.
   */
  defaultFontSet?: import('./motionLibrary').FontSet;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'editorial-clean',
    label: 'Editorial limpo',
    description: 'Tipografia grande, fundo neutro, motion sutil.',
    emoji: '📰',
    bestFor: 'Conteúdo informativo, didático, profissional.',
    bgType: 'light',
    role: 'concept',
    roleLabel: 'Conceito',
    defaultFontSet: 'editorial',
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
    role: 'hook',
    roleLabel: 'Hook',
    defaultFontSet: 'brand',
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
    role: 'step',
    roleLabel: 'Passo',
    defaultFontSet: 'tech',
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
    role: 'comparison',
    roleLabel: 'Comparação',
    defaultFontSet: 'brand',
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
    role: 'reflection',
    roleLabel: 'Reflexão',
    defaultFontSet: 'display',
    label: 'Pastel quente',
    description: 'Cream + peach + warm tan. Lifestyle premium, contemplativo.',
    emoji: '🌸',
    bestFor: 'Conteúdo lifestyle, beleza, bem-estar, autocuidado, viagem suave.',
    bgType: 'light',
    atmosphere: {
      // Paleta peach/cream/tan — alinhada com PRINCIPLE 6 (no rose/pink/magenta).
      baseBg: '#fef3e8',
      warmGlow: { color: '#d4a574', alpha: 0.22, pos: '25% 25%' },
      coolGlow: { color: '#c9956c', alpha: 0.16, pos: '75% 75%' },
      vignetteIntensity: 0.22,
    },
    geminiBrief: `
PALETTE: Soft warm pastel — cream paper, peach glow, warm tan accent.
  bg: brandBackgroundColor if it is a warm light tone (#fdf5e8, #fef3e8, #faf3e0 range).
      OTHERWISE force '#fef3e8' (warm cream) — DO NOT use pure white, DO NOT use any pink/rose/magenta tone.
  text: brandTextColor if it has 7:1 contrast on cream OR force '#5c3b1e' (warm umber)
  accent1: brandPrimaryColor if it is a warm earth tone (peach/amber/terracotta/sage).
      OTHERWISE force '#d4a574' (warm tan)
  accent2: brandAccentColor or '#c9956c' (deeper tan)
  decoration: '#e8c89a' (light amber) for blobs and dots
  shadow: '0 4px 20px rgba(180, 130, 80, 0.15)' — ALWAYS warm-toned shadows, NEVER rgba(0,0,0,...)

TYPOGRAPHY:
  primary display: "Playfair Display", "Cormorant Garamond", serif (use class="font-display")
  body: "Inter", sans-serif
  weights: 400 (body), 500 (italic body), 600 (display)
  display sizes: 88-140px
  letter-spacing: -0.01em on display, normal on body
  line-height: 1.1 on display, 1.5 on body
  italic only on pull-quotes (1-2 words max)

LAYOUT:
  generous breathing room — minimum 56px gutters
  off-center composition encouraged (golden-ratio feel, not centered grids)
  organic blob shapes (SVG ellipses with filter: blur(30px)) at opacity 0.35-0.55
  floating decorative dots — diameter 4-8px, opacity 0.30-0.50, drifting
  thin 1px hairline dividers in '#a08566' at 25% alpha
  rounded corners: 12px (cards), 999px (pills)
  drop-shadows ALWAYS warm: '0 4px 20px rgba(180, 130, 80, 0.15)'

MOTION:
  ease: sine.inOut, power1.inOut, power2.out (gentle, never back/elastic)
  durations: 1.0-1.8s (gentle, never snappy)
  fade + small scale 0.96→1 entries; translate ≤ 12px
  background blobs drift vertically (yoyo, 4-6s cycle, ±20px)
  dots float slowly (yoyo, 3-5s, ±15px)
  word-by-word reveals with 0.10-0.14s stagger (slow, contemplative)
  no clip-path snaps, no overshoot, no rotation
  text appears with translateY(8px → 0) + opacity 0→1 over 1.2s ease power2.out

VOICE:
  Calmo, contemplativo, lifestyle premium. Pensa "perfume editorial" ou abertura
  de documentário de viagem — o motion respira, não pula. Audiência aceita 2s
  pra ler porque a composição está convidando, não exigindo. Menos é mais —
  se um quadro funciona com 3 elementos, não coloque 5.

NEVER:
  • pure black text (#000000) — sempre warm umber/brown
  • cold/black shadows — sempre warm-toned (rgba(180,130,80,X))
  • snap reveals (clip-path inset → 0)
  • scale > 1.05 ou translate > 16px
  • brand colors no espectro 250-345 hue (purple/pink/rose/magenta) — força fallback
  • saturação > 50% em qualquer elemento (tudo deve parecer "lavado")
  • easing back.out, elastic, expo — quebra a calma`.trim(),
  },
  {
    id: 'cinematic-dark',
    role: 'problem',
    roleLabel: 'Problema',
    defaultFontSet: 'editorial',
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
    role: 'list',
    roleLabel: 'Lista',
    defaultFontSet: 'apple',
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
    role: 'quote',
    roleLabel: 'Citação',
    defaultFontSet: 'editorial',
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

  // ─── HyperFrames-inspired presets (Onda 11) ──────────────────────────

  {
    id: 'social-cta-follow',
    role: 'cta',
    roleLabel: 'CTA Social',
    defaultFontSet: 'social',
    label: 'Social CTA Follow',
    description: 'Card bottom estilo Instagram/TikTok — slide-in + botão "Seguir".',
    emoji: '👥',
    bestFor: 'CTA final do reel: "siga @handle". Estética autêntica de overlay social.',
    bgType: 'dark',
    atmosphere: {
      baseBg: 'transparent',
      warmGlow: { color: '#000000', alpha: 0, pos: '0 0' },
      coolGlow: { color: '#000000', alpha: 0, pos: '0 0' },
      vignetteIntensity: 0,
    },
    geminiBrief: `
PALETTE: Authentic social overlay. Card black #1a1a1a, accent depends on platform:
  Instagram → #0095f6 (blue)
  TikTok    → #fe2c55 (pink/red)
  YouTube   → #ff0000 (red)
  Generic   → use brandPrimaryColor

LAYOUT (CRITICAL — match the HyperFrames reference exactly):
  - Card pill at bottom: position: absolute; bottom: 160px; left: 50%; translateX(-50%)
  - Pill: background #1a1a1a, border-radius 75px, padding 25px 40px 25px 25px, box-shadow 0 8px 40px rgba(0,0,0,0.4)
  - Inside (flex row, gap 30px, center): avatar circle 120px → profile-info (display-name + handle + follower-count) → follow-btn pill
  - Avatar: circle 120px, border 3px solid #333. If no real avatar available, render a CSS gradient placeholder.
  - Display name 42px weight 700 white + verified badge 34px (SVG check on platform color)
  - Handle 28px weight 400 #a0a0a0
  - Followers 25px weight 400 #737373
  - Follow button: width 250px height 80px border-radius 40px, platform color → on press transition to dark gray #2f2f2f with chevron

MOTION (5s timeline):
  - 0.0-0.6s: card slides in from y:300, opacity 0→1, ease "power3.out"
  - 1.0s: button press scale 0.92, duration 0.15, ease "power2.out"
  - 1.15s: button release with elastic.out(1, 0.4), background instant change to #2f2f2f
  - 1.15-1.22s: "Follow" text fades out, "Following ✓" fades in
  - 3.8-4.05s: card slides back to y:300, opacity 1→0

VOICE: Authentic social platform overlay — viewers should feel they're seeing a real Instagram/TikTok notification, not a designed graphic.`.trim(),
  },

  {
    id: 'counter-reveal',
    role: 'stat',
    roleLabel: 'Estatística',
    defaultFontSet: 'apple',
    label: 'Counter reveal',
    description: 'Apple Money Count — número conta de 0 a X com green flash + burst.',
    emoji: '💰',
    bestFor: 'Stats reveal: "1M views", "R$ 50K em 30 dias", "+247% growth". Vibe finance Apple.',
    bgType: 'light',
    atmosphere: {
      baseBg: '#fdfefe',
      warmGlow: { color: '#30d158', alpha: 0.08, pos: '50% 50%' },
      coolGlow: { color: '#000000', alpha: 0.03, pos: '50% 50%' },
      vignetteIntensity: 0.2,
    },
    geminiBrief: `
PALETTE: Apple finance style.
  bg: #fdfefe (off-white)
  text: #111315 (near black)
  flash accent: #30d158 (Apple green — fires during the count climax)
  shadow: rgba(7, 84, 31, 0.2) (green-tinted, anchors the cash icons)

LAYOUT:
  - Stage centered. Single hero element: the number, .font-tech with tabular-nums, size 190px, weight 900.
  - Letter-spacing 0, line-height 0.9. Text-shadow: 0 3px 0 rgba(255,255,255,0.58), 0 18px 36px rgba(17,19,21,0.14), 0 42px 92px rgba(17,19,21,0.1).
  - Optional caption above (24-32px .font-body weight 600, color #111315 60% alpha) — "R$ ganhos em 30 dias", "Views totais", etc.
  - Money/coin icons: 6-12 SVG bills (96×52, #30d158 rounded 10px) + coins (64px radial gradient #fff7a6 → #ffd54f → #d9a514). Hidden until climax.

MOTION (5s timeline) — copy this exact rhythm from Apple Money Count:
  - 0.0-0.3s: number appears at scale 0.6, opacity 0 → scale 1, opacity 1, ease "back.out(1.4)"
  - 0.3-3.5s: number counts from 0 to target value with ease "power2.out". Use gsap.to(obj, { value: target, onUpdate: () => el.textContent = formatted }). For currency, format with thousands separator.
  - 3.5-3.65s: green flash overlay (#30d158, opacity 0 → 0.7 → 0 in 150ms total)
  - 3.55-4.5s: money/coin icons burst from center, each with random angle 0-360deg, distance 200-500px, rotation -180-180deg, opacity 1 → 0, duration 0.7-0.9s, ease "power2.out". Stagger 0.02s between particles.
  - 4.5-5.0s: final hold + tiny scale pulse 1 → 1.04 → 1

VOICE: Confident, decisive, premium. The number is the hero — everything else supports it.`.trim(),
  },

  {
    id: 'notification-pop',
    role: 'example',
    roleLabel: 'Exemplo',
    defaultFontSet: 'apple',
    label: 'Notification pop',
    description: 'Banner estilo macOS notification — pop top-right + ícone + mensagem.',
    emoji: '🔔',
    bestFor: 'Hook "olha o que recebi": DM, comment, payment notification, news alert.',
    bgType: 'dark',
    atmosphere: {
      baseBg: 'transparent',
      warmGlow: { color: '#000000', alpha: 0.4, pos: '50% 50%' },
      coolGlow: { color: '#000000', alpha: 0.2, pos: '50% 50%' },
      vignetteIntensity: 0.5,
    },
    geminiBrief: `
PALETTE: macOS Sonoma glass notification.
  bg behind: subtle dark blur (composition has avatar/broll behind, so transparent)
  banner: background rgba(30, 30, 30, 0.82), backdrop-filter blur(20px) saturate(180%)
  border: 1px solid rgba(255, 255, 255, 0.1)
  text white: #ffffff
  text secondary: rgba(255, 255, 255, 0.7)

LAYOUT:
  - Banner pill positioned absolute top: 80px, right: 60px (or centered if motion is replace-layer)
  - Width 720px, padding 20px 28px, border-radius 22px
  - Inside flex row gap 18px: app-icon (72px square rounded 16px with brand color or SVG logo) + content (flex column gap 4px): app-name (.font-body 16px weight 500 secondary) + title (.font-display 22px weight 600 white) + message (.font-body 18px weight 400 secondary)
  - Optional timestamp top-right small (14px, very subtle "agora")

MOTION (5s timeline) — Apple notification rhythm:
  - 0.0-0.55s: banner slides in from y:-120, opacity 0 → y:0, opacity 1, ease "expo.out". slight x:30 jitter at end for organic landing.
  - 0.55s: subtle scale 1 → 1.015 → 1 over 0.3s (settle bounce)
  - 0.85-3.8s: hold (this is where the viewer reads). Optional: small float y:0 → 2 → 0 every 1.5s for life.
  - 3.8-4.4s: tiny press scale 0.98 ease "power2.in" then continue
  - 4.4-5.0s: banner slides up to y:-120, opacity 1 → 0, ease "power3.in"

VOICE: Native macOS, real notification — not a designed graphic. Restraint over flash.`.trim(),
  },

  {
    id: 'map-zoom',
    role: 'geo',
    roleLabel: 'Geografia',
    defaultFontSet: 'editorial',
    label: 'Map zoom',
    description: 'Mapa Apple-style com pin + circle + label editorial. Geo content.',
    emoji: '🗺️',
    bestFor: 'Locale reveal: "São Paulo, Brasil", trajeto "de X pra Y", country highlight.',
    bgType: 'light',
    atmosphere: {
      baseBg: '#f5f5f7',
      warmGlow: { color: '#000000', alpha: 0.04, pos: '20% 30%' },
      coolGlow: { color: '#000000', alpha: 0.06, pos: '80% 70%' },
      vignetteIntensity: 0.35,
    },
    geminiBrief: `
PALETTE: Apple Maps + editorial overlay.
  bg: #f5f5f7 (Apple system gray)
  map area: render an abstract topographic CSS gradient (no real image — soft layered radial gradients in muted gray-greens like #d4d8d3, #b8c4b8) covering 70% of viewport
  ocean overlay: linear-gradient at low opacity to suggest water mass
  pin/marker: red dot #ff3b30 with white center, drop-shadow 0 8px 24px rgba(255,59,48,0.4)
  scribble/route: SVG path stroked in #ff3b30 width 6px, stroke-dasharray for hand-drawn feel
  label: pop-up card white #fff with 1px border rgba(0,0,0,0.08), padding 16px 24px, border-radius 18px, drop-shadow

LAYOUT:
  - Background: 1080×1920 with abstract map gradient (subdivide into 3-5 radial gradients overlapping for organic terrain)
  - SVG route or scribble drawn on top: use stroke-dasharray + stroke-dashoffset for "drawing" animation
  - One pin/marker at the focal point of the journey/location
  - Label pop-up appears near the pin: contains location name (.font-display Libre Baskerville 64-80px) + optional subtitle (.font-body Libre Franklin 24px weight 500)

MOTION (varies with duration, default 6s):
  - 0.0-1.2s: map appears via clip-path inset reveal from center, scale 1.05 → 1, opacity 0 → 1, ease "expo.out"
  - 1.2-2.8s: SVG route/scribble draws in via stroke-dashoffset, ease "power2.inOut"
  - 2.8-3.2s: pin drops in from y:-80, scale 0 → 1, ease "back.out(2)" with bounce
  - 3.2-3.6s: pulse ring expands around pin: scale 0.4 → 2.5, opacity 0.6 → 0, repeated 2x with stagger 0.4s
  - 3.6-4.4s: label pop-up slides in y:20, opacity 0 → 1, ease "expo.out"
  - hold remaining time

VOICE: Editorial documentary — like a New York Times interactive map. Premium, considered, not gimmicky.`.trim(),
  },

  {
    id: 'logo-outro',
    role: 'outro',
    roleLabel: 'Outro',
    defaultFontSet: 'brand',
    label: 'Logo outro',
    description: 'Logo assembly piece-by-piece + glow bloom + tagline. Encerramento brand.',
    emoji: '🎬',
    bestFor: 'Fim de reel com identidade da marca, transition pra sign-off, brand outro.',
    bgType: 'dark',
    atmosphere: {
      baseBg: '#0a0a0f',
      warmGlow: { color: '#ff3b30', alpha: 0.15, pos: '50% 50%' },
      coolGlow: { color: '#0080ff', alpha: 0.1, pos: '50% 50%' },
      vignetteIntensity: 0.7,
    },
    geminiBrief: `
PALETTE: Dark cinematic with brand-glow center.
  bg: deep #0a0a0f
  glow ring: radial-gradient(circle at 50% 50%, brandPrimaryColor at 25% alpha 0%, transparent 70%) — bloom anchor for logo
  logo color: use brandPrimaryColor or pure white if no brand
  tagline: white at 70% alpha
  URL pill: rgba(255,255,255,0.08) bg, 1px solid rgba(255,255,255,0.15) border

LAYOUT:
  - Stage 100% centered, vertically aligned middle
  - Logo: build out of 3-5 geometric pieces (circles, rectangles, diagonals) that assemble into a single shape. If brand has a real wordmark, use that as the LOGO TEXT in .font-display (Anton) at 180-220px. If pure logomark, build it from <div> shapes with brand color fills.
  - Tagline below: .font-body 36-48px weight 500, letter-spacing 0.02em, color rgba(255,255,255,0.7), 1 line max
  - URL pill below tagline: padding 14px 28px, border-radius 999px, .font-tech 22px weight 500. Examples: "instagram.com/@handle", "site.com.br"

MOTION (6s timeline) — assembly + bloom rhythm:
  - 0.0-1.2s: pieces fly in from random off-screen positions (random angle 0-360°, distance 1200-1800px), each piece staggered 0.08-0.12s, rotation -180-180deg, ease "expo.out"
  - 1.2-1.5s: pieces snap to final positions with subtle scale 1.05 → 1 settle, drop-shadow grows
  - 1.5-2.3s: glow bloom expands behind logo: radial-gradient layer scales 0.3 → 1.8, opacity 0 → 0.6 → 0.3, slow "power1.inOut"
  - 2.3-3.0s: tagline fades in y:30 → y:0, opacity 0 → 1, ease "power3.out"
  - 3.0-3.6s: URL pill slides in y:20 → y:0, opacity 0 → 1, scale 0.94 → 1, ease "back.out(1.4)"
  - 3.6-5.4s: everything holds. Optional subtle floating: tagline y:0 → 2 → 0 cycle 3s.
  - 5.4-6.0s: whole composition fades to opacity 0 + slight scale 1 → 1.02 zoom-out feel

VOICE: Final beat — brand asserts itself, audience leaves with the name embedded. Cinematic, controlled.`.trim(),
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
- adding NEW external font URLs in the HTML body. The host page preloads the active TYPOGRAPHY SET (see the TYPOGRAPHY section of your brief) plus Inter as fallback. Use ONLY the .font-display / .font-tech / .font-body convenience classes defined in <style>, or "system-ui"/"sans-serif" as last-resort fallbacks. Do not add @import of fonts.googleapis.com — they will fail at render time and the text will fall back to a generic sans.
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

// ─── Native presets (no Gemini — HTML is built programmatically) ──────────

/** Preset IDs that are handled natively in motionService (no Gemini call). */
export const NATIVE_PRESET_IDS: StylePresetId[] = ['claude-ui'];

// Append the claude-ui entry to the canonical preset list.
STYLE_PRESETS.push({
  id: 'claude-ui',
  role: 'command',
  roleLabel: 'Comando',
  label: 'Claude UI',
  description: 'Interface escura do Claude com digitação do comando e resposta animada.',
  emoji: '🤖',
  bestFor: 'Demonstrar comandos do Claude (Ultraplan, Powerup, Insight, etc.).',
  bgType: 'dark',
  atmosphere: {
    baseBg: '#1c1c1c',
    warmGlow:  { color: '#e07b54', alpha: 0.08, pos: '30% 40%' },
    coolGlow:  { color: '#c84040', alpha: 0.06, pos: '70% 60%' },
    vignetteIntensity: 0.55,
  },
  // No geminiBrief needed — motionService bypasses Gemini for this preset.
  geminiBrief: '',
});
