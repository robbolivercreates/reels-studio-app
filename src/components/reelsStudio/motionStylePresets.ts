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
  | 'illustrated-explainer'
  | 'social-cta-follow'
  | 'counter-reveal'
  | 'notification-pop'
  | 'map-zoom'
  | 'logo-outro'
  // ─── Onda 2 / Entrega B: asset-heavy shot templates ───────────
  | 'browser-chrome'
  | 'phone-mockup'
  | 'pip-talking-head'
  | 'before-after-split'
  | 'karaoke-captions'
  | 'icon-callout'
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
PALETTE: USE THE BRAND IDENTITY COLORS PROVIDED ABOVE.
  bg: brandBackgroundColor.
      Fallback if unset OR brand bg is busy/saturated: '#f5f5f5' (clean light neutral).
  text: brandTextColor.
      Fallback if unset OR < 7:1 contrast: '#1a1a1a' (near-black, NEVER pure #000).
  accent: brandPrimaryColor — used SPARINGLY (one hot-spot per beat, max).
      Editorial limpo means accent is the exception, not the rule.
  muted: brandSecondaryColor at 50% alpha, OR '#86868b' (neutral gray) if unset.
  separator: '#1a1a1a' at 8% alpha (hairline)

TYPOGRAPHY:
  primary: "Inter", "Helvetica Neue", system-ui, sans-serif
  weights: 400 (body), 600 (subhead), 800 (display headlines)
  display sizes: 96-160px (BIG but not screaming — restraint over impact)
  body sizes: 32-48px
  letter-spacing: -0.03em to -0.04em on display, normal on body
  line-height: 1.05 on display, 1.45 on body
  text-align: left OR center; NEVER right-aligned

LAYOUT:
  generous breathing room — minimum 64px gutters
  content anchors to thirds (top-third headline, middle-third value, bottom-third caption)
  one focal element per beat (NEVER stack 2 headlines simultaneously)
  rounded corners: 4-6px on any card (clean = geometric, NOT pill-shaped)
  thin 1px hairline dividers in separator color at 8% alpha
  NO decorative borders, NO drop shadows on text, NO gradient bgs
  asset images (when present) get 8px rounded corners, max-width 70% canvas

MOTION:
  ease: power3.out, power2.out, expo.out (for entries)
  ease for exits: power3.in
  durations: 0.6-1.0s for entries, 0.4-0.6s for exits
  fade + translate (8-16px upward) is the default entry — NEVER scale > 1.04
  staggered word reveals: 0.04-0.06s stagger, 0.5s per word fade
  exit before next entry — NEVER simultaneous in/out (clean = sequential)
  no rotation, no overshoot, no clip-path snap

VOICE:
  Profissional, editorial, invisível. Tipografia trabalha; motion serve.
  Pensa Bloomberg, Monocle, New York Times Magazine — o motion não compete
  com o conteúdo, ele enquadra. Se um elemento decorativo pode sair sem
  prejuízo, sai. Limpeza > criatividade visual.

NEVER:
  • gradients no background (clean significa flat)
  • drop-shadow ou text-shadow em texto (digital, não editorial)
  • glow em qualquer elemento
  • rotation de texto ou cards
  • scale > 1.04 em qualquer entrada
  • pure #000 background ou #fff text — sempre off-tints
  • mais de 1 cor accent por bloco
  • text-align: right
  • pill-shaped cards (rounded > 12px)
  • decorative dots, blobs, particles — clean é austero por definição`.trim(),
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
      // Swapped purple #7b3cff (banned by PRINCIPLE 6) for cyan complementary to orange.
      coolGlow: { color: '#3ce7ff', alpha: 0.14, pos: '80% 75%' },
      vignetteIntensity: 0.7,
    },
    geminiBrief: `
PALETTE: High-energy, high-contrast, pop-art digital.
  bg: ALWAYS DARK — even when brand bg is light.
      If brandBackgroundColor is dark (luminance < 25%): use linear-gradient(135deg,
        brandBackgroundColor 0%, [a 15% lighter shade of same hue] 100%).
      If brandBackgroundColor is light (luminance ≥ 25%): force '#0f0f1a' (deep
        midnight) — the preset's mood requires dark, period.
  text: brandTextColor if it works on dark, OR force '#ffffff' (pure white IS
      acceptable here because bold-pop is digital-loud by design).
  accent1: brandPrimaryColor (the hero color — should be vibrant; if brand
      is muted, INCREASE saturation by 25% mentally to "pop")
  accent2: brandAccentColor (used on 1 hot-spot per beat)
  accent3: brandSecondaryColor (used on geometric bg shapes)
  particle alpha: 0.6-0.85 (visible, not subtle)
  glow alpha on text: 0.45-0.65 (text-shadow's rgba alpha)

TYPOGRAPHY:
  primary: "Inter", system-ui, sans-serif
  weights: 800 (body bold), 900 (display heavy)
  display sizes: 120-220px (HUGE — pop is loud)
  letter-spacing: -0.04em to -0.06em on display
  line-height: 0.92-0.98 (tight, packed)
  text-shadow on display: 0 0 60px <accent>, alpha 0.45-0.6
  text-transform: UPPERCASE common on display
  font-style: italic on 1-2 hot words for kinetic feel

LAYOUT:
  large blocky shapes — circles 200-400px diameter, rotated rects -8° to +8°
  layered geometric bg: 2-3 shapes overlapping, opacity 0.15-0.30
  text often has accent box behind it: padding 16px 24px, rounded 8px, accent fill
  rotation accents on geometric shapes (-12° to +12°, fixed angle not animated)
  rounded corners: 8-12px on cards (not pills, not sharp)
  drop-shadow on cards: 0 8px 30px rgba(0,0,0,0.4) — heavier than other presets
  particle effects on focal moments: 4-8 dots, size 4-10px, opacity 0.6-0.85,
      burst from a focal point and fade over 0.6s

MOTION:
  ease: back.out(2), elastic.out(1, 0.5), power4.out, expo.out
  durations: 0.25-0.7s (fast — pop is snappy)
  ENTRIES use overshoot: scale 0.4 → 1.08 → 1.0 with back.out(2)
  rotation entries: -12deg → 0 with back.out(1.8)
  particle bursts on focal beat: stagger 0.02-0.04s, lifespan 0.6s
  staggered word reveals: 0.05-0.08s stagger, 0.3s per word
  exits are snappy: 0.2-0.3s with power3.in

VOICE:
  Hook viral. Urgência. Energia jovem. Pop-art digital. A audiência tem 1.5s
  pra decidir se continua — o motion grita "PARA!" e segura. Pensa em
  TikTok publicidade de marca, não NYT. Bold significa que pode exagerar.

NEVER:
  • easing suaves (sine.*, power1.*, power2.inOut) — não combina com pop
  • durations > 0.8s em qualquer animação
  • whitespace generoso — pop é packed, denso
  • fonts < 800 weight em display
  • bg gradient com brandBackgroundColor light — force '#0f0f1a' fallback
  • cores purple/magenta/rose no atmosphere (PRINCIPLE 6 — usa cyan/yellow/orange)
  • mais de 3 shapes geométricos visíveis ao mesmo tempo
  • text sem text-shadow no display (digital flat morre nesse preset)
  • saturação < 60% em qualquer accent`.trim(),
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
      // Swapped #7850c8 (purple, banned) for tech-cyan complementary to warm amber.
      warmGlow: { color: '#0ea5e9', alpha: 0.18, pos: '20% 30%' },
      coolGlow: { color: '#ff8c3c', alpha: 0.14, pos: '80% 70%' },
      vignetteIntensity: 0.7,
    },
    geminiBrief: `
PALETTE: Frosted glass, cool tech, premium materials.
  bg: radial-gradient(ellipse at top, brandBackgroundColor 0%, #050510 80%).
      Fallback if brand bg is light: force '#08080f' (deep tech blue-black).
  text: brandTextColor.
      Fallback if unset OR < 7:1: '#e8edf5' (cool off-white — never pure #ffffff).
  accent: brandPrimaryColor.
      If brand is in 250-345 hue band (banned), force '#0ea5e9' (tech cyan).
  glow on accent: ${'$\{accent\} at alpha 0.6'} — write the literal rgba()
      conversion by splitting the hex into r,g,b and using "rgba(r, g, b, 0.6)".
      DO NOT write "brandPrimaryColor at 60% alpha" — Gemini must emit literal CSS.
  glass-bg: rgba(255,255,255,0.06) — slightly darker than 0.08 to feel premium
  glass-border: rgba(255,255,255,0.14) (was 0.18 — too bright)
  glass-highlight-edge: rgba(255,255,255,0.22) — 1px top edge only, simulates light
  grid lines: rgba(255,255,255,0.06) — 1px @ 6% alpha

TYPOGRAPHY:
  primary: "Space Grotesk", "Inter", system-ui, -apple-system, sans-serif (class="font-tech")
  weights: 500 (body), 600 (display)
  display sizes: 88-160px
  letter-spacing: -0.02em to -0.03em on display, -0.01em on body
  line-height: 1.08 on display, 1.45 on body
  numerals: use tabular-nums (font-variant-numeric: tabular-nums) for stats

LAYOUT:
  frosted glass cards: backdrop-filter: blur(20px) saturate(180%); background
      glass-bg; border 1px solid glass-border; rounded corners 16-20px
  inner highlight: ::before { top: 0; left: 8px; right: 8px; height: 1px;
      background: glass-highlight-edge } — sells the "glass" feel
  card padding: 32-48px (generous)
  thin glowing borders on focus elements: 1px solid accent at 50% alpha,
      with 0 0 24px <accent> at 30% box-shadow
  faint grid lines in bg: 1px @ 6% alpha, 64px spacing (tech-blueprint feel)
  accent particles: 3-6 dots, diameter 4-8px, color accent, opacity 0.5-0.7,
      drifting yoyo on translateY ±20px over 4-6s
  NO blobs, NO decorative shapes outside grid + particles (tech is geometric)

MOTION:
  ease: power2.inOut, sine.inOut, power3.out (entries)
  durations: 0.8-1.4s (calm, deliberate)
  ENTRIES: opacity 0→1 + filter: blur(20px) → blur(0) + translateY(20px → 0)
      over 1.0-1.4s ease power3.out
  glass cards subtle floating: translateY ±4px yoyo over 5s sine.inOut
  glow pulse on accents: box-shadow alpha 0.3 ↔ 0.6 yoyo over 2s sine.inOut
  particles drift: translateY ±20px yoyo over 4-6s, opacity 0.5↔0.7 sync
  staggers: 0.05-0.08s on glass card reveals

VOICE:
  Frio, futuro, técnico-aspiracional. Material design encontra Apple Pro.
  Esse preset é pra produtos onde "qualidade" e "confiança" são o pitch —
  IA empresarial, hardware premium, ferramenta dev. Calma deliberada, não
  urgência. Cada elemento tem peso, profundidade, e justifica seu espaço.

NEVER:
  • gradient nas glass cards (glass = uniform com highlight, não gradient)
  • saturação > 70% em qualquer elemento (tech é dessaturado por princípio)
  • animação de qualquer elemento > 1.5s (exceto idle floats)
  • decoração orgânica: blobs, paint splashes, curves — tech é geométrico
  • easing back.out, elastic — quebram o feel premium
  • box-shadow preto puro (rgba(0,0,0,X)) — sempre use accent-tinted shadows
  • cores purple/magenta/rose no bg ou accent (PRINCIPLE 6 — usa cyan/blue/teal)
  • mais de 2 glass cards simultaneamente no mesmo frame (depth confusion)
  • backdrop-filter < 16px (não lê como glass) ou > 30px (overkill)
  • text-shadow em texto — tech é tipografia precisa, não brilhante`.trim(),
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
PALETTE: Typography IS the design. Minimal color, maximum impact.
  bg: brandBackgroundColor if it is dark (luminance < 25%).
      Fallback if unset OR light: force '#0a0a0a' (deep charcoal — never pure #000,
      pure black eats the vignette and feels flat).
  text: brandTextColor.
      Fallback: '#ffffff' is acceptable here (kinetic-bold is digital-loud by design).
  highlight-bg: brandPrimaryColor — block fill behind the hero word.
      Padding inside the block: 8px horizontal, 4px vertical.
      Alpha: 1.0 for current word, 0.85 for previous word (decay over 0.4s).
  alt-color: brandAccentColor — used on 1-2 secondary words per beat
  NO gradients, NO glows, NO multi-color text — kinetic is monochromatic
  with single-color highlight blocks.

TYPOGRAPHY:
  primary: "Inter", "Helvetica Neue", system-ui, sans-serif (class="font-brand")
  weights: 800, 900 (NEVER below 800 in display — kinetic IS the heaviness)
  display sizes: 140-260px (HUGE — single word fills 80%+ of canvas width)
  letter-spacing: -0.05em to -0.08em on display
  line-height: 0.88-0.95 (tight, packed)
  text-transform: UPPERCASE the hero word; mixed-case OK on connector words

LAYOUT:
  text fills the canvas — 80%+ width on hero words, ≥ 50% on connectors
  one or two words on screen at a time, MAX three
  hero word centered, anchored at vertical center or slightly above
  hero word gets highlight-bg block: padding 8px h / 4px v, NOT rounded
      (kinetic is geometric, not pill-shaped — rounded ≤ 4px MAX)
  connector words (de, a, é, com) smaller and at 60% alpha — visual hierarchy
  NO decorative shapes, NO icons, NO backgrounds beyond the bg color
      and optional 1-2 thin lines (1-2px) as compositional anchors

MOTION:
  ease: power4.out, expo.out, power3.out (entries)
  ease for exits: power3.in, expo.in
  durations: 0.20-0.45s (snappy — kinetic is fast)
  word-by-word reveals with clip-path: inset(0 100% 0 0) → inset(0 0 0 0)
      ease power4.out, duration 0.28-0.35s, stagger 0.06-0.10s
  highlighted words: clip-path reveal + immediate scale punch 1 → 1.08 → 1
      over 0.18s ease back.out(2)
  exits: clip-path inset(0 0 0 0) → inset(0 100% 0 0) ease expo.in 0.20s
      OR scale 1 → 0.85 + opacity 1 → 0 over 0.18s
  NO fade-only entries — kinetic uses clip-path + scale, never plain opacity
  staggers: 0.06-0.10s between words

VOICE:
  Manchete em movimento. Cada palavra é um soco. Esse preset é o oposto de
  cinematic-dark — ele EXIGE atenção, não convida. Pensa em outdoor de
  campanha política, capa de revista provocativa, manifesto. Single-thought
  per beat. A palavra é a estrela, tudo o mais é palco.

NEVER:
  • easing suaves (sine.*, power1.*, power2.inOut) — kinetic é instantâneo
  • durations > 0.6s em qualquer animação
  • texto pequeno (< 120px display) — kinetic = grande por definição
  • plain fade-in (opacity-only) — entrada precisa de clip-path OU scale punch
  • fonts < 800 weight em display
  • cards rounded > 4px — kinetic é geométrico, não pill-shaped
  • mais de 3 palavras simultâneas no canvas
  • highlight-bg sem padding interno (8h × 4v) — fica colado, mata legibilidade
  • multi-color text (text com mais de 1 cor por palavra)
  • decorative shapes, icons, blobs — austeridade tipográfica
  • text-shadow ou glow — kinetic é tipografia limpa, não brilhante
  • bg gradient — sempre cor sólida`.trim(),
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
PALETTE: Restrained, low-saturation, deep-cinema.
  bg: brandBackgroundColor (must be dark — #000 to #1a1a1a range).
      If brand bg is light, force '#0a0a0a' deep charcoal (NOT pure #000).
      Apply as radial-gradient from center: brandBackgroundColor 0% → +12% lighter at 80%.
  text: brandTextColor (must contrast 7:1 on dark bg).
      If unset OR low-contrast, force '#ebe4d6' (warm off-white — NEVER pure #ffffff,
      pure white reads as digital, not cinematic).
  accent: brandPrimaryColor at 60-80% saturation (cinema desaturates everything).
      Single accent only — no secondary accent appears in any frame.
  vignette: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.65) 100%).
      ALWAYS present. Track-index 9. Pointer-events none. Mix-blend-mode multiply.
  film grain: SVG <feTurbulence baseFrequency="0.9" numOctaves="2"/> as data-URI overlay
      OR a pre-rendered noise data-URI; opacity 0.04-0.06; mix-blend-mode overlay;
      position absolute inset:0; pointer-events none.

TYPOGRAPHY:
  primary: "Inter", "Helvetica Neue", system-ui, sans-serif
  weights: 300 (display light), 600 (body bold accent only)
  display sizes: 64-120px (cinema avoids HUGE — restraint is the point)
  letter-spacing: 0.08em-0.16em on display (wide, breathing, cinematic credits)
  text-transform: uppercase on display ONLY when ≤ 3 words; mixed case otherwise
  line-height: 1.4 on display, 1.6 on body

LAYOUT:
  letterbox bars top + bottom: 2 black bars, 60-120px each, 100% opacity, NOT transparent
  vertical asymmetry — anchor content to lower-third (y: 65-75% of canvas)
  one focal element per beat — no stacking
  16:9 framing math: bars occupy (1 - 9/16 * 16/9) of height = ~28% total when canvas is 9:16
  rounded corners: NONE on bars; 2-4px on any card (minimal — cinema is geometric)
  thin hairlines in accent at 30% alpha as section dividers (1px)
  NO decorative shapes, blobs, dots, or icons — cinema is austere

MOTION:
  ease: power3.inOut, power2.out, sine.inOut (NEVER back/elastic/expo)
  durations: 1.2-2.4s (slow, deliberate)
  fade durations: 0.8-1.6s (NEVER hard cuts — minimum 0.6s on transitions)
  text appears: opacity 0→1 over 1.4s + translateY(4px → 0) ease power3.out
  background slow zoom (Ken Burns): scale 1.0 → 1.04 over the full block duration,
      ease sine.inOut. Track-0 bg ONLY (vignette + grain stay static).
  text may have IMPERCEPTIBLE drift: translateY (-1.5px → 0 → -1.5px) yoyo over 6s.
      Without this, opacity-only fades feel like a slideshow, not cinema.
  letterbox bars fade in over 0.6s at the start; STAY visible the whole block.
  staggers: 0.08-0.12s (slow reveals)

VOICE:
  Documentário longa-metragem. A audiência ganhou o direito de ver isso
  porque você cuidou de cada elemento. Tudo respira. Nada grita. Cinema é
  o oposto de TikTok — confia que a pessoa vai ficar até o final do plano.
  Se um elemento pode ser removido sem perda de significado, REMOVA.

NEVER:
  • pure #000000 background — sempre #0a0a0a OR brand dark
  • pure #ffffff text — sempre warm off-white #ebe4d6
  • hard cuts (durations < 0.6s em transições)
  • back.out, elastic, expo — fora do vocabulário cinemático
  • scale punch ou rotation em texto
  • mais de 1 cor accent por bloco
  • saturação > 70% em qualquer elemento
  • blobs, dots, decorative shapes — austeridade absoluta
  • esquecer o film grain ou a vignette (são identidade do preset)`.trim(),
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
  {
    id: 'illustrated-explainer',
    role: 'concept',
    roleLabel: 'Explicador ilustrado',
    defaultFontSet: 'apple',
    label: 'Explicador ilustrado',
    description: 'Ícones SVG + diagramas + setas. Pra explicar conceito, processo, tutorial.',
    emoji: '✏️',
    bestFor: 'Conteúdo didático: tutoriais, "como funciona", "o que é X", explicações de processo passo-a-passo.',
    bgType: 'light',
    atmosphere: {
      baseBg: '#fafbfc',
      warmGlow: { color: '#0ea5e9', alpha: 0.06, pos: '20% 25%' },
      coolGlow: { color: '#10b981', alpha: 0.05, pos: '80% 75%' },
      vignetteIntensity: 0.18,
    },
    geminiBrief: `
PALETTE: Educational notebook / explainer-video aesthetic. Light, clean, learnable.
  bg: brandBackgroundColor if it is light (luminance > 80%) OR force '#fafbfc' (warm off-white)
  text: brandTextColor (must contrast 7:1 on light bg).
      Fallback if unset OR < 7:1: '#1a1a1a' (near-black, NEVER pure #000)
  accent: brandPrimaryColor.
      Fallback if unset OR in banned 250-345 hue: '#0ea5e9' (tech cyan)
  secondary-accent: brandAccentColor OR '#10b981' (emerald — used for "correct/positive" elements)
  caution-accent: '#f59e0b' (amber — used for "warning/contrast" elements only when topic calls for it)
  muted: rgba(0, 0, 0, 0.55) — for secondary labels
  hairline: rgba(0, 0, 0, 0.12) — for connector lines, dividers, light strokes
  shadow: 0 4px 16px rgba(0, 0, 0, 0.06) — very soft, never heavy

TYPOGRAPHY:
  primary: "Space Grotesk", "Inter", system-ui, -apple-system, sans-serif (class="font-tech")
  weights: 500 (body), 600 (labels), 700 (display)
  display sizes: 64-100px (smaller than other presets — illustration shares the stage)
  body sizes: 28-44px
  letter-spacing: -0.02em on display, -0.005em on body
  line-height: 1.15 on display, 1.5 on body
  numerals: tabular-nums on numbered lists / step indicators

LAYOUT:
  ILLUSTRATION IS PRIMARY — text supports the visual, not vice versa.
  Compositions follow one of these archetypes (pick the one that fits the block):

  Archetype A — Single-icon-with-label:
    centered SVG icon (120-160px, stroke 3-4px, brandPrimaryColor) at y:30%-40%
    label below at y:55%-65%, .font-tech 56-80px weight 700
    optional subtext at y:70%-78%, body weight 500, muted color
    use when: one concept being defined ("o que é X")

  Archetype B — Process diagram (2-4 steps):
    horizontal row of nodes (each 100-140px circle/rounded-rect with icon inside)
    nodes connected by 2-3px hairline arrows with small triangle heads
    each node labeled below (max 2 words, body weight 600)
    use when: process explanation, "primeiro...depois...por fim"

  Archetype C — Comparison (2 columns):
    left half: icon + label + muted bg tint (slightly cooler/grayer)
    right half: icon + label + accent bg tint (warmer/brighter)
    thin 2px vertical divider between halves in hairline color
    use when: "vs", "antes/depois", contrast of two ideas

  Archetype D — Numbered list (3-5 items):
    vertical stack, each row: numbered badge (32px circle, accent fill, white number)
      + label (.font-tech 38-44px weight 600) + optional 1-line description below
    items appear stagger 0.25s apart with translateY(12 → 0) ease power3.out
    use when: "são 3 motivos", "top 5", numbered list

  COMMON to all archetypes:
    generous breathing room — minimum 56px gutters
    rounded corners: 12-16px on cards, 999px on numbered badges, 4px on arrow heads
    icon stroke weight scales with typography weight (500-600 type → 2-3px stroke,
      700 type → 3-4px stroke)
    NO heavy decoration: no blobs, no particles, no atmospheric glow (this preset
      stays graphically clean — Khan Academy / Notion-doc / Tella feel)

MOTION:
  ease: power3.out, power2.out, expo.out (entries — snappy but smooth)
  ease for exits: power3.in
  durations: 0.4-0.8s for icons/labels, 0.6-1.0s for diagrams (slower so the
    viewer can read the structure)
  ENTRIES:
    Icons: scale 0.85 → 1.0 + opacity 0 → 1, ease back.out(1.3), 0.5s
    Labels: opacity 0 → 1 + translateY(8 → 0), ease power3.out, 0.4s, 0.1s after icon
    Arrows: stroke-dashoffset animation drawing from start to end, 0.5s ease power2.out
    Nodes in a diagram: stagger 0.18s, each does scale 0.92 → 1 + opacity 0 → 1
    Numbered badges: stagger 0.22s, scale 0 → 1 ease back.out(1.6)
  AMBIENT:
    No background motion (no blobs, no particles, no slow zoom) — the preset stays
    visually quiet so the illustration carries the attention
    OK: a very subtle pulse on the active step indicator (scale 1 ↔ 1.05 yoyo 1.5s)
  EXITS:
    Whole composition fades + slight scale 1 → 0.97 over 0.5s ease power3.in
    NEVER per-element snappy exits (the structure stays coherent until end)

VOICE:
  Tella / Notion / Khan Academy / Sketchbook explainer. The audience is learning,
  not consuming. Visual hierarchy = pedagogical hierarchy. Each illustration is
  earned — it shows something words alone can't. If you can remove an icon
  without losing meaning, REMOVE.

NEVER:
  • use external image URLs — only inline SVG
  • use clip-art / cartoon / 3D-style illustrations — geometric simple only
  • render this preset without at least 1 SVG illustration element (the preset's identity)
  • dark backgrounds — this preset is light by design
  • text-shadow / glow on text — learning material is flat-typographic, not "designed"
  • more than 1 main archetype in a single block (pick one — clarity over richness)
  • saturação > 80% on accents — explainer needs to feel calm, not loud
  • rotation in icons or text
  • elastic.out / back.out > 1.8 — bouncy motion breaks the "studious" feel
  • pure #000 text or pure #ffffff bg — always off-tints for paper feel
  • bright primary colors when brand is muted — respect brand mood`.trim(),
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

// ─── Asset-heavy shot templates (Onda 2 / Entrega B) ─────────────────────
// These presets wrap an attached image/video in a recognizable visual frame
// (browser chrome, phone mockup, talking-head PIP, comparison split) or use
// audio word-level timestamps for karaoke captions. They expect at least one
// pinnedAsset on the block — Gemini is told which slot to use and how to mask
// the asset into the chrome.

STYLE_PRESETS.push({
  id: 'browser-chrome',
  role: 'example',
  roleLabel: 'Screenshot · navegador',
  defaultFontSet: 'apple',
  label: 'Browser chrome',
  description: 'Envolve um screenshot em janela macOS Safari com address bar e traffic lights.',
  emoji: '🖥',
  bestFor: 'Demos de webapp, tweets, dashboards, sites — qualquer screenshot que ganha autoridade num navegador real.',
  bgType: 'dark',
  atmosphere: {
    baseBg: '#0e0e10',
    warmGlow: { color: '#0084ff', alpha: 0.08, pos: '20% 25%' },
    coolGlow: { color: '#ffffff', alpha: 0.04, pos: '80% 75%' },
    vignetteIntensity: 0.6,
  },
  geminiBrief: `
PALETTE: macOS Safari window over moody dark backdrop.
  bg: brandBackgroundColor if dark (luminance < 25%) OR force '#0e0e10' deep blue-black.
  text: '#ffffff' for labels on the dark bg; '#1d1d1f' for any caption that sits ON the screenshot
  window-bg: '#1d1d1f' (the Safari chrome frame, not the screenshot itself)
  window-border: rgba(255, 255, 255, 0.08) — 1px subtle separation
  address-bar-bg: '#2c2c2e'
  address-bar-text: '#a1a1a6'
  traffic-light-red: '#ff5f57'
  traffic-light-amber: '#febc2e'
  traffic-light-green: '#28c840'
  caption-accent: brandPrimaryColor (or '#0084ff' fallback) — used SPARINGLY on 1 word max

REQUIRED ASSETS:
  This preset REQUIRES at least one pinnedAsset (image). If pinnedAssets is empty,
  fall back gracefully: render a placeholder gradient inside the window with the
  block text written on it. NEVER omit the window chrome — the chrome IS the preset.

LAYOUT (CRITICAL — match the visual reference):
  Root: full canvas with bg color, vignette via box-shadow inset.
  Window container:
    - position: absolute; top: 240px; left: 80px; right: 80px (1080-wide canvas → 920px window)
    - background: '#1d1d1f'; border-radius: 18px; border: 1px solid window-border;
    - box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 8px 20px rgba(0,0,0,0.35)
    - Inside: top chrome (60px) + content area (rest)
  Top chrome (Safari header):
    - height: 60px; padding: 0 22px; display: flex; align-items: center; gap: 12px
    - 3 traffic lights on the left: each 14px diameter, gap 10px, colors above
    - Address bar centered: width 480px height 32px, bg #2c2c2e, border-radius 8px,
      inside: a small lock icon SVG (10px) + URL text in address-bar-text color, 16px monospace
    - URL text: derive from block topic ("yourapp.com/dashboard", "stripe.com/pricing", etc.)
      OR use a generic placeholder ("example.com") if topic is unclear
  Content area (the screenshot):
    - the pinnedAsset image fills this area
    - inside a .clip shell with overflow: hidden, border-radius 0 0 18px 18px (bottom only)
    - <img object-fit: cover; object-position: top center>
  Optional caption below window:
    - max 6 words, 56px weight 600 .font-tech, color white, centered, max-width 800px
    - sits at y: window-bottom + 64px

MOTION (5s timeline) — Safari "opens with a click":
  - 0.0-0.55s: window appears with scale 0.92 → 1.0 + opacity 0 → 1, ease "power3.out".
    transformOrigin: center center.
  - 0.55s: subtle settle scale 1.0 → 1.012 → 1.0 over 0.25s (the "snap into slot")
  - 0.6-1.2s: traffic lights fade in one at a time, stagger 0.06s (red → amber → green),
    each from opacity 0 → 1 + scale 0.7 → 1 ease back.out(1.8)
  - 1.0-1.4s: address bar URL text reveals letter-by-letter using clip-path inset,
    duration ~0.4s ease power3.out
  - 1.4s onwards: very subtle ambient float — translateY 0 → -3 → 0 yoyo over 4s sine.inOut
  - If caption is present: caption fades in opacity 0 → 1 + translateY(8 → 0) at 1.6s,
    duration 0.7s ease power3.out
  - 4.6-5.0s: gentle scale 1 → 0.98 + opacity 1 → 0 exit, ease power3.in

TYPOGRAPHY:
  caption: .font-tech (Space Grotesk / Inter), weight 600, 56px, letter-spacing -0.02em
  URL: monospace fallback "SF Mono", "JetBrains Mono", monospace; 16px
  body / address-bar: weight 400-500

VOICE:
  Native macOS Safari, not a designed graphic. The viewer should feel they're
  watching a real screen recording, not a marketing illustration. Restraint over
  flourish — the screenshot IS the hero, the chrome is just the proof.

NEVER:
  • render this preset without the Safari window chrome (chrome IS the identity)
  • use Windows / Chrome-on-Windows / Firefox styling — this is MACOS Safari only
  • crop the screenshot to fit weirdly — always object-fit: cover; object-position: top center
  • animate the screenshot independently (no zoom, pan, parallax) — the window is the unit
  • add decoration (blobs, particles, gradients) on top of the screenshot
  • rounded corners > 20px on the window — Safari is 14-18px historically
  • bright background bg colors — preset requires a dark moody backdrop
  • back.out / elastic / overshoot on the window itself (only on traffic lights)`.trim(),
});

STYLE_PRESETS.push({
  id: 'phone-mockup',
  role: 'example',
  roleLabel: 'Screenshot · iPhone',
  defaultFontSet: 'apple',
  label: 'iPhone mockup',
  description: 'Envolve um screenshot em moldura iPhone 15 Pro com Dynamic Island.',
  emoji: '📱',
  bestFor: 'Demos de app mobile, conversas, posts de Instagram/TikTok — qualquer screenshot vertical que pede contexto de telefone.',
  bgType: 'dark',
  atmosphere: {
    baseBg: '#101012',
    warmGlow: { color: '#ffffff', alpha: 0.05, pos: '50% 20%' },
    coolGlow: { color: '#0084ff', alpha: 0.06, pos: '50% 80%' },
    vignetteIntensity: 0.65,
  },
  geminiBrief: `
PALETTE: Premium iPhone 15 Pro mockup floating on moody dark stage.
  bg: brandBackgroundColor if dark OR force '#101012' (slight warmer than pure black)
  phone-frame: '#1a1a1a' (the titanium/black bezel)
  phone-frame-edge: linear-gradient(135deg, '#2a2a2a' 0%, '#0a0a0a' 50%, '#2a2a2a' 100%)
      — this gradient sells the metallic edge highlight; apply as a 2px border via background-clip
  dynamic-island-bg: '#000000' (true black)
  screen-radius: 48px (iPhone 15 Pro corner radius scaled to our 1080 canvas)
  caption-color: '#ffffff'
  caption-accent: brandPrimaryColor (or '#0084ff' fallback)

REQUIRED ASSETS:
  This preset REQUIRES at least one pinnedAsset (image, ideally 9:19.5 or vertical).
  If pinnedAssets is empty, render placeholder gradient inside the screen with
  block text. NEVER omit the phone frame — frame IS the preset.

LAYOUT (CRITICAL — iPhone 15 Pro proportions in 9:16 canvas):
  Canvas is 1080×1920. Phone occupies roughly the central column:
  Phone container:
    - position: absolute; top: 180px; left: 50%; transform: translateX(-50%)
    - width: 720px; height: 1480px (matches iPhone aspect ratio ~9:19.5)
    - background: phone-frame; border-radius: 100px; padding: 14px (the bezel)
    - box-shadow: 0 40px 100px rgba(0,0,0,0.6), 0 12px 24px rgba(0,0,0,0.4)
    - inside ::before for the metallic edge: position absolute; inset -1px;
      border-radius inherit; background: phone-frame-edge; z-index: -1
  Screen (inside the bezel):
    - background: #000; border-radius: 88px (inner radius after 14px bezel inset)
    - overflow: hidden; position: relative
    - the pinnedAsset image: object-fit: cover; width 100%; height 100%
  Dynamic Island:
    - position: absolute; top: 22px (inside screen); left: 50%; transform: translateX(-50%)
    - width: 168px; height: 44px; background: dynamic-island-bg; border-radius: 22px
    - z-index above screen content
  Optional caption above OR below phone:
    - max 6 words, 52px weight 600 .font-tech, white, centered, max-width 760px
    - top: phone-y - 110px (above) OR phone-bottom + 50px (below)

MOTION (5s timeline) — iPhone "rises into frame":
  - 0.0-0.7s: phone enters from y:80 + opacity 0 → y:0 + opacity 1, ease "power3.out"
    + slight rotation -2deg → 0
  - 0.7s: micro-settle scale 1 → 1.01 → 1 over 0.25s (the "presence" beat)
  - 0.7-1.2s: dynamic island scales 0.6 → 1 with back.out(1.6)
  - 0.9-1.3s: screen content fades in opacity 0 → 1 ease power2.out
  - 1.3s onwards: very subtle continuous float — translateY 0 → -4 → 0 yoyo 5s sine.inOut
  - If caption: caption fades in at 1.4s, opacity 0 → 1 + translateY(10 → 0), 0.7s
  - 4.6-5.0s: phone exits with scale 1 → 0.96 + opacity 1 → 0, ease power3.in

TYPOGRAPHY:
  caption: .font-tech weight 600, 52px, letter-spacing -0.02em, line-height 1.15

VOICE:
  Premium product photography vibe. The viewer should feel "Apple keynote
  spotlight" — phone floating in soft light, dramatic but not loud. The
  screenshot is the message; the phone is the stage.

NEVER:
  • render without the iPhone frame (frame IS the identity)
  • flat phone color — must have the metallic edge gradient or feels cartoonish
  • round screen corners < 80px or > 96px — iPhone 15 Pro is ~88px
  • omit the Dynamic Island (it's the visual signature of modern iPhones)
  • rotate the phone beyond ±3deg during the float
  • add decoration on top of the screen (blobs, particles) — screen is sacred
  • caption longer than 8 words — phone composition needs negative space
  • bright background — preset requires dark moody stage for the spotlight feel
  • elastic/back.out on the phone body itself (only on Dynamic Island reveal)`.trim(),
});

STYLE_PRESETS.push({
  id: 'pip-talking-head',
  role: 'concept',
  roleLabel: 'PIP · talking-head',
  defaultFontSet: 'brand',
  label: 'PIP talking-head',
  description: 'Avatar pequeno no canto + conteúdo grande ocupando o resto — feel de live stream/podcast.',
  emoji: '⚡',
  bestFor: 'Conteúdo educativo / tutorial onde o avatar fala mas o ponto principal é o gráfico/texto que ocupa a tela.',
  bgType: 'dark',
  atmosphere: {
    baseBg: '#0a0a0c',
    warmGlow: { color: '#ff6b3c', alpha: 0.08, pos: '15% 80%' },
    coolGlow: { color: '#3ce7ff', alpha: 0.10, pos: '85% 20%' },
    vignetteIntensity: 0.5,
  },
  geminiBrief: `
PALETTE: Live-stream / podcast aesthetic — high-energy backdrop, talking-head as overlay.
  bg: brandBackgroundColor (if dark) OR '#0a0a0c'
  text: '#ffffff' (must contrast 7:1 on dark bg)
  accent: brandPrimaryColor (for hero word + PIP frame border)
  pip-frame: '#1a1a1a' (the rounded card behind avatar slot)
  pip-frame-border: 2px solid accent at 80% alpha
  pip-shadow: 0 12px 40px rgba(0,0,0,0.5)

CONTEXT FROM BLOCK:
  This preset is intended for BLOCKS WHERE THE AVATAR IS PRESENT (avatar mode).
  The motion COMPLEMENTS the avatar — the talking-head video is already rendered
  by the timeline at its layout-defined position. This preset's HTML provides:
  (a) a decorative PIP frame that the avatar will sit IN; (b) bold content
  graphics that occupy the rest of the canvas.
  CRITICAL: do NOT render the avatar yourself. The .clip layers you produce go
  UNDER the avatar layer. Reserve the bottom-right corner for the avatar by
  leaving a 400×400px transparent zone at position (bottom: 60px, right: 60px).

LAYOUT:
  Main content area (top + left + center):
    - hero text fills 70% of canvas, anchored top-third
    - .font-display weight 800-900, 110-180px, letter-spacing -0.04em, line-height 0.95
    - 1-2 words highlighted with accent color (NOT the whole text)
    - secondary text (caption / supporting line): .font-body 32-44px weight 500,
      below the hero, max 2 lines
    - decorative accent: 1 horizontal hairline 2px solid accent at 60% alpha,
      between hero and caption, width 200px
  PIP reservation zone (DO NOT FILL):
    - position: absolute; bottom: 60px; right: 60px
    - width: 400px; height: 400px (the actual avatar layer goes here from the timeline)
    - The PIP frame decoration BELONGS HERE (z-index just below avatar):
      a soft rounded shell with .pip-frame-border, .pip-shadow, border-radius 32px,
      with a subtle pulse glow over time
  Background decoration:
    - 2-4 soft particles (8-14px, accent color, opacity 0.25-0.45) drifting slowly
    - 1 large blurred radial glow behind hero text, opacity 0.18, blur(60px)

MOTION (5s timeline):
  - 0.0-0.4s: bg glow fades in opacity 0 → 0.18, ease power2.out
  - 0.2-0.7s: hero text reveals word-by-word with clip-path inset(0 100% 0 0) → 0,
    stagger 0.10s, each 0.35s ease power4.out
  - 0.6-0.9s: accent hairline expands from width 0 → 200px, ease expo.out
  - 0.7-1.1s: caption fades in opacity + translateY(10 → 0), ease power3.out
  - 1.0-1.4s: PIP frame appears with scale 0.85 → 1 + opacity 0 → 1, ease back.out(1.6)
  - 1.4s onwards: PIP border glow pulse (border-color alpha 0.6 ↔ 1.0 yoyo 2.4s sine.inOut)
  - 1.4s onwards: particles drift translateY ±18px yoyo over 4-6s, randomly staggered
  - 4.6-5.0s: hero scale 1 → 0.97 + opacity 1 → 0, exit ease power3.in

TYPOGRAPHY:
  hero: .font-display weight 800-900, 110-180px
  caption: .font-body weight 500, 32-44px
  italic OK on 1-2 hot words (visual rhythm)

VOICE:
  Live podcast set. The avatar is the personality; the graphic is the
  point. Both win when they share the frame — the avatar gets a corner,
  the graphic gets the stage, and they conspire to make the viewer feel
  they're watching a premium show.

NEVER:
  • fill the bottom-right 400×400px zone with motion content (avatar lives there)
  • cover the hero text with the PIP frame
  • use the PIP frame as a "card" for content — it's specifically the avatar slot
  • forget the PIP frame entirely (the frame IS the visual signature)
  • render an actual avatar/face inside the PIP frame (timeline layer does that)
  • use easing back.out / elastic on the hero text — those break the "live show" feel
  • saturate > 70% — live stream graphics are punchy but not neon
  • more than 2 hot accent words in the hero (visual fatigue)`.trim(),
});

STYLE_PRESETS.push({
  id: 'before-after-split',
  role: 'comparison',
  roleLabel: 'Antes / Depois',
  defaultFontSet: 'brand',
  label: 'Antes / Depois',
  description: 'Split vertical com reveal diagonal — 2 assets comparados lado a lado.',
  emoji: '⚖',
  bestFor: 'Comparações visuais: produto antes/depois, app legado vs novo, dia 1 vs dia 30 — qualquer transformação que ganha com confronto direto.',
  bgType: 'dark',
  atmosphere: {
    baseBg: '#0c0c10',
    warmGlow: { color: '#ff5a3c', alpha: 0.10, pos: '20% 50%' },
    coolGlow: { color: '#3ce7ff', alpha: 0.10, pos: '80% 50%' },
    vignetteIntensity: 0.6,
  },
  geminiBrief: `
PALETTE: Confronto / transformação. Visual peso emocional, accent forte.
  bg: brandBackgroundColor (dark) OR '#0c0c10'
  text: '#ffffff'
  label-before-bg: '#3a1a1a' (deep warm red — failure/past)
  label-after-bg: '#1a3a2a' (deep emerald — success/future)
  label-before-text: '#ff8a6c' (warm coral)
  label-after-text: '#6cf0a8' (mint)
  divider: linear-gradient(180deg, accent 0%, white 50%, accent 100%) — the slash between halves
  caption-color: '#ffffff'
  caption-accent: brandPrimaryColor (or '#3ce7ff' fallback)

REQUIRED ASSETS:
  This preset REQUIRES TWO pinnedAssets:
    - pinnedAssets[0] = the BEFORE image (placed on the LEFT half)
    - pinnedAssets[1] = the AFTER image (placed on the RIGHT half)
  If only 1 asset provided: use it on the AFTER side; render a gray placeholder
  on the BEFORE side with the text "ANTES" at 60% alpha.
  If 0 assets: render a gradient on both sides with labels visible — degrade
  gracefully but keep the structure recognizable.

LAYOUT (CRITICAL — diagonal split with confrontation):
  Canvas split into 2 vertical halves with a diagonal seam:
    Left half (BEFORE):
      - clip-path: polygon(0 0, 55% 0, 45% 100%, 0 100%) — slight diagonal lean
      - background image: pinnedAssets[0] via background-image: url(...) cover center
      - desaturate filter: grayscale(0.7) brightness(0.85) — past looks faded
    Right half (AFTER):
      - clip-path: polygon(45% 0, 100% 0, 100% 100%, 55% 100%) — mirrored diagonal
      - background image: pinnedAssets[1] via background-image: url(...) cover center
      - NO desaturate — full color, future looks vivid
  Diagonal divider seam:
    - a 6px wide diagonal strip running from (55% top) to (45% bottom)
    - background: divider gradient
    - z-index above both halves
    - subtle glow: box-shadow 0 0 24px accent at 40% alpha
  Labels:
    - "ANTES" label: position absolute top: 120px, left: 80px, padding 16px 32px,
      background label-before-bg, color label-before-text, .font-display 36px
      weight 700, letter-spacing 0.08em, text-transform uppercase, border-radius 8px
    - "DEPOIS" label: same style on the right, position top: 120px, right: 80px,
      background label-after-bg, color label-after-text
  Optional caption at the bottom:
    - max 6 words, .font-display 56px weight 800 white, centered,
      position: absolute; bottom: 140px; left: 50%; transform translateX(-50%)
    - text-shadow: 0 4px 24px rgba(0,0,0,0.8)

MOTION (5s timeline) — confrontation rhythm:
  - 0.0-0.6s: both halves slide in from opposite sides simultaneously:
    - LEFT half: translateX(-300px → 0), opacity 0 → 1, ease power3.out
    - RIGHT half: translateX(300px → 0), opacity 0 → 1, ease power3.out
  - 0.6-1.0s: diagonal divider expands from height 0 → 100% with the gradient
    revealing, ease expo.out, scaleY origin center
  - 0.9-1.3s: labels appear:
    - BEFORE label: opacity 0 → 1 + translateX(-30 → 0), ease back.out(1.6), 0.4s
    - AFTER label: opacity 0 → 1 + translateX(30 → 0), ease back.out(1.6), 0.4s,
      delay 0.1s after BEFORE
  - 1.3s onwards: very subtle ambient breath — both halves scale 1 ↔ 1.015 yoyo
    over 5s sine.inOut (alternating phase so it feels like they're pulsing toward each other)
  - 1.5-2.0s: divider glow pulses (box-shadow alpha 0.4 ↔ 0.7 yoyo 2.5s)
  - If caption: caption fades in at 1.8s with opacity + translateY(20 → 0), 0.7s
  - 4.6-5.0s: divider scales 1 → 1.15 + opacity 1 → 0; halves scale 1 → 0.97 + fade

TYPOGRAPHY:
  labels: .font-display weight 700, 36px, UPPERCASE, letter-spacing 0.08em
  caption: .font-display weight 800, 56px

VOICE:
  Drama da transformação. O lado esquerdo precisa parecer EVITÁVEL, o direito
  ASPIRACIONAL. Eles competem visualmente; o motion é sobre essa tensão.
  Pensa "anúncio de campanha política do antes vs depois" — não sutil, frontal.

NEVER:
  • render without the diagonal divider (the seam IS the identity)
  • render both halves with the same saturation (defeat the comparison)
  • diagonal seam mais vertical que 5° de inclinação ou mais que 15° (visual ruído)
  • labels horizontais sem o background sólido (ficam frágeis)
  • saturação > 90% no lado AFTER (parece neon, não aspiracional)
  • caption longer than 8 words (composition needs the visual to breathe)
  • particles ou blobs no top — a comparação já é o conteúdo
  • easing suave (sine.*) nas entradas — confronto é rápido
  • flip-flop dos lados (AFTER à esquerda é antinatural pra leitura ocidental)`.trim(),
});

STYLE_PRESETS.push({
  id: 'icon-callout',
  role: 'example',
  roleLabel: 'Destaque · ícone + label',
  defaultFontSet: 'apple',
  label: 'Destaque ícone',
  description: 'Ícone SVG grande + label curto + número/keyword — momento de hero compacto.',
  emoji: '💥',
  bestFor: 'Pontos de destaque rápidos: "💰 R$ 50K", "⚡ 3x mais rápido", "🎯 Foco". Card hero de uma só métrica/conceito.',
  bgType: 'dark',
  atmosphere: {
    baseBg: '#0a0a0c',
    warmGlow: { color: '#ffd93c', alpha: 0.10, pos: '50% 30%' },
    coolGlow: { color: '#0ea5e9', alpha: 0.08, pos: '50% 70%' },
    vignetteIntensity: 0.5,
  },
  geminiBrief: `
PALETTE: Hero compact card — icon-first, single accent.
  bg: brandBackgroundColor (must be dark — luminance < 25%).
      Fallback: '#0a0a0c' (deep dark) — never pure #000.
  text: '#ffffff' for the main label (acceptable here — high-contrast hero).
  accent: brandPrimaryColor (or '#ffd93c' yellow fallback when banned hue)
  card-bg: rgba(255, 255, 255, 0.06) — subtle backdrop behind the icon+label cluster
  card-border: rgba(255, 255, 255, 0.14) — 1px hairline
  glow: 0 0 60px <accent> at alpha 0.35 — soft halo behind the icon ONLY

REQUIRED CONTENT:
  This effect rendres ONE compact composition with three pieces:
    1. A LARGE SVG ICON (240-320px, stroke 4-6px or filled, accent color)
    2. A SHORT LABEL (1-3 words OR a metric like "R$ 50K" / "3x" / "0→1M")
    3. An OPTIONAL secondary line (1 short sentence, ≤ 8 words, muted)
  If the block text mentions a metric (number + unit), render the metric
  as the label. Otherwise extract the most-strong noun/verb from the text.

LAYOUT (CRITICAL — single hero composition, not full-screen graphic):
  Composition is a vertical stack centered at canvas center:
    Icon container:
      - position: absolute; top: 38%; left: 50%; transform: translate(-50%, -50%)
      - 240-320px square, contains the SVG icon
      - glow halo: 0 0 60px accent at 0.35 alpha (box-shadow on the container)
    Label:
      - directly below icon, gap 36px
      - .font-tech weight 700, 96-140px (large but not screaming)
      - color: white; letter-spacing -0.02em; text-align center
    Secondary line (optional):
      - below label, gap 18px
      - .font-body weight 500, 32-40px
      - color: rgba(255, 255, 255, 0.65); max-width 720px; center
  Background composition wraps the icon+label cluster in a soft card:
    - position: absolute; inset: 25% 12% 25% 12% (top right bottom left)
    - background: card-bg; border: 1px solid card-border; border-radius: 28px
    - backdrop-filter: blur(8px) — very light glass effect
    - NO heavy decoration outside this card — preset stays focused

MOTION (5s timeline) — punch in, hold, fade out:
  - 0.0-0.4s: card scale 0.85 → 1.0 + opacity 0 → 1, ease back.out(1.4)
  - 0.2-0.7s: icon enters via stroke-dashoffset (if outline) OR scale 0.6 → 1.0 +
    opacity 0 → 1 (if filled), ease back.out(1.8), starts at card 0.2s
  - 0.5-0.9s: label opacity 0 → 1 + translateY(16 → 0), ease power3.out, 0.4s duration
  - 0.7-1.1s: secondary line opacity 0 → 1 (if present), ease power2.out
  - 1.0s onwards: glow halo pulses (box-shadow alpha 0.35 ↔ 0.55 yoyo over 2.4s sine.inOut)
  - 1.0s onwards: icon micro-float translateY ±3px yoyo over 4s sine.inOut
  - 4.6-5.0s: whole composition scale 1 → 0.96 + opacity 1 → 0, ease power3.in

TYPOGRAPHY:
  label: .font-tech weight 700, 96-140px
  secondary: .font-body weight 500, 32-40px

VOICE:
  Apple-keynote moment. One number, one icon, one truth. The viewer
  doesn't need to read — they need to SEE the magnitude. Restraint creates
  the impact. If you tried to add a second icon or a second metric, you
  killed it. ONE thing.

NEVER:
  • render without an SVG icon (the icon IS the preset)
  • use external image URLs — only inline SVG
  • emoji as substitute for SVG (emojis read as casual; SVGs read as designed)
  • more than 1 icon per composition (1 hero, no companions)
  • icon smaller than 200px or larger than 360px (lose magnitude either way)
  • label longer than 5 words (over that, switch to illustrated-explainer)
  • backgrounds with patterns, gradients beyond 1 subtle stop, or particles
  • text-shadow on label (clean hero, not 'designed' graphic)
  • rotation on icon or label
  • elastic > 1.8 (overshoot kills the Apple-keynote feel)
  • saturation > 70% on accent (loud is the wrong note here — confident is the right one)`.trim(),
});

STYLE_PRESETS.push({
  id: 'karaoke-captions',
  role: 'hook',
  roleLabel: 'Karaokê · word-sync',
  defaultFontSet: 'brand',
  label: 'Karaokê word-sync',
  description: 'Caption palavra-por-palavra sincronizada com o TTS — vibe TikTok / Reels viral.',
  emoji: '🎤',
  bestFor: 'Hooks emocionais, frases de impacto, qualquer momento onde a fala É o conteúdo e merece destaque tipográfico.',
  bgType: 'dark',
  atmosphere: {
    baseBg: '#0a0a0c',
    warmGlow: { color: '#ffd93c', alpha: 0.12, pos: '50% 30%' },
    coolGlow: { color: '#ffffff', alpha: 0.04, pos: '50% 80%' },
    vignetteIntensity: 0.65,
  },
  geminiBrief: `
PALETTE: TikTok / Reels viral caption — high contrast, single accent.
  bg: brandBackgroundColor (dark) OR '#0a0a0c'
  text-idle: '#ffffff' (the words waiting to be spoken)
  text-active: brandPrimaryColor (or '#ffd93c' yellow fallback) — the CURRENT word
  text-active-bg: rgba(0, 0, 0, 0.6) — slight backdrop behind the active word for legibility
  text-spoken: rgba(255, 255, 255, 0.55) — words already said, faded back

REQUIRED CONTEXT:
  This preset works with WORD TIMESTAMPS injected by motionService when available.
  Look for a "WORD TIMESTAMPS" section in the prompt — it lists each word + start +
  end (in seconds, relative to the block's audio start). If timestamps ARE provided:
  build a real karaoke where each word transitions through 3 states (idle → active →
  spoken). If timestamps are NOT provided: degrade gracefully — show all words at
  once with a slow stagger reveal (0.15s between words) over the full block duration.

LAYOUT:
  Single hero caption fills the canvas vertical center:
    - position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)
    - max-width: 920px (leave canvas margins)
    - text-align: center
    - .font-display weight 900, 120-180px (BIG — caption is the only thing)
    - letter-spacing: -0.04em
    - line-height: 1.08
    - text-transform: UPPERCASE for hero emotional beats; mixed-case for narrative
  Each word is a SEPARATE <span> with class clip and an id like word-0, word-1, etc:
    - inline-block, padding 4px 14px, border-radius 8px
    - default style: color text-idle, background transparent
    - active state: color text-active, background text-active-bg
    - spoken state: color text-spoken, background transparent
  No decoration, no shapes, no background blobs — karaoke is pure typography.

MOTION (word-by-word, driven by timestamps when present):
  Per-word lifecycle:
    - 0.0 → wordStart: idle state (visible at text-idle color, scale 1.0)
    - wordStart → wordStart + 0.10s: transition to ACTIVE
      * color text-idle → text-active over 0.10s
      * scale 1.0 → 1.06 ease back.out(1.6) over 0.18s
      * background fades in (text-active-bg) over 0.10s
      * subtle text-shadow blooms: 0 0 24px text-active at 0.4 alpha
    - wordEnd → wordEnd + 0.15s: transition to SPOKEN
      * color text-active → text-spoken over 0.15s
      * scale 1.06 → 1.0 ease power3.out
      * background fades out
      * text-shadow returns to none
  If NO timestamps:
    - reveal all words sequentially with stagger 0.15s starting at 0.0s
    - each word: opacity 0 → 1 + scale 0.92 → 1, ease back.out(1.6), 0.35s
    - all stay visible at text-idle color, no active/spoken states
  Background ambient:
    - very subtle radial glow behind the caption block (track-0): opacity 0.08 → 0.14
      yoyo over 3s sine.inOut, color text-active

TYPOGRAPHY:
  caption: .font-display weight 900, 120-180px
  italic OK on 1-2 emotional hot words (sets visual rhythm without breaking flow)

VOICE:
  TikTok viral caption. O TTS está falando — o texto faz dança com a voz.
  Não é sub-título passivo, é PROTAGONISTA. Cada palavra ganha o seu instante
  de espotlight quando é falada. Hierarquia visual = sequência temporal.

NEVER:
  • mostrar todas as palavras com a mesma cor/peso ao mesmo tempo (defeats the karaoke)
  • mais de 1 palavra "ativa" simultânea (foco se dissolve)
  • decoração não-tipográfica (blobs, particles, gradients no fundo)
  • caption pequeno (< 100px) — karaoke precisa ler de longe
  • cores active no espectro 250-345 hue (purple/rose/magenta — PRINCIPLE 6)
  • saturação < 70% no text-active — palavra ativa precisa pular
  • durations > 0.3s em qualquer transição active (matar o ritmo)
  • esquecer o estado spoken (palavras spent precisam recuar visualmente)
  • rotation em palavras (texto bailando = ruído, não dança)
  • multi-line layout se há > 8 palavras — quebra a leitura linear do karaokê`.trim(),
});


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
