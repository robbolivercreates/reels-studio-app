import { GoogleGenAI } from '@google/genai';
import type { ScriptBlock, BlockKind } from '../components/reelsStudio/types';
import { buildVoicePromptSection, type VoiceProfile } from '../components/reelsStudio/voiceProfile';

const uid = () => `b_${Math.random().toString(36).slice(2, 9)}`;

const getApiKey = (): string => {
  const key = localStorage.getItem('GOOGLE_API_KEY');
  if (!key) throw new Error('GOOGLE_API_KEY não configurada.');
  return key;
};

const MODEL = 'gemini-3-flash-preview';

interface Neighbors {
  prev?: ScriptBlock;
  next?: ScriptBlock;
}

const formatNeighbors = (n: Neighbors): string => {
  const parts: string[] = [];
  if (n.prev) parts.push(`Previous block (${n.prev.kind}): "${n.prev.text}"`);
  if (n.next) parts.push(`Next block (${n.next.kind}): "${n.next.text}"`);
  if (parts.length === 0) return '(no neighbouring blocks — this is a standalone block)';
  return parts.join('\n');
};

const parseSingleBlock = (raw: string): { kind: BlockKind; text: string } => {
  if (!raw) throw new Error('IA retornou resposta vazia.');
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Resposta da IA inválida (não é JSON).');
  const parsed = JSON.parse(match[0]) as { kind?: string; text?: string };
  if (!parsed.text || !parsed.text.trim()) throw new Error('IA não retornou texto.');
  const kind: BlockKind = parsed.kind === 'broll' ? 'broll' : 'avatar';
  return { kind, text: parsed.text.trim() };
};

/**
 * Regenerates a single existing block, keeping coherence with neighbours.
 * Returns the SAME block id (so timeline references stay valid) with new
 * `kind` (if Gemini decides) and new `text`.
 */
export const regenerateBlock = async (
  block: ScriptBlock,
  neighbors: Neighbors,
  voiceProfile: VoiceProfile | undefined,
  extraInstructions: string,
): Promise<ScriptBlock> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const promptLines: string[] = [
    'You rewrite a SINGLE block of a short-form vertical video script (Reel/TikTok/Shorts).',
    'Goal: produce one fresh take that flows naturally between the surrounding blocks.',
    '',
    'HARD RULES:',
    '- Output must fit 2-7 seconds when spoken (TTS pace, ~3-5 words/sec in PT-BR).',
    '- No emojis, no markdown, no hashtags. Plain spoken text.',
    '- No self-introduction, no long sign-off, no filler ("e bom", "como eu tava falando").',
    '- Keep the kind (avatar / broll) the same UNLESS the user explicitly asks to change it.',
    '- Diverge meaningfully from the original — do not repeat the same wording.',
    '',
    `CURRENT BLOCK to rewrite (kind=${block.kind}):`,
    `"${block.text}"`,
    '',
    'NEIGHBOURING CONTEXT:',
    formatNeighbors(neighbors),
  ];

  if (extraInstructions && extraInstructions.trim()) {
    promptLines.push('');
    promptLines.push('USER FEEDBACK (highest priority):');
    promptLines.push(extraInstructions.trim());
  }

  if (voiceProfile) {
    promptLines.push('');
    promptLines.push(buildVoicePromptSection(voiceProfile));
  }

  promptLines.push('');
  promptLines.push('Return JSON ONLY: { "kind": "avatar" | "broll", "text": string }');

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: { parts: [{ text: promptLines.join('\n') }] },
    config: {
      responseMimeType: 'application/json',
      temperature: 0.85,
    },
  });

  const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const { kind, text } = parseSingleBlock(raw);
  return { ...block, kind, text };
};

/**
 * Generates a brand new block of a given kind that fits between neighbours.
 * Returns a fresh block with a new id (start/end stay 0 — filled when audio
 * is regenerated).
 */
export const generateNewBlock = async (
  kind: BlockKind,
  userPrompt: string,
  neighbors: Neighbors,
  voiceProfile: VoiceProfile | undefined,
): Promise<ScriptBlock> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const promptLines: string[] = [
    'You write a SINGLE new block to insert into a short-form vertical video script (Reel/TikTok/Shorts).',
    `The block must be of kind: ${kind} (${kind === 'avatar' ? 'spoken to camera' : 'narration over visuals/screen'}).`,
    '',
    'HARD RULES:',
    '- Output must fit 2-7 seconds when spoken (TTS pace, ~3-5 words/sec in PT-BR).',
    '- No emojis, no markdown, no hashtags. Plain spoken text.',
    '- No self-introduction, no long sign-off, no filler.',
    '- Must flow naturally from the previous block and into the next.',
    '',
    'NEIGHBOURING CONTEXT:',
    formatNeighbors(neighbors),
  ];

  if (userPrompt && userPrompt.trim()) {
    promptLines.push('');
    promptLines.push('USER REQUEST (what this block should be about):');
    promptLines.push(userPrompt.trim());
  } else {
    promptLines.push('');
    promptLines.push('No specific user prompt — fill the natural gap between neighbours.');
  }

  if (voiceProfile) {
    promptLines.push('');
    promptLines.push(buildVoicePromptSection(voiceProfile));
  }

  promptLines.push('');
  promptLines.push(`Return JSON ONLY: { "kind": "${kind}", "text": string }`);

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: { parts: [{ text: promptLines.join('\n') }] },
    config: {
      responseMimeType: 'application/json',
      temperature: 0.8,
    },
  });

  const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  const parsed = parseSingleBlock(raw);
  // Force the kind the user requested — we trust the UI choice, not Gemini's.
  return { id: uid(), kind, text: parsed.text, start: 0, end: 0 };
};
