import { GoogleGenAI } from '@google/genai';
import type { ScriptBlock, BlockKind, RegenerateContext } from './types';
import { buildRegenPromptSection } from '../../services/regenPrompt';
import { buildVoicePromptSection, type VoiceProfile } from './voiceProfile';

const uid = () => `b_${Math.random().toString(36).slice(2, 9)}`;

const newBlock = (kind: BlockKind, text: string): ScriptBlock => ({
  id: uid(), kind, text: text.trim(), start: 0, end: 0,
});

// ─── HEURISTIC SPLIT (fallback / no-AI mode) ────────────────────────────
const splitIntoSentences = (text: string): string[] => {
  // Prefer paragraph breaks first
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length >= 2) return paragraphs;

  // Otherwise split by sentence-ending punctuation, keeping the punctuation.
  return text
    .split(/(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
};

const groupIntoBlocks = (sentences: string[]): string[] => {
  // Aim for 8-25 words per block. Merge tiny consecutive sentences; split very long ones already done by sentence boundary.
  const wordsCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const result: string[] = [];
  let buf = '';
  for (const s of sentences) {
    const candidate = buf ? `${buf} ${s}` : s;
    if (wordsCount(candidate) < 8 && wordsCount(s) < 8) {
      buf = candidate;
      continue;
    }
    if (buf) {
      result.push(buf);
      buf = '';
    }
    if (wordsCount(s) < 8) {
      buf = s;
    } else {
      result.push(s);
    }
  }
  if (buf) result.push(buf);
  return result.length > 0 ? result : sentences;
};

// Heuristic Avatar/B-roll classifier (used when AI off or unavailable).
const HOOK_RE      = /\b(ol[áa]|oi|e a[íi]|fala|hoje|deixa eu|gente|pessoal|bom dia|tudo bem)\b/i;
const CTA_RE       = /\b(salv[ae]|segu[ea]|comenta|compartilh[ae]|link|bio|tchau|valeu|at[ée] mais|obrigad[ao])\b/i;
const SHOW_RE      = /\b(olh[ae]|veja|repare|aqui|aqui voc[êe]|vou mostrar|vou demonstrar|vou abrir|vou clicar|vou rolar|essa tela|essa interface|nessa tela|nesse menu|na tela|no menu|esse bot[ãa]o|esse campo)\b/i;
const EXPLAIN_RE   = /\b(funciona assim|funciona da seguinte|repare como|note que|observa|repare|configurando|vamos configurar|aqui voc[êe] pode|nessa parte|nessa etapa)\b/i;

const heuristicClassify = (text: string): BlockKind => {
  const t = text.toLowerCase();
  if (HOOK_RE.test(t) || CTA_RE.test(t)) return 'avatar';
  if (SHOW_RE.test(t) || EXPLAIN_RE.test(t)) return 'broll';
  // Default: shorter punchy lines = avatar, longer explanatory = broll
  const words = t.split(/\s+/).filter(Boolean).length;
  return words <= 14 ? 'avatar' : 'broll';
};

export const importScriptHeuristic = (rawText: string): ScriptBlock[] => {
  const sentences = splitIntoSentences(rawText);
  const grouped = groupIntoBlocks(sentences);
  return grouped.map(t => newBlock(heuristicClassify(t), t));
};

// ─── AI CLASSIFIER ──────────────────────────────────────────────────────
interface AIResponse {
  blocks: { text: string; kind: 'avatar' | 'broll' }[];
}

const SYSTEM_PROMPT = `You are a video script segmenter for short-form vertical video (Reels/TikTok/Shorts).

The user gives you a raw script. You must split it into BLOCKS and classify each block as either:
- "avatar" — when the speaker should appear on-screen (face visible).
- "broll" — when only voice plays while screen recording / B-roll covers the visual.

Rules for splitting:
- Each block should be 1-3 sentences, naturally spoken in 2-7 seconds.
- Preserve the speaker's exact wording — DO NOT rewrite, summarize, or translate.
- Group sentences that flow together; split when topic or visual focus changes.
- Aim for 4-8 blocks total for a 30s reel.

Rules for classification:
- AVATAR: greetings, hooks ("hoje vou mostrar", "olha isso"), CTAs ("salva", "segue", "tchau"), emotional/reaction moments, short punchy claims, personal credibility.
- BROLL: instructional or descriptive content ("aqui você vê", "repare como", "vamos configurar", "nessa tela"), step-by-step demonstrations, anything that REQUIRES the viewer to look at a screen/object instead of the speaker.

A reel typically follows: [avatar hook] → [broll demonstration] → [avatar reappearance/insight] → [avatar CTA]. Use this rhythm.

Return ONLY raw JSON in this exact shape:
{
  "blocks": [
    { "text": "exact text from the script", "kind": "avatar" },
    { "text": "exact text from the script", "kind": "broll" }
  ]
}`;

export const importScriptWithAI = async (
  rawText: string,
  regen?: RegenerateContext,
  voiceProfile?: VoiceProfile,
): Promise<ScriptBlock[]> => {
  const apiKey = localStorage.getItem('GOOGLE_API_KEY');
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY não configurada. Adicione em Configurações pra usar IA.');
  }
  const ai = new GoogleGenAI({ apiKey });

  const parts: { text: string }[] = [
    { text: SYSTEM_PROMPT },
    { text: `\n\nSCRIPT:\n${rawText.trim()}` },
  ];
  if (voiceProfile) {
    parts.push({ text: '\n\n' + buildVoicePromptSection(voiceProfile) });
  }
  const regenSection = buildRegenPromptSection(regen);
  if (regenSection) parts.push({ text: regenSection });

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: { parts },
    config: { temperature: regen ? 0.9 : 0.55 },
  });

  const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Resposta da IA inválida.');
  const parsed = JSON.parse(match[0]) as AIResponse;

  if (!parsed.blocks || parsed.blocks.length === 0) {
    throw new Error('IA não retornou blocos.');
  }

  return parsed.blocks.map(b => newBlock(b.kind, b.text));
};
