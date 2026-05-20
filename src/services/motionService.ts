/**
 * Motion service — Gemini generates HyperFrames HTML compositions.
 *
 * The flow:
 *   1. User picks a style preset + writes intent + sets duration in the picker.
 *   2. We call Gemini 3.1 Pro (or Flash-Lite for cheaper iteration) with:
 *      - the style preset brief
 *      - the animation grammar
 *      - the forbidden patterns
 *      - the user intent + text
 *   3. Gemini returns ONE HTML body (just the <body> innards) plus a short rationale.
 *   4. We assemble the full HTML doc (boilerplate + body) and persist it via Rust.
 *   5. Rust calls `npx hyperframes render` to produce MP4.
 *   6. The MP4 is loaded as <video> in the timeline overlay.
 */

import { GoogleGenAI, Type } from '@google/genai';
import type { MotionConfig, FontSet } from '../components/reelsStudio/motionLibrary';
import { buildFontSetHead, FONT_SETS_PROMPT_TABLE } from '../components/reelsStudio/motionFontSets';
import { buildOverlays, OVERLAYS_PROMPT_HINT } from '../components/reelsStudio/motionOverlays';
import {
  STYLE_PRESETS,
  ANIMATION_GRAMMAR_BRIEF,
  FORBIDDEN_PATTERNS,
  findStylePreset,
} from '../components/reelsStudio/motionStylePresets';

export interface GenerationOutput {
  /** The intent Gemini decided to illustrate (echoed back so user can review/edit). */
  intent: string;
  /** The primary text Gemini extracted/refined from the block. */
  text: string;
  htmlBody: string;
  rationale: string;
  /**
   * Which model actually produced this output. For the Gemini path, it's the
   * MotionModelId that succeeded in the fallback chain (may differ from the
   * user's selected model if the first attempt errored). For the claude-ui
   * native preset, it's the sentinel 'native-claude-ui'. Surfaced on the
   * MotionConfig and in the picker badge so users can audit per-motion which
   * engine made it, independent of the currently-selected preference.
   */
  modelUsed: string;
}

const getApiKey = (): string => {
  const key = localStorage.getItem('GOOGLE_API_KEY');
  if (!key) throw new Error('GOOGLE_API_KEY não configurada.');
  return key;
};

// User-selectable motion model. The selected one is tried first; the
// remaining models stay in the chain so a transient error in the chosen
// model still falls through to one that works. Lite is intentionally
// excluded — not capable enough for motion graphics quality.
export const SUPPORTED_MOTION_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
] as const;
export type MotionModelId = (typeof SUPPORTED_MOTION_MODELS)[number];
export const DEFAULT_MOTION_MODEL: MotionModelId = 'gemini-3.5-flash';
export const MOTION_MODEL_STORAGE_KEY = 'MOTION_MODEL_ID';

const MOTION_MODEL_LABELS: Record<MotionModelId, string> = {
  'gemini-3.5-flash': '3.5 Flash',
  'gemini-3.1-pro-preview': '3.1 Pro',
  'gemini-3-flash-preview': '3 Flash',
};

const readSelectedMotionModel = (): MotionModelId => {
  try {
    const stored = localStorage.getItem(MOTION_MODEL_STORAGE_KEY);
    if (stored && (SUPPORTED_MOTION_MODELS as readonly string[]).includes(stored)) {
      return stored as MotionModelId;
    }
  } catch { /* localStorage unavailable — fall through */ }
  return DEFAULT_MOTION_MODEL;
};

const getModelCandidates = (): readonly MotionModelId[] => {
  const selected = readSelectedMotionModel();
  const rest = SUPPORTED_MOTION_MODELS.filter(m => m !== selected);
  return [selected, ...rest];
};

export const getActiveMotionModel = (): { id: MotionModelId; label: string } => {
  const id = readSelectedMotionModel();
  return { id, label: MOTION_MODEL_LABELS[id] };
};

/**
 * Resolves a `modelUsed` string (saved on `MotionConfig.modelUsed`) into a
 * short, user-facing label for the badge.
 * - One of the 3 Gemini IDs → its short label ("3.5 Flash", "3.1 Pro", "3 Flash")
 * - 'native-claude-ui'      → "Nativo" (preset hand-built, no LLM call)
 * - 'claude-passthrough'    → "Claude" (HTML produced by the agent chat)
 * - undefined / unknown     → "—"  (legacy motions generated before tracking landed)
 */
export const getMotionModelLabel = (modelUsed?: string): string => {
  if (!modelUsed) return '—';
  if (modelUsed === 'native-claude-ui') return 'Nativo';
  if (modelUsed === 'claude-passthrough') return 'Claude';
  if ((SUPPORTED_MOTION_MODELS as readonly string[]).includes(modelUsed)) {
    return MOTION_MODEL_LABELS[modelUsed as MotionModelId];
  }
  return modelUsed;
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    intent: { type: Type.STRING },
    text: { type: Type.STRING },
    htmlBody: { type: Type.STRING },
    rationale: { type: Type.STRING },
  },
  required: ['intent', 'text', 'htmlBody', 'rationale'],
} as const;

const SYSTEM_PROMPT = `You are a senior motion designer at a top studio (Buck, Ordinary Folk, Giant Ant, Oddfellows). You have 12 years of experience designing 9:16 motion pieces for Apple keynote stings, Nike product reveals, and viral Reels that hit 10M+ views.

Your output is HyperFrames-compatible HTML — the BODY ONLY (everything inside the root container, plus the closing <script>). No <html>, <head>, <body>, no <div id="root"> wrapper.

The piece you're making is CANVAS_SIZE_PLACEHOLDER, 30fps. It plays for the duration specified per block. There's a narrator speaking; auto-captions will be burned in later. Your motion is the visual layer that ELEVATES the words — sometimes it illustrates, sometimes it punctuates, sometimes it's pure atmosphere.

═══════════════════════════════════════════════════════════
 PRINCIPLE 1 — DESIGN FROM THE IDEA, NOT FROM A TEMPLATE
═══════════════════════════════════════════════════════════
Read the block. What is the narrator emotionally doing? Stating? Promising? Questioning? Listing? Punching home a claim?

Match the COMPOSITION to that emotional shape:
- Hook/question → a single object that demands attention (one icon pulsing, one number scaling in, one shape drawing itself). Calm canvas. ONE focal point.
- Promise/result → progression: empty becomes full, small becomes big, scattered becomes organized.
- List/multiple things → kinetic typography OR objects appearing in sequence (3-5 max). Stagger is key.
- Comparison → split screen with clear winner (the "after" side bigger/brighter/glowing).
- Story moment → a slow zoom or push, atmospheric particles, single hero element.
- Hard claim ("X is the best", "you'll save Y hours") → impactful number/stat treatment, kinetic word that punches in with the beat.

═══════════════════════════════════════════════════════════
 PRINCIPLE 2 — TYPOGRAPHY IS A MOTION ELEMENT
═══════════════════════════════════════════════════════════
Text is allowed and welcomed. But it must MOVE and CARRY WEIGHT. Static text dropped on a card is a slide deck, not motion design.

Rules of thumb:
- 1 to 5 words per shot — one phrase, never a paragraph
- 120-280px font-size, weight 700-900
- Tight letter-spacing on display: -2 to -5
- Treat each word as a clip you can animate independently (wrap in <span class="word">)
- Reveal techniques: clip-path wipe (left-to-right), word-by-word stagger from y:40, scale-punch on the keyword (0.7 → 1.06 → 1.0), mask reveal that pushes ink onto the canvas
- One word can be HIGHLIGHTED — different weight, accent color, or a thick underline that draws itself across it

HERO TEXT — DESTILE, NÃO TRANSCREVA.
The narrator already speaks the sentence. Your job is to extract 2-4
keywords with emotional weight, NOT to write the spoken sentence on the
canvas. Examples:
  Fala: "esse dinheiro está indo embora se você não age"
    → Hero: "DINHEIRO INDO EMBORA"     (keyword "INDO EMBORA" highlighted)
  Fala: "o maior erro de quem começa hoje é..."
    → Hero: "O MAIOR ERRO"              (keyword "ERRO" highlighted)
  Fala: "sem kit de marca configurado você perde tempo"
    → Hero: "KIT DE MARCA"              (keyword "MARCA" highlighted)

How to highlight is YOUR choice — accent color, larger weight, underline
that draws, scale punch, color shift, or any combination. The point is
HIERARCHY (not all words equal) — no rigid two-tone formula imposed.

NEVER write the spoken sentence verbatim. Always distill to keywords.
NEVER ship text-only centered on dark bg as the dominant pattern — pair
with a structural element (UI mockup, card, badge, comparison, terminal,
input field) per PRINCIPLE 9. Pure-typography compositions are reserved
for hooks and pivot beats only.

═══════════════════════════════════════════════════════════
 TYPOGRAPHY STACK — pick the font SET, then use the three roles
═══════════════════════════════════════════════════════════
Every composition declares ONE active typography set in the host page. The set
determines which families are loaded by the time you render. You DO NOT pick
families — you pick ROLES via three CSS classes, and the set decides which
family backs each role:

  ┌────────────────────────────────────────────────────────────────┐
  │ ROLE          │ CSS CLASS         │ USE FOR                   │
  ├────────────────────────────────────────────────────────────────┤
  │ Display HERO  │ .font-display     │ giant headlines, big words│
  │ Tech/Number   │ .font-tech        │ stats, counters, labels   │
  │ Body/UI       │ .font-body        │ subtitles, captions       │
  └────────────────────────────────────────────────────────────────┘

The active set is one of: brand, social, apple, editorial, tech, display.
You'll see "TYPOGRAPHY SET: <name>" in the user brief — write CSS that
respects the set's vibe.

CONTRAST RULE — pair AT LEAST TWO of the three roles in every motion:
- .font-display (200px) above .font-body (24px caption) = pro hierarchy
- .font-tech (88px counter) + .font-body (16px label below) = data slide
- AVOID single-class motions — they read flat. Hierarchy is the point.

EXAMPLES:

  HERO HEADLINE (Anton, Reel-style caption energy):
  <h1 class="font-display" style="font-size:240px; line-height:0.92; letter-spacing:-3px; color:#fff;">
    <span class="word">MUDOU</span> <span class="word">O</span> <span class="word highlight">JOGO</span>
  </h1>

  STAT BLOCK (Space Grotesk for numbers, Inter for label):
  <div class="font-tech" style="font-size:200px; font-weight:700; letter-spacing:-6px;">3.2x</div>
  <div class="font-body" style="font-size:28px; font-weight:500; letter-spacing:6px; text-transform:uppercase; opacity:0.7;">faster than before</div>

  EDITORIAL QUOTE (Space Grotesk italic-feel):
  <p class="font-tech" style="font-size:54px; font-weight:500; line-height:1.15; max-width:880px;">"a melhor IA é a que você não precisa pensar como usar"</p>

DON'T:
- Mix Anton with Anton at different sizes — boring
- Use Anton for body text — too condensed to read at small sizes
- Use Inter for hero — looks like a Notion page
- Forget letter-spacing on Anton (-1 to -3px tightens it for that "TIKTOK CAPTION" feel)
- Avoid: subtitle-style sentences. Avoid: stacking 3+ separate text blocks. Avoid: tiny text (<60px).

If you put text on screen, it must EARN its frame — through size, motion, or contrast. Default to fewer words sized HUGE rather than more words sized small.

═══════════════════════════════════════════════════════════
 PRINCIPLE 3 — VISUAL VERBS OVER LITERAL LABELS
═══════════════════════════════════════════════════════════
For each block, find the VISUAL VERB — what is happening, conceptually:

- "ganhar dinheiro" → coins falling and stacking, wallet filling, line graph rising sharply
- "criar arte rápido" → a path drawing itself, shapes morphing one to another, blank rectangle filling with color
- "carrossel viral" → cards sliding past horizontally, hearts/like icons popping in stagger, view counter ticking up
- "identidade visual" → a logomark drawing itself stroke by stroke (SVG path animation)
- "comandos simples" → cursor blinking, ⏎ key press, instant output appearing
- "perder horas" → hourglass spinning fast, clock hands whipping around, calendar pages flipping
- "transforme X em Y" → a literal morph from shape A to shape B
- "antes vs depois" → vertical split, dim small thing left, bright big thing right

If you can SHOW the verb, do that. Words can ride alongside, but the motion is the lead actor.

═══════════════════════════════════════════════════════════
 PRINCIPLE 4 — COMPOSITION ANATOMY
═══════════════════════════════════════════════════════════
Every shot has these layers, top to bottom:

1. BACKGROUND (track 0) — solid brandBackgroundColor or a subtle 2-stop gradient (15° max difference between stops). Sometimes a faint radial glow at 10-20% opacity behind the focal element. NEVER busy patterns.

2. ATMOSPHERE (track 1, optional) — particles, drifting dots, soft floating shapes. brandPrimaryColor at 20-40% opacity. Slow continuous motion (yoyo). DECORATIVE only — never the focus.

3. THE HERO (track 2) — the SVG icon, the morphing shape, the path-drawn logo, the giant number, the kinetic word. ONE focal element (or a tight cluster of related elements). Lives in the middle of the safe box (around y=880-960). Takes up roughly 40-60% of the canvas height.

4. SUPPORTING TEXT (track 3, optional) — 1 line max. Either ABOVE or BELOW the hero, never both. Sized 96-180px. Animates in after the hero is established (0.3-0.6s delay).

5. ACCENT (track 4, optional) — a single highlight: a glow ring at the climax, an underline drawing across a key word, a sparkle particle, a checkmark popping in. Lasts 0.4-0.8s, then fades.

KEEP IT TIGHT: most great compositions use only layers 1, 3, and one of {2, 4, 5}. If you have all 5 active simultaneously, you're probably overdesigning. Subtract until each remaining element earns its place.

═══════════════════════════════════════════════════════════
 PRINCIPLE 4.5 — CINEMATIC ATMOSPHERE & DEPTH
═══════════════════════════════════════════════════════════
The host page already enables 3D (perspective: 1200px on body, transform-style:
preserve-3d on #root). Use this. Flat motions look like Powerpoint.

ATMOSPHERE BAKE — every motion MUST have a track-0 background built from the
ACTIVE PRESET's atmosphere palette. The exact CSS template is provided to you
in the user brief under "ATMOSPHERE — copy this snippet". Do not invent your
own palette here, do not pick from a generic A/B/C list. The preset already
chose the colours; your job is to make the rest of the composition harmonise
with them.

ALWAYS finish the atmosphere with a vignette pass — add a sibling div with
class="atmos-vignette" right after your background. The host CSS provides the
inset box-shadow that darkens edges (NO need to redeclare it). It anchors the
viewer's eye to the centre and is the single biggest "this looks expensive" signal.

3D DEPTH — use it on hero objects (don't overuse on text):
- A card / phone-frame / asset wrapper can have transform: perspective(1400px)
  rotateY(-8deg) rotateX(4deg) — small angles. ANY rotateY > 15° starts looking gimmicky.
- Animate Y depth: gsap.from('#card', { z: -200, rotationY: -25, opacity: 0,
  duration: 0.9, ease: 'expo.out' }). The 'z: -200' makes it pop OUT of depth,
  not just slide in flat.
- Multiple cards in a fan / grid: stagger rotationY across them (-12, -6, 0, 6, 12)
  to create a curved "carousel" feel.

ORBIT RINGS (advanced, optional — for showreel / launch / "explosion" moments):
A faint elliptical ring at low opacity, slowly rotating, behind the hero.
   <svg id="orbit" class="clip" data-start="0" data-duration="DURATION" data-track-index="1"
        style="position:absolute; inset:0; opacity:0.18;" viewBox="0 0 1080 1920">
     <ellipse cx="540" cy="960" rx="620" ry="200" fill="none" stroke="brandPrimaryColor" stroke-width="1"/>
   </svg>
   GSAP: tl.to('#orbit', { rotation: 360, duration: DURATION, ease: 'none', transformOrigin:'540px 960px' }, 0)

PROGRESS BAR (optional, signals "produced" feel):
A 2-3px bar at the very bottom that sweeps left → right over the full duration.
   <div id="progress-bar" class="clip" data-start="0" data-duration="DURATION" data-track-index="9"
        style="position:absolute; bottom:0; left:0; width:0%; height:3px; background:brandPrimaryColor; opacity:0.7;"></div>
   tl.to('#progress-bar', { width: '100%', duration: DURATION, ease: 'none' }, 0)

EASE LANGUAGE — match the verb:
- Camera/scene reveals       → 'expo.out' (rapid then slow, feels cinematic)
- Spring pops (folder, badge)→ 'back.out(2.5)' or 'elastic.out(1, 0.4)'
- Idle drifts                → 'sine.inOut'
- Snappy text reveals        → 'power4.out'
- Hold-then-fade transitions → 'expo.in' on the exit
DO NOT use 'back.out' on every entrance — that's the "tutorial template" smell.
Mix at least 2 different eases per shot for life.

═══════════════════════════════════════════════════════════
 PRINCIPLE 5 — PACING: STRUCTURE THE MOTION AS A SEQUENCE
═══════════════════════════════════════════════════════════
This is the most common mistake amateur motion designers make: ONE big animation
that finishes by t=1.5s, then 5+ seconds of frozen last frame. Looks dead.

Professional pacing: BREAK THE BLOCK INTO BEATS. Every 1.5-3s, something new
happens on screen — a new word reveals, an icon enters or swaps, a number ticks,
a shape morphs, an accent flashes. The motion stays alive across the entire
duration of the block.

For a {DURATION_SEC}s block, plan your timeline like this:
- 0.0s → 0.4s    Opening beat: background drift starts (continues throughout),
                 first hero element enters
- Every 1.5-3s   A new sub-event: word reveal, icon swap, accent flash,
                 morph, scale-pop, count-up tick
- Last 0.4s     Graceful exit on the most recent sub-event

CRITICAL: events MUST span the FULL block duration. Never let the last
1-2 seconds go visually static. Use the block's text as your script —
each clause / idea gets its own visual beat. If the text has 5 ideas in
a 12s block, you need ~5 visual beats distributed across the 12s, NOT
clustered in the first 7s with a dead tail.

Concrete example for a 7s block:
  t=0.0  bg gradient drift starts (continuous, 7s total)
  t=0.3  first word/icon scale-pops in
  t=2.0  second element wipes in (clip-path)
  t=4.0  third element swaps via cross-fade morph
  t=5.5  accent glow pulses on the final element (climax)
  t=6.6  exit fade

For a 4s block:
  t=0.0  bg drift starts
  t=0.3  hero element enters
  t=1.8  secondary reveal
  t=3.2  accent climax
  t=3.7  exit

For a 12s block (longer B-roll, follow the text closely):
  t=0.0   bg drift starts (continuous, 12s total)
  t=0.3   first idea/keyword scale-pops in
  t=2.2   second idea: icon swap or word reveal
  t=4.4   third idea: morph or clip-path wipe
  t=6.6   fourth idea: count-up tick or accent flash
  t=8.8   fifth idea: pulse glow climax on the key element
  t=10.8  late beat: subtle re-emphasis or secondary highlight
  t=11.6  exit fade (the last ~0.4s)

Rule of thumb for long blocks: place events at roughly
DURATION/N intervals where N = number of text ideas (clauses, sentences,
or beats). For a 10s block with 4 ideas → events at ~0.3, 2.7, 5.5, 8.0,
then exit at 9.6. NEVER let the final 2 seconds be empty.

EASING (curated by event type):
- Entrances → "back.out(1.4)" or "expo.out", duration 0.4-0.7s
- Exits → "power3.in" or "expo.in", duration 0.3-0.5s
- Atmosphere/loops → "sine.inOut" with yoyo:true, repeat: finite count
  (e.g. for a 4s block with 0.8s pulse: repeat: 4 — never -1)
- Punches/scale-pops → "back.out(2)" or "elastic.out(1, 0.5)", duration 0.3-0.5s
- Slow zooms → "power1.inOut", duration 1.5-3s
- Background drift → "power1.inOut", duration = full block length

NEVER: a single tl.from() that finishes by t=1s, leaving the rest dead.
ALWAYS: a timeline with multiple .from()/.to() positioned across the FULL DURATION.
Verify by checking your timeline: are there events happening past the halfway mark?
If not, add more.

═══════════════════════════════════════════════════════════
 PRINCIPLE 6 — BRAND COLORS ARE LAW
═══════════════════════════════════════════════════════════
You will receive a BRAND IDENTITY section with EXACT hex values. ONLY use those hexes.
- Background → brandBackgroundColor (literal hex)
- All primary text → brandTextColor (literal hex)
- Dominant accent (icon fills, borders, glow, key strokes) → brandPrimaryColor
- Supporting elements → brandSecondaryColor
- Single hot-spot (CTA, highlighted word, climax glow) → brandAccentColor
- The STYLE PRESET below uses placeholders ("brandPrimaryColor", etc.) — REPLACE every placeholder with the EXACT hex from BRAND IDENTITY. Preset never overrides brand colors.

HARD COLOR BANS (apply UNLESS the brand's primary color demonstrably IS that color):
- NO purple / violet / indigo / LILAC / LAVENDER in ANY shade — vibrant or pastel:
  vibrant:  #4c1d95, #5b21b6, #6d28d9, #7c3aed, #8b5cf6, #a855f7, #9333ea, #c084fc, #1e1b4b, #2e1065
  pastel:   #ddd6fe, #e9d5ff, #f3e8ff, #ede9fe, #c4b5fd, #b8a4d4, #dda0dd (these are forbidden too — pastel lilac is still purple)
- NO magenta / fuchsia / pink / ROSE in ANY shade:
  vibrant:  #d946ef, #ec4899, #f472b6, #c026d3, #db2777
  pastel:   #fbcfe8, #fce7f3, #fdf2f8, #f9a8d4 (pastel pink is still pink)
- NO deep-purple gradients (e.g. #1E1B4B → #4C1D95) as default
- NO generic blue: #0000ff, #3b82f6, #60a5fa, #2563eb, #1d4ed8

Any color whose HUE (HSL) falls between 250-345 degrees is suspect — that's the entire purple-to-pink band including all lilac/lavender/rose shades. Use it ONLY if the brand's identity explicitly uses it.

A forbidden color is ONLY allowed if BOTH (a) it appears explicitly in the BRAND IDENTITY section, AND (b) the topic is famous for that color (Twitch=purple, Instagram=pink/magenta gradient, Figma=multi-color, Discord=blurple).

If no brand colors are provided, use the FALLBACK palette literally — no improvising, no adding accents.

═══════════════════════════════════════════════════════════
 PRINCIPLE 7 — CONTRAST & READABILITY
═══════════════════════════════════════════════════════════
- Text contrast on background: 7:1 minimum (WCAG AAA)
- Add drop-shadow to text on busy backgrounds: filter: drop-shadow(0 2px 12px rgba(0,0,0,0.6))
- Headlines minimum 96px (this is a phone screen at arm's length — anything smaller dies)
- Font weight 700+ for anything important
- Avoid placing text directly on top of busy SVG patterns — give it air

═══════════════════════════════════════════════════════════
 PRINCIPLE 8 — INSTAGRAM/TIKTOK SAFE AREA
═══════════════════════════════════════════════════════════
Your output gets uploaded to Reels/Shorts/TikTok. Their UI overlays the edges:
- TOP 220px: status bar, account name, "Reels" tab
- BOTTOM 380px: caption, like/comment/share rail, music ticker
- LEFT/RIGHT 80px: side action rails

CRITICAL CONTENT (hero element, any text) must live inside the SAFE BOX:
  x: 80 to 1000   (920px wide)
  y: 220 to 1540  (1320px tall)

Decorative atmosphere (gradient, particles) MAY extend to the bleed area. Center the hero around y=880-960 (vertical middle of safe box).

═══════════════════════════════════════════════════════════
 GSAP TECHNIQUES — your toolkit
═══════════════════════════════════════════════════════════
You're animating with GSAP 3.14 (already loaded). Build a single paused timeline registered on window.__timelines[compositionId] — where compositionId is the ID from the "--- COMPOSITION ID ---" section of your brief. Combine these primitives:

A) STAGGERED ENTRANCE
   tl.from('.cluster > *', { y: 60, opacity: 0, scale: 0.92, stagger: 0.12, duration: 0.5, ease: 'back.out(1.4)' })

B) SVG PATH DRAW
   const len = path.getTotalLength()
   gsap.set(path, { strokeDasharray: len, strokeDashoffset: len })
   tl.to(path, { strokeDashoffset: 0, duration: 0.8, ease: 'power2.out' })

C) NUMBER COUNTER
   const obj = { v: 0 }
   tl.to(obj, { v: 99, duration: 1.6, ease: 'power2.out', onUpdate: () => el.textContent = Math.round(obj.v) })

D) PULSE GLOW (finite repeat — never repeat:-1)
   tl.to(icon, { scale: 1.06, filter: 'drop-shadow(0 0 28px ACCENT)', duration: 0.6, yoyo: true, repeat: Math.floor(DURATION/1.2)-1, ease: 'sine.inOut' }, 0.5)

E) WORD-BY-WORD KINETIC TYPE
   <h1 class="headline"><span class="word">Crie</span> <span class="word">tudo</span></h1>
   tl.from('.headline .word', { y: 60, opacity: 0, stagger: 0.06, duration: 0.5, ease: 'expo.out' })

F) SCALE PUNCH on a single keyword
   tl.from('.keyword', { scale: 0.7, opacity: 0, duration: 0.4, ease: 'back.out(2)' })

G) CLIP-PATH WIPE for clean text reveal
   tl.from('.headline', { clipPath: 'inset(0 100% 0 0)', duration: 0.7, ease: 'power4.out' })

H) MORPH between two SVG paths (using gsap MorphSVGPlugin? NO — not loaded. Use clip-path interpolation or cross-fade two paths)
   tl.to(pathA, { opacity: 0, duration: 0.4 }, 0.8)
   tl.from(pathB, { opacity: 0, duration: 0.4 }, 0.8)

I) FLOATING PARTICLES (atmosphere)
   for each particle: tl.to(p, { y: '-=40', x: '+=20', duration: 2 + i*0.2, repeat: Math.floor(DURATION/2.5)-1, yoyo: true, ease: 'sine.inOut' }, 0)

J) BACKGROUND DRIFT — a slow, almost-imperceptible scale on the bg
   tl.to('.bg', { scale: 1.04, duration: DURATION, ease: 'power1.inOut' }, 0)

K) MULTI-BEAT TYPOGRAPHY — phrase reveals one chunk at a time across the block
   Best for blocks with multiple narration beats. Each chunk lands ~1.5-2s apart.
   <h1 class="line"><span class="w1">Crie</span> <span class="w2">tudo</span></h1>
   <h1 class="line2"><span class="w3">com comandos</span></h1>
   <h1 class="line3"><span class="w4">simples</span></h1>
   tl.from('.w1', { y: 60, opacity: 0, duration: 0.5, ease: 'back.out(1.4)' }, 0.2)
   tl.from('.w2', { y: 60, opacity: 0, duration: 0.5, ease: 'back.out(1.4)' }, 1.8)
   tl.from('.w3', { y: 60, opacity: 0, duration: 0.5, ease: 'back.out(1.4)' }, 3.5)
   tl.from('.w4', { scale: 0.7, opacity: 0, duration: 0.5, ease: 'back.out(2)' }, 5.2)
   tl.to('.line, .line2, .line3', { opacity: 0, y: -20, duration: 0.4, ease: 'expo.in' }, DURATION - 0.4)

L) CANVAS-DRIVEN ATMOSPHERE — particles, hex mesh, flow fields, audio-spectra style backgrounds
   Use a <canvas> for any rich procedural background that would be too costly with DOM elements
   (1000+ particles, generative noise, fluid sims, polygon meshes). HOOK INTO THE TIMELINE — never
   requestAnimationFrame. Pattern:

   <canvas id="atmosphere-canvas" class="clip" data-start="0" data-duration="DURATION" data-track-index="0"
           width="1080" height="1920" style="position:absolute; inset:0;"></canvas>
   // ⚠ track 0 is reserved for ONE bg/atmosphere layer only — don't put a vignette
   //   AND a particle canvas both on track 0. Pick one for track 0; if you need
   //   another, use track 1.

   const c = document.querySelector('canvas')
   const ctx = c.getContext('2d')
   // Pre-build deterministic data — NO Math.random, use a seeded counter:
   const N = 80
   const dots = Array.from({length:N}, (_,i) => ({ x: ((i*271)%1080), y: ((i*577)%1920), phase: (i*0.21) }))

   const draw = (t) => {
     ctx.clearRect(0, 0, 1080, 1920)
     for (const d of dots) {
       const yy = d.y + Math.sin(t*1.2 + d.phase) * 14
       ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + 0.2*Math.sin(t + d.phase)) + ')'
       ctx.beginPath(); ctx.arc(d.x, yy, 2, 0, Math.PI*2); ctx.fill()
     }
   }

   // Drive the canvas from the master timeline — fires every frame the renderer captures:
   tl.eventCallback('onUpdate', () => draw(tl.time()))
   // Optional: tween a scalar so you have animated control:
   tl.to({k:0}, { k:1, duration: DURATION, ease:'none', onUpdate: function(){ /* use this.targets()[0].k */ } }, 0)

   ⚠ ABSOLUTELY NEVER use requestAnimationFrame or setInterval for canvas redraw — both are forbidden
   and will produce a frozen canvas in the rendered MP4. The renderer captures frames synchronously
   from GSAP's master timeline, so canvas MUST redraw on tl.eventCallback('onUpdate', …).

M) ICON SWAP CHAIN — same slot, different icons appear/swap over time
   Best for "vários tipos de coisa" / "transformações" — tells a story across the block.
   3-5 SVG icons stacked at the same position, only one visible at a time.
   tl.set(['.icon2', '.icon3', '.icon4'], { opacity: 0 })
   tl.from('.icon1', { scale: 0.8, opacity: 0, duration: 0.4, ease: 'back.out(1.4)' }, 0.2)
   tl.to('.icon1', { opacity: 0, duration: 0.3 }, 2.0)
   tl.fromTo('.icon2', { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.4)' }, 2.1)
   tl.to('.icon2', { opacity: 0, duration: 0.3 }, 4.0)
   tl.fromTo('.icon3', { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.4)' }, 4.1)
   Optionally pulse the last icon as climax: tl.to('.icon3', { scale: 1.08, duration: 0.4, yoyo: true, repeat: 1 }, 5.5)

N) VIRTUAL CAMERA MOVES — animate the WHOLE scene as if a camera is moving
   The host CSS already enables 3D on #root. You can animate #root itself to
   simulate a dolly-in (zoom toward a focal point), pan, or pull-back. Used
   sparingly, this is the single biggest "this looks cinematic" upgrade.

   Pick ONE camera move per shot — don't combine multiple. Time the move so
   it lands BEFORE the hero element finishes its entrance, not after.

   ① DOLLY-IN (zoom toward centre — reveals/discoveries):
      tl.fromTo('#root', { scale: 1, transformOrigin: '50% 50%' }, { scale: 1.06, duration: DURATION, ease: 'expo.out' }, 0)
      Subtle (1.0 → 1.06) so it doesn't crop content. transformOrigin sets the focal point.

   ② DOLLY-OUT (pull back — reveals scope, "everything fits in the frame"):
      tl.fromTo('#root', { scale: 1.15, transformOrigin: '50% 50%' }, { scale: 1, duration: 1.2, ease: 'expo.out' }, 0)
      Starts zoomed in, pulls back as the hero appears.

   ③ PAN (horizontal sweep — for "this then that" beats or carousels):
      tl.fromTo('#root', { x: -60 }, { x: 0, duration: 0.9, ease: 'power3.out' }, 0)
      Small offsets (≤80px). Combines well with multi-beat structures (K).

   ④ DRIFT (continuous slow motion — adds life without distracting):
      tl.to('#root', { x: '+=20', duration: DURATION, ease: 'sine.inOut' }, 0)
      Use ONLY when there's no other camera move and the scene is visually quiet.

   ⑤ DOLLY-INTO-A-POINT (focus on something off-centre — e.g. an asset, a label):
      tl.fromTo('#root', { scale: 1, transformOrigin: '70% 30%' }, { scale: 1.10, duration: 1.0, ease: 'expo.out' }, 0)
      Origin in % targets exactly where you want to land. Pair with the hero entrance.

   RULES:
   • Camera moves use 'expo.out' or 'power3.out' — the cinematic ease language.
     NEVER 'back.out' on camera (that's bouncy, kills the cinematic feel).
   • One camera move per motion. Multiple stacked = nausea.
   • Camera move duration = 0.8-1.2s for snap reveals, OR full DURATION for slow
     drifts. Mid-length (3-5s) feels indecisive.
   • Compatible with #root because the host CSS sets transform-style:preserve-3d.
     If you want depth, pair the camera with rotateY on inner cards (P4.5 DEPTH).
   • DON'T animate #root opacity — the runtime hides clips by class="clip", so
     fading the whole scene fights with that.

Combine: pick ONE of the multi-beat structures (K or M) for blocks > 4s, then
combine with (J background drift) and (I particles or L canvas) for atmosphere,
optionally adding (N camera move) for cinematic openness. For blocks ≤ 3s, a
simpler arc (A entrance + F punch + exit) is fine — camera optional, often skip.

═══════════════════════════════════════════════════════════
 PRINCIPLE 9 — UI INTERFACE RECREATION (no asset attached)
═══════════════════════════════════════════════════════════
The reels being made are INSTRUCTIONAL — every composition must reinforce
the spoken content with a concrete visual structure (UI mockup, terminal,
browser frame, comparison cards, badge, input field). When the block text
describes or mentions software, you BUILD THE UI IN HTML/CSS — never fall
back to centered typography on dark bg.

DETECTION (apply when ANY of these matches — NOT a strict AND):
  • Text mentions a Named app/SaaS/product (Canva, Claude, Figma, Notion,
    Instagram, TikTok, ChatGPT, Slack, Linear, VS Code, Shopify, Webflow,
    WhatsApp, YouTube, Google, Chrome, Safari, etc.)
    → BUILD that app's UI EVEN WITHOUT an action verb.
       Just naming the app is enough trigger.
  • Text contains UI verb + UI noun (clica + botão, abre + menu, etc.)
       UI verbs:  clica, toca, abre, seleciona, arrasta, digita, navega,
                  vai em, acessa, click, tap, open, select, drag, type
       UI nouns:  menu, botão, aba, tela, painel, dashboard, settings,
                  projetos, sidebar, modal, campo, janela, app, plataforma,
                  interface, feed, perfil, notificações, button, tab,
                  screen, panel, field, window, profile, notifications
    → BUILD the UI WITH the action animated (cursor moves to target).
  • Text describes a software feature, screen, or behavior implicitly
    (e.g. "tem um kit de marca", "ele responde em segundos", "isso aparece
    no feed", "configurações de notificação")
    → BUILD a plausible UI that supports the described context.

NEVER fall back to "centered hero text on dark bg" when an app, product,
or software feature is being described. If you don't know the exact UI,
build a plausible one using BRAND IDENTITY colors above + a sidebar/topbar
layout. The motion's job is to ILLUSTRATE what's being said, not caption it.

WHAT TO BUILD:
① A simplified but recognisable mockup of the named interface using HTML/CSS/SVG.
   - Use the app's real brand colors if known:
     Claude = sidebar #1a1a1a + amber #D97706 accent
     Figma  = dark #1e1e1e + blue #1abcfe
     Notion = white #fff + black #000
     Instagram = white bg + gradient purple/pink/orange icon
     VS Code = #1e1e1e + blue #007acc
     For unknown apps: generic dark shell (#1c1c1e) with neutral accent (#6366f1)
   - A top bar / window chrome (app name or logo text, 1–2 nav items)
   - The specific element being acted on — rendered as a real-looking button, list item,
     sidebar link, or input field — highlighted or focused

② A cursor SVG that moves to the target element and clicks it:
   - Cursor: white arrow SVG (14×20px), absolute positioned
   - Starts off-center (e.g. bottom-right quadrant), travels to target with ease:'power2.inOut', duration 0.7s
   - On arrive: cursor scale 0.82 pulse (simulates press down), duration 0.08s, then back to 1
   - After click: target element flashes with highlight color (opacity pulse or background-color tween), duration 0.15s
   - SVG cursor markup: <svg viewBox="0 0 14 20" fill="white" stroke="#333" stroke-width="1"><path d="M0 0 L0 16 L4 12 L7 19 L9 18 L6 11 L11 11 Z"/></svg>

③ The element being acted on must be CLEARLY LABELED with text matching what the
   user said — if text says "clica em Projetos", the button/link must say "Projetos".

STRUCTURE EXAMPLE — "clica em Projetos no Claude":
  Track 0 (bg): panel #1a1a1a full slot
  Track 1 (sidebar): left strip 180px wide, bg #111, border-right 1px solid #333
    - "Claude" wordmark at top (font-weight 600, color #fff, font-size 14px)
    - 4 nav items: "Novo chat", "Projetos" (highlighted amber bg #D97706, text #000),
      "Histórico", "Configurações" — each 36px tall, 12px padding
  Track 2 (main area): right of sidebar, dark bg, subtle placeholder content lines
  Track 3 (cursor): SVG cursor animates from main area → "Projetos" sidebar item, then clicks
  Track 4 (headline): block text as caption below the mockup in dead zone

STRUCTURE EXAMPLE — "abre o menu Settings do Figma":
  Track 0 (bg): #1e1e1e
  Track 1 (top bar): full width 40px, bg #2c2c2c, "Figma" text left + menu items "File Edit View..."
    - "Preferences" or "Settings" menu item highlighted
  Track 2 (dropdown): appears at click position, white bg, list of settings options
  Track 3 (cursor): travels to menu item, clicks, dropdown opens (animate from scaleY:0 to 1)

DO NOT use placeholder rectangles labeled "App Screen" or "UI Mockup" — that is forbidden.
DO build specific, named, recognisable interfaces with real text labels.
If the named app is completely unknown, build a generic-but-plausible shell:
  dark window chrome + sidebar/nav + centered content area + the specific action element labeled.

⛔ SAFE AREA CONSTRAINT — applies to ALL UI mockups regardless of slot type:
  The entire UI mockup (window, sidebar, chrome, all elements) MUST be contained within
  the active slot's safe area. For full-frame (replace) slots: y:220–1540, x:80–1000.
  For split slots (960px tall): y:80–820, x:60–1020.
  NEVER let any div, absolute element, or animated child exceed these bounds — use
  overflow:hidden on the root container and set explicit max-height matching the slot.

═══════════════════════════════════════════════════════════
 ANTI-PATTERNS — avoid these mistakes
═══════════════════════════════════════════════════════════
× Stacking 3+ rectangle "cards" with text inside — that's a slide deck, not motion design
× Using emojis (🔥, ⚡, 💡) as content. They look amateur — use SVG icons instead
× Default linear easing on multiple elements — feels robotic
× Static held shots with no motion happening for >1.5s — this is a motion piece. If your timeline ends by t=2s but the block is 7s long, ADD MORE EVENTS (use technique K or L).
× Single-arc animation that finishes at t=1-2s leaving the rest of the block frozen — for blocks > 4s, you MUST stagger events across the full duration
× Repeat -1 (infinite loops) — HyperFrames forbids them; calculate finite repeat from DURATION
× Tiny text (<60px) — invisible on phone screens
× More than one focal element competing for attention
× Background gradients with too much contrast between stops (>15° hue shift looks cheap)
× Text that just transcribes the narration — captions already cover that

═══════════════════════════════════════════════════════════
 TECHNICAL REQUIREMENTS
═══════════════════════════════════════════════════════════
1. Each element: class="clip", data-start, data-duration, data-track-index (0=back, higher=front), id="kebab-case-name" (REQUIRED — lint fails without an id on every timeline element). Media tags (<video src=…>, <img src=…>) ALSO need data-start + data-duration on the tag itself, in addition to being inside a .clip shell — without that the lint reports 'media_missing_data_start' and the render aborts.

1a. TRACK INDEX RULE (CRITICAL — render fails otherwise): every .clip element with the same data-track-index MUST have non-overlapping [data-start, data-start + data-duration] windows. The HyperFrames CLI reports "overlapping_clips_same_track" and aborts the render when two clips share a track and overlap in time. Practical rule: **each clip that is alive at the same time goes on its OWN data-track-index**. Don't bundle "node + label" or "icon + caption" or "card-bg + card-content" on the same track just because they're visually related. Use track 0 for the background, then increment (1, 2, 3, …) for every additional clip — even if it's just a 1px divider. Track 9 is reserved for the brand-chrome layer. If you have 8 clips alive across the block duration, use track-index 0 through 8.
2. ONE <script> at the end. Use the actual composition ID from the "--- COMPOSITION ID ---" section of your brief (e.g. "motion-abc123"). Example structure:
   window.__timelines = window.__timelines || {}
   const tl = gsap.timeline({ paused: true })
   window.__timelines["motion-abc123"] = tl   // ← replace "motion-abc123" with the real ID from your brief
   CRITICAL: window.__timelines key MUST match the composition ID exactly — wrong key = silent black screen.
3. All tweens fit within each element's data-start to data-start+data-duration window
4. Canvas: 1080×1920px. Absolute positioning. Sizes in px.
5. Fonts already loaded (use ONLY these — no other Google Fonts links):
   - "Inter" wght 400-900   → body/UI (use class="font-body" or font-family:"Inter")
   - "Anton"                → display headlines (use class="font-display") — single weight, condensed, uppercase-feel
   - "Space Grotesk" 400-700 → tech/numbers/quotes (use class="font-tech")
   Combine at least TWO families per motion for proper hierarchy. See TYPOGRAPHY STACK section.
6. GSAP 3.14 already loaded. No external URLs. No images.
7. FORBIDDEN: Date.now(), Math.random(), fetch(), setTimeout(), setInterval(), requestAnimationFrame()
8. SVG icons must be inline, self-contained, under 1200 chars each.

═══════════════════════════════════════════════════════════
 OUTPUT
═══════════════════════════════════════════════════════════
Return JSON with these fields:
- "intent": pt-BR, one sentence describing the visual concept you designed (e.g. "Hourglass spinning fast com partículas de poeira pra ilustrar tempo perdido")
- "text": pt-BR, the headline that appears on screen — 1 to 5 words MAX. Sometimes empty if the visual stands alone.
- "htmlBody": full HTML content (elements + the closing script registering the timeline)
- "rationale": 1-2 sentences pt-BR explaining the design choice — what verb you animated, what the timing arc is, why this composition fits this block

If the user provided a manual intent or text override, use those values verbatim.`.trim();

/**
 * Hyperframes catalog slug whitelist — single source of truth.
 *
 * Gemini may reference any of these in `data-composition-src`; the Rust
 * pipeline auto-installs each referenced slug via `npx hyperframes add`
 * before running the lint. Slugs OUTSIDE this list fail lint and abort.
 *
 * Mirrored in Rust (`src-tauri/src/motions.rs`) — keep both in sync.
 */
export const HYPERFRAMES_WHITELIST: ReadonlyArray<string> = [
  // Overlays
  'grain-overlay',
  'vignette',
  'shimmer-sweep',
  // WebGL backgrounds
  'vfx-liquid-glass',
  'vfx-liquid-background',
  // UI mockups (real apps / devices)
  'vfx-iphone-device',
  'instagram-follow',
  'tiktok-follow',
  'x-post',
  'spotify-card',
  'yt-lower-third',
  'macos-notification',
  'reddit-post',
  // Transitions
  'transitions-dissolve',
  'transitions-push',
];

/**
 * Deterministic detector — does the block text mention a known app?
 *
 * When it matches, we inject an APP MENTION hint into the user brief so
 * Gemini reaches for the real Hyperframes block (instagram-follow, etc.)
 * instead of drawing a fake UI in CSS.
 *
 * First match wins — patterns are ordered loosely by ambiguity (most
 * specific first). Returns `undefined` when no app is mentioned.
 */
export interface AppMention {
  app: string;
  block: string;
}

const APP_MENTION_PATTERNS: ReadonlyArray<{ pattern: RegExp; app: string; block: string }> = [
  { pattern: /\btik\s?tok\b/i,                            app: 'TikTok',    block: 'tiktok-follow'    },
  { pattern: /\binstagram\b|\binsta\b|\bIG\b/,            app: 'Instagram', block: 'instagram-follow' },
  { pattern: /\bspotify\b/i,                              app: 'Spotify',   block: 'spotify-card'     },
  { pattern: /\byoutube\b|\bYT\b/,                        app: 'YouTube',   block: 'yt-lower-third'   },
  { pattern: /\breddit\b/i,                               app: 'Reddit',    block: 'reddit-post'      },
  { pattern: /\btwitter\b|\btweet\b|\bx\.com\b/i,         app: 'X/Twitter', block: 'x-post'           },
  { pattern: /\b(macos|mac\s?os)\b.*\b(notifica[çc][ãa]o|notification)\b/i, app: 'macOS', block: 'macos-notification' },
];

export const detectAppMention = (text: string): AppMention | undefined => {
  if (!text) return undefined;
  for (const m of APP_MENTION_PATTERNS) {
    if (m.pattern.test(text)) return { app: m.app, block: m.block };
  }
  return undefined;
};

export interface ProjectAsset {
  name: string;   // filename, e.g. "screenshot-dashboard.png"
  path: string;   // absolute local path — converted to asset:// URL for HTML
  /** Optional — present when the asset comes from `list_project_assets`. */
  kind?: 'image' | 'video';
}

export interface GenerateMotionInput {
  presetId: MotionConfig['presetId'];
  /** The full block text (the spoken content). Required — Gemini reads this. */
  blockText: string;
  /** Optional manual intent override. If empty, Gemini decides. */
  intent?: string;
  /** Optional manual text override. If empty, Gemini extracts from blockText. */
  text?: string;
  secondaryText?: string;
  number?: number;
  durationSec: number;
  /** Composition id (will be substituted into the {COMPOSITION_ID} placeholder). */
  compositionId: string;
  /** Project screenshots/images the user dropped in the Assets folder. */
  projectAssets?: ProjectAsset[];
  /**
   * Ordered list of assets explicitly attached to this block. Replaces the
   * legacy single `pinnedAsset`. When the list has at least one entry,
   * `projectAssets` is ignored — only these are referenced.
   *   - 1 entry  → behaves like the old single-asset protagonist
   *   - 2+ entries → carousel: each gets `durationSec/N` seconds with fade
   *     transitions between consecutive slots
   *
   * Each entry may carry `relativeUrl` (e.g. "assets/foo.mp4") if the caller
   * pre-copied the file into the motion's folder. HyperFrames cannot resolve
   * `asset://` URLs at render time, so relative paths are required for the
   * video/image to actually decode.
   */
  pinnedAssets?: Array<ProjectAsset & {
    type?: 'image' | 'video';
    relativeUrl?: string;
  }>;
  /** Full reel script context — helps Gemini understand where this block sits. */
  reelContext?: {
    projectName?: string;
    allBlocks?: string[];
    blockIndex?: number;
    prevBlockText?: string;
    nextBlockText?: string;
    /**
     * Visual intent of the immediately preceding motion (one-liner, pt-BR or en).
     * Helps Gemini avoid generating two visually identical motions in a row.
     * Example: "número grande 3.0x escalando com partículas" → next motion should
     * AVOID number-as-hero and pick a different focal grammar.
     */
    prevMotionIntent?: string;
    /** Visual intent of the motion two blocks back, used to vary the rhythm further. */
    prevPrevMotionIntent?: string;
  };
  /** Motion layer mode — affects canvas dimensions and composition design. */
  motionLayer?: 'overlay' | 'replace' | 'split-bottom' | 'split-top';
  /**
   * Output canvas aspect ratio. Defaults to '9:16' (1080×1920) for reels.
   * Set to '4:5' (1080×1350) for carousel slides — HyperFrames renders at this
   * size and the preview iframe adjusts accordingly.
   */
  canvasAspect?: '9:16' | '4:5';
  /**
   * Brand identity from a previous motion in this reel. When provided, brand
   * research is SKIPPED and these colors are used as-is. This keeps every
   * motion in the same reel visually consistent (same palette, same style).
   */
  existingBrand?: BrandResearch;
  /**
   * BCP-47 output language for the visible motion text + intent + rationale.
   * When omitted, defaults to 'pt-BR' (legacy behaviour). Should match the
   * script's language so the motion doesn't say "Crie tudo" while the avatar
   * speaks English.
   */
  outputLanguage?: string;
  /**
   * Global color mode from the reel. When 'light', dark presets receive a
   * forced override that swaps their background to white/light-neutral and
   * their text to near-black. Light presets are unaffected.
   */
  motionColorMode?: 'dark' | 'light';
  /**
   * Energy/pacing nudge. 'minimal' = slow, restraint, fewer particles.
   * 'energetic' = fast, kinetic, more punch. Applied as a single paragraph
   * appended to the system prompt. Default behaviour (omitted) = 'energetic'.
   */
  motionEnergy?: 'minimal' | 'energetic';
  /**
   * Creator identity (handle, display name, avatar) for social CTA motions
   * — the "siga @perfil" follow card uses this so the rendered card is the
   * real user instead of a fake one Gemini invents from the project name.
   * When omitted, the existing preset behaviour (Gemini invents a card from
   * brand colors) still applies.
   */
  userIdentity?: {
    displayName?: string;
    handle?: string;
    avatarDataUrl?: string;
    followerCount?: string;
    primaryPlatform?: 'instagram' | 'tiktok' | 'youtube' | 'generic';
  };
  /**
   * Typography palette to use. Overrides the preset's defaultFontSet when
   * provided. When omitted, the preset's defaultFontSet (or 'brand') wins.
   */
  fontSet?: FontSet;
  /**
   * Word-level timestamps for the spoken audio of this block, with start/end
   * already REBASED to the block's local time (0 = block start, not project
   * start). Used by presets that sync visuals to speech (karaoke-captions,
   * future word-stagger reveals). When omitted, presets degrade to a static
   * stagger reveal without sync.
   */
  wordTimestamps?: Array<{ word: string; start: number; end: number }>;
  /**
   * Premium polish overlays to enable. Forwarded into the rendered HTML;
   * Gemini is told via the prompt which are active so it can add the
   * `.shimmer-sweep-target` class where appropriate.
   */
  overlays?: { grain?: boolean; vignette?: boolean; shimmer?: boolean };
}

// ─── Step 1: Brand research via Google Search grounding ───────────────────────

export interface BrandResearch {
  topic: string;
  brandPrimaryColor: string;
  brandSecondaryColor: string;
  brandAccentColor: string;
  brandBackgroundColor: string;
  brandTextColor: string;
  logoSvg: string;
  brandFacts: string[];
  visualStyle: string;
}

const BRAND_RESEARCH_PROMPT = `You are a brand identity researcher with access to Google Search. Your job: identify the main brand/product/company/concept from a script block, search for its EXACT visual identity, and return structured data.

SEARCH STRATEGY:
1. Read the script and identify the primary subject (a product, company, tool, concept, or theme)
2. Search for "[subject] brand colors hex code", "[subject] visual identity", "[subject] logo colors"
3. Return the REAL colors — not generic ones. If the block mentions Claude AI → search "Anthropic Claude brand colors" → it's #DE7356 peach/terracotta primary, #1a1a2e dark bg, #f5f0eb text — NOT purple, NOT blue, NOT violet. If it mentions Canva → #00C4CC teal + #7D2AE7 purple. If it mentions ChatGPT → #10A37F green. If it mentions Instagram → gradient orange/pink/purple.

For generic concepts (productivity, automation, marketing, etc.) choose a dominant color culture — but DO NOT default to purple/pink/violet/lilac/lavender unless the brand IS that color:
- AI/Tech generic → deep navy #0f0f23 bg, electric cyan #00d4ff accent
- Finance/Money → dark green #0a2e1a bg, gold #f59e0b accent
- Health/Wellness → dark teal #0a1f1a bg, soft green #4ade80 accent
- Creative/Design → charcoal #1a1a1a bg, warm orange #f97316 OR amber #f59e0b accent (NEVER purple, NEVER pink, NEVER lilac)
- Business/Corporate → charcoal #1a1a1a bg, steel blue #3b82f6 accent (ONLY for corporate topics)
- Generic/unknown → black #000000 bg, white #ffffff text, amber #f59e0b OR cyan #00d4ff accent

ABSOLUTE BAN: even if the topic feels "creative" or "design-y", DO NOT return purple, pink, magenta, fuchsia, lilac, lavender, violet, indigo for brandPrimaryColor or brandAccentColor unless the actual brand uses that color. When in doubt, use orange, amber, cyan, green, or pure white.

Return ONLY this JSON (no markdown, no explanation):
{
  "topic": "exact brand/topic name you identified",
  "brandPrimaryColor": "#hex — the dominant brand color (used for icons, borders, highlights)",
  "brandSecondaryColor": "#hex — supporting brand color",
  "brandAccentColor": "#hex — bright pop color for CTAs and key highlights",
  "brandBackgroundColor": "#hex — dark bg (luminance < 25%) that matches the brand dark mode",
  "brandTextColor": "#hex — text color with 7:1+ contrast against brandBackgroundColor",
  "logoSvg": "self-contained SVG <svg width='120' height='120' viewBox='0 0 120 120'>...</svg> using only basic shapes and the brand colors. Max 500 chars. Empty string if too complex.",
  "brandFacts": ["short visual fact useful for metaphors", "another fact"],
  "visualStyle": "one sentence: the brand's visual personality (e.g. warm terracotta minimalist, bold electric neon, clean corporate blue)"
}

CRITICAL RULES:
- brandBackgroundColor MUST be dark (luminance < 25%) — this overlays on video
- brandTextColor MUST contrast ≥ 7:1 against brandBackgroundColor
- Do NOT default to blue (#3b82f6, #60a5fa) unless the brand actually IS blue
- logoSvg must use inline shapes only — no external hrefs, no images, no text elements`;

// Convert hex (#rrggbb or #rgb) to HSL. Returns null if invalid.
const hexToHsl = (hex: string): { h: number; s: number; l: number } | null => {
  if (!hex) return null;
  let m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) {
    // try #rgb shorthand
    const sm = hex.trim().match(/^#?([0-9a-f]{3})$/i);
    if (!sm) return null;
    const [r, g, b] = sm[1].split('').map(c => parseInt(c + c, 16));
    m = [hex, [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')] as RegExpMatchArray;
  }
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / d + 2) * 60; break;
      case b: h = ((r - g) / d + 4) * 60; break;
    }
  }
  return { h, s, l };
};

// Allowed-topic guards — bans only apply when topic is NOT one of these.
const PURPLE_TOPICS = /(twitch|figma|discord|yahoo|roxo|purple|violet|lavender|lilás|lilac)/i;
const PINK_TOPICS = /(instagram|barbie|pink|magenta|fuchsia|rosa|lipstick|valentine)/i;
const BLUE_TOPICS = /(facebook|twitter|linkedin|paypal|samsung|dell|ibm|intel|chase|visa|ford|walmart|wal\s?mart|blue|azul)/i;

// Detect whether a hex falls into the banned color space (purple/violet/lilac/pink/magenta/generic-blue).
// Uses HSL hue ranges so all shades (vibrant + pastel + lilac + lavender) are caught.
const isBannedColor = (hex: string, topic: string): { banned: boolean; label: string } => {
  const hsl = hexToHsl(hex);
  if (!hsl) return { banned: false, label: '' };
  const { h, s, l } = hsl;
  // Ignore near-greys/neutrals — they're never a "color" decision.
  if (s < 0.12) return { banned: false, label: '' };
  // Ignore very dark colors (likely background, hue is irrelevant there).
  if (l < 0.08) return { banned: false, label: '' };

  // PURPLE/VIOLET/INDIGO/LILAC/LAVENDER: hue 250-295
  // Includes vibrant violets (h~270, s>0.5) AND pastel lilacs (h~280, s~0.3, l~0.8)
  if (h >= 250 && h <= 295 && !PURPLE_TOPICS.test(topic)) {
    return { banned: true, label: 'purple/lilac' };
  }
  // MAGENTA/FUCHSIA/PINK/ROSE: hue 295-345 (wraps slightly toward red)
  // Includes hot pink (h~330, s>0.7) AND pastel rose (h~340, s~0.4, l~0.85)
  if (h >= 295 && h <= 345 && !PINK_TOPICS.test(topic)) {
    return { banned: true, label: 'pink/magenta' };
  }
  // GENERIC BLUE (medium-saturated, not navy): hue 200-240, s>0.4, l>0.4
  // Don't ban dark navy bg colors (l<0.2) since those can legitimately be backgrounds.
  if (h >= 200 && h <= 240 && s > 0.4 && l > 0.4 && !BLUE_TOPICS.test(topic)) {
    return { banned: true, label: 'generic blue' };
  }
  return { banned: false, label: '' };
};

async function researchBrand(ai: GoogleGenAI, blockText: string, reelContext?: GenerateMotionInput['reelContext']): Promise<BrandResearch | null> {
  // Brand research — Pro and Flash only. Lite is not capable enough (user requirement).
  const groundingModels = [
    'gemini-3.1-pro-preview',
    'gemini-3-flash-preview',
  ];

  const query = [
    BRAND_RESEARCH_PROMPT,
    '',
    `--- SCRIPT BLOCK TO ANALYZE ---`,
    blockText.trim(),
    reelContext?.projectName ? `Project name: ${reelContext.projectName}` : '',
    reelContext?.allBlocks?.length
      ? `Full script (first 3 blocks for context): ${reelContext.allBlocks.slice(0, 3).join(' | ')}`
      : '',
  ].filter(Boolean).join('\n');

  for (const model of groundingModels) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: query,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.1,
        },
      });
      const raw = response.candidates?.[0]?.content?.parts?.find(p => p.text)?.text ?? '';
      if (!raw) continue;
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]) as BrandResearch;
      if (!parsed.brandPrimaryColor || !parsed.brandBackgroundColor) continue;

      // Sanity-check colors. If the brand isn't known for the color but Gemini
      // returned a banned default (purple/magenta/blue), reject the result.
      // Even ONE banned color in the primary slot is enough — Gemini hallucinating
      // a magenta primary for a generic topic poisons the whole motion.
      const topic = (parsed.topic || '').toLowerCase();
      const primaryBan = isBannedColor(parsed.brandPrimaryColor, topic);
      if (primaryBan.banned) {
        console.warn('[motion] brand research returned a banned primary color, falling back to neutral', { topic, color: parsed.brandPrimaryColor, label: primaryBan.label });
        return null;
      }
      const checks = [parsed.brandSecondaryColor, parsed.brandAccentColor].filter(Boolean);
      const offenders = checks.map(h => isBannedColor(h, topic)).filter(r => r.banned);
      if (offenders.length >= 1) {
        console.warn('[motion] brand research returned banned accent colors, falling back to neutral', { topic, offenders });
        return null;
      }
      return parsed;
    } catch {
      // grounding failed or model not available — proceed without brand colors
    }
  }
  return null;
}

// ─── Step 2: HTML generation ──────────────────────────────────────────────────

/**
 * Builds a high-priority language-instruction block prepended to the user
 * brief. Overrides the legacy pt-BR examples baked into SYSTEM_PROMPT.
 * The instruction targets `intent`, `text`, and `rationale` (the visible /
 * narrated outputs); HTML class names and CSS stay in English regardless.
 */
const buildMotionLanguageSection = (lang: string): string => {
  const labels: Record<string, string> = {
    'pt-BR': 'Brazilian Portuguese',
    'pt-PT': 'European Portuguese',
    'en-US': 'American English',
    'es-ES': 'European Spanish',
    'es-419': 'Latin American Spanish',
    'fr-FR': 'French',
    'it-IT': 'Italian',
    'de-DE': 'German',
  };
  const label = labels[lang] ?? lang;
  // Even pt-BR needs an explicit reminder. The SYSTEM_PROMPT itself is
  // written in English (PRINCIPLE 1-8, all rules, all anti-patterns); only
  // the few HTML examples mix in pt-BR words. Without an explicit override,
  // Gemini often defaults the visible <h1>/<p>/<span> text to English to
  // "match the surrounding instructional language" — which is exactly what
  // the user is seeing: script is pt-BR but the motion text comes out
  // English.
  return [
    `--- OUTPUT LANGUAGE OVERRIDE (HIGHEST PRIORITY) ---`,
    `The script for this reel is in ${label} (${lang}).`,
    `ALL VISIBLE / NARRATED outputs must be in ${label}:`,
    `  • "intent" field → write in ${label}`,
    `  • "text" field (the headline on screen) → write in ${label}`,
    `  • "rationale" field → write in ${label}`,
    `  • Any visible <h1>, <h2>, <p>, <span>, label, button text inside the HTML → ${label}`,
    `Treat the system prompt's example HTML as STRUCTURAL templates only; translate the literal wording into ${label}.`,
    `Keep HTML class names, CSS property names, GSAP API calls, and code identifiers in English (they are code, not content).`,
    `If the user's intent/text overrides above contain ${label} text, use those values verbatim.`,
    ``,
  ].join('\n');
};

// ─── Claude UI native preset (no Gemini call) ───────────────────────────────

function _detectClaudeCommand(cmd: string, blockText: string): string {
  const s = `${cmd} ${blockText}`.toLowerCase();
  if (s.includes('ultraplan')) return 'ultraplan';
  if (s.includes('powerup') || s.includes('power up')) return 'powerup';
  if (s.includes('insight')) return 'insight';
  return 'generic';
}

const _CLAUDE_RESPONSES: Record<string, { label: string; lines: Array<{ text: string; color?: string }> }> = {
  ultraplan: {
    label: 'Criando sub-agentes de pesquisa…',
    lines: [
      { text: '›  Agente de pesquisa ativo' },
      { text: '›  Agente de análise ativo' },
      { text: '›  Montando diagrama…' },
      { text: '✓  Plano completo gerado', color: '#5ac47d' },
    ],
  },
  powerup: {
    label: '10 tutoriais feitos pra você:',
    lines: [
      { text: '1.  Prompts que economizam horas' },
      { text: '2.  Fluxo de edição de vídeo com IA' },
      { text: '3.  Roteiros de Reels em 3 minutos' },
      { text: '4.  Análise de concorrentes automática' },
      { text: '    + 6 tutoriais personalizados…', color: '#888' },
    ],
  },
  insight: {
    label: 'Relatório gerado com sucesso:',
    lines: [
      { text: '›  Taxa de engajamento: +34%' },
      { text: '›  Melhor formato: Carrossel' },
      { text: '›  Horário ideal: 18h–21h' },
      { text: '✓  3 ações prioritárias listadas', color: '#5ac47d' },
    ],
  },
  generic: {
    label: 'Processando sua solicitação…',
    lines: [
      { text: '›  Analisando contexto' },
      { text: '›  Gerando resposta' },
      { text: '✓  Pronto', color: '#5ac47d' },
    ],
  },
};

const _CMD_TEXTS: Record<string, string> = {
  ultraplan: 'Ultraplan: crie meu plano de conteúdo',
  powerup: 'Powerup',
  insight: 'Insight: analise meu canal',
};

function _buildClaudeUiHtml(input: GenerateMotionInput): GenerationOutput {
  const compositionId = input.compositionId;
  const DUR = input.durationSec;
  const cmdType = _detectClaudeCommand(input.text ?? '', input.blockText);
  const cmd = (input.text?.trim() || _CMD_TEXTS[cmdType] || 'Ultraplan').slice(0, 60);
  const resp = _CLAUDE_RESPONSES[cmdType] ?? _CLAUDE_RESPONSES.generic;

  const charDelay = cmd.length <= 12 ? 0.13 : 0.055;
  const typeEnd = parseFloat((0.7 + cmd.length * charDelay).toFixed(3));
  const lineDelay = 0.62;

  const linesHtml = resp.lines.map((line, i) => {
    const color = line.color ?? '#cccccc';
    return `        <div id="rline${i}" class="font-body" style="color:${color};font-size:29px;line-height:1.35;display:flex;align-items:center;gap:12px;margin-bottom:14px;opacity:0;white-space:pre;">${line.text}</div>`;
  }).join('\n');

  const lineGsap = resp.lines.map((_, i) => {
    const t = (typeEnd + 2.05 + i * lineDelay).toFixed(3);
    const isLast = i === resp.lines.length - 1;
    const ease = isLast ? "'back.out(1.4)'" : "'expo.out'";
    const fromScale = isLast ? ', scale: 0.94' : '';
    const toScale   = isLast ? ', scale: 1' : '';
    return `  tl.fromTo('#rline${i}', { opacity: 0, x: -16${fromScale} }, { opacity: 1, x: 0${toScale}, duration: 0.4, ease: ${ease} }, ${t});`;
  }).join('\n');

  // ── Claude avatar SVG (reused 3×) ──────────────────────────────────────
  const avatarSvg = `<svg width="20" height="20" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="11" fill="white" opacity=".9"/><circle cx="16" cy="16" r="4.5" fill="#c84040"/></svg>`;
  const avatarDiv = `<div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#e07b54,#c84040);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;">${avatarSvg}</div>`;

  const htmlBody = `<!-- Background — track 0 -->
<div id="bg-shell" class="clip" data-start="0" data-duration="${DUR}" data-track-index="0" style="position:absolute;inset:0;"><div id="bg-inner" style="position:absolute;inset:0;background:#1c1c1c;"></div></div>
<div class="atmos-vignette" style="z-index:50;pointer-events:none;"></div>

<!-- Top bar — track 1 -->
<div id="topbar-shell" class="clip" data-start="0" data-duration="${DUR}" data-track-index="1" style="position:absolute;top:260px;left:80px;right:80px;overflow:visible;">
  <div id="topbar-inner" style="display:flex;align-items:center;justify-content:space-between;opacity:0;">
    <div style="display:flex;align-items:center;gap:16px;">
      <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#e07b54,#c84040);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><svg width="20" height="20" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="11" fill="white" opacity=".95"/><circle cx="16" cy="16" r="4.5" fill="#c84040"/></svg></div>
      <span class="font-body" style="color:#e8e8e8;font-size:30px;font-weight:600;letter-spacing:-0.5px;">Claude</span>
    </div>
    <div style="background:#2a2a2a;border:1px solid #383838;border-radius:14px;padding:8px 18px;"><span class="font-body" style="color:#999;font-size:22px;font-weight:500;">claude opus 4</span></div>
  </div>
</div>

<!-- Divider — track 2 -->
<div id="divider-shell" class="clip" data-start="0" data-duration="${DUR}" data-track-index="2" style="position:absolute;top:356px;left:80px;right:80px;height:1px;"><div id="divider-inner" style="width:100%;height:100%;background:#2a2a2a;opacity:0;"></div></div>

<!-- Chat area — track 3 -->
<div id="chat-shell" class="clip" data-start="0" data-duration="${DUR}" data-track-index="3" style="position:absolute;top:380px;left:80px;right:80px;height:980px;overflow:hidden;">
  <div id="chat-inner" style="opacity:0;">
    <div id="user-row" style="display:flex;justify-content:flex-end;margin-bottom:44px;opacity:0;">
      <div style="background:#2c2c2c;border:1px solid #3c3c3c;border-radius:22px 22px 6px 22px;padding:24px 30px;max-width:860px;">
        <span id="utext" class="font-body" style="color:#f0f0f0;font-size:33px;line-height:1.4;font-weight:400;"></span><span id="ucursor" style="display:inline-block;width:2px;height:38px;background:#e07b54;vertical-align:middle;margin-left:3px;"></span>
      </div>
    </div>
    <div id="thinking-row" style="display:flex;align-items:flex-start;gap:18px;margin-bottom:30px;opacity:0;">
      ${avatarDiv}
      <div>
        <div class="font-body" style="color:#aaa;font-size:26px;font-weight:500;margin-bottom:14px;">Claude está pensando…</div>
        <div style="display:flex;gap:9px;"><div id="dot1" style="width:9px;height:9px;border-radius:50%;background:#e07b54;"></div><div id="dot2" style="width:9px;height:9px;border-radius:50%;background:#e07b54;"></div><div id="dot3" style="width:9px;height:9px;border-radius:50%;background:#e07b54;"></div></div>
      </div>
    </div>
    <div id="cresp-row" style="display:flex;align-items:flex-start;gap:18px;opacity:0;">
      ${avatarDiv}
      <div style="flex:1;">
        <div id="clabel" class="font-body" style="color:#e07b54;font-size:26px;font-weight:600;margin-bottom:18px;opacity:0;">${resp.label}</div>
${linesHtml}
      </div>
    </div>
  </div>
</div>

<!-- Input bar — track 4 -->
<div id="input-shell" class="clip" data-start="0" data-duration="${DUR}" data-track-index="4" style="position:absolute;top:1480px;left:80px;right:80px;">
  <div id="input-inner" style="background:#212121;border:1px solid #333;border-radius:30px;padding:24px 32px;display:flex;align-items:center;justify-content:space-between;opacity:0;">
    <span class="font-body" style="color:#555;font-size:27px;">Como posso ajudar?</span>
    <div style="width:48px;height:48px;border-radius:50%;background:#2d2d2d;border:1px solid #3a3a3a;display:flex;align-items:center;justify-content:center;"><svg width="22" height="22" viewBox="0 0 24 24" fill="#666"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg></div>
  </div>
</div>

<!-- Progress bar — track 9 -->
<div id="pb-shell" class="clip" data-start="0" data-duration="${DUR}" data-track-index="9" style="position:absolute;bottom:0;left:0;right:0;height:3px;"><div id="pb-inner" style="height:100%;width:0%;background:#e07b54;opacity:.8;"></div></div>

<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
window.__timelines["${compositionId}"] = tl;
const DUR = ${DUR};
const cmd = ${JSON.stringify(cmd)};
tl.to('#pb-inner', { width: '100%', duration: DUR, ease: 'none' }, 0);
tl.fromTo('#topbar-inner', { opacity: 0, y: -12 }, { opacity: 1, y: 0, duration: 0.45, ease: 'expo.out' }, 0.1);
tl.to('#divider-inner', { opacity: 1, duration: 0.3 }, 0.35);
tl.fromTo('#chat-inner',  { opacity: 0 },        { opacity: 1, duration: 0.3 }, 0.35);
tl.fromTo('#input-inner', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: 'expo.out' }, 0.35);
tl.to('#user-row', { opacity: 1, duration: 0.3 }, 0.6);
const utextEl = document.getElementById('utext');
for (let i = 0; i < cmd.length; i++) {
  tl.call(() => { utextEl.textContent = cmd.slice(0, i + 1); }, null, 0.7 + i * ${charDelay});
}
tl.to('#ucursor', { opacity: 0, duration: 0.15, repeat: 3, yoyo: true }, ${typeEnd});
tl.set('#ucursor', { opacity: 0 }, ${(typeEnd + 0.7).toFixed(3)});
tl.fromTo('#thinking-row', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, ${(typeEnd + 0.3).toFixed(3)});
tl.to(['#dot1','#dot2','#dot3'], { y: -7, duration: 0.28, stagger: 0.1, ease: 'power2.out', yoyo: true, repeat: 3 }, ${(typeEnd + 0.5).toFixed(3)});
tl.to('#thinking-row', { opacity: 0, duration: 0.25 }, ${(typeEnd + 1.55).toFixed(3)});
tl.fromTo('#cresp-row', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }, ${(typeEnd + 1.7).toFixed(3)});
tl.to('#clabel', { opacity: 1, duration: 0.35 }, ${(typeEnd + 1.85).toFixed(3)});
${lineGsap}
<\/script>`;

  return {
    intent: `Interface do Claude com comando "${cmd}" sendo digitado e resposta aparecendo`,
    text: cmd,
    htmlBody,
    rationale: `Preset claude-ui nativo: interface escura do Claude com digitação e resposta progressiva (${resp.lines.length} linhas).`,
    modelUsed: 'native-claude-ui',
  };
}

// ─── Main HTML generator ────────────────────────────────────────────────────

export const generateMotionHtml = async (input: GenerateMotionInput): Promise<GenerationOutput & { brand?: BrandResearch }> => {
  // Claude UI preset — native HTML, no Gemini call needed.
  if (input.presetId === 'claude-ui') {
    return _buildClaudeUiHtml(input);
  }

  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const preset = findStylePreset(input.presetId);

  // If the reel already has a brand identity (from the first motion), reuse it
  // — every motion in the same reel must share the same palette/style.
  // Otherwise, run brand research now.
  const brandPromise: Promise<BrandResearch | null> = input.existingBrand
    ? Promise.resolve(input.existingBrand)
    : researchBrand(ai, input.blockText, input.reelContext);

  const ctx = input.reelContext;
  const recentIntents = [ctx?.prevPrevMotionIntent, ctx?.prevMotionIntent].filter(Boolean) as string[];
  const reelContextSection = ctx ? [
    `--- REEL CONTEXT ---`,
    ctx.projectName ? `Project: ${ctx.projectName}` : '',
    ctx.allBlocks && ctx.allBlocks.length > 0
      ? `Full script (${ctx.allBlocks.length} blocks):\n${ctx.allBlocks.map((t, i) => `  [${i + 1}] ${t}`).join('\n')}`
      : '',
    ctx.blockIndex !== undefined ? `This is block ${ctx.blockIndex + 1} of ${ctx.allBlocks?.length ?? '?'}` : '',
    ctx.prevBlockText ? `Previous block: "${ctx.prevBlockText}"` : '',
    ctx.nextBlockText ? `Next block: "${ctx.nextBlockText}"` : '',
    recentIntents.length > 0 ? [
      ``,
      `╔══════════════════════════════════════════════════════╗`,
      `  🎬 STORYBOARD CONTINUITY — vary the visual rhythm`,
      `╚══════════════════════════════════════════════════════╝`,
      `Recent motions in this reel (most recent last):`,
      ...recentIntents.map((intent, i) => `  ${i === recentIntents.length - 1 ? '↪ just before this' : '↪ two blocks back'}: "${intent}"`),
      ``,
      `RULE: do NOT repeat the same focal grammar. If the previous motion's hero was a giant number,`,
      `pick a different hero this time (icon swap, kinetic type, SVG path draw, glass card with chart, etc).`,
      `Variety in the focal element across consecutive blocks is what makes the reel feel produced, not generic.`,
      `KEEP CONSTANT: brand colors, typography weights, ease curves — the reel must feel like one piece.`,
      `VARY: hero element, composition layout, primary animation verb.`,
    ].join('\n') : '',
    '',
  ].filter(Boolean).join('\n') : '';

  // Wait for brand research
  const brand = await brandPromise;
  const isReusedBrand = !!input.existingBrand;
  const brandSection = brand ? [
    `╔══════════════════════════════════════════════════════╗`,
    isReusedBrand
      ? `  BRAND IDENTITY — REUSED FROM REEL (consistency LOCKED)`
      : `  BRAND IDENTITY — MANDATORY COLORS (researched via Google Search)`,
    `  YOU MUST USE THESE. DO NOT SUBSTITUTE WITH BLUE OR GENERIC COLORS.`,
    isReusedBrand
      ? `  Other motions in this reel already use these EXACT colors and visual style.`
      : ``,
    isReusedBrand
      ? `  STAY CONSISTENT — same palette, same typography weights, same animation language.`
      : ``,
    `╚══════════════════════════════════════════════════════╝`,
    `Topic: ${brand.topic}`,
    `brandPrimaryColor: ${brand.brandPrimaryColor}  ← use for icons, borders, glows, highlights`,
    `brandSecondaryColor: ${brand.brandSecondaryColor}  ← use for supporting elements`,
    `brandAccentColor: ${brand.brandAccentColor}  ← use for CTAs, badges, key highlights`,
    `brandBackgroundColor: ${brand.brandBackgroundColor}  ← MUST be the background`,
    `brandTextColor: ${brand.brandTextColor}  ← MUST be ALL primary text`,
    brand.logoSvg ? `logoSvg (use this SVG inline as the brand icon): ${brand.logoSvg}` : 'logoSvg: (none — create a simple geometric icon in brandPrimaryColor)',
    brand.brandFacts?.length ? `Visual metaphor inspiration: ${brand.brandFacts.join(' | ')}` : '',
    `Visual style: ${brand.visualStyle}`,
    `⚠️  FAILURE TO USE THESE EXACT COLORS = WRONG OUTPUT. No blue. No purple. Use ${brand.topic}'s actual colors.`,
    '',
  ].filter(Boolean).join('\n') : (() => {
    // No-brand fallback — but the choice depends on the preset's bgType, NOT
    // a one-size-fits-all "strict black & white". Light/warm presets must not
    // be forced into B&W just because brand research came back empty.
    if (preset.bgType === 'warm') {
      return [
        `╔══════════════════════════════════════════════════════╗`,
        `  NO BRAND IDENTIFIED — WARM PAPER FALLBACK (preset-aware)`,
        `╚══════════════════════════════════════════════════════╝`,
        `Preset "${preset.label}" is a warm/cream preset, so the fallback is NOT pure B&W.`,
        `brandBackgroundColor: ${preset.atmosphere.baseBg}   ← warm cream paper (the preset's atmosphere)`,
        `brandTextColor: #2d2d2d         ← deep warm brown (NEVER pure black on cream)`,
        `brandPrimaryColor: #d4714d      ← terracotta accent`,
        `brandSecondaryColor: #c9a563    ← warm gold`,
        `brandAccentColor: #d4714d       ← terracotta highlight`,
        ``,
        `Use the preset's atmosphere. All shadows must be tinted warm (rgba(120,80,40,0.18) family).`,
        `Avoid: cyan, electric blue, magenta, pure black. Stay in the warm earth-tone family.`,
        '',
      ].join('\n');
    }
    if (preset.bgType === 'light') {
      return [
        `╔══════════════════════════════════════════════════════╗`,
        `  NO BRAND IDENTIFIED — LIGHT NEUTRAL FALLBACK (preset-aware)`,
        `╚══════════════════════════════════════════════════════╝`,
        `Preset "${preset.label}" is a light preset, so the fallback is NOT pure B&W.`,
        `brandBackgroundColor: ${preset.atmosphere.baseBg}   ← light neutral (the preset's atmosphere)`,
        `brandTextColor: #1d1d1f         ← near-black ink (high contrast on light)`,
        `brandPrimaryColor: #1d1d1f      ← black for primary accents (typographic emphasis)`,
        `brandSecondaryColor: #6e6e73    ← warm grey (60% black)`,
        `brandAccentColor: #1d1d1f       ← black highlight (NOT a colour — emphasis via contrast)`,
        ``,
        `Stay restrained. No bright accents unless the preset itself prescribes them.`,
        '',
      ].join('\n');
    }
    // Dark preset → preset-aware fallback using the preset's own atmosphere
    // colors. Previously this was a "strict B&W" fallback (white on black,
    // zero accent color), which made every brandless motion look like an
    // identical monochrome icon. Each preset already declares its identity
    // colors via atmosphere.warmGlow.color + atmosphere.coolGlow.color —
    // those are the natural accents (glass-tech: cyan + amber; bold-pop:
    // orange + cyan; cinematic-dark: warm glow + deep blue; etc). Use them.
    return [
      `╔══════════════════════════════════════════════════════╗`,
      `  NO BRAND IDENTIFIED — DARK PRESET FALLBACK (preset-aware)`,
      `╚══════════════════════════════════════════════════════╝`,
      `Preset "${preset.label}" has its own atmosphere identity — use it as the palette.`,
      `brandBackgroundColor: ${preset.atmosphere.baseBg}   ← preset atmosphere base (the dark canvas)`,
      `brandTextColor: #ffffff         ← off-white (or tint to ${preset.atmosphere.warmGlow.color} at ~95% for warmth)`,
      `brandPrimaryColor: ${preset.atmosphere.warmGlow.color}      ← preset's primary accent (icons, borders, glows, key strokes)`,
      `brandSecondaryColor: ${preset.atmosphere.coolGlow.color}    ← preset's secondary accent (supporting elements, alt highlights)`,
      `brandAccentColor: ${preset.atmosphere.warmGlow.color}       ← single hot-spot for CTAs / numbers / hero word`,
      ``,
      `Use the preset's accents intentionally — small areas with the warm/cool glow colors,`,
      `not fields of solid color. Most of the canvas should be the dark base. Accents earn`,
      `their punch by contrast against that dark, not by saturation alone.`,
      ``,
      `STRICTLY FORBIDDEN (PRINCIPLE 6): purple, violet, indigo, magenta, fuchsia, pink, rose, lilac, lavender.`,
      `Any HSL hue between 250-345 degrees is banned. If a preset accent above happens to fall in that range, override it to #f59e0b (warm amber).`,
      '',
    ].join('\n');
  })();

  // ─── Light mode override ──────────────────────────────────────────────
  // When the reel's motionColorMode is 'light' AND the chosen preset is dark,
  // inject a mandatory override that forces a white/light background palette.
  // Light presets (bgType !== 'dark') are intentionally skipped — they are
  // already bright and don't need forcing.
  const lightModeSection = (input.motionColorMode === 'light' && preset.bgType === 'dark') ? [
    `╔══════════════════════════════════════════════════════╗`,
    `  ☀️  LIGHT MODE OVERRIDE — MANDATORY (user setting)`,
    `╚══════════════════════════════════════════════════════╝`,
    `The user switched the reel to LIGHT MODE. Some preset briefs below contain`,
    `hardcoded dark hex values inside CSS examples — those are STALE REFERENCES.`,
    `You MUST translate them to the light palette before emitting HTML.`,
    ``,
    `── HARD COLOR REMAPS (apply BEFORE writing any CSS) ──`,
    ``,
    `Replace these EXACT tokens whenever they appear in preset CSS examples:`,
    `  #000  / #000000             → #ffffff`,
    `  #0a0a0f / #08080f / #08080a → #ffffff`,
    `  #1a1a1a / #1c1c1c           → #f4f4f5  (a soft off-white card on white bg)`,
    `  rgba(30, 30, 30, 0.82)      → rgba(255, 255, 255, 0.92)  + 1px border rgba(0,0,0,0.08)`,
    `  rgba(255,255,255,0.08-0.18) → rgba(0, 0, 0, 0.06)  (glass / frost layers)`,
    `  white text (#fff / #ffffff) → #1d1d1f  on any element NOT layered over a brand-color block`,
    `  inset rgba(0,0,0,0.4–0.65)  → remove entirely (no dark vignettes on white)`,
    `  text-shadow with white glow → remove or replace with subtle #000 at alpha 0.06`,
    `  "or pure #000 if bg is dark" / "if bg is dark" fallbacks → ALWAYS pick the light branch`,
    `  "keep it dark" / "deep #0a0a0f" / similar moody bias phrases → IGNORE them`,
    ``,
    `── EFFECTIVE PALETTE for this generation ──`,
    `brandBackgroundColor: #ffffff   (pure white canvas, overrides preset bg)`,
    `brandTextColor:       #1d1d1f   (near-black, high contrast on white)`,
    `brandPrimaryColor:    (keep as-is — accent + icons + bars)`,
    `brandSecondaryColor / brandAccentColor: (keep as-is)`,
    `Animation timing, easing, motion grammar: KEEP — only the palette shifts.`,
    ``,
    `── CONTRAST AUDIT (final check before emitting) ──`,
    `Walk every <div>, <span>, <p> with text:`,
    `  • If text color = white AND the immediate background is now white → FLIP to #1d1d1f`,
    `  • If a card background was #1a1a1a (now #f4f4f5) and text was white → text becomes #1d1d1f`,
    `  • If text is over a brandPrimaryColor block → keep contrast-aware (white on dark accent stays)`,
    ``,
    `The composition must feel bright, airy, clean — Apple.com product page energy.`,
    '',
  ].join('\n') : '';

  // ─── Dark mode override (analogue of lightModeSection, opposite direction) ──
  // When the reel's motionColorMode is 'dark' AND the chosen preset is light
  // (editorial-clean, illustrated-explainer, etc.), inject a mandatory override
  // forcing a dark palette. Without this, light presets ignore the user's
  // Dark toggle and continue emitting white backgrounds.
  const darkModeSection = (input.motionColorMode === 'dark' && preset.bgType === 'light') ? [
    `╔══════════════════════════════════════════════════════╗`,
    `  🌙  DARK MODE OVERRIDE — MANDATORY (user setting)`,
    `╚══════════════════════════════════════════════════════╝`,
    `The user switched the reel to DARK MODE. The preset "${preset.label}" is`,
    `naturally a LIGHT preset — its CSS examples below contain light hex`,
    `values. Those are STALE REFERENCES. You MUST translate them to the dark`,
    `palette before emitting HTML.`,
    ``,
    `── HARD COLOR REMAPS (apply BEFORE writing any CSS) ──`,
    ``,
    `Replace these EXACT tokens whenever they appear in preset CSS examples:`,
    `  #fff / #ffffff               → #0a0a0c  (deep dark canvas)`,
    `  #fafafa / #fafbfc / #f5f5f5  → #0a0a0c`,
    `  #f4f4f5 / #fef3e8            → rgba(255, 255, 255, 0.06)  (subtle card on dark bg)`,
    `  #1a1a1a / #1d1d1f near-black text → #f5f5f5  (off-white text on dark bg)`,
    `  rgba(0,0,0,0.04-0.12)        → rgba(255,255,255,0.06)  (hairline / divider)`,
    `  warm grays (#86868b / #6e6e73) → #a3a3a3 (neutral grey on dark)`,
    `  light gradients (#fafafa→#fff) → #08080c→#12121a  (subtle dark gradient)`,
    `  black drop-shadows on text   → remove or use white at alpha 0.04 instead`,
    ``,
    `── EFFECTIVE PALETTE for this generation ──`,
    `brandBackgroundColor: #0a0a0c   (deep dark canvas — never pure #000)`,
    `brandTextColor:       #f5f5f5   (off-white, never pure #ffffff)`,
    `brandPrimaryColor:    (keep as-is — accent + icons + bars)`,
    `brandSecondaryColor / brandAccentColor: (keep as-is)`,
    `Animation timing, easing, motion grammar: KEEP — only the palette shifts.`,
    ``,
    `The composition must feel dark, focused, cinematic — never cheerful/airy.`,
    '',
  ].join('\n') : '';

  // ─── Brand chrome (persistent visual identity layer) ──────────────────
  // After the FIRST motion of a reel, every subsequent motion gets a small
  // section instructing Gemini to include a faint always-on chrome layer on
  // track 0: a subtle hex mesh, a vignette, a 1-2px brand-coloured frame.
  // This makes the reel feel cohesive instead of every block reinventing its
  // own background. We only inject this when `isReusedBrand` is true so the
  // first motion stays clean (it sets the visual tone for the rest).
  const brandChromeSection = isReusedBrand && brand ? [
    `╔══════════════════════════════════════════════════════╗`,
    `  🎨 PERSISTENT BRAND CHROME — track 9 (top, non-blocking)`,
    `╚══════════════════════════════════════════════════════╝`,
    `Every motion in this reel MUST include ONE subtle, always-on chrome layer at data-track-index="9"`,
    `(rendered ON TOP of all content), running for the full duration. pointer-events:none so it never blocks.`,
    `This is what makes consecutive blocks feel like the same piece. Track 9 is reserved for chrome —`,
    `do NOT put any other element there. Track 0 is reserved for ONE bg/atmosphere layer only.`,
    ``,
    `Pick ONE of these patterns (do NOT combine; one chrome only):`,
    ``,
    `Option A — VIGNETTE FRAME:`,
    `  <div id="brand-chrome-vignette" class="clip" data-start="0" data-duration="${input.durationSec}" data-track-index="9"`,
    `       style="position:absolute; inset:0; pointer-events:none;`,
    `              box-shadow:inset 0 0 200px rgba(0,0,0,0.55), inset 0 0 0 1px ${brand.brandPrimaryColor}33;"></div>`,
    ``,
    `Option B — FAINT HEX MESH (canvas, deterministic):`,
    `  <canvas id="brand-chrome-mesh" class="clip" data-start="0" data-duration="${input.durationSec}" data-track-index="9"`,
    `          width="1080" height="1920" style="position:absolute; inset:0; opacity:0.06;"></canvas>`,
    `  // draw hex grid at low opacity in brandPrimaryColor — see GSAP TECHNIQUE L for the canvas pattern`,
    ``,
    `Option C — TOP+BOTTOM BRAND BARS:`,
    `  <div id="brand-chrome-bars" class="clip" data-start="0" data-duration="${input.durationSec}" data-track-index="9"`,
    `       style="position:absolute; inset:0; pointer-events:none;`,
    `              background: linear-gradient(180deg, ${brand.brandPrimaryColor}22 0%, transparent 8%, transparent 92%, ${brand.brandPrimaryColor}22 100%);"></div>`,
    ``,
    `RULES:`,
    `• Chrome must be SUBTLE (opacity ≤ 0.12, or alpha-tinted brand color). It is not the focal element.`,
    `• Chrome must use brand colors only — never decorative palettes.`,
    `• Chrome can have a slow drift animation (e.g. canvas redraw via tl.eventCallback) but must not steal attention.`,
    `• Pick the SAME chrome option you would expect a previous motion in this reel to have used — consistency over creativity here.`,
    ``,
  ].join('\n') : '';

  // Build assets section — give Gemini the asset:// URLs it can use directly in <img> tags.
  // PRIORITY: if `pinnedAssets` has entries (user explicitly attached one or more),
  // they win — the motion is built AROUND them and projectAssets are ignored.
  // 1 entry → single-asset protagonist. 2+ entries → sequential carousel.
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const pinned = input.pinnedAssets ?? [];
  const isCarousel = pinned.length > 1;
  const assetsSection = pinned.length > 0 ? (() => {
    // ─── CAROUSEL PATH (2+ pinned assets) ──────────────────────────────────
    // Each slide gets `durationSec / N` seconds. Slides share the same slot
    // (centered, percent-based positioning) — only one is visible at a time.
    if (isCarousel) {
      const slideLayer = input.motionLayer ?? 'overlay';
      const slideSafeW = slideLayer === 'split-bottom' || slideLayer === 'split-top' ? 760 : 880;
      const slideSafeH = slideLayer === 'split-bottom' || slideLayer === 'split-top' ? 700 : 1400;
      const slotDur = input.durationSec / pinned.length;
      const fadeDur = Math.min(0.25, slotDur / 5); // overlap window
      const slideBlocks = pinned.map((p, i) => {
        const u = p.relativeUrl ?? convertFileSrc(p.path);
        const isVid = p.type === 'video';
        const start = i * slotDur;
        const id = isVid ? `carousel-video-${i + 1}` : `carousel-image-${i + 1}`;
        if (isVid) {
          return [
            `   <video id="${id}" class="clip" src="${u}"`,
            `          data-start="${start.toFixed(3)}" data-duration="${slotDur.toFixed(3)}" data-track-index="3"`,
            `          autoplay muted loop playsinline preload="auto"`,
            `          style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:${slideSafeW}px; max-height:${slideSafeH}px; object-fit:contain; border-radius:24px; box-shadow:0 32px 80px rgba(0,0,0,0.6);"></video>`,
          ].join('\n');
        }
        return [
          `   <div id="${id}-shell" class="clip" data-start="${start.toFixed(3)}" data-duration="${slotDur.toFixed(3)}" data-track-index="3"`,
          `        style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);">`,
          `     <img id="${id}" class="clip asset-anim" src="${u}" loading="eager"`,
          `          data-start="${start.toFixed(3)}" data-duration="${slotDur.toFixed(3)}" data-track-index="3"`,
          `          style="width:${slideSafeW}px; max-height:${slideSafeH}px; object-fit:contain; border-radius:24px; box-shadow:0 32px 80px rgba(0,0,0,0.6);" />`,
          `   </div>`,
        ].join('\n');
      }).join('\n\n');
      const slideListing = pinned
        .map((p, i) => `  ${i + 1}. "${p.name}" (${p.type ?? 'image'}) — slot ${(i * slotDur).toFixed(2)}s → ${((i + 1) * slotDur).toFixed(2)}s`)
        .join('\n');
      return [
        `╔══════════════════════════════════════════════════════╗`,
        `  📌 PINNED CAROUSEL — ${pinned.length} slides em sequência`,
        `  THE ASSETS ARE THE PROTAGONISTS. NON-NEGOTIABLE.`,
        `╚══════════════════════════════════════════════════════╝`,
        `Block duration: ${input.durationSec}s · per-slide duration: ${slotDur.toFixed(2)}s`,
        ``,
        `Slides (in order):`,
        slideListing,
        ``,
        `🎯 LAYOUT — copy the carousel block VERBATIM. Each slide already has its own`,
        `data-start / data-duration on track 3, so the runtime shows exactly one slide`,
        `at a time. They share the same centered slot — DO NOT shift positions per slide.`,
        ``,
        slideBlocks,
        ``,
        `HARD RULES:`,
        `1. Slides ARE the visual content. Build supporting elements (headline, sublabel,`,
        `   progress dots, slide number) AROUND the carousel, never on top of it.`,
        `2. Each slide must occupy its full ${slotDur.toFixed(2)}s slot. Do NOT add fade-in/out`,
        `   inside the slide — the runtime handles slide visibility via class="clip".`,
        `3. You MAY add a subtle entry on each slide via gsap (target the id), kept short`,
        `   (≤${(fadeDur * 0.6).toFixed(2)}s) so it doesn't eat the slot. Example:`,
        `     tl.from('#carousel-image-1', { scale:0.96, opacity:0, duration:${(fadeDur * 0.6).toFixed(2)}, ease:'power3.out' }, 0)`,
        `     tl.from('#carousel-image-2', { scale:0.96, opacity:0, duration:${(fadeDur * 0.6).toFixed(2)}, ease:'power3.out' }, ${slotDur.toFixed(2)})`,
        `     ... one per slide, anchored at i * ${slotDur.toFixed(2)}.`,
        `4. Add a slide-number indicator (e.g. "1 / ${pinned.length}") in a corner, animated`,
        `   in sync with each slot. Use class="font-tech" (Space Grotesk) and keep it small.`,
        `5. Optionally: a row of dots at the bottom showing carousel progress (active dot`,
        `   uses brandPrimaryColor at 100%, inactive at 30%). Animate the active dot per slot.`,
        `6. NEVER place a sixth/seventh slide if the user only attached ${pinned.length}.`,
        `   The carousel has exactly ${pinned.length} slots — match.`,
        ``,
        `📖 TEXT-OVER-CAROUSEL: same legibility rules as single-asset (plate, blur, halo,`,
        `or dead zone). Headlines that span the whole block are FINE — they sit on track 4+,`,
        `above the carousel layer.`,
        ``,
        `CONTEXT: the user said "${input.blockText.slice(0, 120)}${input.blockText.length > 120 ? '…' : ''}" while this carousel plays — make the supporting elements answer what's being said. Treat the slides as evidence/illustration of the narration.`,
        ``,
      ].join('\n');
    }
    // ─── SINGLE-ASSET PATH (legacy behaviour, untouched) ──────────────────
    const a = pinned[0];
    // Prefer the pre-copied relative URL (assets/foo.mp4) — HyperFrames cannot
    // resolve asset:// URLs at render time. Only fall back to asset:// when
    // the caller hasn't copied the file (used by the live preview path).
    const url = a.relativeUrl ?? convertFileSrc(a.path);
    const isVideo = a.type === 'video';
    // CRITICAL: video and image have DIFFERENT shell rules.
    // - <img>: needs to be inside a .clip shell. The shell handles timing.
    // - <video>: IS its own .clip (with data-start on the tag itself). DO NOT
    //   wrap it in another timed shell — HyperFrames lint reports
    //   `video_nested_in_timed_element` and the render freezes the video.
    // Layout-aware positioning — the asset's safe center depends on the slot:
    //   - split-top   (slot 1080×960, asset slot = top half) → center at y=480
    //   - split-bottom (asset slot = bottom half)            → center at y=480 (slot is offset by HyperFrames)
    //   - replace      (full frame 1080×1920)                → center at y=960
    //   - overlay                                            → use CSS centering
    // For all of these the canvas root maps the slot's own coords, so y=50%
    // maps to the slot's true center. Using percent + translate is the only
    // way to GUARANTEE the asset stays centered no matter what width/height
    // it actually decodes to. Pixel coords drift because Gemini guesses heights.
    const layer = input.motionLayer ?? 'overlay';
    const safeWidth = layer === 'split-bottom' || layer === 'split-top' ? 760 : 880;
    const safeMaxHeight = layer === 'split-bottom' || layer === 'split-top' ? 700 : 1400;
    const mediaBlock = isVideo
      ? [
          `   <video id="pinned-asset-video" class="clip" src="${url}"`,
          `          data-start="0" data-duration="${input.durationSec}" data-track-index="3"`,
          `          autoplay muted loop playsinline preload="auto"`,
          `          style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:${safeWidth}px; max-height:${safeMaxHeight}px; object-fit:contain; border-radius:24px; box-shadow:0 32px 80px rgba(0,0,0,0.6);"></video>`,
        ].join('\n')
      : [
          `   <div id="pinned-asset-shell" class="clip" data-start="0" data-duration="${input.durationSec}" data-track-index="3"`,
          `        style="position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);">`,
          `     <img id="pinned-asset-image" class="asset-anim" src="${url}" loading="eager"`,
          `          style="width:${safeWidth}px; max-height:${safeMaxHeight}px; object-fit:contain; border-radius:24px; box-shadow:0 32px 80px rgba(0,0,0,0.6);" />`,
          `   </div>`,
        ].join('\n');
    return [
      `╔══════════════════════════════════════════════════════╗`,
      `  📌 PINNED ASSET — user attached this to the block`,
      `  THIS ASSET IS THE VISUAL PROTAGONIST. NON-NEGOTIABLE.`,
      `╚══════════════════════════════════════════════════════╝`,
      `Filename: "${a.name}" (${a.kind ?? (isVideo ? 'video' : 'image')})`,
      `URL: ${url}`,
      ``,
      `HARD RULES — failure to follow these = wrong output:`,
      `1. The asset MUST be the centerpiece of this composition. Do NOT generate a replacement, do NOT hide it, do NOT make it secondary.`,
      `2. Build motion AROUND the asset: entrance animation, idle micro-motion (subtle drift, glow pulse), supporting elements (text labels, arrows, particles, frames) that point to or complement it.`,
      `3. The asset takes ~60-80% of the slot's visual area. Position it as the focal point.`,
      `4. Use the EXACT URL above. Do not invent paths.`,
      ``,
      `🎯 POSITIONING — COPY THE TEMPLATE BELOW VERBATIM. DO NOT REWRITE THE STYLE ATTRIBUTE.`,
      ``,
      `   The asset's positioning uses CSS centering (left:50%; top:50%; translate(-50%,-50%))`,
      `   because it is the only way to GUARANTEE the asset stays centered in the slot regardless`,
      `   of the asset's intrinsic dimensions. If you replace this with absolute pixel coordinates`,
      `   (left:160px, top:260px, etc.), the asset WILL drift off-center because video and image`,
      `   intrinsic sizes are unknown at prompt time. THIS IS A REPEAT BUG — do not introduce it again.`,
      ``,
      `   Required style attribute (copy verbatim — only change box-shadow/border-radius if needed):`,
      `     position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:${safeWidth}px; max-height:${safeMaxHeight}px; object-fit:contain;`,
      ``,
      `   You MAY add: border-radius, box-shadow, border, filter (e.g. drop-shadow). You MAY NOT change`,
      `   left/top/transform/width/max-height/object-fit. If you want the asset offset (e.g. for a label`,
      `   below it), wrap supporting elements around the centered asset, do not move the asset itself.`,
      ``,
      isVideo
        ? `5. VIDEO ASSET TEMPLATE — the <video> tag IS its own .clip. Do NOT wrap it in another .clip shell (lint rule: video_nested_in_timed_element). Animate it directly:`
        : `5. IMAGE ASSET TEMPLATE — wrap the <img> in a .clip shell and animate the inner <img>:`,
      mediaBlock,
      isVideo ? `   ⚠ ALWAYS keep the muted attribute. Asset audio would clash with the narration track.` : ``,
      `6. Only ONE copy of the asset. Don't duplicate, mirror, or grid it.`,
      isVideo
        ? `7. GSAP target: '#pinned-asset-video'. You CAN gsap.from/to the <video> itself for entrance/exit because it IS the timed element here. Do NOT animate transform-origin/scale on the video without preserving its width — keep the asset readable.`
        : `7. NEVER GSAP-target the .clip itself — animate '#pinned-asset-image' or supporting children only.`,
      ``,
      `RECOMMENDED ANIMATION GRAMMAR (target .asset-anim, never .clip):`,
      `• Entrance: tl.from('.asset-anim', { scale:0.85, opacity:0, y:40, duration:0.6, ease:'back.out(1.6)' })`,
      `• Idle drift: const cycle = 2; tl.to('.asset-anim', { y:'+=8', duration:cycle, repeat: Math.floor((${input.durationSec}-1) / cycle), yoyo:true, ease:'sine.inOut' }, '>-0.1')`,
      `• Glow pulse via real child <div class="glow-ring"> (NOT ::before) animated with box-shadow tween`,
      `• Supporting text: brand-coloured headline next to or below the asset, animated in after it lands`,
      `• Arrows / annotations pointing TO the asset, drawn with SVG path stroke animation`,
      ``,
      `╔══════════════════════════════════════════════════════╗`,
      `  📖 TEXT-OVER-ASSET LEGIBILITY — REQUIRED`,
      `╚══════════════════════════════════════════════════════╝`,
      `Asset frames are unpredictable: a video may shift between bright and dark, a screenshot may`,
      `have light text areas. Plain coloured text dropped on top WILL disappear in some frames.`,
      `Pick AT LEAST ONE of these four techniques for every text element you place over (or near) the asset:`,
      ``,
      `① TEXT PLATE (safest — use when in doubt)`,
      `   Wrap the text in a container with an opaque or semi-opaque background pill.`,
      `   <div style="display:inline-block; padding:14px 28px; border-radius:14px; background:#000000; color:#ffffff;">TEXT</div>`,
      `   Or with brand-colour bg:  background:${brand?.brandPrimaryColor ?? '#000'}; color:${brand?.brandTextColor ?? '#fff'};`,
      ``,
      `② BACKDROP BLUR (modern, "iOS Now Playing")`,
      `   <div style="background:rgba(0,0,0,0.55); backdrop-filter:blur(18px) saturate(140%); -webkit-backdrop-filter:blur(18px) saturate(140%); border:1px solid rgba(255,255,255,0.12); border-radius:16px; padding:16px 24px; color:#fff;">TEXT</div>`,
      `   Works ONLY on text containers, not on the asset itself.`,
      ``,
      `③ HEAVY TEXT-SHADOW HALO (invisible, no plate needed)`,
      `   color:#ffffff; text-shadow: 0 0 16px rgba(0,0,0,0.95), 0 4px 18px rgba(0,0,0,0.85), 0 0 4px rgba(0,0,0,1);`,
      `   Stack 3 shadows like above — single shadow doesn't survive bright frames. Pair with weight 800+.`,
      ``,
      `④ DEAD ZONE — place text where the asset is NOT (preferred for hero headlines)`,
      `   The asset is centered at left:50% top:50% with the box widths above. The DEAD ZONES are:`,
      layer === 'split-bottom' || layer === 'split-top'
        ? `     • Top strip:   y: 30–110  (above the asset, ~80px tall)
     • Bottom strip: y: 850–940 (below the asset, ~90px tall) — but watch for caption rail bleed
     • Left band:    x: 0–${Math.round(540 - safeWidth/2 - 40)}    (anything left of the asset)
     • Right band:   x: ${Math.round(540 + safeWidth/2 + 40)}–1080 (anything right of the asset)`
        : `     • Top strip:   y: 220–460  (above the asset, hook/title zone)
     • Bottom strip: y: 1280–1540 (below the asset, caption/CTA zone)
     • Side bands:   x: 0–60 and x: 1020–1080 (margins, only for narrow accents)`,
      `   Centering text BELOW or ABOVE the asset (rather than over it) is almost always cleaner.`,
      ``,
      `MANDATORY checks before finalising:`,
      `• If text is INSIDE the asset's bounding box → MUST have ① plate, ② blur, or ③ heavy shadow.`,
      `• If text uses brand colour over a brand-coloured plate → invert: use brandTextColor ON brandPrimaryColor, not on the raw asset.`,
      `• Headline weight ≥ 700 always when over an asset (medium weights wash out).`,
      `• Avoid pure single-shadow (text-shadow: 0 2px 8px rgba(0,0,0,0.5)) — it dies on bright frames.`,
      ``,
      `CONTEXT: the user said "${input.blockText.slice(0, 120)}${input.blockText.length > 120 ? '…' : ''}" while this asset is on screen — frame the composition so the asset visually answers what's being said.`,
      ``,
    ].filter(Boolean).join('\n');
  })() : input.projectAssets && input.projectAssets.length > 0 ? [
    `╔══════════════════════════════════════════════════════╗`,
    `  PROJECT ASSETS — real screenshots from the user`,
    `  PREFER these over AI-generated mockups whenever relevant to the block.`,
    `╚══════════════════════════════════════════════════════╝`,
    ...input.projectAssets.map(a => {
      const url = convertFileSrc(a.path);
      return `• "${a.name}" → use as: <img src="${url}" style="..." />`;
    }),
    ``,
    `HOW TO USE ASSETS IN HTML — CLIP-SHELL PATTERN (REQUIRED):`,
    `  <div id="screenshot-shell" class="clip" data-start="0" data-duration="${input.durationSec}" data-track-index="2"`,
    `       style="position:absolute; left:240px; top:600px;">`,
    `    <img id="screenshot-img" class="asset-anim" src="ASSET_URL" data-start="0" data-duration="${input.durationSec}"`,
    `         style="width:600px; border-radius:16px; box-shadow:0 24px 64px rgba(0,0,0,0.6);" />`,
    `  </div>`,
    `GSAP (target by id, never the .clip): tl.from('#screenshot-img', { scale:0.9, opacity:0, duration:0.5, ease:'back.out(1.4)' })`,
    `For TUTORIAL_STEP blocks: place the screenshot inside the phone/browser frame SVG.`,
    `For HOW_IT_WORKS blocks: use screenshots as the "result" box content.`,
    ``,
  ].join('\n') : '';

  // Slot context: tell Gemini the exact canvas it's designing for.
  const slotSection = (() => {
    const layer = input.motionLayer ?? 'overlay';
    if (layer === 'split-bottom' || layer === 'split-top') {
      const position = layer === 'split-bottom' ? 'BOTTOM HALF of the screen' : 'TOP HALF of the screen';
      const avatarPosition = layer === 'split-bottom' ? 'top half' : 'bottom half';
      return [
        `╔══════════════════════════════════════════════════════╗`,
        `  CANVAS SLOT — SPLIT LAYOUT`,
        `╚══════════════════════════════════════════════════════╝`,
        `This composition occupies the ${position} (1080×960px).`,
        `The avatar video fills the ${avatarPosition} — you CANNOT see it, but the viewer can.`,
        ``,
        `DESIGN RULES FOR THIS SLOT:`,
        `• Container: width:1080px; height:960px (NOT 1920px)`,
        `• Root div must have: position:absolute; width:1080px; height:960px; overflow:hidden`,
        `• Keep ALL content inside 0..960px vertically — nothing outside`,
        `• Typography: slightly larger than full-frame — the slot is compact, text must be BOLD and readable`,
        `• Composition: dense and self-contained — no empty padding expecting content above/below`,
        `• Visual edge: add a subtle top/bottom border or glow (2-4px, brandPrimaryColor) to frame the slot cleanly`,
        `• The split seam between avatar and motion will have a gradient — design the edge of your slot with this in mind`,
        `• DO NOT design for 1920px height — anything below 960px will be clipped`,
        ``,
        `📐 SAFE AREA (split slot, 1080×960):`,
        `  Place all primary content inside x:60–1020, y:80–820.`,
        `  • Top 80px and bottom 140px are SOFT BLEED zones — gradients, atmospheric particles only, no headlines or hero icons.`,
        `  • The bottom 140px is reserved for the seam gradient + caption rail bleed-through; keep it visually quiet.`,
        `  • Hero/focal element vertical center should sit around y=420-480 (true middle of the slot).`,
      ].join('\n');
    }
    if (layer === 'replace') {
      if (input.canvasAspect === '4:5') {
        return [
          `╔══════════════════════════════════════════════════════╗`,
          `  CANVAS SLOT — CAROUSEL SLIDE (4:5 · 1080×1350px)`,
          `╚══════════════════════════════════════════════════════╝`,
          `This is a CAROUSEL SLIDE. Canvas: 1080×1350px (4:5 aspect ratio). No avatar.`,
          `This is ONE slide in a swipeable Instagram carousel. Design it as a standalone visual card.`,
          ``,
          `DESIGN PHILOSOPHY for carousel slides:`,
          `• Each slide is a static poster that animates in — NOT a talking-head video supplement`,
          `• Bold, graphic, poster-like aesthetic. Think magazine cover energy.`,
          `• One strong visual hierarchy: topic headline → supporting element → quiet background`,
          `• The text on screen IS the message — make it the dominant element, not a caption`,
          `• Animations: elegant entrances (slide-up, fade-scale). Loop gently or hold at the end. Never frantic.`,
          ``,
          `📐 SAFE AREA (carousel 4:5, 1080×1350):`,
          `  Place all primary content inside x:80–1000, y:160–1190.`,
          `  ⛔ FORBIDDEN: place any headline or primary content above y:160 or below y:1190.`,
          `  • Top 160px (y:0–160): background gradients and decorative atmosphere only.`,
          `  • Bottom 160px (y:1190–1350): quiet zone — soft gradient, no text.`,
          `  • Hero/focal element vertical center: aim for y≈630-680 (true middle of safe box).`,
          `  • Typography size: larger than reel — viewer is reading on mobile at thumb-scroll speed.`,
          `  • Root div: position:absolute; width:1080px; height:1350px; overflow:hidden`,
        ].join('\n');
      }
      return [
        `╔══════════════════════════════════════════════════════╗`,
        `  CANVAS SLOT — FULL FRAME REPLACE`,
        `╚══════════════════════════════════════════════════════╝`,
        `This composition fills the ENTIRE screen (1080×1920px). No avatar underneath.`,
        `Design for maximum visual impact — this IS the entire video frame for this block.`,
        ``,
        `📐 SAFE AREA (full frame, 1080×1920):`,
        `  Place all primary content inside x:80–1000, y:220–1540.`,
        `  ⛔ FORBIDDEN: place any headline, hero icon, image, or primary content above y:220 or below y:1540.`,
        `  ⛔ FORBIDDEN: position any element with top < 220px or bottom > 1540px — it will be clipped or overlap system UI.`,
        `  • Top 220px (y:0–220): background gradients and atmosphere ONLY — no text, no icons, no UI chrome.`,
        `  • Bottom 380px (y:1540–1920): caption rail and handle zone — no designed content here.`,
        `  • Hero/focal element vertical center: aim for y≈900-960 (true middle of the safe box).`,
        `  • UI mockups (sidebars, windows, app chrome): must fit entirely within x:0–1080, y:220–1540. Cap height at 1320px max.`,
      ].join('\n');
    }
    // overlay
    return [
      `╔══════════════════════════════════════════════════════╗`,
      `  CANVAS SLOT — FLOATING OVERLAY (mobile vertical short-form)`,
      `╚══════════════════════════════════════════════════════╝`,
      `This composition floats over a talking presenter in 9:16 vertical video (Reels/TikTok/Shorts).`,
      `Think: Submagic-style caption card, Hormozi pop-text, floating data card centered over the lower-mid frame.`,
      `NOT a broadcast TV lower-third (those occupy the bottom 20% — but the bottom 15-20% of mobile vertical`,
      `video is OCCLUDED by platform UI: likes, comments, caption rail, progress bar).`,
      `Composited with SCREEN blend, so #000000 backgrounds become transparent.`,
      ``,
      `DESIGN RULES — FLOATING OVERLAY:`,
      `• Background MUST be pure #000000 — dark pixels become transparent under screen blend`,
      `• ALL primary content lives in y:1114–1536 (the floating-card zone, 22% height of the canvas)`,
      `• y:0–1100 (top 57%) MUST be pure black — that's where the presenter's face/chest live; nothing visible there`,
      `• y:1536–1920 (bottom 20%) MUST be pure black — that's the platform UI occlusion zone, anything there gets hidden by the app chrome on upload`,
      `• Text: white or bright brand color, bold sans, strong drop shadow so it reads over the moving presenter behind`,
      `• Energy: a single hero element (headline / stat / label) — NOT a dense composition. Mobile = one idea per overlay.`,
      `• NO atmospheric gradients/glows outside y:1114–1536 — they'd brighten the face or get clipped`,
      ``,
      `📐 SAFE AREA (floating overlay card, 1080×1920):`,
      `  Primary content: x:80–1000, y:1114–1536 (the mobile-safe floating zone)`,
      `  Black-only zones (KEEP PURE BLACK):`,
      `    • y:0–1100 (top — presenter zone)`,
      `    • y:1536–1920 (bottom — platform UI occlusion zone)`,
      `  Soft fade buffer: 40px (~y:1080–1120 and ~y:1500–1540) — atmosphere/particles only, no text.`,
    ].join('\n');
  })();

  // Atmosphere snippet derived from the active preset's atmospherePalette.
  // Replaces the previous A/B/C list in the SYSTEM_PROMPT — Gemini gets one
  // explicit, copy-paste-ready CSS block tied to the preset's mood.
  const atm = preset.atmosphere;
  const rgba = (hex: string, alpha: number): string => {
    const m = hex.replace('#', '');
    const r = parseInt(m.length === 3 ? m[0] + m[0] : m.slice(0, 2), 16);
    const g = parseInt(m.length === 3 ? m[1] + m[1] : m.slice(2, 4), 16);
    const b = parseInt(m.length === 3 ? m[2] + m[2] : m.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };
  // When the reel is in LIGHT mode, override the atmosphere's bg + glow alphas
  // so the snippet itself is light. Otherwise the dark preset's `baseBg` would
  // get rendered into the HTML literally, overriding the lightModeSection above
  // it (Gemini follows the most concrete CSS — and the atmosphere snippet IS
  // copy-paste CSS). vignette is suppressed in light mode (dark vignettes on
  // white look filthy).
  const forceLight = input.motionColorMode === 'light' && preset.bgType === 'dark';
  // Opposite direction: user clicked dark on a light preset. Atmosphere is
  // rewritten to a dark canvas so the snippet itself emits dark colors.
  const forceDark = input.motionColorMode === 'dark' && preset.bgType === 'light';
  const atmBg = forceLight
    ? '#ffffff'
    : forceDark
      ? '#0a0a0c'
      : atm.baseBg;
  const atmWarmAlpha = forceLight
    ? Math.min(atm.warmGlow.alpha, 0.06)
    : forceDark
      ? Math.max(atm.warmGlow.alpha, 0.12)
      : atm.warmGlow.alpha;
  const atmCoolAlpha = forceLight
    ? Math.min(atm.coolGlow.alpha, 0.06)
    : forceDark
      ? Math.max(atm.coolGlow.alpha, 0.10)
      : atm.coolGlow.alpha;
  const atmVignette = forceLight
    ? 0
    : forceDark
      ? Math.max(atm.vignetteIntensity, 0.5)
      : atm.vignetteIntensity;
  const atmosphereSection = [
    `╔══════════════════════════════════════════════════════╗`,
    `  🎨 ATMOSPHERE — copy this snippet for track 0`,
    `╚══════════════════════════════════════════════════════╝`,
    forceLight
      ? `User is in LIGHT MODE. The atmosphere below has already been re-tinted to a bright palette — use it AS-IS, don't restore the preset's dark colours.`
      : forceDark
        ? `User is in DARK MODE. The atmosphere below has already been re-tinted to a dark palette — use it AS-IS, don't restore the preset's light colours.`
        : `Preset "${preset.label}" declares this atmosphere palette. Use it AS-IS for the track-0 background — do not invent another colour scheme. Then add the vignette pass below as a sibling (track 1, full duration).`,
    ``,
    `Track 0 — atmosphere base:`,
    `  <div id="atmos-bg" class="clip" data-start="0" data-duration="${input.durationSec}" data-track-index="0"`,
    `       style="position:absolute; inset:0; background:${atmBg};`,
    `              background-image:`,
    `                radial-gradient(ellipse 60% 50% at ${atm.warmGlow.pos}, ${rgba(atm.warmGlow.color, atmWarmAlpha)} 0%, transparent 60%),`,
    `                radial-gradient(ellipse 55% 45% at ${atm.coolGlow.pos}, ${rgba(atm.coolGlow.color, atmCoolAlpha)} 0%, transparent 65%);"></div>`,
    ``,
    atmVignette > 0
      ? [
          `Track 1 — vignette pass (anchors the eye, looks expensive):`,
          `  <div id="atmos-vignette" class="clip atmos-vignette" data-start="0" data-duration="${input.durationSec}" data-track-index="1"`,
          `       style="opacity:${atmVignette};"></div>`,
          ``,
        ].join('\n')
      : '',
    forceLight
      ? `The base bg color is "${atmBg}" (white). ALL other elements should harmonise with a bright canvas: dark text (#1d1d1f), subtle shadows tinted with the brand accent, NEVER pure black shadows on white. NO dark vignettes.`
      : forceDark
        ? `The base bg color is "${atmBg}" (deep dark). ALL other elements should harmonise with a dark canvas: off-white text (#f5f5f5, never pure #fff), accents that pop against dark, vignette welcomed. NO bright white backgrounds.`
        : `The base bg color "${atmBg}" is the canvas. ALL other elements should harmonise with it: text colours that contrast 7:1+ against it, accents that sit warmly on it, shadows tinted to its hue (warm bg → warm shadows, NEVER black shadows on cream).`,
    ``,
  ].filter(Boolean).join('\n');

  const lang = input.outputLanguage ?? 'pt-BR';
  const languageSection = buildMotionLanguageSection(lang);

  // Creator identity — when the user has filled their profile in Settings,
  // surface it to Gemini so social-flavoured presets (notably the follow card)
  // render with the REAL handle, name, avatar instead of inventing one from
  // the project name. Without this, "Claude Acesso" became "@claude.acesso"
  // on every reel, which was confusing.
  const id = input.userIdentity;
  const hasIdentity = !!id && (!!id.displayName?.trim() || !!id.handle?.trim());
  const userIdentitySection = hasIdentity ? [
    `╔══════════════════════════════════════════════════════╗`,
    `  👤 CREATOR IDENTITY — use these EXACT values`,
    `╚══════════════════════════════════════════════════════╝`,
    `The user has configured their identity in Settings. If this motion includes`,
    `a "follow" card, profile pill, handle badge, or any element that names the`,
    `creator, you MUST use these values verbatim — do NOT invent a handle from`,
    `the project name or brand.`,
    ``,
    id.displayName?.trim() ? `displayName: ${id.displayName.trim()}` : `displayName: (none — omit or use brand name)`,
    id.handle?.trim() ? `handle: @${id.handle.trim().replace(/^@+/, '')}` : `handle: (none — omit)`,
    id.followerCount?.trim() ? `followerCount: ${id.followerCount.trim()} followers` : `followerCount: (omit, don't invent)`,
    id.primaryPlatform ? `platform: ${id.primaryPlatform} (use its accent color in the follow button)` : ``,
    id.avatarDataUrl
      ? [
        `avatarDataUrl: provided as a base64 data URL — embed via <img src="…" /> inside the profile circle.`,
        `The exact value to put in the src attribute:`,
        id.avatarDataUrl,
      ].join('\n')
      : `avatarDataUrl: (none — use a CSS gradient placeholder for the avatar circle)`,
    ``,
    `CRITICAL RULES:`,
    `• Copy the values above LITERALLY. Do not alter spelling, capitalisation, or add prefixes/suffixes.`,
    `• Do NOT show a verified checkmark unless the user explicitly asked.`,
    `• Do NOT invent a follower count if "followerCount" above says "(omit, don't invent)".`,
    ``,
  ].filter(Boolean).join('\n') : '';

  // Deterministic app-mention detector — when the block text names a real
  // app, route Gemini toward the matching Hyperframes block instead of
  // letting it draw a fake UI in CSS. See HYPERFRAMES_WHITELIST above.
  const appMention = detectAppMention(input.blockText);
  const appMentionSection = appMention
    ? [
        `--- APP MENTION DETECTED ---`,
        `The block text mentions ${appMention.app}. You may emit the Hyperframes`,
        `catalog block \`${appMention.block}\` as a sub-composition for the moment`,
        `that names the app. The Rust pipeline will auto-install it before lint.`,
        `Emit pattern:`,
        `  <div class="clip" id="ui-mockup"`,
        `       data-start="0" data-duration="<seconds>" data-track-index="<n>"`,
        `       data-composition-id="ui-mockup-inner"`,
        `       data-composition-src="compositions/${appMention.block}.html"`,
        `       data-variable-values='{}'></div>`,
        `Whether to use this or to hand-roll the moment is YOUR call based on the`,
        `composition you're designing. The real catalog block is sharper and`,
        `on-brand if it fits; if not, hand-rolling is fine.`,
        ``,
      ].join('\n')
    : '';

  const userBrief = [
    languageSection,
    slotSection,
    '',
    reelContextSection,
    lightModeSection,
    darkModeSection,
    brandSection,
    brandChromeSection,
    atmosphereSection,
    userIdentitySection,
    assetsSection,
    appMentionSection,
    `--- THIS BLOCK (illustrate this) ---`,
    input.blockText.trim(),
    '',
    input.intent?.trim() ? `--- USER INTENT OVERRIDE ---\n${input.intent.trim()}\n` : '',
    input.text?.trim() ? `--- USER TEXT OVERRIDE ---\n${input.text.trim()}\n` : '',
    input.secondaryText ? `--- SECONDARY TEXT ---\n${input.secondaryText.trim()}\n` : '',
    input.number !== undefined ? `--- KEY NUMBER ---\n${input.number}\n` : '',
    `--- DURATION ---`,
    `${input.durationSec} seconds`,
    '',
    `--- COMPOSITION ID ---`,
    input.compositionId,
    `window.__timelines["${input.compositionId}"]`,
    '',
    // Word timestamps — only injected when the caller passes them AND the
    // preset is one that can benefit (karaoke-captions today; future word-
    // staggered presets can opt in by reading this section). Already rebased
    // to block-local time (0 = block start).
    input.wordTimestamps && input.wordTimestamps.length > 0
      ? [
          `--- WORD TIMESTAMPS (block-local seconds, sync to these) ---`,
          'Each line: <word> @ <start>s → <end>s. Use for karaoke/word-sync presets.',
          ...input.wordTimestamps.map((w, i) =>
            `  ${i}: "${w.word}"  @  ${w.start.toFixed(3)}s → ${w.end.toFixed(3)}s`
          ),
          `Total: ${input.wordTimestamps.length} words across ${input.durationSec.toFixed(2)}s.`,
          '',
        ].join('\n')
      : '',
    `--- STYLE PRESET: ${preset.label} (use brand colors above if available) ---`,
    preset.geminiBrief,
    '',
    `--- TYPOGRAPHY SET: ${input.fontSet ?? preset.defaultFontSet ?? 'brand'} ---`,
    FONT_SETS_PROMPT_TABLE,
    '',
    input.overlays && (input.overlays.grain || input.overlays.vignette || input.overlays.shimmer)
      ? `--- ACTIVE OVERLAYS ---\nActive: ${[
          input.overlays.grain && 'grain',
          input.overlays.vignette && 'vignette',
          input.overlays.shimmer && 'shimmer',
        ].filter(Boolean).join(', ')}\n${OVERLAYS_PROMPT_HINT}`
      : '',
    `--- ENERGY: ${input.motionEnergy ?? 'energetic'} ---`,
    input.motionEnergy === 'minimal'
      ? 'Pacing slow and restrained. Fewer particles, longer holds (each beat 0.4-0.8s longer than default). Prefer fade + small translate over scale/rotate. Avoid overshoot, avoid kinetic bursts, avoid stagger faster than 0.08s. Single focal element per moment. Think Apple keynote, NYT, perfume ad.'
      : 'Pacing fast and kinetic. More particles, shorter holds. Use scale/rotate freely. Overshoot with back.out / elastic.out is welcome. Stagger 0.03-0.06s. Multiple elements can move at once. Think viral Reels, Buck/Oddfellows, Nike commercial.',
    '',
    ANIMATION_GRAMMAR_BRIEF,
    '',
    FORBIDDEN_PATTERNS,
  ].filter(Boolean).join('\n');

  const canvasSize = input.canvasAspect === '4:5' ? '1080×1350' : '1080×1920';
  const systemPromptForRequest = SYSTEM_PROMPT
    .replace('CANVAS_SIZE_PLACEHOLDER', canvasSize)
    // {DURATION_SEC} appears in the timeline-planning rule. Without this
    // substitution the model receives a literal placeholder and falls
    // back to the bundled 4s/7s examples — for 10s+ blocks it then
    // clusters all events early and leaves a dead tail at the end.
    .replace(/\{DURATION_SEC\}/g, input.durationSec.toString());

  // Debug: confirm light-mode override is actually in the prompt + final HTML body.
  console.log('[motion/audit] motionColorMode=', input.motionColorMode,
    '· preset=', preset.id,
    '· presetBgType=', preset.bgType,
    '· forceLight=', forceLight,
    '· forceDark=', forceDark,
    '· lightModeSection chars=', lightModeSection.length,
    '· atmosphere baseBg=', atmBg,
    '· appMention=', appMention?.app ?? 'none',
    '· hyperframesCatalogInjected=true');
  let lastError: unknown;
  for (const model of getModelCandidates()) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ text: systemPromptForRequest }, { text: userBrief }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
          temperature: 0.65,
        },
      });
      const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (!raw) continue;
      let parsed: GenerationOutput;
      try { parsed = JSON.parse(raw); }
      catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) continue;
        parsed = JSON.parse(match[0]);
      }
      if (parsed.htmlBody && parsed.htmlBody.length > 100) {
        // Sanitize self-closing media tags before HyperFrames lints the HTML.
        // Gemini 3.5 Flash in particular emits `<video src="..." />` which the
        // browser parses as an open tag that swallows everything after it as
        // invisible fallback content. HyperFrames' lint catches this and aborts
        // the render with [self_closing_media_tag]. We rewrite to explicit
        // `<video ...></video>` so the composition renders. Same trick for
        // <img>, <audio>, <source>, <track>. Idempotent: tags already in
        // explicit form are left alone (regex requires the `/>` suffix).
        const beforeLen = parsed.htmlBody.length;
        parsed.htmlBody = parsed.htmlBody.replace(
          /<(video|audio|source|track|img)([^>]*?)\s*\/>/gi,
          (_match, tag, attrs) => {
            // <img> and <source>/<track> are void elements; leaving them
            // self-closed is technically OK in HTML5, but HyperFrames'
            // strict lint rejects all of them uniformly. Emit explicit
            // closing tags for everything to stay on the safe side.
            return `<${tag}${attrs}></${tag}>`;
          },
        );
        if (parsed.htmlBody.length !== beforeLen) {
          console.log('[motion/sanitize] rewrote self-closing media tags · model=', model, '· delta=', parsed.htmlBody.length - beforeLen);
        }

        // Debug: see if Gemini honoured the light-mode override. We count
        // the suspicious dark hex literals that *should* have been remapped.
        if (input.motionColorMode === 'light' && preset.bgType === 'dark') {
          const darkRefs = (parsed.htmlBody.match(/#000(?![0-9a-fA-F])|#000000|#0a0a0f|#08080f|#08080a|#1a1a1a|#1c1c1c/g) ?? []).length;
          const whiteRefs = (parsed.htmlBody.match(/#fff(?![0-9a-fA-F])|#ffffff/g) ?? []).length;
          console.log('[motion/audit] HTML inspection · darkHexCount=', darkRefs,
            '· whiteHexCount=', whiteRefs,
            '· htmlLength=', parsed.htmlBody.length);
          if (darkRefs > 0) {
            console.warn('[motion/audit] Gemini emitted', darkRefs, 'dark hex references despite LIGHT MODE — sample:', parsed.htmlBody.slice(0, 500));
          }
        }
        return {
          intent: (parsed.intent ?? input.intent ?? '').trim(),
          text: (parsed.text ?? input.text ?? '').trim(),
          htmlBody: parsed.htmlBody,
          rationale: (parsed.rationale ?? '').trim(),
          // Record which model in the fallback chain produced this output.
          // Used by the picker badge to show what actually ran, not just the
          // current preference (which the user can change between generations).
          modelUsed: model,
          // Return the brand so the caller can cache it on the reel state and
          // pass it back via existingBrand on subsequent motions.
          brand: brand ?? undefined,
        };
      }
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Fallback to next model on: model not found, model unavailable, overload, server errors
      const retryable = /not found|NOT_FOUND|not supported|404|503|UNAVAILABLE|overload|RESOURCE_EXHAUSTED|429|500|INTERNAL/i.test(msg);
      if (!retryable) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Falha ao gerar HTML do motion.');
};

// ─── HTML doc assembly ─────────────────────────────────────────────────

export const buildFullHtmlDoc = (motion: MotionConfig, canvasAspect?: '9:16' | '4:5', motionColorMode?: 'dark' | 'light'): string => {
  const compositionId = motion.id;
  const dur = motion.durationSec;
  const isSplit = motion.layer === 'split-bottom' || motion.layer === 'split-top';
  const canvasH = isSplit ? 960 : canvasAspect === '4:5' ? 1350 : 1920;
  const isLight = motionColorMode === 'light';

  // Font set resolution: explicit on motion → preset default → 'brand' fallback.
  const preset = findStylePreset(motion.presetId);
  const fontSet: FontSet = motion.fontSet ?? preset.defaultFontSet ?? 'brand';
  const { links: fontLinks, css: fontCss } = buildFontSetHead(fontSet);

  // Overlays (grain / vignette / shimmer) — all optional, default off.
  const overlay = buildOverlays(motion.overlays);

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=${canvasH}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <!-- Inter is ALWAYS loaded as a safety fallback so first-frame text never renders generic sans. -->
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=block" rel="stylesheet" />
    ${fontLinks}
    <style>
      *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: 1080px; height: ${canvasH}px; overflow: hidden;
        /* Light mode gets a subtle dot grid texture (1.5px dots @ 24px spacing,
           6% black alpha) so the white canvas has personality without competing
           with content. Dark mode stays pure black — atmosphere comes from the
           preset's own glow/vignette layers. */
        background: ${isLight
          ? '#ffffff radial-gradient(circle at center, rgba(0,0,0,0.06) 1.5px, transparent 1.5px) 0 0 / 24px 24px'
          : '#000'};
        font-family: "Inter", system-ui, -apple-system, "Helvetica Neue", sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
        /* Enables 3D transforms (rotateY, perspective depth) on any descendant
           without each element needing to declare its own perspective. Use
           transform: rotateY(8deg) translateZ(40px) on cards for depth. */
        perspective: 1200px;
        transform-style: preserve-3d;
      }
      #root {
        position: relative;
        transform-style: preserve-3d;
      }
      .clip { will-change: opacity, transform; }
      ${fontCss}
      /* Cinematic atmosphere helper — see ATMOSPHERE section in prompt.
         Dark mode: strong black inset shadow anchors the eye to centre.
         Light mode: very subtle warm-grey inset so edges don't blow out. */
      .atmos-vignette {
        position: absolute; inset: 0; pointer-events: none;
        box-shadow: ${isLight
          ? 'inset 0 0 160px rgba(0,0,0,0.10), inset 0 0 60px rgba(0,0,0,0.06)'
          : 'inset 0 0 240px rgba(0,0,0,0.65), inset 0 0 80px rgba(0,0,0,0.45)'};
      }
      ${overlay.css}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="${compositionId}"
      data-start="0"
      data-duration="${dur}"
      data-width="1080"
      data-height="${canvasH}"
    >
${motion.html}
    </div>
    ${overlay.html}
    ${overlay.script ? `<script>${overlay.script}</script>` : ''}
  </body>
</html>`;
};
