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
import type { MotionConfig } from '../components/reelsStudio/motionLibrary';
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
}

const getApiKey = (): string => {
  const key = localStorage.getItem('GOOGLE_API_KEY');
  if (!key) throw new Error('GOOGLE_API_KEY não configurada.');
  return key;
};

// Pro for highest quality HTML/GSAP generation; Flash as fallback.
// Motion HTML generation — Pro and Flash only. Lite is not capable enough for
// motion graphics quality (user requirement).
// Note: pro-preview uses '3.1' but flash uses '3' (no minor) — that's how Google ships them.
const MODEL_CANDIDATES = [
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
];

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

The piece you're making is 1080×1920, 30fps. It plays for the duration specified per block. There's a narrator speaking; auto-captions will be burned in later. Your motion is the visual layer that ELEVATES the words — sometimes it illustrates, sometimes it punctuates, sometimes it's pure atmosphere.

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
- 120-280px font-size, weight 700-900 (Inter, system-ui)
- Tight letter-spacing on display: -2 to -5
- Treat each word as a clip you can animate independently (wrap in <span class="word">)
- Reveal techniques: clip-path wipe (left-to-right), word-by-word stagger from y:40, scale-punch on the keyword (0.7 → 1.06 → 1.0), mask reveal that pushes ink onto the canvas
- One word can be HIGHLIGHTED — different weight, accent color, or a thick underline that draws itself across it
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
You're animating with GSAP 3.14 (already loaded). Build a single paused timeline registered on window.__timelines["{COMPOSITION_ID}"]. Combine these primitives:

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

L) ICON SWAP CHAIN — same slot, different icons appear/swap over time
   Best for "vários tipos de coisa" / "transformações" — tells a story across the block.
   3-5 SVG icons stacked at the same position, only one visible at a time.
   tl.set(['.icon2', '.icon3', '.icon4'], { opacity: 0 })
   tl.from('.icon1', { scale: 0.8, opacity: 0, duration: 0.4, ease: 'back.out(1.4)' }, 0.2)
   tl.to('.icon1', { opacity: 0, duration: 0.3 }, 2.0)
   tl.fromTo('.icon2', { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.4)' }, 2.1)
   tl.to('.icon2', { opacity: 0, duration: 0.3 }, 4.0)
   tl.fromTo('.icon3', { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.4)' }, 4.1)
   Optionally pulse the last icon as climax: tl.to('.icon3', { scale: 1.08, duration: 0.4, yoyo: true, repeat: 1 }, 5.5)

Combine: pick ONE of the multi-beat structures (K or L) for blocks > 4s, then
combine with (J background drift) and (I particles) for atmosphere. For blocks
≤ 3s, a simpler arc (A entrance + F punch + exit) is fine.

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
1. Each element: class="clip", data-start, data-duration, data-track-index (0=back, higher=front)
2. ONE <script> at the end:
   window.__timelines = window.__timelines || {}
   const tl = gsap.timeline({ paused: true })
   window.__timelines["{COMPOSITION_ID}"] = tl
   ({COMPOSITION_ID} is a literal placeholder — write it exactly)
3. All tweens fit within each element's data-start to data-start+data-duration window
4. Canvas: 1080×1920px. Absolute positioning. Sizes in px.
5. Fonts: Inter, system-ui, sans-serif (already loaded)
6. GSAP 3.14 already loaded. No external URLs. No images.
7. FORBIDDEN: Date.now(), Math.random(), fetch(), setTimeout(), setInterval(), requestAnimationFrame()
8. SVG icons must be inline, self-contained, under 400 chars each

═══════════════════════════════════════════════════════════
 OUTPUT
═══════════════════════════════════════════════════════════
Return JSON with these fields:
- "intent": pt-BR, one sentence describing the visual concept you designed (e.g. "Hourglass spinning fast com partículas de poeira pra ilustrar tempo perdido")
- "text": pt-BR, the headline that appears on screen — 1 to 5 words MAX. Sometimes empty if the visual stands alone.
- "htmlBody": full HTML content (elements + the closing script registering the timeline)
- "rationale": 1-2 sentences pt-BR explaining the design choice — what verb you animated, what the timing arc is, why this composition fits this block

If the user provided a manual intent or text override, use those values verbatim.`.trim();

export interface ProjectAsset {
  name: string;   // filename, e.g. "screenshot-dashboard.png"
  path: string;   // absolute local path — converted to asset:// URL for HTML
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
  /** Full reel script context — helps Gemini understand where this block sits. */
  reelContext?: {
    projectName?: string;
    allBlocks?: string[];
    blockIndex?: number;
    prevBlockText?: string;
    nextBlockText?: string;
  };
  /** Motion layer mode — affects canvas dimensions and composition design. */
  motionLayer?: 'overlay' | 'replace' | 'split-bottom' | 'split-top';
  /**
   * Brand identity from a previous motion in this reel. When provided, brand
   * research is SKIPPED and these colors are used as-is. This keeps every
   * motion in the same reel visually consistent (same palette, same style).
   */
  existingBrand?: BrandResearch;
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

export const generateMotionHtml = async (input: GenerateMotionInput): Promise<GenerationOutput & { brand?: BrandResearch }> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const preset = findStylePreset(input.presetId);

  // If the reel already has a brand identity (from the first motion), reuse it
  // — every motion in the same reel must share the same palette/style.
  // Otherwise, run brand research now.
  const brandPromise: Promise<BrandResearch | null> = input.existingBrand
    ? Promise.resolve(input.existingBrand)
    : researchBrand(ai, input.blockText, input.reelContext);

  const ctx = input.reelContext;
  const reelContextSection = ctx ? [
    `--- REEL CONTEXT ---`,
    ctx.projectName ? `Project: ${ctx.projectName}` : '',
    ctx.allBlocks && ctx.allBlocks.length > 0
      ? `Full script (${ctx.allBlocks.length} blocks):\n${ctx.allBlocks.map((t, i) => `  [${i + 1}] ${t}`).join('\n')}`
      : '',
    ctx.blockIndex !== undefined ? `This is block ${ctx.blockIndex + 1} of ${ctx.allBlocks?.length ?? '?'}` : '',
    ctx.prevBlockText ? `Previous block: "${ctx.prevBlockText}"` : '',
    ctx.nextBlockText ? `Next block: "${ctx.nextBlockText}"` : '',
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
  ].filter(Boolean).join('\n') : [
    `╔══════════════════════════════════════════════════════╗`,
    `  NO BRAND IDENTIFIED — STRICT BLACK & WHITE PALETTE`,
    `╚══════════════════════════════════════════════════════╝`,
    `brandBackgroundColor: #000000   ← pure black`,
    `brandTextColor: #ffffff         ← pure white`,
    `brandPrimaryColor: #ffffff      ← white (used for icons, borders, accents)`,
    `brandSecondaryColor: #a3a3a3    ← neutral grey (60% white)`,
    `brandAccentColor: #ffffff       ← white (single hot-spot — emphasize via scale/glow not colour)`,
    ``,
    `THIS IS BLACK & WHITE MODE. NO COLORS AT ALL.`,
    `STRICTLY FORBIDDEN: any purple, violet, indigo, magenta, fuchsia, pink, blue, red, orange, yellow, green, cyan, teal, amber.`,
    `If the style preset suggests a gradient, use #000000 → #1a1a1a (subtle dark grey).`,
    `If the style preset suggests "vibrant" or "energy", express it through SCALE / MOTION / CONTRAST / TYPOGRAPHY WEIGHT, NEVER colour.`,
    `Highlights: use a thin white border, a white glow (rgba(255,255,255,0.5)), or pure white text against #000.`,
    '',
  ].join('\n');

  // Build assets section — give Gemini the asset:// URLs it can use directly in <img> tags
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const assetsSection = input.projectAssets && input.projectAssets.length > 0 ? [
    `╔══════════════════════════════════════════════════════╗`,
    `  PROJECT ASSETS — real screenshots from the user`,
    `  PREFER these over AI-generated mockups whenever relevant to the block.`,
    `╚══════════════════════════════════════════════════════╝`,
    ...input.projectAssets.map(a => {
      const url = convertFileSrc(a.path);
      return `• "${a.name}" → use as: <img src="${url}" style="..." />`;
    }),
    ``,
    `HOW TO USE ASSETS IN HTML:`,
    `  <img src="ASSET_URL" class="clip" data-start="0" data-duration="${input.durationSec}"`,
    `       data-track-index="2" style="position:absolute; width:600px; border-radius:16px;`,
    `       box-shadow:0 24px 64px rgba(0,0,0,0.6);" />`,
    `GSAP: tl.from(img, { scale:0.9, opacity:0, duration:0.5, ease:'back.out(1.4)' })`,
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
      ].join('\n');
    }
    if (layer === 'replace') {
      return [
        `╔══════════════════════════════════════════════════════╗`,
        `  CANVAS SLOT — FULL FRAME REPLACE`,
        `╚══════════════════════════════════════════════════════╝`,
        `This composition fills the ENTIRE screen (1080×1920px). No avatar underneath.`,
        `Design for maximum visual impact — this IS the entire video frame for this block.`,
      ].join('\n');
    }
    // overlay
    return [
      `╔══════════════════════════════════════════════════════╗`,
      `  CANVAS SLOT — OVERLAY (screen blend over avatar)`,
      `╚══════════════════════════════════════════════════════╝`,
      `This composition is blended over the avatar using SCREEN blend mode at 88% opacity.`,
      `DESIGN RULES FOR OVERLAY:`,
      `• Background MUST be #000000 or very dark — dark pixels become transparent in screen blend`,
      `• Only bright/colored elements will be visible over the avatar`,
      `• Text: white or bright brand color, large, with strong glow/shadow`,
      `• Decorative shapes: bright, colored, at 60-80% opacity — avoid white which washes out`,
      `• NO background fills over 15% brightness — they will wash out the avatar face`,
      `• Think: floating text and glowing elements that appear to hover over the person`,
    ].join('\n');
  })();

  const userBrief = [
    slotSection,
    '',
    reelContextSection,
    brandSection,
    assetsSection,
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
    `--- STYLE PRESET: ${preset.label} (use brand colors above if available) ---`,
    preset.geminiBrief,
    '',
    ANIMATION_GRAMMAR_BRIEF,
    '',
    FORBIDDEN_PATTERNS,
  ].filter(Boolean).join('\n');

  let lastError: unknown;
  for (const model of MODEL_CANDIDATES) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ text: SYSTEM_PROMPT }, { text: userBrief }] },
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
        return {
          intent: (parsed.intent ?? input.intent ?? '').trim(),
          text: (parsed.text ?? input.text ?? '').trim(),
          htmlBody: parsed.htmlBody,
          rationale: (parsed.rationale ?? '').trim(),
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

export const buildFullHtmlDoc = (motion: MotionConfig): string => {
  const compositionId = motion.id;
  const dur = motion.durationSec;
  const isSplit = motion.layer === 'split-bottom' || motion.layer === 'split-top';
  const canvasH = isSplit ? 960 : 1920;
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=${canvasH}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: 1080px; height: ${canvasH}px; overflow: hidden;
        background: #000;
        font-family: "Inter", system-ui, -apple-system, "Helvetica Neue", sans-serif;
      }
      .clip { will-change: opacity, transform; }
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
  </body>
</html>`;
};
