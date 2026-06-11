/**
 * Instagram caption generator for carousels.
 *
 * Takes the full carousel script and generates a ready-to-paste caption
 * following the canvas-ai rules: no meta-talk, no markdown, para-scroll hook
 * on the first line, conversational language, CTA at the end, no hashtags.
 */

import { GoogleGenAI } from '@google/genai';
import type { CarouselSlide } from './carouselScriptService';
import { logActualCost } from './costPredictor';

const getApiKey = (): string => {
  const key = localStorage.getItem('GOOGLE_API_KEY');
  if (!key) throw new Error('GOOGLE_API_KEY não configurada.');
  return key;
};

const MODEL = 'gemini-3.1-flash-lite';

export const generateCarouselCaption = async (
  slides: CarouselSlide[],
  topic: string,
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const ctaSlide = slides[slides.length - 1];
  const scriptSummary = slides
    .map((s, i) => `Slide ${i + 1}: ${s.text}`)
    .join('\n');

  const prompt = `You are an expert Instagram copywriter. Write a caption for the carousel below.

CAROUSEL TOPIC: ${topic}
CTA (last slide): "${ctaSlide?.text ?? ''}"

FULL SCRIPT:
${scriptSummary}

RULES — follow strictly:
1. NO META-TALK: Never say "neste carrossel", "arraste para aprender", "confira este post". Sounds robotic.
2. Write as a natural fluid story or direct conversation about the PROBLEM and SOLUTION of the topic.
3. First line: a "para-scroll" hook (curiosity, bold statement, relatable problem). This line must stop the scroll.
4. Simple language — explain like talking to a 10-year-old. Short paragraphs.
5. End with the CTA highlighted and impossible to miss.
6. NEVER use markdown: no asterisks (*), no bold (**), no headers (#), no bullet points (-). Instagram doesn't support markdown.
7. MAY use emojis to organize and visually highlight sections — use naturally, not forced.
8. NO hashtags.
9. Text ready to paste directly into Instagram caption field.
10. Language: Brazilian Portuguese conversational.

Return ONLY the caption text — no JSON, no explanation, no quotes around it.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.8, maxOutputTokens: 800 },
  });

  logActualCost('Carousel Caption', MODEL, response.usageMetadata, 0);

  const text = response.text?.trim() ?? '';
  if (!text) throw new Error('Resposta vazia ao gerar legenda.');
  return text;
};
