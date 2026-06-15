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
import { logActualCost, calculateActualCost } from './costPredictor';
import { EDITING_PACING_RULES, MOTION_LAWS_BRIEF, EASING_DICTIONARY, CAPTION_TONES } from './editingPlaybook';
import { buildHouseStyleCss, buildHouseAtmosphereDiv, HOUSE_STYLE_PROMPT_BRIEF } from '../components/reelsStudio/motionHouseStyle';
import type { MotionConfig, FontSet } from '../components/reelsStudio/motionLibrary';
import { buildFontSetHead, FONT_SETS_PROMPT_TABLE } from '../components/reelsStudio/motionFontSets';
import { buildOverlays, OVERLAYS_PROMPT_HINT } from '../components/reelsStudio/motionOverlays';
import {
  STYLE_PRESETS,
  TEMPLATE_PRESET_IDS,
  ANIMATION_GRAMMAR_BRIEF,
  FORBIDDEN_PATTERNS,
  findStylePreset,
} from '../components/reelsStudio/motionStylePresets';

// Memory cache to avoid repeating Google Search grounding for the same brand in the same session.
export const BRAND_CACHE = new Map<string, any>();

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
  /** Actual cost in USD for generating this motion. */
  actualCostUSD?: number;
  /** Actual token count metadata. */
  actualTokens?: {
    prompt: number;
    candidates: number;
  };
}

export const getApiKey = (): string => {
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

export const getModelCandidates = (preferred?: string): readonly MotionModelId[] => {
  // Per-block override (preferred) wins; else the global localStorage choice.
  const valid = preferred && (SUPPORTED_MOTION_MODELS as readonly string[]).includes(preferred)
    ? (preferred as MotionModelId)
    : undefined;
  const selected = valid ?? readSelectedMotionModel();
  
  const allowProFallback = localStorage.getItem('ALLOW_PRO_FALLBACK') === 'true';
  
  // If Pro fallback is not allowed and the chosen model is NOT Pro, exclude it from candidates.
  // This keeps the user safe from silent $0.05/call fallbacks by accident.
  if (!allowProFallback && selected !== 'gemini-3.1-pro-preview') {
    const flashModels = SUPPORTED_MOTION_MODELS.filter(m => m !== 'gemini-3.1-pro-preview');
    const rest = flashModels.filter(m => m !== selected);
    return [selected, ...rest];
  }
  
  const rest = SUPPORTED_MOTION_MODELS.filter(m => m !== selected);
  return [selected, ...rest];
};

export const getActiveMotionModel = (): { id: MotionModelId; label: string } => {
  const id = readSelectedMotionModel();
  return { id, label: MOTION_MODEL_LABELS[id] };
};

/** Persist the user's chosen motion model (used by generation as the first
 *  candidate in the fallback chain). Surfaced inline in the Motion inspector
 *  so the model can be picked right where you generate/regenerate, not only
 *  buried in Settings. */
export const setSelectedMotionModel = (id: MotionModelId): void => {
  try { localStorage.setItem(MOTION_MODEL_STORAGE_KEY, id); } catch { /* non-fatal */ }
};

/** All models with their short labels — for building an inline model picker. */
export const MOTION_MODEL_OPTIONS: { id: MotionModelId; label: string }[] =
  SUPPORTED_MOTION_MODELS.map(id => ({ id, label: MOTION_MODEL_LABELS[id] }));

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

const SYSTEM_PROMPT = `You are a senior motion designer at a top studio (Buck, Ordinary Folk, Giant Ant, Oddfellows) designing 9:16 motion pieces for Apple keynote stings, Nike reveals, and viral Reels.

Your output is HyperFrames-compatible HTML — the BODY ONLY (everything inside the root container, plus the closing <script>). No <html>, <head>, <body>, no <div id="root"> wrapper.

The piece is CANVAS_SIZE_PLACEHOLDER, 30fps, playing for the block's duration. A narrator is speaking and the viewer HEARS every word — there are NO burned-in captions. So the motion must SHOW the idea (objects, UI, numbers, metaphors), never subtitle it: on-screen text is at most 1-3 distilled keywords, never the spoken sentence. Your motion ILLUSTRATES — it doesn't transcribe.

═══ PRINCIPLE 1 — DESIGN FROM THE IDEA, NOT A TEMPLATE ═══
Read the block. Match the COMPOSITION to its emotional shape:
- Hook/question → ONE focal object demanding attention (icon pulsing, number scaling in). Calm canvas.
- Promise/result → progression: empty→full, small→big, scattered→organized.
- List → kinetic typography OR 3-5 objects in stagger sequence.
- Comparison → split with a clear winner (the "after" bigger/brighter/glowing).
- Story → slow zoom/push, single hero element.
- Hard claim → impactful number/stat, kinetic keyword punching in.

═══ PRINCIPLE 2 — TYPOGRAPHY IS A MOTION ELEMENT ═══
Text must MOVE and carry weight; static text on a card is a slide deck.
- 1-5 words per shot, 120-280px, weight 700-900, tight letter-spacing (-2 to -5)
- Each word is a clip (<span class="word">); reveals: clip-path wipe, word stagger from y:40, scale-punch on the keyword, mask reveal
- ONE word may be highlighted (accent color / weight / self-drawing underline)

HERO TEXT — DESTILE, NÃO TRANSCREVA (1-3 palavras). The narrator speaks the full sentence and the viewer HEARS it; you put only the 2-3 keyword essence on screen. Ex: fala "esse dinheiro está indo embora se você não age" → hero "DINHEIRO INDO EMBORA" (highlight "INDO EMBORA"). NEVER write the spoken sentence verbatim — that is the #1 failure here. The VISUAL is the lead actor; text is a caption to the visual, not a replacement for it. NEVER ship text-only centered on dark bg as the dominant pattern — pair with a structural element (UI mockup, card, badge, comparison, terminal) per PRINCIPLE 9. Pure typography is for hooks/pivots only.

═══ PRINCIPLE 2.5 — LINGUAGEM E VISUAL DE 9 ANOS ═══
Every visible word and metaphor must be instantly clear to a 9-year-old; the viewer has ~1s per scene.
- Everyday words, 1-3 syllables: "usa">"utiliza", "junta">"consolida", "faz">"executa". Verbs over nouns: "PENSA" not "PENSAMENTO". Concrete over abstract: "robô" not "modelo de linguagem".
- Banned vocab → replace: otimizar→melhorar · implementar→fazer/criar · configurar→ajustar · processar→pensar/ler · analisar→olhar/estudar · automatizar→fazer sozinho · "inteligência artificial"→"a IA" · algoritmo→receita/regra · interface→tela · deploy→publicar · feedback→resposta · stakeholder→quem decide
- Brand/app names stay, paired with a concrete icon. Round numbers: "quase 1 milhão" beats "893.452".
- Ex: ❌ "Otimização do fluxo de trabalho" → ✅ "Trabalho mais rápido" · ❌ "Processamento neural" → ✅ "A IA pensa"
- VISUAL METAPHORS: imagery from a kid's world (animais, formas, rostos, mãos, lâmpadas, estrelas). AVOID corporate flowcharts, engrenagens, terminais abstratos. Anthropomorphize abstractions (the cloud = nuvem fofinha com sorriso). TEST: could a 9-year-old point and say what's happening?

═══ TYPOGRAPHY — use the HOUSE CLASSES (provided by the runtime) ═══
The wrapper injects ready classes; use them for ALL primary text (sizes/positions inline):
  .hs-title (Anton, UPPERCASE — hero headlines) · .hs-subtitle (Inter 600 — support)
  .hs-kicker (accent micro-label) · .hs-number (Space Grotesk tabular — stats)
  Legacy role classes also exist: .font-display / .font-tech / .font-body.
CONTRAST RULE: pair AT LEAST TWO roles per motion (e.g. 200px title above 28px subtitle). Single-class motions read flat.
DON'T: Anton for body text · Inter for hero · text <60px · 3+ stacked text blocks · forgetting tight letter-spacing on Anton. Fewer words sized HUGE beats more words small.

═══ PRINCIPLE 3 — VISUAL VERBS OVER LITERAL LABELS ═══
Find the verb and SHOW it: ganhar dinheiro→coins stacking/graph rising · criar rápido→path drawing itself/shapes morphing · viral→cards sliding, hearts popping, counter ticking · identidade→logomark stroke-drawing · comandos→cursor blink, ⏎ press, instant output · perder horas→clock hands whipping · transformar→morph A→B · antes/depois→split, dim left, bright right. Words ride alongside; motion is the lead actor.

═══ PRINCIPLE 4 — COMPOSITION ANATOMY ═══
Layers (top to bottom):
0-1. BACKGROUND + VIGNETTE — PROVIDED BY THE RUNTIME (wrapper injects tracks 0-1). Do NOT create backgrounds; start your elements at data-track-index 2.
2. THE HERO — the icon/morph/number/kinetic word. ONE focal element, centered ~y=880-960, 40-60% of canvas height.
3. SUPPORTING TEXT — 1 line max, above OR below the hero (never both), 96-180px, enters 0.3-0.6s after the hero.
4. ACCENT — single highlight (glow ring, underline draw, sparkle, checkmark), 0.4-0.8s then fades.
Most great compositions use the hero + ONE other layer. Subtract until every element earns its place.

═══ PRINCIPLE 4.5 — CINEMATIC DEPTH ═══
The host enables 3D (perspective:1200px on body; preserve-3d on #root). Flat = PowerPoint.
- Cards/phone-frames: transform: perspective(1400px) rotateY(-8deg) rotateX(4deg) — small angles (>15° = gimmick).
- Depth pop: gsap.from('#card', { z:-200, rotationY:-25, opacity:0, duration:0.9, ease:'expo.out' }).
- Card fans: stagger rotationY (-12,-6,0,6,12).
- Optional PROGRESS BAR (produced feel): 3px bar at bottom, track 9, tl.to width 0→100% over the FULL duration, ease:'none', opacity 0.7.
EASE LANGUAGE: reveals→'expo.out' · spring pops→'back.out(2.5)'/'elastic.out(1,0.4)' · idle drifts→'sine.inOut' · snappy text→'power4.out' · exits→'expo.in'. Don't use back.out on every entrance; mix ≥2 eases per shot.

═══ PRINCIPLE 5 — PACING: A SEQUENCE, NOT ONE ARC ═══
The #1 amateur mistake: one animation done by t=1.5s, then seconds of frozen frame.
BREAK THE BLOCK INTO BEATS: every 1.5-3s something new happens (word reveal, icon swap, number tick, morph, accent flash). Events MUST span the FULL {DURATION_SEC}s — never let the final 2s go static. Use the block text as the script: N ideas → ~N beats at roughly DURATION/N intervals.
Example, 7s block: t=0 bg drift (runs full 7s) · t=0.3 hero scale-pops · t=2.0 second element wipes in · t=4.0 swap/morph · t=5.5 accent climax · t=6.6 exit fade.
EASING by event: entrances back.out(1.4)/expo.out 0.4-0.7s · exits power3.in/expo.in 0.3-0.5s · loops sine.inOut yoyo with FINITE repeat (repeat: Math.floor(DURATION/period)-1, never -1) · punches back.out(2)/elastic 0.3-0.5s · slow zooms power1.inOut 1.5-3s · bg drift power1.inOut full length.
Verify: are there events past the halfway mark? If not, add more.

═══ PRINCIPLE 6 — BRAND COLORS ARE LAW ═══
The BRAND IDENTITY section gives EXACT hexes. Background→brandBackgroundColor · primary text→brandTextColor · dominant accent→brandPrimaryColor · support→brandSecondaryColor · hot-spot→brandAccentColor. Preset placeholders ("brandPrimaryColor") are ALWAYS replaced by these hexes.
HARD BANS (unless the brand demonstrably IS that color):
- NO purple/violet/indigo/lilac/lavender (vibrant OR pastel): #4c1d95 #5b21b6 #6d28d9 #7c3aed #8b5cf6 #a855f7 #9333ea #c084fc #1e1b4b #2e1065 #ddd6fe #e9d5ff #f3e8ff #ede9fe #c4b5fd #b8a4d4 #dda0dd
- NO magenta/fuchsia/pink/rose: #d946ef #ec4899 #f472b6 #c026d3 #db2777 #fbcfe8 #fce7f3 #fdf2f8 #f9a8d4
- NO generic blue: #0000ff #3b82f6 #60a5fa #2563eb #1d4ed8 (exception: house var(--hs-accent) provided by the runtime)
Any HSL hue 250-345° is suspect — allowed ONLY if it appears in BRAND IDENTITY AND the brand is famous for it (Twitch, Instagram, Figma, Discord). No brand colors given → use the FALLBACK palette literally.

═══ PRINCIPLE 7 — CONTRAST & READABILITY ═══
Text contrast ≥7:1 (AAA). Drop-shadow on busy backgrounds: filter:drop-shadow(0 2px 12px rgba(0,0,0,0.6)). Headlines ≥96px (phone at arm's length). Weight 700+ for anything important. Give text air — never on busy SVG patterns.

═══ PRINCIPLE 8 — REELS/TIKTOK SAFE AREA ═══
Platform UI overlays the edges: TOP 220px (status/account) · BOTTOM 380px (caption/rail/music) · SIDES 80px.
CRITICAL CONTENT lives inside the SAFE BOX: x:80-1000, y:220-1540. Decorative atmosphere may bleed. Center the hero around y=880-960.

═══ GSAP TECHNIQUES — toolkit (GSAP 3.14 loaded) ═══
Build ONE paused timeline registered on window.__timelines[compositionId] (ID from "--- COMPOSITION ID ---").

A) STAGGERED ENTRANCE: tl.from('.cluster > *', { y:60, opacity:0, scale:0.92, stagger:0.12, duration:0.5, ease:'back.out(1.4)' })
B) SVG PATH DRAW: const len=path.getTotalLength(); gsap.set(path,{strokeDasharray:len,strokeDashoffset:len}); tl.to(path,{strokeDashoffset:0,duration:0.8,ease:'power2.out'})
C) NUMBER COUNTER: const o={v:0}; tl.to(o,{v:99,duration:1.6,ease:'power2.out',onUpdate:()=>el.textContent=Math.round(o.v)})
D) PULSE GLOW (finite): tl.to(icon,{scale:1.06,filter:'drop-shadow(0 0 28px ACCENT)',duration:0.6,yoyo:true,repeat:Math.floor(DURATION/1.2)-1,ease:'sine.inOut'},0.5)
E) WORD-BY-WORD TYPE: <span class="word"> per word; tl.from('.headline .word',{y:60,opacity:0,stagger:0.06,duration:0.5,ease:'expo.out'})
F) SCALE PUNCH: tl.from('.keyword',{scale:0.7,opacity:0,duration:0.4,ease:'back.out(2)'})
G) CLIP-PATH WIPE: tl.from('.headline',{clipPath:'inset(0 100% 0 0)',duration:0.7,ease:'power4.out'})
H) MORPH: cross-fade two SVG paths (MorphSVGPlugin NOT loaded): tl.to(pathA,{opacity:0,duration:0.4},0.8); tl.from(pathB,{opacity:0,duration:0.4},0.8)
I) FLOATING PARTICLES: per particle tl.to(p,{y:'-=40',x:'+=20',duration:2+i*0.2,repeat:Math.floor(DURATION/2.5)-1,yoyo:true,ease:'sine.inOut'},0)
J) FOREGROUND DRIFT: tl.to('.hero-group',{scale:1.04,duration:DURATION,ease:'power1.inOut'},0)
K) MULTI-BEAT TYPOGRAPHY — phrase reveals chunk by chunk across the block, ~1.5-2s apart; exit the lines at DURATION-0.4 with expo.in. Best for blocks >4s with several narration beats.
L) CANVAS ATMOSPHERE/FX — rich procedural visuals (many particles, meshes) on a <canvas class="clip"> (track ≥2, width=1080 height=1920). Pre-build DETERMINISTIC data (seeded counters — NO Math.random):
   const dots=Array.from({length:80},(_,i)=>({x:(i*271)%1080,y:(i*577)%1920,phase:i*0.21}))
   Drive redraw FROM THE TIMELINE: tl.eventCallback('onUpdate',()=>draw(tl.time()))
   ⚠ NEVER requestAnimationFrame/setInterval for canvas — frozen canvas in the MP4. Only tl.eventCallback('onUpdate').
M) ICON SWAP CHAIN — 3-5 icons share one slot, one visible at a time: tl.set others opacity 0; fade/scale each in at its beat, out before the next; optionally pulse the last as climax. Best for "vários tipos / transformações".
N) VIRTUAL CAMERA — animate #root itself, ONE move per shot, ease 'expo.out'/'power3.out' (NEVER back.out on camera), duration 0.8-1.2s or full-duration drift:
   ① dolly-in: scale 1→1.06 (transformOrigin = focal point) · ② dolly-out: 1.15→1 · ③ pan: x -60→0 (≤80px) · ④ drift: x '+=20' over DURATION · ⑤ dolly-into-point: origin '70% 30%', scale 1→1.10
   Don't animate #root opacity (fights the clip system).

Combine: blocks >4s → one multi-beat structure (K or M) + atmosphere (I or L) + optional camera (N). Blocks ≤3s → simple arc (A + F + exit).

═══ PRINCIPLE 9 — UI RECREATION (no asset attached) ═══
These reels are INSTRUCTIONAL — when the text names software or describes a feature/screen/action, BUILD THE UI in HTML/CSS. Never fall back to centered typography.
DETECTION (any one is enough):
• Named app/SaaS (Canva, Claude, Figma, Notion, Instagram, ChatGPT, Slack, VS Code, Shopify, WhatsApp, YouTube, Chrome…) → build that app's UI even without an action verb.
• UI verb + UI noun (clica/toca/abre/seleciona/arrasta/digita/acessa + menu/botão/aba/tela/painel/dashboard/sidebar/modal/campo/feed/perfil…) → build the UI with the action animated.
• Implicit feature description ("tem um kit de marca", "isso aparece no feed") → build a plausible supporting UI.
WHAT TO BUILD:
① Simplified but recognisable mockup (real brand colors when known: Claude #1a1a1a+#D97706 · Figma #1e1e1e+#1abcfe · Notion white+black · VS Code #1e1e1e+#007acc; unknown → dark shell #1c1c1e + neutral accent), with window chrome/top bar and the target element rendered as a real labeled control.
② Cursor SVG (white arrow 14×20: <svg viewBox="0 0 14 20" fill="white" stroke="#333" stroke-width="1"><path d="M0 0 L0 16 L4 12 L7 19 L9 18 L6 11 L11 11 Z"/></svg>) that travels to the target (power2.inOut, 0.7s), presses (scale 0.82 for 0.08s), target flashes highlight 0.15s.
③ The acted-on element is LABELED with the exact words spoken ("clica em Projetos" → button says "Projetos").
Example — "clica em Projetos no Claude": bg panel #1a1a1a (track 2) · sidebar 180px #111 with "Claude" wordmark + 4 nav items, "Projetos" highlighted amber (track 3) · main area placeholder lines (track 4) · cursor travels and clicks (track 5).
DO NOT use placeholder rectangles labeled "App Screen". Unknown app → generic-but-plausible shell with the labeled action element.
⛔ SAFE AREA: the ENTIRE mockup stays inside the slot's safe area — full-frame: y:220-1540, x:80-1000; split slots (960px): y:80-820, x:60-1020. overflow:hidden on the container; explicit max-height.

═══ ANTI-PATTERNS ═══
× 3+ stacked text cards (slide deck) × emojis as content (use SVG icons) × default linear easing × >1.5s with nothing moving × single arc done by t=2s on a 7s block × repeat:-1 (forbidden — compute finite repeats) × text <60px × competing focal elements × transcribing the narration (the viewer hears it — SHOW the idea, don't subtitle it)

═══ TECHNICAL REQUIREMENTS ═══
1. Each element: class="clip", data-start, data-duration, data-track-index (0=back, higher=front), id="kebab-case-name" (REQUIRED — lint fails without an id on every timeline element). Media tags (<video src=…>, <img src=…>) ALSO need data-start + data-duration on the tag itself, in addition to being inside a .clip shell — without that the lint reports 'media_missing_data_start' and the render aborts.

1a. TRACK INDEX RULE (CRITICAL — render fails otherwise): every .clip element with the same data-track-index MUST have non-overlapping [data-start, data-start + data-duration] windows. The HyperFrames CLI reports "overlapping_clips_same_track" and aborts the render when two clips share a track and overlap in time. Practical rule: **each clip that is alive at the same time goes on its OWN data-track-index**. Don't bundle "node + label" or "icon + caption" or "card-bg + card-content" on the same track just because they're visually related. Tracks 0-1 are the runtime's background/vignette — START YOUR ELEMENTS AT TRACK 2 and increment (2, 3, 4, …) for every additional clip, even a 1px divider. If you have 8 clips alive across the block, use tracks 2 through 9.

2. ONE <script> at the end. Use the actual composition ID from the "--- COMPOSITION ID ---" section of your brief:
   window.__timelines = window.__timelines || {}
   const tl = gsap.timeline({ paused: true })
   window.__timelines["motion-abc123"] = tl   // ← replace with the real ID
   CRITICAL: the key MUST match the composition ID exactly — wrong key = silent black screen.
3. All tweens fit within each element's data-start to data-start+data-duration window.
4. Canvas: 1080×1920px. Absolute positioning. Sizes in px.
5. Fonts already loaded (ONLY these): "Inter" 400-900 (.font-body) · "Anton" (.font-display) · "Space Grotesk" 400-700 (.font-tech) — plus the house classes (.hs-title/.hs-subtitle/.hs-kicker/.hs-number). Combine at least TWO roles per motion.
6. GSAP 3.14 already loaded. No external URLs. No images.
7. FORBIDDEN: Date.now(), Math.random(), fetch(), setTimeout(), setInterval(), requestAnimationFrame()
8. SVG icons inline, self-contained, under 1200 chars each.

═══ OUTPUT ═══
Return JSON:
- "intent": pt-BR, one sentence — the visual concept (e.g. "Hourglass girando rápido com partículas pra ilustrar tempo perdido")
- "text": pt-BR headline on screen — 1-5 words MAX (may be empty if the visual stands alone)
- "htmlBody": full HTML (elements + the closing script registering the timeline)
- "rationale": 1-2 sentences pt-BR — the verb animated, the timing arc, why it fits

If a MOTION DIRECTION is provided (the brief's "BUILD THIS VISUAL" / "ON-SCREEN TEXT" sections), treat it as AUTHORITATIVE: build exactly that visual concept, and put exactly that (already-distilled) headline on screen — do not re-distill, expand, or replace it with the spoken sentence.`.trim();

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
  /** Per-block model override. When set (and valid), it's used as the first
   *  candidate in the fallback chain instead of the global localStorage choice.
   *  Lets each block be (re)generated with its own Gemini model. */
  preferredModel?: string;
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
  /**
   * When true, generates a motion graphic designed as a SCREEN-BLEND OVERLAY
   * over an existing video (not a full-frame composition). The motion uses
   * pure black (#000000) background so screen-blend makes it disappear and
   * only the foreground elements (text, icons, badges) remain visible over the
   * user's talking-head video. Activates the OVERLAY CONSTRAINT section of the
   * system prompt. Use with `motionLayer: 'overlay'` or `'fullscreen'`.
   */
  overlayMode?: boolean;
  /**
   * HyperFrames lint error from a previous generation attempt.
   * When provided, Gemini is shown the exact lint errors and asked to produce
   * corrected HTML in its next attempt. Used by the self-correction retry loop —
   * never set by callers outside the retry logic.
   */
  lintError?: string;
  /**
   * Pre-filled template variable values from the template router
   * (routeTemplateForBlock). When present for a template preset, the
   * variable-extraction Gemini call is skipped — the router already filled
   * them in the same call that selected the template.
   */
  templateVars?: Record<string, string>;
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
  const cacheKey = reelContext?.projectName ? `proj_${reelContext.projectName}` : `text_${blockText.slice(0, 100)}`;
  if (BRAND_CACHE.has(cacheKey)) {
    console.log('[motion] Brand research cache HIT for key:', cacheKey);
    return BRAND_CACHE.get(cacheKey)!;
  }

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
      
      // LOG COST
      logActualCost('Brand Research Grounding', model, response.usageMetadata, 1);

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

      BRAND_CACHE.set(cacheKey, parsed);
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

// ─── Template preset handler ─────────────────────────────────────────────────

/** Dispatch a template preset to its builder, fill vars, apply brand palette. */
async function _dispatchTemplateBuilder(
  input: GenerateMotionInput,
  vars: Record<string, string>,
): Promise<GenerationOutput> {
  const T = await import('./motionTemplates');
  let out: GenerationOutput;
  switch (input.presetId) {
    case 'stat-counter':        out = T.buildStatCounter(input, vars); break;
    case 'typewriter-terminal': out = T.buildTypewriterTerminal(input, vars); break;
    case 'imessage-notif':      out = T.buildImessageNotification(input, vars); break;
    case 'audio-waveform':      out = T.buildAudioWaveform(input, vars); break;
    case 'app-icon-launcher':   out = await T.buildAppIconLauncher(input, vars); break;
    case 'wastebasket-trash':   out = await T.buildWastebasketTrash(input, vars); break;
    case 'toggle-flip':         out = T.buildToggleFlip(input, vars); break;
    case 'progress-bar':        out = T.buildProgressBar(input, vars); break;
    case 'apple-maps-route':    out = T.buildAppleMapsRoute(input, vars); break;
    case 'claude-bloom-steps':  out = await T.buildClaudeBloomSteps(input, vars); break;
    default:                    out = T.buildStatCounter(input, vars); break;
  }
  // Overlay mode (screen-blend over footage): pure-black canvas, no bg
  // pattern. Applied first — overrides any light-mode/brand background.
  if (input.overlayMode) {
    out.htmlBody = T.applyOverlayMode(out.htmlBody, input.presetId);
    return out;
  }
  // Light/dark toggle first, then brand palette (brand wins when both exist).
  out.htmlBody = T.applyColorMode(out.htmlBody, input.presetId, input.motionColorMode);
  const brand = input.existingBrand;
  if (brand) {
    out.htmlBody = T.applyBrandPalette(out.htmlBody, input.presetId, {
      bg: brand.brandBackgroundColor,
      text: brand.brandTextColor,
      accent: brand.brandPrimaryColor,
    });
  }
  return out;
}

async function _buildTemplateHtml(input: GenerateMotionInput): Promise<GenerationOutput> {
  const { TEMPLATE_VARIABLE_SCHEMAS } = await import('./motionTemplates');
  const schema = TEMPLATE_VARIABLE_SCHEMAS[input.presetId] ?? [];

  // Pre-filled vars (from the template router) skip the extraction call entirely.
  if (input.templateVars && Object.keys(input.templateVars).length > 0) {
    return _dispatchTemplateBuilder(input, input.templateVars);
  }

  // No variables to fill — build directly (audio-waveform).
  if (schema.length === 0) {
    return _dispatchTemplateBuilder(input, {});
  }

  // Ask Gemini to fill ONLY the variable values — same model chain + cost
  // logging as the main generator, just a much smaller prompt.
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const varList = schema.map(v =>
    `- ${v.name} (${v.required ? 'obrigatório' : 'opcional'}): ${v.description}. Exemplo: "${v.example}"`
  ).join('\n');
  const prompt = [
    `Bloco do script de um Reel: "${input.blockText}"`,
    `Template visual escolhido: ${input.presetId}`,
    '',
    'Preencha os valores das variáveis abaixo baseado no conteúdo do bloco.',
    'Os textos devem estar na MESMA LÍNGUA do bloco. Seja fiel ao conteúdo — não invente números ou fatos.',
    '',
    'Variáveis:',
    varList,
    '',
    'Responda SOMENTE com JSON válido:',
    `{${schema.map(v => `"${v.name}":"..."`).join(',')}}`,
  ].join('\n');

  let vars: Record<string, string> = {};
  let lastErr: unknown;
  for (const model of getModelCandidates(input.preferredModel)) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 1024 },
      });
      logActualCost('Motion Template Vars', model, response.usageMetadata, 0);
      const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
      vars = JSON.parse(raw.replace(/```json|```/g, '').trim());
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /not found|NOT_FOUND|not supported|404|503|UNAVAILABLE|overload|RESOURCE_EXHAUSTED|429|500|INTERNAL/i.test(msg);
      if (!retryable) break;
    }
  }
  if (lastErr) {
    console.warn('[motionTemplates] variable extraction failed, using template defaults:', lastErr);
  }
  return _dispatchTemplateBuilder(input, vars);
}

// ─── Template router — LLM picks the best template for a block ──────────────

export interface TemplateRouteResult {
  templateId: string;
  vars: Record<string, string>;
  rationale: string;
}

/**
 * One small Gemini call that decides whether any motion-pack template fits the
 * block AND fills its variables in the same shot. Returns null when no
 * template fits — caller falls back to the freeform Gemini HTML generator.
 *
 * Used by the auto-pipeline (from-scratch creation). NOT used when the user
 * explicitly picked a preset in the modal — explicit choice always wins.
 */
export const routeTemplateForBlock = async (input: {
  blockText: string;
  durationSec: number;
  preferredModel?: string;
  /** True when the motion does NOT own the whole frame (float over a person,
   *  or a split half). Motion-pack templates are full-frame DESIGNS — giant
   *  titles, centered grids — so they are only routable when the motion is
   *  full-frame replace. Anything else gets freeform generation, which
   *  respects the face-safe zone / split canvas. */
  overlayContext?: boolean;
}): Promise<TemplateRouteResult | null> => {
  // Templates are geometrically full-frame: routing one into a float would
  // plaster a 1080×1920 layout over the speaker's face (the "Ferramenta
  // gigante" bug). Freeform handles those contexts.
  if (input.overlayContext) return null;

  const { TEMPLATE_SELECTION_CATALOG, TEMPLATE_VARIABLE_SCHEMAS } = await import('./motionTemplates');
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const availableTemplates = TEMPLATE_SELECTION_CATALOG;

  const catalog = availableTemplates.map(t => {
    const schema = TEMPLATE_VARIABLE_SCHEMAS[t.id] ?? [];
    const varDesc = schema.length > 0
      ? ` Variáveis: ${schema.map(v => `${v.name} (${v.description})`).join('; ')}`
      : ' (sem variáveis)';
    return `- "${t.id}": ${t.whenToUse}${varDesc}`;
  }).join('\n');

  const prompt = [
    'Você é um diretor de motion graphics para Reels. Para o bloco de script abaixo, decida se algum dos templates da biblioteca encaixa PERFEITAMENTE no conteúdo. Seja conservador: escolha um template apenas quando o bloco pede exatamente aquele visual; na dúvida, responda null.',
    '',
    input.overlayContext
      ? 'CONTEXTO: o motion vai FLUTUAR sobre um vídeo real de talking-head via screen-blend — elementos compactos e claros, nunca cobrindo o centro do frame onde está o rosto.'
      : '',
    `Bloco (${input.durationSec.toFixed(0)}s de fala): "${input.blockText}"`,
    '',
    'Biblioteca de templates:',
    catalog,
    '',
    'Se um template encaixar, preencha TODAS as variáveis dele com base no conteúdo do bloco (mesma língua do bloco, fiel aos fatos — não invente números).',
    '',
    'Responda SOMENTE com JSON válido:',
    '{"templateId": "<id ou null>", "variables": {"NOME": "valor", ...}, "rationale": "<1 frase explicando>"}',
  ].filter(Boolean).join('\n');

  for (const model of getModelCandidates(input.preferredModel)) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 1536 },
      });
      logActualCost('Motion Template Router', model, response.usageMetadata, 0);
      const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()) as {
        templateId?: string | null;
        variables?: Record<string, string>;
        rationale?: string;
      };
      const validIds = availableTemplates.map(t => t.id);
      if (!parsed.templateId || !validIds.includes(parsed.templateId)) return null;
      return {
        templateId: parsed.templateId,
        vars: parsed.variables ?? {},
        rationale: parsed.rationale ?? '',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /not found|NOT_FOUND|not supported|404|503|UNAVAILABLE|overload|RESOURCE_EXHAUSTED|429|500|INTERNAL/i.test(msg);
      if (!retryable) {
        console.warn('[motion/router] template routing failed:', msg);
        return null;
      }
    }
  }
  return null;
};

// ─── Main HTML generator ─────────────────────────────────────────────────────

export const generateMotionHtml = async (input: GenerateMotionInput): Promise<GenerationOutput & { brand?: BrandResearch }> => {
  // ── CENTRAL TEMPLATE GATE ──
  // Templates (and the native claude-ui doc) are full-frame 1080×1920
  // DESIGNS — giant titles, centered grids. Composited as a float or split
  // they plaster a full-screen layout over the speaker's face (the
  // "Ferramenta gigante" bug). No matter which path requested it (router,
  // director, effect-detector seed, modal regen with a stale presetId),
  // anything that isn't full-frame 'replace' falls back to freeform, which
  // authors inside the face-safe zone.
  const isFullFrame = !input.motionLayer || input.motionLayer === 'replace';
  if (!isFullFrame && (input.presetId === 'claude-ui' || TEMPLATE_PRESET_IDS.includes(input.presetId))) {
    console.warn('[motion] template', input.presetId, 'requested for layer', input.motionLayer, '— full-frame design over a person; falling back to freeform');
    input = { ...input, presetId: 'bold-pop', templateVars: undefined };
  }

  // Claude UI preset — native HTML, no Gemini call needed.
  if (input.presetId === 'claude-ui') {
    return _buildClaudeUiHtml(input);
  }

  // Motion-pack templates — static HTML + small Gemini variable fill.
  if (TEMPLATE_PRESET_IDS.includes(input.presetId)) {
    return _buildTemplateHtml(input);
  }

  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const preset = findStylePreset(input.presetId);

  // If the reel already has a brand identity (from the first motion), reuse it
  // — every motion in the same reel must share the same palette/style.
  //
  // Brand RESEARCH (Gemini + Google Search grounding, 2-3× the cost of a
  // normal call) is OFF by default: its outputs were superseded by strictly
  // better local sources — the REAL logo (Clearbit/iTunes via __BRAND_LOGO__)
  // and the official KNOWN_BRAND_COLORS map. The compact brand below feeds
  // the same brandSection without any extra API call. Re-enable via Settings
  // (localStorage BRAND_RESEARCH_ENABLED='true') for obscure brands.
  const brandResearchEnabled = (() => {
    try { return localStorage.getItem('BRAND_RESEARCH_ENABLED') === 'true'; } catch { return false; }
  })();
  const brandPromise: Promise<BrandResearch | null> = input.existingBrand
    ? Promise.resolve(input.existingBrand)
    : brandResearchEnabled
      ? researchBrand(ai, input.blockText, input.reelContext)
      : Promise.resolve(null);

  // REAL logo for mentioned brands (Canva, Notion, …): fetched from
  // Clearbit/iTunes in PARALLEL with generation. The model never sees the
  // data URI — it emits the short __BRAND_LOGO__ token (same proven pattern
  // as __CREATOR_AVATAR__) and we substitute the real image post-generation.
  // Without this, only templates got real logos; the freeform path let
  // Gemini draw a fake geometric "C".
  const { detectKnownBrand, fetchKnownBrandLogo, getKnownBrandColors } = await import('./logoFetchService');
  const mentionedBrand = detectKnownBrand(input.blockText);
  const brandLogoPromise: Promise<string | null> = mentionedBrand
    ? fetchKnownBrandLogo(mentionedBrand).catch(() => null)
    : Promise.resolve(null);
  const mentionedBrandColors = mentionedBrand ? getKnownBrandColors(mentionedBrand.name) : null;

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

  // Wait for brand research (or build the compact local brand: when research
  // is off and a KNOWN brand is mentioned, the official KNOWN_BRAND_COLORS +
  // the real logo via __BRAND_LOGO__ feed the same brandSection — zero API).
  const researched = await brandPromise;
  const modeTokens = input.motionColorMode === 'light'
    ? { bg: '#FAFAF8', text: '#1d1d1f' }
    : { bg: '#0a0a0c', text: '#f5f5f5' };
  const brand: BrandResearch | null = researched ?? (mentionedBrand ? {
    topic: mentionedBrand.name.charAt(0).toUpperCase() + mentionedBrand.name.slice(1),
    brandPrimaryColor: mentionedBrandColors?.[0] ?? '#60A5FA',
    brandSecondaryColor: mentionedBrandColors?.[1] ?? mentionedBrandColors?.[0] ?? '#2563EB',
    brandAccentColor: mentionedBrandColors?.[2] ?? mentionedBrandColors?.[0] ?? '#60A5FA',
    brandBackgroundColor: modeTokens.bg,
    brandTextColor: modeTokens.text,
    logoSvg: '', // real logo arrives via the __BRAND_LOGO__ token substitution
    brandFacts: [],
    visualStyle: `Official ${mentionedBrand.name} accent palette over the house canvas`,
  } : null);
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
  // Mode overrides — COMPACT since the house wrapper now owns canvas + vars
  // (--hs-bg/--hs-text are already mode-correct). The only remaining job is
  // flipping stale hexes inside preset CSS examples.
  const lightModeSection = (input.motionColorMode === 'light' && preset.bgType === 'dark' && !input.overlayMode) ? [
    `☀️ LIGHT MODE (user setting). The wrapper canvas/vars are ALREADY LIGHT`,
    `(--hs-bg=#FAFAF8, --hs-text=#1d1d1f). Preset CSS examples below may carry`,
    `stale DARK hexes — translate them: dark canvases/cards → transparent or`,
    `rgba(255,255,255,0.92) cards with 1px rgba(0,0,0,0.08) borders; white text`,
    `→ var(--hs-text); dark vignettes and white text-glows → remove. Keep brand`,
    `accents as-is. Final audit: never white-on-white text. Bright, airy, Apple.`,
    '',
  ].join('\n') : '';

  const darkModeSection = (input.motionColorMode === 'dark' && preset.bgType === 'light') ? [
    `🌙 DARK MODE (user setting). The wrapper canvas/vars are ALREADY DARK`,
    `(--hs-bg=#0a0a0c, --hs-text=#f5f5f5). Preset "${preset.label}" carries stale`,
    `LIGHT hexes — translate them: light canvases/cards → transparent or`,
    `rgba(255,255,255,0.06); near-black text → var(--hs-text); black drop-shadows`,
    `→ remove. Keep brand accents as-is. Final audit: never dark-on-dark text.`,
    `Dark, focused, cinematic.`,
    '',
  ].join('\n') : '';

  // ─── Brand chrome (persistent visual identity layer) ──────────────────
  // After the FIRST motion of a reel, every subsequent motion gets a small
  // section instructing Gemini to include a faint always-on chrome layer on
  // track 0: a subtle hex mesh, a vignette, a 1-2px brand-coloured frame.
  // This makes the reel feel cohesive instead of every block reinventing its
  // own background. We only inject this when `isReusedBrand` is true so the
  // first motion stays clean (it sets the visual tone for the rest).
  // Brand chrome — RETIRED. Reel-to-reel cohesion is now provided
  // deterministically by the house atmosphere the wrapper injects (same
  // canvas, glow and vignette on every motion). Asking the model to also
  // paint a chrome layer cost ~350 tokens/call and would collide with the
  // wrapper's track-0/1 atmosphere.
  const brandChromeSection = '';
  void isReusedBrand;

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
    // overlay — two physical duals by the reel's color mode:
    //   dark  → black canvas + SCREEN blend (black = transparent, bright content)
    //   light → white canvas + MULTIPLY blend (white = transparent, dark content)
    const ovLight = input.motionColorMode === 'light';
    const ovBg = ovLight ? '#FFFFFF' : '#000000';
    const ovBlend = ovLight ? 'MULTIPLY' : 'SCREEN';
    const ovKeep = ovLight ? 'PURE WHITE #FFFFFF' : 'pure black #000000';
    return [
      `╔══════════════════════════════════════════════════════╗`,
      `  CANVAS SLOT — FLOATING OVERLAY (mobile vertical short-form)`,
      `╚══════════════════════════════════════════════════════╝`,
      `This composition floats over a talking presenter in 9:16 vertical video (Reels/TikTok/Shorts).`,
      `Think: Submagic-style caption card, Hormozi pop-text, floating data card centered over the lower-mid frame.`,
      `NOT a broadcast TV lower-third (those occupy the bottom 20% — but the bottom 15-20% of mobile vertical`,
      `video is OCCLUDED by platform UI: likes, comments, caption rail, progress bar).`,
      `Composited with ${ovBlend} blend, so ${ovBg} backgrounds become transparent.`,
      ``,
      `DESIGN RULES — FLOATING OVERLAY:`,
      `• Background MUST be ${ovKeep} — those pixels become transparent under ${ovBlend} blend`,
      `• ALL primary content lives in y:1114–1536 (the floating-card zone, 22% height of the canvas)`,
      `• y:0–1100 (top 57%) MUST be ${ovKeep} — that's where the presenter's face/chest live; nothing visible there`,
      `• y:1536–1920 (bottom 20%) MUST be ${ovKeep} — that's the platform UI occlusion zone, anything there gets hidden by the app chrome on upload`,
      ovLight
        ? `• Text: deep graphite #1d1d1f or rich saturated brand colors, bold sans — DARK-ON-LIGHT ONLY: multiply can only DARKEN, so white/pale fills VANISH. The app composites a soft WHITE scrim (with a subtle grid) behind this overlay; design dark content on white. Never light/pastel fills as the primary container.`
        : `• Text: white or bright brand color, bold sans, strong drop shadow so it reads over the moving presenter behind`,
      ovLight ? '' : [
        `• LIGHT-ON-DARK ONLY — the screen blend can only LIGHTEN: mid-gray or dark fills VANISH over bright`,
        `  footage. The app composites a soft dark scrim behind this overlay, so design bright content on black:`,
        `  pure-white / vivid brand colors with a strong glow (text-shadow), never dark card backgrounds as the`,
        `  primary container (they read on dark preview but disappear over a white wall).`,
      ].join('\n'),
      `• Energy: a single hero element (headline / stat / label) — NOT a dense composition. Mobile = one idea per overlay.`,
      `• NO atmospheric gradients/glows outside y:1114–1536 — they'd ${ovLight ? 'darken' : 'brighten'} the face or get clipped`,
      ``,
      `FACE RULES (from the motion-pack guide — a real person is talking behind this overlay):`,
      `• "If my face is in the video: place graphics in the lower-half ONLY, below my chin."`,
      `• "Logos that fly in should arc through open space, never cross my face" — entrance paths`,
      `  must travel through the lower half (slide up from y:1920 or in from the sides at y>1100),`,
      `  NEVER descend through the center of the frame.`,
      `• "IG Reel top 220px: reserved for handle/follow button — keep graphics out."`,
      `• "IG Reel bottom 420px: reserved for caption/like/comment — keep graphics out."`,
      ``,
      `📐 SAFE AREA (floating overlay card, 1080×1920):`,
      `  Primary content: x:80–1000, y:1114–1536 (the mobile-safe floating zone)`,
      `  ${ovLight ? 'White-only zones (KEEP PURE WHITE)' : 'Black-only zones (KEEP PURE BLACK)'}:`,
      `    • y:0–1100 (top — presenter zone)`,
      `    • y:1536–1920 (bottom — platform UI occlusion zone)`,
      `  Soft fade buffer: 40px (~y:1080–1120 and ~y:1500–1540) — atmosphere/particles only, no text.`,
    ].filter(Boolean).join('\n');
  })();

  // Atmosphere — the WRAPPER owns it now (house style). buildFullHtmlDoc
  // injects the ready-made track-0 background + track-1 vignette (steel glow
  // on dark, line-grid + accent wash on light). The model only does
  // foreground, which cuts ~700 prompt tokens AND the output tokens it used
  // to spend re-painting canvases. Float keeps its pure-black mandate.
  const atmosphereSection = input.overlayMode ? [
    `╔══════════════════════════════════════════════════════╗`,
    `  🎨 ATMOSPHERE — FLOATING OVERLAY: NONE.`,
    `╚══════════════════════════════════════════════════════╝`,
    `This composition is blended over real footage AND the user can slide it`,
    `vertically. Any full-frame glow/gradient/vignette/grain creates a VISIBLE`,
    `SEAM at the frame edge when repositioned, and tints the speaker's face.`,
    `Therefore:`,
    input.motionColorMode === 'light'
      ? `• Track 0 background: <div style="position:absolute; inset:0; background:#FFFFFF;"></div> — pure white, NOTHING else.`
      : `• Track 0 background: <div style="position:absolute; inset:0; background:#000000;"></div> — pure black, NOTHING else.`,
    `• NO radial-gradient atmospheres, NO vignette pass, NO dot grids, NO grain.`,
    `• Glow is allowed ONLY as a tight box-shadow/halo hugging the card itself`,
    `  (fully contained inside y:1064–1586) — never reaching the canvas edges.`,
    ``,
  ].filter(Boolean).join('\n') : [
    `🎨 ATMOSPHERE: provided by the runtime. The wrapper already injects the`,
    `track-0 background + track-1 vignette (house style, mode-correct). Do NOT`,
    `create any background, canvas-wide gradient, grid, vignette or grain — `,
    `start your elements at data-track-index="2". Foreground only.`,
    ``,
  ].join('\n');

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
        `avatar: the user HAS a profile photo. Put it in an <img> INSIDE the profile`,
        `circle, with the src set EXACTLY to this placeholder token — the runtime swaps`,
        `in the real photo AFTER generation. Do NOT paste a data URL. Do NOT invent a`,
        `URL. Do NOT output any base64. Use the token literally:`,
        `    <img src="__CREATOR_AVATAR__" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />`,
        `(the literal token is: __CREATOR_AVATAR__ )`,
      ].join('\n')
      : `avatar: (none — use a CSS gradient placeholder for the avatar circle, no <img>)`,
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

  // Overlay mode: the motion sits OVER a real talking-head video via blend.
  // Dark reel → black bg + SCREEN (bright content floats). Light reel →
  // white bg + MULTIPLY (dark content floats — the "float claro").
  const overlayConstraintSection = input.overlayMode ? (input.motionColorMode === 'light' ? [
    `╔══════════════════════════════════════════════════════╗`,
    `  🎬 OVERLAY MODE (CLARO) — multiply-blend over talking-head video`,
    `╚══════════════════════════════════════════════════════╝`,
    ``,
    `OVERLAY CONSTRAINT (OBRIGATÓRIO — não ignorar):`,
    `• Background: BRANCO PURO #FFFFFF. NENHUM gradiente, partícula, dot-grid,`,
    `  vinheta ou grain. O track-0 background clip DEVE ser apenas #FFFFFF sólido.`,
    `• Apenas elementos FOREGROUND em cores ESCURAS/saturadas (grafite #1d1d1f,`,
    `  azuis/verdes/vermelhos PROFUNDOS): texto, ícones, badges, números, cards`,
    `  isolados. Nada que preencha >40% da tela.`,
    `• Por quê: o branco vai SUMIR via multiply-blend no renderer — o vídeo real`,
    `  fica visível atrás. Elementos escuros flutuam sobre o apresentador, com um`,
    `  scrim CLARO (faixa branca com grade sutil) composto por trás pelo app.`,
    `• NUNCA elementos claros/pastel (desaparecem no multiply). Sem text-shadow claro.`,
    `• Composição parcial: deixe espaço generoso nos lados e topo pro rosto aparecer.`,
    `• NÃO use: background-color diferente de #FFF, backdrop-filter, opacidade de fundo.`,
    ``,
    EDITING_PACING_RULES,
    ``,
  ].join('\n') : [
    `╔══════════════════════════════════════════════════════╗`,
    `  🎬 OVERLAY MODE — screen-blend over talking-head video`,
    `╚══════════════════════════════════════════════════════╝`,
    ``,
    `OVERLAY CONSTRAINT (OBRIGATÓRIO — não ignorar):`,
    `• Background: PRETO PURO #000000. NENHUM gradiente, nenhuma partícula de fundo,`,
    `  nenhum atmosphere-bake, NENHUM dot-grid, NENHUMA vinheta, NENHUM grain-overlay.`,
    `  O track-0 background clip DEVE ser apenas #000000 sólido.`,
    `• Apenas elementos FOREGROUND em cores CLARAS (branco, cores vivas, amarelo, ciano…):`,
    `  texto, ícones, badges, números, cards isolados. Nada que preencha >40% da tela.`,
    `• Por quê: o preto vai SUMIR via screen-blend no renderer — o vídeo real do usuário`,
    `  fica visível atrás. Elementos claros flutuam sobre o rosto do apresentador.`,
    `• Composição parcial: deixe espaço generoso nos lados e topo pro rosto aparecer.`,
    `• Drop-shadow em texto é bem-vindo (ajuda contraste sobre o vídeo de fundo).`,
    `• NÃO use: background-color diferente de #000, backdrop-filter, opacidade de fundo.`,
    ``,
    EDITING_PACING_RULES,
    ``,
  ].join('\n')) : '';

  // Real-logo token section — only when a known brand is mentioned. The data
  // URI never passes through the model (it would truncate/corrupt it); the
  // token is substituted in code after generation.
  const brandLogoSection = mentionedBrand ? [
    `╔══════════════════════════════════════════════════════╗`,
    `  🏷 REAL BRAND ASSETS — ${mentionedBrand.name.toUpperCase()}`,
    `╚══════════════════════════════════════════════════════╝`,
    `The runtime has the REAL ${mentionedBrand.name} logo. Wherever the design`,
    `shows the ${mentionedBrand.name} logo/icon, emit EXACTLY:`,
    `  <img src="__BRAND_LOGO__" alt="${mentionedBrand.name}" style="width:..;height:..;border-radius:22%;object-fit:cover;">`,
    `(pick the size/position; the runtime swaps __BRAND_LOGO__ for the real image).`,
    `NEVER draw a fake/approximate logo with SVG paths or letters — the real`,
    `asset always wins. Use the token at most ONCE unless the design truly`,
    `needs repeats.`,
    ``,
    `🎨 BRAND PALETTE LOCK (MANDATORY — the composition is ABOUT ${mentionedBrand.name}):`,
    mentionedBrandColors
      ? [
          `  Base: black canvas + white/off-white text. Accents: ONLY the official`,
          `  ${mentionedBrand.name} colors → ${mentionedBrandColors.join(', ')}.`,
          `  Glows, highlights, buttons, keyword tints, progress fills: pick from`,
          `  these accents. NO unrelated reds/blues/greens — a random palette next`,
          `  to the real logo reads off-brand and amateur.`,
        ].join('\n')
      : [
          `  Base: black canvas + white/off-white text + ONE accent color — the`,
          `  brand's official primary (use the real one you know; if unsure, a`,
          `  neutral cool accent). Never mix multiple unrelated hues.`,
        ].join('\n'),
    ``,
  ].join('\n') : '';

  const userBrief = [
    overlayConstraintSection,
    HOUSE_STYLE_PROMPT_BRIEF,
    '',
    brandLogoSection,
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
    input.intent?.trim() ? `--- MOTION DIRECTION — BUILD THIS VISUAL (authoritative) ---\n${input.intent.trim()}\nThis is WHAT to show; apply all the craft rules (animation, brand colors, safe area) to realise it. Do NOT just write it as text.\n` : '',
    input.text?.trim() ? `--- ON-SCREEN TEXT — USE EXACTLY (already distilled, ≤3 words; do not expand into the sentence) ---\n${input.text.trim()}\n` : '',
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
    MOTION_LAWS_BRIEF,
    '',
    EASING_DICTIONARY,
    '',
    CAPTION_TONES,
    '',
    FORBIDDEN_PATTERNS,
    // Self-correction: when a previous generation attempt produced HTML that failed
    // HyperFrames lint, include the exact errors so Gemini can avoid repeating them.
    input.lintError ? [
      '',
      '⚠️ LINT CORRECTION REQUIRED — your previous HTML failed HyperFrames validation:',
      input.lintError,
      'Fix ALL of the above errors in your new output. Do NOT repeat them.',
    ].join('\n') : '',
  ].filter(Boolean).join('\n');

  // Float overlays author at FULL 1080×1920 like everything else — the
  // overlay slotSection constrains content to the face-safe card zone and the
  // screen-blend composite makes the black canvas transparent. A band-sized
  // canvas (420px) was tried twice and failed twice: the model gravitates to
  // 1920-space coordinates no matter what the canvas line says, dropping all
  // content below the crop → black MP4s.
  const canvasSize = input.canvasAspect === '4:5' ? '1080×1350' : '1080×1920';
  const systemPromptForRequest = SYSTEM_PROMPT
    .replace('CANVAS_SIZE_PLACEHOLDER', canvasSize)
    // {DURATION_SEC} appears in the timeline-planning rule. Without this
    // substitution the model receives a literal placeholder and falls
    // back to the bundled 4s/7s examples — for 10s+ blocks it then
    // clusters all events early and leaves a dead tail at the end.
    .replace(/\{DURATION_SEC\}/g, input.durationSec.toString());

  // Audit: mode + PROMPT SIZE (token-diet proof — compare before/after).
  console.log('[motion/cost] prompt chars=', systemPromptForRequest.length + userBrief.length,
    '(system', systemPromptForRequest.length, '+ brief', userBrief.length, ')',
    '· mode=', input.motionColorMode,
    '· preset=', preset.id,
    '· appMention=', appMention?.app ?? 'none');
  let lastError: unknown;
  for (const model of getModelCandidates(input.preferredModel)) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ text: systemPromptForRequest }, { text: userBrief }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
          temperature: 0.65,
          // Heavy compositions (line-art SVG presets like animado-notion) plus the
          // mandatory window.__timelines registration script can exceed the model's
          // default output cap, which truncates the HTML mid-tag — producing broken
          // SVG (width="500</div>) and a cut-off registration script that fails the
          // HyperFrames lint with [missing_timeline_registry]. Give it ample room.
          // Cap, not target — typical motions emit 3-8k output tokens; the
          // heaviest compositions stay well under 24k now that the wrapper
          // owns backgrounds (the model no longer paints canvases).
          maxOutputTokens: 24576,
          // gemini-3-flash / 3.5-flash are THINKING models: reasoning tokens are
          // billed against the SAME output budget. Left unbounded, thinking ate
          // most of the budget and the HTML came out truncated at ~6KB (no
          // timeline registration). Cap thinking so the HTML always has room.
          thinkingConfig: { thinkingBudget: 4096 },
        },
      });

      // LOG COST
      logActualCost('Motion Generation', model, response.usageMetadata, 0);
      const usage = response.usageMetadata;
      const actualCostUSD = usage
        ? calculateActualCost(model, usage.promptTokenCount, usage.candidatesTokenCount, 0, 0)
        : 0;

      // If the model ran out of output budget, the JSON/HTML is truncated and
      // unusable — skip to the next candidate instead of feeding broken HTML to
      // the renderer (which then fails the lint or throws SVG attribute errors).
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason === 'MAX_TOKENS') {
        console.warn('[motion] model', model, 'hit MAX_TOKENS — output truncated, trying next candidate');
        lastError = new Error('Output truncado (MAX_TOKENS) — composição muito grande pra este modelo.');
        continue;
      }
      const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (!raw) continue;
      let parsed: GenerationOutput;
      try { parsed = JSON.parse(raw); }
      catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) continue;
        try { parsed = JSON.parse(match[0]); }
        catch {
          console.warn('[motion] model', model, 'returned unparseable/truncated JSON — trying next candidate');
          lastError = new Error('Resposta truncada (JSON inválido).');
          continue;
        }
      }
      // Completeness guard: every GSAP motion MUST register its timeline on
      // window.__timelines[compositionId] at the end of the HTML. If that's
      // missing, the HTML was truncated mid-generation (thinking ate the budget,
      // model stopped early, etc.) — feeding it to the renderer just fails the
      // HyperFrames lint with [missing_timeline_registry] and writes broken HTML
      // to disk. Skip to the next model instead.
      if (parsed.htmlBody && !parsed.htmlBody.includes('__timelines')) {
        console.warn('[motion] model', model, 'produced HTML without window.__timelines (incomplete/truncated) — trying next candidate · len=', parsed.htmlBody.length);
        lastError = new Error('HTML incompleto — geração truncada (sem registro de timeline).');
        continue;
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

        // Inject the creator avatar deterministically. The base64 data URL must
        // NEVER pass through the model — asked to copy a long opaque string, it
        // truncates/corrupts it, yielding a broken-image icon on the follow card.
        // Instead the model emits a short __CREATOR_AVATAR__ token and we swap in
        // the real photo here, in code.
        if (input.userIdentity?.avatarDataUrl && parsed.htmlBody.includes('__CREATOR_AVATAR__')) {
          parsed.htmlBody = parsed.htmlBody.split('__CREATOR_AVATAR__').join(input.userIdentity.avatarDataUrl);
          console.log('[motion] injected creator avatar into __CREATOR_AVATAR__ placeholder');
        } else if (parsed.htmlBody.includes('__CREATOR_AVATAR__')) {
          // Model used the token but we have no photo — swap in a 1x1 transparent
          // pixel so the <img> never renders as a broken-image icon.
          const TRANSPARENT_PX = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
          parsed.htmlBody = parsed.htmlBody.split('__CREATOR_AVATAR__').join(TRANSPARENT_PX);
        }

        // Inject the REAL brand logo (Clearbit/iTunes, fetched in parallel) —
        // same deterministic-token pattern as the creator avatar above.
        if (parsed.htmlBody.includes('__BRAND_LOGO__')) {
          const logoUri = await brandLogoPromise;
          if (logoUri) {
            parsed.htmlBody = parsed.htmlBody.split('__BRAND_LOGO__').join(logoUri);
            console.log('[motion] injected REAL brand logo for', mentionedBrand?.name);
          } else {
            // Fetch failed — letter tile so the <img> never shows broken.
            const letter = (mentionedBrand?.name ?? 'x').slice(0, 1).toUpperCase();
            const tile = `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" rx="44" fill="#2563EB"/><text x="100" y="136" font-family="Arial,Helvetica,sans-serif" font-size="110" font-weight="800" fill="#fff" text-anchor="middle">${letter}</text></svg>`)}`;
            parsed.htmlBody = parsed.htmlBody.split('__BRAND_LOGO__').join(tile);
            console.warn('[motion] brand logo fetch failed — letter tile fallback for', mentionedBrand?.name);
          }
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
          actualCostUSD,
          actualTokens: usage ? {
            prompt: usage.promptTokenCount ?? 0,
            candidates: usage.candidatesTokenCount ?? 0
          } : undefined
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
  // Motion-pack template builders return a COMPLETE self-contained document
  // (own DOCTYPE, composition root and window.__timelines registration).
  // Wrapping it again would produce nested DOCTYPEs + two composition roots
  // and fail the HyperFrames lint — pass it through untouched.
  if (/^\s*<!doctype html/i.test(motion.html)) {
    return motion.html;
  }
  const compositionId = motion.id;
  const dur = motion.durationSec;
  // Placement (unified model) wins over the legacy layer — a stale layer here
  // crops the canvas to 960px while the HTML was authored for 1920px, which
  // renders pure black frames (the screen-blend then shows nothing).
  const effLayer = motion.placement
    ? (motion.placement.area === 'top-half' ? 'split-top'
      : motion.placement.area === 'bottom-half' ? 'split-bottom'
      : motion.placement.area === 'full' ? 'replace' : 'overlay')
    : motion.layer;
  const isSplit = effLayer === 'split-bottom' || effLayer === 'split-top';
  // Float overlays author at FULL 1080×1920 (face-safe card zone) and are
  // screen-blended over the whole frame. Never a band-sized canvas — the
  // model authors in 1920-space regardless, so a shorter canvas just crops
  // everything into black frames.
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
        /* Base canvas: overlay floats need the PURE blend key (black for
           screen, WHITE for the light/multiply float); everything else gets
           the house bg — the actual atmosphere (grid+gradient on light,
           steel glow on dark) is the injected track-0 div below. */
        background: ${effLayer === 'overlay' ? (isLight ? '#FFF' : '#000') : isLight ? '#FAFAF8' : '#0a0a0c'};
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
      ${buildHouseStyleCss(isLight ? 'light' : 'dark')}
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
${
  // House atmosphere (track 0+1) — injected by the wrapper so the model never
  // paints backgrounds. Skipped when: overlay mode (pure black required for
  // screen blend) or the HTML already carries its own track-0 background
  // (legacy generations / atmosphere-bearing presets) — injecting twice would
  // collide on track 0 and fail the HyperFrames lint.
  effLayer !== 'overlay' && !/atmos-bg|data-track-index="0"/.test(motion.html)
    ? buildHouseAtmosphereDiv(isLight ? 'light' : 'dark', dur)
    : ''
}
${motion.html}
    </div>
    ${overlay.html}
    ${overlay.script ? `<script>${overlay.script}</script>` : ''}
  </body>
</html>`;
};
