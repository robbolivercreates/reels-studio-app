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
// Tries the newest preview models first, falls back to stable 2.5 line if unavailable.
const MODEL_CANDIDATES = [
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
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
 PRINCIPLE 5 — TIMING & EASING (this is what makes it feel professional)
═══════════════════════════════════════════════════════════
Amateur motion uses linear or default easing on everything. Professional motion is curated:

- Entrances → ease: "back.out(1.4)" or "expo.out". Duration 0.4-0.7s.
- Exits → ease: "power3.in" or "expo.in". Duration 0.3-0.5s.
- Atmosphere/loops → ease: "sine.inOut" with yoyo:true, repeat: calculated finite count (e.g. for a 4s block with 0.8s pulse: repeat: 4)
- Punches/scale-pops → ease: "back.out(2)" or "elastic.out(1, 0.5)". Duration 0.3-0.5s.
- Slow zooms → ease: "power1.inOut". Duration 1.5-3s.

PACING:
- First 0.5s — set the scene (background + first hero element entering)
- 0.5s to 1.5s — main animation/storytelling beat
- 1.5s onward — text reveal, accent, climax, hold for 0.3-0.6s, then begin exit
- Last 0.3s — graceful exit (fade or scale-down) so cuts to the next block don't feel jarring

A 4-second piece should feel like 4 distinct beats, not a single static held shape.

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
- NO purple/violet/indigo: #4c1d95, #5b21b6, #6d28d9, #7c3aed, #8b5cf6, #a855f7, #9333ea, #c084fc, #1e1b4b, #2e1065
- NO magenta/fuchsia/pink: #d946ef, #ec4899, #f472b6, #c026d3, #db2777
- NO deep-purple gradients (e.g. #1E1B4B → #4C1D95) as default
- NO generic blue: #0000ff, #3b82f6, #60a5fa, #2563eb, #1d4ed8

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

Combine: most great pieces = (J background drift) + (A or E for entrance) + (D or F as climax) + (I particles for atmosphere). Three or four GSAP calls is enough.

═══════════════════════════════════════════════════════════
 ANTI-PATTERNS — avoid these mistakes
═══════════════════════════════════════════════════════════
× Stacking 3+ rectangle "cards" with text inside — that's a slide deck, not motion design
× Using emojis (🔥, ⚡, 💡) as content. They look amateur — use SVG icons instead
× Default linear easing on multiple elements — feels robotic
× Static held shots with no motion happening for >1s — this is a motion piece
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
}

// ─── Step 1: Brand research via Google Search grounding ───────────────────────

interface BrandResearch {
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

For generic concepts (productivity, automation, marketing, etc.) choose the dominant color culture:
- AI/Tech generic → deep navy #0f0f23 bg, electric cyan #00d4ff accent
- Finance/Money → dark green #0a2e1a bg, gold #f59e0b accent
- Health/Wellness → dark teal #0a1f1a bg, soft green #4ade80 accent
- Creative/Design → deep purple #1a0a2e bg, hot pink #f72585 accent
- Business/Corporate → charcoal #1a1a1a bg, steel blue #3b82f6 accent (ONLY for corporate topics)

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

// Hex shades to be wary of — only allowed if the topic is a brand famous for them.
const BANNED_HEX_RANGES: Array<{ pattern: RegExp; allowedTopicsRegex: RegExp; label: string }> = [
  { pattern: /^#(7c3aed|8b5cf6|a855f7|9333ea|6d28d9|5b21b6|4c1d95|c084fc|1e1b4b|2e1065)/i, allowedTopicsRegex: /(twitch|figma|discord|yahoo|roxo|purple|violet)/i, label: 'purple' },
  { pattern: /^#(d946ef|ec4899|f472b6|c026d3|db2777|be185d|9d174d)/i, allowedTopicsRegex: /(instagram|barbie|pink|magenta|fuchsia|rosa)/i, label: 'magenta/pink' },
  { pattern: /^#(3b82f6|60a5fa|2563eb|1d4ed8|1e40af)/i, allowedTopicsRegex: /(facebook|twitter|linkedin|paypal|samsung|dell|ibm|intel|chase|visa|ford|wal\s?mart|blue|azul)/i, label: 'generic blue' },
];

const isBannedColor = (hex: string, topic: string): { banned: boolean; label: string } => {
  if (!hex) return { banned: false, label: '' };
  for (const ban of BANNED_HEX_RANGES) {
    if (ban.pattern.test(hex) && !ban.allowedTopicsRegex.test(topic)) {
      return { banned: true, label: ban.label };
    }
  }
  return { banned: false, label: '' };
};

async function researchBrand(ai: GoogleGenAI, blockText: string, reelContext?: GenerateMotionInput['reelContext']): Promise<BrandResearch | null> {
  const groundingModels = [
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
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

export const generateMotionHtml = async (input: GenerateMotionInput): Promise<GenerationOutput> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const preset = findStylePreset(input.presetId);

  // Run brand research in parallel with context assembly (non-blocking — if it
  // fails we just proceed without brand colors).
  const brandPromise = researchBrand(ai, input.blockText, input.reelContext);

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
  const brandSection = brand ? [
    `╔══════════════════════════════════════════════════════╗`,
    `  BRAND IDENTITY — MANDATORY COLORS (researched via Google Search)`,
    `  YOU MUST USE THESE. DO NOT SUBSTITUTE WITH BLUE OR GENERIC COLORS.`,
    `╚══════════════════════════════════════════════════════╝`,
    `Topic identified: ${brand.topic}`,
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
