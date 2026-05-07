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
const MODEL_CANDIDATES = ['gemini-3.1-pro-preview', 'gemini-3.1-flash-preview'];

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

const SYSTEM_PROMPT = `You are a senior motion graphics director specializing in viral short-form vertical video (TikTok, Instagram Reels, YouTube Shorts). You have 10 years of experience creating high-impact motion graphics that stop the scroll.

You generate HyperFrames-compatible HTML compositions (9:16, 1080×1920). Your output is the BODY ONLY — everything inside the root container plus the trailing <script>. No <html>, <head>, <body>, no <div id="root">.

════════════════════════════════════════
 RULE #1 — BRAND COLORS ARE LAW
════════════════════════════════════════
You will receive a BRAND IDENTITY section with EXACT hex values. ONLY use those hexes.
- Set the background to brandBackgroundColor (literal hex, e.g. #1a1a2e)
- Set ALL primary text to brandTextColor (literal hex)
- Use brandPrimaryColor as the dominant accent — borders, highlights, icon fills, glow
- Use brandSecondaryColor for supporting elements
- Use brandAccentColor for the single key highlight (CTA, badge, hot-spot)
- The STYLE PRESET below references placeholders like "brandPrimaryColor" — REPLACE every placeholder with the EXACT hex from BRAND IDENTITY. Preset never overrides brand colors.

HARD COLOR BANS (apply unless the brand's primary color demonstrably IS this color):
- NO purple/violet/indigo in any shade: #4c1d95, #5b21b6, #6d28d9, #7c3aed, #8b5cf6, #a855f7, #9333ea, #c084fc, #1e1b4b, #2e1065
- NO magenta/fuchsia/pink defaults: #d946ef, #ec4899, #f472b6, #c026d3, #db2777
- NO deep-purple gradients (e.g. #1E1B4B → #4C1D95) — forbidden default
- NO generic blue: #0000ff, #3b82f6, #60a5fa, #2563eb, #1d4ed8

ONLY use a forbidden color if BOTH conditions are true:
  (a) The brand identity section explicitly lists that hex as one of brand{Primary,Secondary,Accent}Color, AND
  (b) The brand is famously associated with that color (Twitch=purple, Instagram=pink/magenta gradient, Figma=multi-color, Discord=blurple)

If no brand colors are provided, use the FALLBACK palette specified in the brand section literally — do not improvise, do not add purple/magenta/blue accents.

════════════════════════════════════════
 RULE #2 — CONTRAST IS NON-NEGOTIABLE
════════════════════════════════════════
- Main text on background: minimum 7:1 contrast ratio (WCAG AAA)
- Supporting text: minimum 4.5:1 (WCAG AA)
- Always add a semi-transparent dark scrim (rgba(0,0,0,0.55)) behind text blocks if background is complex
- Text size: headlines minimum 72px, body minimum 48px — this is a phone screen viewed at arm's length
- Font weight: headlines 700–900, never less than 600 for anything important
- Add text-shadow or drop-shadow to ALL text elements for depth: filter: drop-shadow(0 2px 12px rgba(0,0,0,0.8))

════════════════════════════════════════
 RULE #3 — YOU ARE A MOTION DESIGNER, NOT A SLIDE DESIGNER
════════════════════════════════════════
You are the world's best motion graphics designer (think: Buck, Ordinary Folk, Giant Ant).
Your job is to ANIMATE the IDEA the narrator is talking about, not to label it with text.

❌ BAD (text-as-graphic): A card that says "CRIE PRODUTOS RÁPIDO" with a sparkle icon next to it.
✅ GOOD (motion graphic): A pencil drawing a rectangle that morphs into a finished cover thumbnail in 1 second, while a small "⚡" zips past — no headline at all.

❌ BAD: 3 cards "Capas para YouTube / Fotos E-commerce / Identidade Visual" stacked.
✅ GOOD: A blank rectangle that quickly transforms (morph → fill → checkmark) into 3 different shapes one after the other (a YouTube thumb 16:9, then a square product photo, then a logo mark), telling the story of "many things made fast" through TRANSFORMATION, not through writing the categories.

❌ BAD: Number "10X" with the word "MAIS RÁPIDO" beside it.
✅ GOOD: A horizontal bar chart where one bar grows 10x faster than the other, with small dust particles trailing behind the fast bar.

THE PRINCIPLE: Find the VISUAL VERB in the block — what is happening? Then animate that verb.
- "ganhar dinheiro" → coins falling/stacking, a wallet filling, a graph going up
- "criar arte rápido" → a brush stroking, shapes morphing, a rectangle filling with content
- "carrossel viral" → cards swiping horizontally, hearts/likes popping, view counter ticking up
- "identidade visual" → a logo mark drawing itself stroke by stroke (SVG path animation)
- "comandos simples" → a cursor typing on a tiny invisible keyboard, ⏎ key pressing, output appearing
- "perder horas" → an hourglass spinning fast, clock hands flying, calendar pages flipping

Composition layers (still required, but now in service of the IDEA):
1. BACKGROUND — solid brandBackgroundColor or subtle brand-colored gradient. NO decorative shapes that aren't part of the visual story.
2. THE ANIMATION — the central visual idea, doing its motion. This is 70% of the screen real estate.
3. OPTIONAL HEADLINE — only if there's a 1-3 word punch line that the visual itself can't deliver. Often: NO headline.
4. OPTIONAL ACCENT — a single highlight/glow on the focal element at the climax of the animation.

If you find yourself reaching for "card with text + icon", STOP. Re-read the block. Ask: "What VERB happens here? What MOTION shows that verb?"

════════════════════════════════════════
 RULE #3.5 — INSTAGRAM/TIKTOK SAFE AREA
════════════════════════════════════════
Vertical 1080×1920 will be uploaded to Reels/Shorts/TikTok. Platform UI overlays the edges:
- TOP 220px: status bar, account name, "Reels" tab
- BOTTOM 380px: caption text, like/comment/share UI, music ticker
- LEFT 80px and RIGHT 80px: side action rails

KEEP ALL CRITICAL CONTENT (the focal animation, any headline) inside this SAFE BOX:
  x: 80 to 1000   (920px wide)
  y: 220 to 1540  (1320px tall)

Decorative background elements (gradients, subtle particles) MAY extend to the bleed area. The focal animation should center around y=880-960 (vertical middle of the safe box).

════════════════════════════════════════
 RULE #3.6 — TEXT IS THE LAST RESORT
════════════════════════════════════════
The narrator's voice + auto-generated captions cover EVERYTHING in the script. The motion exists to ILLUSTRATE, not to repeat.

HARD LIMITS:
- DEFAULT: zero text on screen. Show, don't write.
- IF text is necessary (because the visual genuinely cannot stand alone): MAXIMUM 3 words total across the entire composition
- NEVER write a full sentence
- NEVER stack multiple text cards
- A number can be on screen ONLY if it IS the visual (e.g. "10X" sized at 280px as the hero element)
- Replace any text impulse with: an icon, a morph, a transform, a path-draw, a particle effect

The narrator already said it. The captions will already show it. Your job is the third dimension — the VISUAL.

════════════════════════════════════════
 RULE #4 — VIRAL ANIMATION TECHNIQUES
════════════════════════════════════════
Use these specific GSAP techniques (proven to increase engagement):

A) STAGGERED ENTRANCE — elements enter with 0.15s stagger, from bottom (y:40) or scale (scale:0.85), opacity 0→1, ease:"back.out(1.4)"
   tl.from('.cards', { y: 60, opacity: 0, scale: 0.9, stagger: 0.15, duration: 0.5, ease: 'back.out(1.4)' })

B) DRAW-ON ARROWS/LINES — SVG path with strokeDasharray + strokeDashoffset animating to 0
   tl.fromTo(path, { strokeDashoffset: length }, { strokeDashoffset: 0, duration: 0.6, ease: 'power2.out' })

C) NUMBER COUNTER — tween a proxy object, update DOM in onUpdate
   const c = { v: 0 }; tl.to(c, { v: TARGET, duration: 2, ease: 'power2.out', onUpdate: () => el.textContent = Math.round(c.v) + suffix })

D) PULSE GLOW — scale 1→1.05→1 + box-shadow/filter intensity cycling, yoyo:true, repeat:-1
   tl.to(icon, { scale: 1.08, filter: 'drop-shadow(0 0 24px COLOR)', duration: 0.8, yoyo: true, repeat: -1, ease: 'sine.inOut' })

E) SEQUENTIAL REVEAL — each list item slides in from x:80, opacity 0, stagger 0.2s
   tl.from('.item', { x: 80, opacity: 0, stagger: 0.2, duration: 0.4, ease: 'power3.out' })

F) SCALE PUNCH — headline scales 0.7→1.05→1.0 on entry for that "pop" feel
   tl.from(headline, { scale: 0.7, opacity: 0, duration: 0.4, ease: 'back.out(2)' })

G) FLOATING PARTICLES — 3-5 small circles (10-20px) with slow infinite y-movement using yoyo:true repeat:-1, staggered starts

════════════════════════════════════════
 STEP 1 — FIND THE VISUAL VERB IN THE BLOCK
════════════════════════════════════════
Read the block. Identify the action/concept being described. Pick the SIMPLEST POSSIBLE animation that shows that idea visually:

• Action verbs ("create", "make", "build") → an object materializing/morphing/being drawn (SVG path animation, scale-up, mask reveal)
• Speed claims ("fast", "in seconds", "rapid") → time compression visual: clock spinning, bar racing, hourglass dumping, particles streaking
• Quantity claims ("more", "a lot of", "many") → multiplication: one shape splits into many, items stack up, counter ticks up
• Transformation ("turn X into Y") → literal morph from shape A to shape B (clip-path, SVG morph)
• Comparison ("better than", "vs") → split screen, both halves animate but one wins (grows bigger, brighter, faster)
• Process ("how it works", "step by step") → small icons drawn one at a time with arrows linking them — but PURE ICONS, no text labels
• Result/benefit ("you'll get", "imagine") → an empty container fills up, a pile grows, a graph rises, a face/heart/checkmark appears
• Hook/question ("do you know", "want to") → a single element pulses/glows/scales rhythmically, drawing the eye
• Numbers/stats → the number IS the hero. Sized 240-320px. Counts up. Background is just a subtle pulse.

════════════════════════════════════════
 STEP 2 — CONCRETE VISUAL TECHNIQUES
════════════════════════════════════════

PURE-VISUAL TEMPLATES (no text required):

A) MORPH SEQUENCE — one shape becomes another over time
   - SVG shape with multiple <path> elements; cross-fade between them via opacity
   - OR clip-path: from rectangle → circle → triangle (use polygon coords)
   - 0.6s per morph, 3 morphs total = 1.8s of pure visual storytelling

B) PATH DRAW (logo / icon being made)
   - <path stroke> with strokeDasharray = pathLength, animate strokeDashoffset to 0
   - Looks like a hand drawing the icon. Powerful for "create / craft / build" verbs

C) ASSEMBLY — pieces flying in to form a whole
   - 3-5 small shapes start scattered (off-screen or x-offset 200-400px)
   - They converge to assembly positions, stagger 0.15s
   - Final shape is the "result" — pulse it briefly when assembly completes

D) CASCADE / STACK — items piling up
   - Repeat the same shape 5-8 times with y-offset stagger
   - Each enters from above with bounce ease, lands on the previous one
   - Great for "muitos / many / pile of"

E) SCALE-AND-FADE — a single hero element grows from nothing
   - Start scale: 0, opacity: 0 → end scale: 1, opacity: 1, ease: 'back.out(1.4)'
   - Add a glow ring that expands behind it (ripple)
   - Use this for: "you can have / imagine / picture this"

F) PHONE / SCREEN MOCK — simplified device showing content morphing
   - SVG rounded rect 540×960px = phone frame
   - Inside: a UI block that changes (image → image, list grows, button highlights)
   - NO ACTUAL TEXT in the mock — use rounded rectangles as "fake content lines"
   - This is for tutorial/product blocks. The phone frame itself is the visual

G) NUMBER COUNTER — the digit is the entire composition
   - One number, font-size 240-320px, font-weight 900, centered
   - Counts up via gsap.to({v:0}, {v:TARGET, onUpdate})
   - Optional: thin bar/arc growing alongside, NO labels

H) PARTICLE FIELD — energy / flow / abundance
   - 12-20 small circles (8-16px) drifting upward with stagger and yoyo
   - Use brandPrimaryColor at 30-60% opacity
   - Background layer; the focal element sits on top

I) BEFORE/AFTER MORPH — split screen with motion
   - Vertical split: left side is "before" (simplified, dim, small), right is "after" (vivid, large, glowing)
   - The right side animates in or transforms; left stays static
   - 0 words required; the contrast tells the story

REMEMBER: pick ONE primary technique per composition. Combine with H (particles) for richness. Keep it CLEAN.
  - Animated underline that draws itself (brandPrimaryColor, 6px thick)
  - Optional: floating particles (technique G)

════════════════════════════════════════
 TECHNICAL REQUIREMENTS
════════════════════════════════════════
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

════════════════════════════════════════
 OUTPUT
════════════════════════════════════════
- "intent": pt-BR, one sentence: "[BLOCK_TYPE]: [what visual you built and why]"
- "text": the punchy on-screen headline, max 6 words, pulled from block text
- "htmlBody": full HTML content (elements + script)
- "rationale": 1-2 sentences pt-BR explaining the brand colors used and animation choice

Override intent/text if user provided manual values.`.trim();

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
  const groundingModels = ['gemini-3.1-pro-preview', 'gemini-3.1-flash-preview'];

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
      if (!/not found|NOT_FOUND|not supported|404/i.test(msg)) throw err;
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
