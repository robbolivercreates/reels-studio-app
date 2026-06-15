import { GoogleGenAI, Type } from '@google/genai';
import type { ScriptBlock } from '../components/reelsStudio/types';
import { logActualCost } from './costPredictor';

const getApiKey = (): string => {
  const key = localStorage.getItem('GOOGLE_API_KEY');
  if (!key) throw new Error('GOOGLE_API_KEY não configurada. Adicione em Configurações.');
  return key;
};

const MODEL = 'gemini-3.1-flash-lite';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type CarouselTone =
  | 'educativo'
  | 'viral'
  | 'inspiracional'
  | 'vendas'
  | 'opiniao'
  | 'storytelling'
  | 'super-viral'
  | 'curiosidade'
  | 'polemica';

export const CAROUSEL_TONE_OPTIONS: { value: CarouselTone; label: string; emoji: string; hint: string; advanced?: boolean }[] = [
  { value: 'educativo',    emoji: '🎓', label: 'Educativo',    hint: 'Passo a passo, didático, com exemplos concretos.' },
  { value: 'viral',        emoji: '🔥', label: 'Viral',        hint: 'Hook forte, ganchos de curiosidade, ritmo cortado.' },
  { value: 'inspiracional',emoji: '✨', label: 'Inspiracional', hint: 'Tom motivacional, história pessoal, transformação.' },
  { value: 'vendas',       emoji: '💰', label: 'Vendas',       hint: 'Dor → solução → prova → CTA direto para conversão.' },
  { value: 'opiniao',      emoji: '💬', label: 'Opinião',      hint: 'Posicionamento forte, contrarian, defende uma tese.' },
  { value: 'storytelling', emoji: '📖', label: 'História',     hint: 'Narrativa pessoal com começo, meio, virada e lição.' },
  { value: 'super-viral',  emoji: '🚀', label: 'Super Viral',  hint: 'Método IHC: Identificação → História → Conteúdo. Usa pesquisa de tendências reais.', advanced: true },
  { value: 'curiosidade',  emoji: '🤔', label: 'Curiosidade',  hint: 'Cada slide começa com pergunta ou mistério. Usa pesquisa de fatos surpreendentes.', advanced: true },
  { value: 'polemica',     emoji: '⚡', label: 'Polêmica',     hint: 'Opiniões contrárias fortes. Desafia crenças comuns. Gera debate.', advanced: true },
];

export interface CarouselSlide {
  /** 1-based slide number */
  slideNumber: number;
  /** Cover | Slide N | CTA */
  role: 'cover' | 'body' | 'cta';
  /** Spoken narration text (TTS-ready, 10–30 words). No emojis, no hashtags. */
  text: string;
  /** Visual direction for motion generation — what to show on screen. */
  visualHint: string;
}

export interface DetectedBrand {
  /** Display name, e.g. "Canva", "Claude", "ChatGPT" */
  name: string;
  /** Root domain for logo fetch, e.g. "canva.com", "anthropic.com" */
  domain: string;
}

export interface GeneratedCarousel {
  slides: CarouselSlide[];
  /** One-line hook that captures the whole carousel theme. */
  theme: string;
  /**
   * Ready-to-paste GPT Image 2 prompt for the cover slide (Rob Boliver Signature aesthetic).
   * Includes headline, topic anchor, scene, and pose — user brings their own reference photo.
   */
  coverImagePrompt: string;
  /**
   * Named brand/tool detected in the topic, if any.
   * Used to auto-fetch the real logo for the GPT Image 2 cover generation.
   * null when the topic is about a concept with no specific brand.
   */
  detectedBrand: DetectedBrand | null;
}

// ─── SERVICE ─────────────────────────────────────────────────────────────────

interface CarouselTrends {
  trendingAngles: string[];
  currentVibe: string;
  hotArchetypes: string[];
}

const GROUNDING_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash'];

/** Pre-research step for advanced tones — uses Google Search, returns raw trend context.
 *  Returns null on any failure (non-fatal). */
const researchCarouselTrends = async (topic: string): Promise<CarouselTrends | null> => {
  let ai: GoogleGenAI;
  try {
    ai = new GoogleGenAI({ apiKey: getApiKey() });
  } catch {
    return null;
  }

  const prompt = `Você tem acesso ao Google Search. Pesquise o que está viralizando AGORA (últimos 30 dias) sobre o tema abaixo em Instagram Reels, TikTok e Shorts.

TEMA: ${topic}

Retorne SOMENTE um JSON (sem markdown, sem cercas) com exatamente estas chaves:
{
  "trendingAngles": ["3 a 5 ângulos/abordagens que estão bombando agora"],
  "currentVibe": "uma frase descrevendo o clima/emoção que está dirigindo engajamento",
  "hotArchetypes": ["arquétipos de hook em alta: Aha, Contraste Emocional, Lacuna de Curiosidade, Identificação, Contrarian, Específico Numérico, Custo de Inação"]
}`;

  for (const model of GROUNDING_MODELS) {
    try {
      const ai2 = new GoogleGenAI({ apiKey: getApiKey() });
      const response = await ai2.models.generateContent({
        model,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }], temperature: 0.3 },
      });
      logActualCost('Carousel Trend Research', model, response.usageMetadata, 1);
      const raw = response.candidates?.[0]?.content?.parts?.find((p: { text?: string }) => p.text)?.text ?? '';
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]) as Partial<CarouselTrends>;
      const trendingAngles = Array.isArray(parsed.trendingAngles) ? parsed.trendingAngles.filter(Boolean) : [];
      const hotArchetypes  = Array.isArray(parsed.hotArchetypes)  ? parsed.hotArchetypes.filter(Boolean)  : [];
      const currentVibe    = typeof parsed.currentVibe === 'string' ? parsed.currentVibe.trim() : '';
      if (!trendingAngles.length && !currentVibe) continue;
      return { trendingAngles, currentVibe, hotArchetypes };
    } catch {
      /* try next model */
    }
  }
  return null;
};

export const generateCarouselScript = async (
  topic: string,
  numSlides: number,
  tone: CarouselTone,
): Promise<GeneratedCarousel> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const clampedSlides = Math.max(3, Math.min(15, numSlides));
  const bodyCount = clampedSlides - 2; // slide 1 = cover, last = CTA

  const toneHints: Record<CarouselTone, string> = {
    educativo:      'Didactic, calm, numbered steps, concrete examples. Each body slide = one clear point.',
    viral:          'Aggressive hooks, curiosity gaps, short punchy sentences. Cover is a bold provocative claim.',
    inspiracional:  'Warm and motivational. Personal transformation arc. CTA invites reflection or action.',
    vendas:         'Pain → solution → proof → clear offer. Cover names the pain. CTA names the offer.',
    opiniao:        'Strong contrarian take. Cover states the thesis boldly. Body slides each defend one argument.',
    storytelling:   'Narrative arc: setup → tension → turning point → lesson. Cover opens mid-action.',
    'super-viral':  'IHC METHOD — MANDATORY:\n  Slide 1 (Identificação): Emotional recognition ONLY. Describe a pain/frustration the audience feels daily. DO NOT teach yet. Format: "A maioria das pessoas faz X achando que está certo", "Aquela sensação quando…", "Todo mundo diz X, mas…"\n  Middle slides (História): Short relatable story. Structure: Conflict → Turning point → Consequence. Audience must see themselves in it. Use "você", "a gente". NEVER "Eu fiz X" unless quoting a real person.\n  Final slides (Conteúdo + CTA): ONLY NOW deliver the key idea/method. Content lands harder after identification + story.',
    curiosidade:    'Structure: Every slide opens with a question or mystery-creating statement. Hooks: "Você sabia…", "O segredo que…", "Por que ninguém fala sobre…", "A verdade sobre…". Each slide must feel like peeling a layer of a mystery.',
    polemica:       'Structure: Each slide challenges a common belief or presents a strong contrary viewpoint. Hooks: "A verdade sobre X que ninguém quer ouvir", "Para de fazer X agora", "X está errado e aqui está o motivo". Tone: bold, direct, almost confrontational.',
  };

  const needsGrounding = (tone === 'super-viral' || tone === 'curiosidade' || tone === 'polemica');

  // Pre-research for advanced tones (separate call — Google Search can't coexist with responseSchema).
  let trendContext = '';
  if (needsGrounding) {
    try {
      const trends = await researchCarouselTrends(topic);
      if (trends) {
        trendContext = `\nTREND RESEARCH (use this to make content feel current and high-CTR):
- Trending angles right now: ${trends.trendingAngles.join(' | ')}
- Current vibe driving engagement: ${trends.currentVibe}
- Hot archetypes: ${trends.hotArchetypes.join(', ')}\n`;
      }
    } catch { /* non-fatal — continue without trends */ }
  }

  const groundingInstruction = trendContext;

  const prompt = `You are a world-class Instagram carousel copywriter AND a creative director.
${groundingInstruction}
TASK A: Write a ${clampedSlides}-slide animated video carousel script in Brazilian Portuguese.
TASK B: Generate a GPT Image 2 prompt for the cover slide using the "Rob Boliver Signature" aesthetic.
TASK C: Detect if the topic references a specific named brand/tool/product and return its domain for logo fetching.

TOPIC: ${topic}
TONE: ${tone} — ${toneHints[tone]}

─── TASK A: CAROUSEL SCRIPT ────────────────────────────────────────────────

SLIDE STRUCTURE (exactly ${clampedSlides} slides):
- Slide 1 (cover): Hook that stops the scroll. Bold claim or provocation. 10–20 words spoken.
- Slides 2–${clampedSlides - 1} (body, ${bodyCount} slides): One clear idea per slide. Each 10–25 words spoken.
- Slide ${clampedSlides} (CTA): Single clear call to action. What should the viewer do right now? 8–15 words.

COPY RULES (MANDATORY):
- Max 200 characters total per slide. Count strictly — cut if over.
- Each slide is narrated aloud (TTS). No emojis, no hashtags, no URLs, no parentheses, no markdown.
- Sentences must read naturally when spoken. Commas and periods are breath pauses.
- Numbers in words (e.g. "três passos" not "3 passos"). Exception: if the number is the headline/hook, digits OK.
- Language: Brazilian Portuguese conversational. Not formal, not academic. Explain like talking to a 10-year-old.
- Every slide (except CTA) must end with a natural curiosity hook that makes people want to continue.
  GOOD hooks: "Mas é aqui que tudo muda…", "O motivo vai te surpreender…", "E então descobri algo que…"
  BAD hooks: "Veja o próximo slide", "Arraste para descobrir", NEVER reference the carousel format.
- No filler slides — every slide must teach or reveal something concrete.
- Information builds progressively: each slide builds on the previous one.

HEADLINE RULES:
- Slide 1: headline MANDATORY. Max 3 impact words. Subtitle max 5 words. One job: stop the scroll.
- Middle slides: headline OPTIONAL — only include when it adds value. Some slides work better as flowing text only.
- Last slide (CTA): one clear call to action. MANDATORY.

VISUAL HINT:
For each slide (2–${clampedSlides}), write a short visual direction (1–2 sentences) for the motion generator.
Slide 1 visual hint: write "Capa estática gerada com GPT Image 2."

─── TASK C: BRAND DETECTION ────────────────────────────────────────────────

Scan the topic "${topic}" for a specific named brand, app, tool, or product.
If found, return { "name": "DisplayName", "domain": "rootdomain.com" }.
Examples: "Canva" → { "name": "Canva", "domain": "canva.com" }
          "ChatGPT" or "OpenAI" → { "name": "ChatGPT", "domain": "openai.com" }
          "Claude" or "Anthropic" → { "name": "Claude", "domain": "anthropic.com" }
          "Notion" → { "name": "Notion", "domain": "notion.so" }
          "Figma" → { "name": "Figma", "domain": "figma.com" }
          "Instagram" → { "name": "Instagram", "domain": "instagram.com" }
          "YouTube" → { "name": "YouTube", "domain": "youtube.com" }
          "TikTok" → { "name": "TikTok", "domain": "tiktok.com" }
          "LinkedIn" → { "name": "LinkedIn", "domain": "linkedin.com" }
If the topic is about a concept (productivity, mindset, money, etc.) with NO specific named brand → return null.

─── TASK B: COVER IMAGE PROMPT ────────────────────────────────────────────

Generate the coverImagePrompt by assembling the COMPLETE template below.
The template has FIXED sections (copy verbatim) and DYNAMIC sections (fill in based on the topic).

DYNAMIC SECTIONS — you decide these based on topic "${topic}":

DYNAMIC-1 · HEADLINE (1–3 ALL-CAPS Portuguese/English words):
Choose a headline that reads instantly. Prefer patterns like:
  Numbers: "5 NÍVEIS" / "3 MINUTOS" / "10 IAs"
  Imperative: "MUDA AGORA" / "PARA TUDO" / "ESQUECE ISSO"
  Personal result: "RESETEI TUDO" / "DEU CERTO" / "VIROU FÁCIL"
  Contrarian: "NÃO É PROMPT" / "ESQUECE GPT" / "ERREI TUDO"
  Single power word: "ALGORITMO" / "SEGREDO" / "VIRADA" / "NOVA ERA"
  Update/novelty: "CHEGOU" / "MUDOU TUDO" / "2.0"

DYNAMIC-2 · TOPIC ANCHOR (choose Option A or B, delete the other):
  Option A — if topic references a named tool/app/product:
    Describe the logo + UI with exact colors, specific UI elements, lit by cyan hero light.
    Must feel like a physical 3D holographic display, not a flat screenshot.
    Example: "the Canva multicolor C logo on a dark floating UI card, showing an AI generation interface with glowing magic wand icon and prompt input field, lit by the same cyan/violet hero light as the subject, with Canva's purple glow emanating from the screen onto the matte desk surface."
  Option B — if topic is a concept (no named tool):
    Describe a sculptural symbolic object that makes the concept tangible.
    Must be lit by cyan hero light. Never flat, never clip-art.
    Example: "a large open notebook with a glowing digital brain hologram rising from its pages, rendered photo-realistically as a 3D object on the desk, lit by cyan rim light."

DYNAMIC-3 · SCENE COMPOSITION (4–6 sentences):
Rules (always apply):
  - Dark editorial workspace
  - Subject in lower portion, slightly left or right of center
  - Anchor on opposite side at chest height, facing camera
  - One editorial detail in foreground (coffee mug, notebook) partially out of focus
  - Warm amber practical light glowing in deep background
  - Upper third of frame CLEAN — only atmosphere, no objects, no text
  - Three depth planes: sharp foreground, sharp subject+anchor, soft bokeh background

DYNAMIC-4 · SUBJECT POSE (1–2 sentences):
Describe the pose, arm position, and expression that matches the topic's energy.
Rules: No open palms facing up, no excessively open gestures.
Match energy: educational → confident, calm. viral/contrarian → knowing smirk. inspirational → open, warm.
Example: "Arms crossed at chest, body slightly angled toward the anchor, head facing camera directly. Expression: confident insider — slight knowing smile, 'I saw this before everyone else' look."

─────────────────────────────────────────────────────────────────────────────
OUTPUT THE COMPLETE PROMPT BELOW — assemble it by filling in [DYNAMIC-N] placeholders:
─────────────────────────────────────────────────────────────────────────────

TASK: Design a single premium, high-CTR vertical social media cover (4:5 aspect ratio — 1080×1350px).
INTENDED USE: Instagram feed post or Reels cover — scroll-stopping first frame.

HEADLINE TEXT TO RENDER:
"[DYNAMIC-1: INSERT 1–3 WORD HEADLINE HERE]"

TYPOGRAPHY SPEC:
- Modern, clean, heavy sans-serif (Bebas Neue / Inter Black / Helvetica Neue Heavy). NOT script. NOT serif.
- All caps, MASSIVELY oversized, tight letter-spacing — headline fills the upper portion of the frame edge-to-edge.
- Pure white (#FFFFFF) with subtle dark drop shadow.
- TARGET: 1–3 words max. Numbers read instantly — favor them.
- TEXT-BEHIND-SUBJECT (signature depth effect): Headline lives on a layer BEHIND the subject's head and shoulders. Clean occlusion — sharp silhouette edge, no halo, no stroke. Subtle cyan/violet rim on text edges where hero light catches them.

VISUAL AESTHETIC DIRECTIVES (Signature Brand):
- Deep dark premium canvas background (#0A0A0F) with elegant cinematic depth of field and soft background blur (bokeh).
- Atmosphere: "Apple keynote × luxury tech startup × editorial magazine cover."
- Brand accent palette as realistic light and reflections, NOT flat overlays:
    * Electric cyan / sapphire: #00B4D8
    * Rich violet / indigo:     #7B2FBE
- Lighting layering: Hero light: cool cyan or violet rim/key on subject and anchor. Background warmth: one subtle warm amber accent in deep background. Practical lights: placed, never dominant.
- Materials: matte black desk, polished glass, brushed aluminum. Three depth planes minimum.
- Editorial details (1–2 only): coffee mug or notebook in foreground.
- Subtle film grain (high-ISO digital, not VHS).
- AVOID: neon overload, competing lights, particles, hexagonal patterns.

TOPIC ANCHOR (REQUIRED):
[DYNAMIC-2: INSERT ANCHOR DESCRIPTION HERE]

SCENE COMPOSITION:
[DYNAMIC-3: INSERT 4–6 SENTENCE SCENE DESCRIPTION HERE]

SUBJECT:
Integrate the FACIAL IDENTITY of the person from the provided reference photo — same face, same hair, same beard, same general build. Long-sleeve black top.
POSE: [DYNAMIC-4: INSERT POSE + EXPRESSION DESCRIPTION HERE]
Render photo-realistically in the lower portion of the frame. Cinematic cyan/violet rim light. No cutout box. No halo.

COMPOSITION RULES:
- Frame as portrait 4:5 (1080×1350px).
- Headline in upper-third, massive, behind subject's head.
- Subject lower-center or lower-left. Anchor opposite side, same desk surface.
- Clean negative space around headline at top.
- Atmospheric cyan (#00B4D8) and violet (#7B2FBE) lighting.
- Shallow depth of field, bokeh, tack-sharp on subject and anchor.
- No harsh neon, no glow halos, no lens flares.
- Anchor never blocks the face.

OUTPUT: A stunning, photo-realistic, cinematic 4:5 cover. Zero additional text beyond the specified headline. Zero watermarks.
─────────────────────────────────────────────────────────────────────────────
(End of template. Output ONLY the assembled prompt — no meta-commentary, no section headers in the output.)

Return JSON matching the schema. No extra commentary.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.85,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 3000 },
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          theme:            { type: Type.STRING },
          coverImagePrompt: { type: Type.STRING },
          detectedBrand: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              name:   { type: Type.STRING },
              domain: { type: Type.STRING },
            },
            required: ['name', 'domain'],
          },
          slides: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                slideNumber: { type: Type.INTEGER },
                role:        { type: Type.STRING },
                text:        { type: Type.STRING },
                visualHint:  { type: Type.STRING },
              },
              required: ['slideNumber', 'role', 'text', 'visualHint'],
            },
          },
        },
        required: ['theme', 'coverImagePrompt', 'detectedBrand', 'slides'],
      },
    },
  });

  // LOG COST
  logActualCost('Carousel Script', MODEL, response.usageMetadata, 0);

  const raw = response.text?.trim();
  if (!raw) throw new Error('Resposta vazia do Gemini.');

  const parsed = JSON.parse(raw) as GeneratedCarousel;

  // Normalise roles in case Gemini used different casing/strings.
  parsed.slides = parsed.slides.map((s, i) => ({
    ...s,
    role: i === 0 ? 'cover' : i === parsed.slides.length - 1 ? 'cta' : 'body',
  }));

  return parsed;
};

// ─── CONVERTER ───────────────────────────────────────────────────────────────

/** Convert carousel slides into ReelsStudio ScriptBlocks.
 *  Slides 2+ (body/CTA) get the rob-boliver preset pre-applied so motions
 *  automatically match the brand aesthetic. Slide 1 (cover) is left without
 *  a preset — it will be replaced by the GPT Image 2 generated cover image. */
export const carouselSlidesToBlocks = (slides: CarouselSlide[]): ScriptBlock[] =>
  slides.map((s, i) => ({
    id: `carousel_${Date.now()}_${i}`,
    kind: 'avatar' as const,
    text: s.text,
    start: 0,
    end: 0,
    ...(i > 0 ? { stylePresetOverride: 'rob-boliver' as const } : {}),
  }));
