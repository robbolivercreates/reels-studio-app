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
You will receive a BRAND IDENTITY section with researched colors. These are NOT suggestions — they are MANDATORY.
- Set the background to brandBackgroundColor
- Set ALL primary text to brandTextColor
- Use brandPrimaryColor as the dominant accent (borders, highlights, glow, icons)
- Use brandSecondaryColor for supporting elements
- NEVER default to blue (#0000ff, #3b82f6, #60a5fa, or any blue shade) unless the brand IS blue
- NEVER use generic purple/violet unless the brand uses it
- If no brand colors are provided, use high-contrast dark background (#0a0a0a) with white text and a warm amber (#f59e0b) accent — NOT blue

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
 RULE #3 — RICHNESS (minimum 6 elements)
════════════════════════════════════════
Every composition MUST have AT LEAST these layers:
1. BACKGROUND — full-bleed gradient or solid using brandBackgroundColor. Add subtle radial glow in brandPrimaryColor at 15% opacity.
2. MID LAYER — decorative geometric shapes (circles, lines, dots) in brandPrimaryColor at 10-20% opacity, animated slowly (rotate, float)
3. LOGO/ICON — inline SVG icon representing the brand or concept, 120-200px, in brandPrimaryColor
4. HEADLINE TEXT — large bold text (72-120px), brandTextColor, with drop-shadow
5. SUPPORTING ELEMENT — the main visual (diagram, counter, mockup, checklist, chart) — THIS is where the content lives
6. ACCENT — a bright highlight, underline, badge, or glow in brandAccentColor that draws the eye to the key message

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
 STEP 1 — CLASSIFY THE BLOCK
════════════════════════════════════════
• TUTORIAL_STEP → phone/app mockup + animated cursor + highlighted element + step badge
• HOW_IT_WORKS → flow diagram: boxes connected by self-drawing arrows, left→right sequence
• STAT_OR_NUMBER → giant counter (technique C above) + growing ring/bar + context label
• BENEFIT_OR_RESULT → before/after split OR animated checklist with SVG checkmarks drawing themselves
• LIST_OR_TIPS → staggered cards (technique E) with number badges, icons, short labels
• CONCEPT_OR_METAPHOR → central SVG metaphor with orbiting/pulsing elements (technique D)
• HOOK_OR_CTA → scale punch headline (technique F) + minimal bold layout

════════════════════════════════════════
 STEP 2 — VISUAL PATTERNS BY TYPE
════════════════════════════════════════

TUTORIAL_STEP:
  - Phone frame: SVG rounded rect 540×960px centered, with status bar, header bar in brandPrimaryColor
  - Inside frame: simplified UI, target element has glowing animated border (brandPrimaryColor glow)
  - Animated cursor SVG moving to target with click ripple
  - Step badge: circle top-left with number, brandPrimaryColor fill

HOW_IT_WORKS:
  - 3 boxes (240×180px each) horizontally centered, connected by arrows
  - Arrow path draws itself via strokeDashoffset (technique B)
  - Each box: SVG icon + short label. Boxes enter with stagger (technique A)
  - Final box: brandPrimaryColor fill, larger scale — the "result"

STAT_OR_NUMBER:
  - Number counter technique C — font-size 160px, font-weight 900
  - Circular SVG arc (stroke-dashoffset) growing to represent the value
  - Small label above (what it measures) + large label below (context)
  - Floating particles in background (technique G)

BENEFIT_OR_RESULT:
  - Two columns: "Antes" (desaturated, small, fading) vs "Depois" (bright, large, scaling up)
  - OR: vertical checklist, each item: SVG checkmark draws itself + text slides in (techniques B+E)
  - Checkmark in brandPrimaryColor, text in brandTextColor

LIST_OR_TIPS:
  - 3-4 cards, each 900×160px, rounded 20px, bg rgba(255,255,255,0.08), border brandPrimaryColor 2px
  - Each card: number badge (brandPrimaryColor circle) + SVG icon + text
  - Enter staggered from right (technique E)
  - Active/last card: brandPrimaryColor background at 20% opacity

CONCEPT_OR_METAPHOR:
  - Central SVG 200px in brandPrimaryColor — use the brand logo SVG if provided
  - 4-6 orbiting small elements (brandSecondaryColor circles/dots) rotating around center
  - Label below: 80px bold, brandTextColor
  - Background radial glow: brandPrimaryColor at 20% opacity

HOOK_OR_CTA:
  - Full-bleed gradient background (brandBackgroundColor → slightly lighter variant)
  - Single headline, font-size 96-120px, font-weight 900, scale punch (technique F)
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
3. Return the REAL colors — not generic ones. If the block mentions Claude AI → search "Anthropic Claude brand colors" → it's #DE7356 peach/terracotta, NOT blue. If it mentions Canva → #00C4CC teal + #7D2AE7 purple. If it mentions ChatGPT → #10A37F green. If it mentions Instagram → gradient orange/pink/purple.

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
      if (parsed.brandPrimaryColor && parsed.brandBackgroundColor) return parsed;
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
    `  NO BRAND FOUND — use high-contrast dark theme`,
    `╚══════════════════════════════════════════════════════╝`,
    `brandBackgroundColor: #0a0a0a`,
    `brandTextColor: #ffffff`,
    `brandPrimaryColor: #f59e0b  ← warm amber accent`,
    `brandSecondaryColor: #78716c`,
    `brandAccentColor: #fbbf24`,
    `⚠️  DO NOT use blue. Use the amber palette above.`,
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
