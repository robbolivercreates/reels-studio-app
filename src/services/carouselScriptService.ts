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
  | 'storytelling';

export const CAROUSEL_TONE_OPTIONS: { value: CarouselTone; label: string; emoji: string; hint: string }[] = [
  { value: 'educativo',    emoji: '🎓', label: 'Educativo',    hint: 'Passo a passo, didático, com exemplos concretos.' },
  { value: 'viral',        emoji: '🔥', label: 'Viral',        hint: 'Hook forte, ganchos de curiosidade, ritmo cortado.' },
  { value: 'inspiracional',emoji: '✨', label: 'Inspiracional', hint: 'Tom motivacional, história pessoal, transformação.' },
  { value: 'vendas',       emoji: '💰', label: 'Vendas',       hint: 'Dor → solução → prova → CTA direto para conversão.' },
  { value: 'opiniao',      emoji: '💬', label: 'Opinião',      hint: 'Posicionamento forte, contrarian, defende uma tese.' },
  { value: 'storytelling', emoji: '📖', label: 'História',     hint: 'Narrativa pessoal com começo, meio, virada e lição.' },
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

export interface GeneratedCarousel {
  slides: CarouselSlide[];
  /** One-line hook that captures the whole carousel theme. */
  theme: string;
  /**
   * Ready-to-paste GPT Image 2 prompt for the cover slide (Rob Boliver Signature aesthetic).
   * Includes headline, topic anchor, scene, and pose — user brings their own reference photo.
   */
  coverImagePrompt: string;
}

// ─── SERVICE ─────────────────────────────────────────────────────────────────

export const generateCarouselScript = async (
  topic: string,
  numSlides: number,
  tone: CarouselTone,
): Promise<GeneratedCarousel> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const clampedSlides = Math.max(3, Math.min(15, numSlides));
  const bodyCount = clampedSlides - 2; // slide 1 = cover, last = CTA

  const toneHints: Record<CarouselTone, string> = {
    educativo:    'Didactic, calm, numbered steps, concrete examples. Each body slide = one clear point.',
    viral:        'Aggressive hooks, curiosity gaps, short punchy sentences. Cover is a bold provocative claim.',
    inspiracional:'Warm and motivational. Personal transformation arc. CTA invites reflection or action.',
    vendas:       'Pain → solution → proof → clear offer. Cover names the pain. CTA names the offer.',
    opiniao:      'Strong contrarian take. Cover states the thesis boldly. Body slides each defend one argument.',
    storytelling: 'Narrative arc: setup → tension → turning point → lesson. Cover opens mid-action.',
  };

  const prompt = `You are a world-class Instagram carousel copywriter AND a creative director.

TASK A: Write a ${clampedSlides}-slide animated video carousel script in Brazilian Portuguese.
TASK B: Generate a GPT Image 2 prompt for the cover slide using the "Rob Boliver Signature" aesthetic.

TOPIC: ${topic}
TONE: ${tone} — ${toneHints[tone]}

─── TASK A: CAROUSEL SCRIPT ────────────────────────────────────────────────

SLIDE STRUCTURE (exactly ${clampedSlides} slides):
- Slide 1 (cover): Hook that stops the scroll. Bold claim or provocation. 10–20 words spoken.
- Slides 2–${clampedSlides - 1} (body, ${bodyCount} slides): One clear idea per slide. Each 10–25 words spoken.
- Slide ${clampedSlides} (CTA): Single clear call to action. What should the viewer do right now? 8–15 words.

RULES FOR SPOKEN TEXT:
- Each slide is narrated aloud (voice + motion animation). Text goes to TTS — no emojis, no hashtags, no URLs, no parentheses.
- Sentences must read naturally when spoken. Use commas and periods as breath pauses.
- Each slide should feel complete on its own but flow into the next.
- Numbers in words (e.g. "três passos" not "3 passos").
- Language: Brazilian Portuguese conversational. Not formal, not academic.

VISUAL HINT:
For each slide (2–${clampedSlides}), write a short visual direction (1–2 sentences) for the motion generator.
Slide 1 visual hint: write "Capa estática gerada com GPT Image 2."

─── TASK B: COVER IMAGE PROMPT ────────────────────────────────────────────

Generate a COMPLETE, ready-to-paste English prompt for GPT Image 2 to create the carousel cover.
The prompt MUST follow this exact "Rob Boliver Signature" aesthetic template:

FIXED AESTHETIC (do not change these):
- Deep dark premium canvas (#0A0A0F). Atmosphere: "Apple Keynote × luxury tech startup × editorial magazine cover."
- Electric cyan (#00B4D8) rim/key light on subject. Rich violet (#7B2FBE) deep background glow. One warm amber accent in background bokeh.
- Heavy sans-serif headline, ALL CAPS, massively oversized, fills upper portion of frame, pure white #FFFFFF.
- Matte surface with subtle reflection. Three depth planes. Subtle film grain. No neon, no particles, no flat overlays.
- TOPIC ANCHOR: a realistic 3D physical object on the desk that visually represents the topic.
- Subject (Rob Boliver): Long-sleeve black top. Cinematic cyan/violet rim light. No cutout box.
- Frame: PORTRAIT 4:5 aspect ratio (1080×1350px). Subject in lower half. Headline in upper third.

YOU MUST FILL IN based on the topic "${topic}":
1. HEADLINE: 1–3 ALL-CAPS words in English that capture the topic's core idea (e.g. ALGORITMO, 5 PASSOS, VIRADA).
2. TOPIC ANCHOR: describe a specific, recognizable physical/digital object that represents this topic — rendered as a 3D object on the desk.
3. SCENE: 4–5 sentences describing the editorial workspace, subject position, anchor position, depth planes, and ambient light.
4. POSE: describe the subject's pose, arm position, and facial expression that fits the topic's energy.

Output the coverImagePrompt as a single block of English text (no section headers in the output, just the complete prompt ready to paste).

Return JSON matching the schema. No extra commentary.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.85,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      // Habilita raciocínio (Thinking) para garantir a estruturação rica de cada slide do carrossel.
      thinkingConfig: { thinkingBudget: 2048 },
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          theme: { type: Type.STRING },
          coverImagePrompt: { type: Type.STRING },
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
        required: ['theme', 'coverImagePrompt', 'slides'],
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
