/**
 * Motion Director — the orchestration pass from the motion-pack guide:
 *
 *   "Transcribe with word-level timestamps → segment into logical scenes
 *    (one scene per spoken idea, usually 3–8 seconds each) → pick a template
 *    or author custom visuals per scene → every word should have a visual
 *    moment."
 *
 * ONE Gemini call plans the whole reel: for each block it decides the visual
 * (template or style hint), fills template variables, and — crucially —
 * anchors the motion at the keyword's word-timestamp with a 3–8s window
 * instead of blindly spanning the whole block.
 *
 * Used by the batch "Gerar todos" flow (creation AND edit-video). Single-block
 * generation keeps the lighter per-block router in motionService.
 */

import { GoogleGenAI } from '@google/genai';
import { getApiKey, getModelCandidates } from './motionService';
import { logActualCost } from './costPredictor';
import { STYLE_PRESET_IDS } from '../components/reelsStudio/presetCategory';

export interface DirectorBlockInput {
  id: string;
  kind: 'avatar' | 'broll';
  text: string;
  /** Project time where the block starts (seconds). */
  startSec: number;
  /** Block length in seconds. */
  durationSec: number;
  /** Block-LOCAL word timestamps (seconds from block start), downsampled. */
  words?: { word: string; start: number; end: number }[];
}

export interface DirectorPlanItem {
  blockId: string;
  /** Motion-pack template id, or null → freeform generation. */
  templateId: string | null;
  /** AI style preset hint when no template fits (validated against STYLE_PRESET_IDS). */
  styleHint?: string;
  /** Template variable fill (only when templateId is set). */
  variables?: Record<string, string>;
  /** Block-local second where the motion appears (keyword-anchored). */
  startOffsetSec: number;
  /** Visible window, 3–8s clamped to the block. */
  durationSec: number;
  rationale: string;
}

const MAX_WORDS_PER_BLOCK = 25;

/** Evenly downsample word timestamps so long blocks don't blow up the prompt. */
const sampleWords = (words: { word: string; start: number; end: number }[]) => {
  if (words.length <= MAX_WORDS_PER_BLOCK) return words;
  const step = words.length / MAX_WORDS_PER_BLOCK;
  const out: typeof words = [];
  for (let i = 0; i < MAX_WORDS_PER_BLOCK; i++) out.push(words[Math.floor(i * step)]);
  return out;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Plan motions for the whole script in ONE call. Returns a map blockId → plan.
 * On any terminal failure returns an EMPTY map — callers fall back to the
 * per-block router, so the director can never make things worse.
 */
export const planMotionsForScript = async (input: {
  scriptText: string;
  blocks: DirectorBlockInput[];
  preferredModel?: string;
  outputLanguage?: string;
  /** Edit-video pipeline: overlays float over real footage — restrict to overlay-safe templates. */
  overlayContext?: boolean;
}): Promise<Map<string, DirectorPlanItem>> => {
  const empty = new Map<string, DirectorPlanItem>();
  if (input.blocks.length === 0) return empty;

  const { TEMPLATE_SELECTION_CATALOG, TEMPLATE_VARIABLE_SCHEMAS } = await import('./motionTemplates');
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  // Templates are full-frame DESIGNS — only blocks whose motion owns the
  // whole frame (kind 'broll' / full placement) may use them. Avatar/float
  // blocks always get freeform art authored inside the face-safe zone
  // (a template routed into a float plasters a 1080×1920 layout over the
  // speaker's face).
  const hasFullFrameBlocks = input.blocks.some(b => b.kind === 'broll') && !input.overlayContext;
  const availableTemplates = hasFullFrameBlocks ? TEMPLATE_SELECTION_CATALOG : [];
  const validTemplateIds = availableTemplates.map(t => t.id);

  const catalog = availableTemplates.map(t => {
    const schema = TEMPLATE_VARIABLE_SCHEMAS[t.id] ?? [];
    const varDesc = schema.length > 0
      ? ` Variáveis: ${schema.map(v => `${v.name} (${v.description})`).join('; ')}`
      : ' (sem variáveis)';
    return `- "${t.id}": ${t.whenToUse}${varDesc}`;
  }).join('\n');

  const styleList = STYLE_PRESET_IDS.join(', ');

  const blockLines = input.blocks.map(b => {
    const words = b.words && b.words.length > 0
      ? `\n  palavras: ${sampleWords(b.words).map(w => `"${w.word}"@${w.start.toFixed(1)}s`).join(' ')}`
      : '';
    return `[${b.id}] (${b.kind}, ${b.startSec.toFixed(1)}s→${(b.startSec + b.durationSec).toFixed(1)}s, dura ${b.durationSec.toFixed(1)}s): "${b.text}"${words}`;
  }).join('\n');

  const prompt = [
    'Você é o DIRETOR DE CENAS de motion graphics de um Reel. Você recebe o roteiro completo, os blocos com seus tempos e os word-timestamps da narração. Planeje o motion de CADA bloco seguindo as regras do guia:',
    '',
    'REGRAS DO GUIA (obrigatórias):',
    '• Uma cena por ideia falada — o motion ilustra UMA ideia, não o bloco inteiro.',
    '• Duração da cena: 3–8s, sincronizada com o trecho falado que ela ilustra.',
    '• ANCORE cada motion na palavra-chave: startOffsetSec = tempo (local do bloco) onde a palavra-chave é falada. O motion entra QUANDO a ideia é dita, nunca antes.',
    '• Blocos B-ROLL: o motion É o conteúdo (tela cheia) — startOffsetSec=0 e durationSec = duração total do bloco.',
    '• Blocos AVATAR: o motion flutua sobre o apresentador — janela curta ancorada na palavra. templateId SEMPRE null nesses blocos (templates são designs de tela cheia e cobririam o rosto): escolha um styleHint.',
    '• Varie o visual entre blocos consecutivos (nunca o mesmo template 2× seguidas).',
    '• Seja conservador com templates (só em blocos B-ROLL): escolha um apenas quando o conteúdo pede EXATAMENTE aquele visual; senão templateId=null e um styleHint.',
    input.overlayContext
      ? '• CONTEXTO OVERLAY: tudo flutua sobre vídeo real de talking-head via screen-blend — elementos compactos, nunca cobrindo o rosto.'
      : '',
    '',
    `ROTEIRO COMPLETO:\n${input.scriptText}`,
    '',
    `BLOCOS:\n${blockLines}`,
    '',
    availableTemplates.length > 0 ? `BIBLIOTECA DE TEMPLATES (apenas blocos B-ROLL):\n${catalog}\n` : '',
    `STYLE HINTS VÁLIDOS (quando templateId=null): ${styleList}`,
    '',
    'Para templates: preencha TODAS as variáveis com base no conteúdo do bloco (mesma língua do roteiro' + (input.outputLanguage ? ` — ${input.outputLanguage}` : '') + ', fiel aos fatos, não invente números).',
    '',
    'Responda SOMENTE com JSON válido:',
    '{"plan":[{"blockId":"...","templateId":"<id ou null>","styleHint":"<id ou null>","variables":{...},"startOffsetSec":0.0,"durationSec":0.0,"rationale":"<1 frase>"}]}',
  ].filter(Boolean).join('\n');

  for (const model of getModelCandidates(input.preferredModel)) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 8192 },
      });
      logActualCost('Motion Director', model, response.usageMetadata, 0);
      const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()) as {
        plan?: Array<{
          blockId?: string;
          templateId?: string | null;
          styleHint?: string | null;
          variables?: Record<string, string>;
          startOffsetSec?: number;
          durationSec?: number;
          rationale?: string;
        }>;
      };
      if (!Array.isArray(parsed.plan)) return empty;

      // Client-side validation — never trust the model with timing math.
      const out = new Map<string, DirectorPlanItem>();
      for (const item of parsed.plan) {
        const block = input.blocks.find(b => b.id === item.blockId);
        if (!block) continue;
        const blockDur = block.durationSec;
        // Hard gate regardless of what the model answered: templates only on
        // full-frame ('broll') blocks.
        const templateId = block.kind === 'broll' && item.templateId && validTemplateIds.includes(item.templateId)
          ? item.templateId
          : null;
        const styleHint = !templateId && item.styleHint && (STYLE_PRESET_IDS as readonly string[]).includes(item.styleHint)
          ? item.styleHint
          : undefined;
        let startOffsetSec: number;
        let durationSec: number;
        if (block.kind === 'broll' || blockDur < 3) {
          // B-roll: the motion IS the content. Tiny blocks: no room to anchor.
          startOffsetSec = 0;
          durationSec = blockDur;
        } else {
          startOffsetSec = clamp(item.startOffsetSec ?? 0, 0, blockDur - 1);
          const maxDur = blockDur - startOffsetSec;
          durationSec = clamp(item.durationSec ?? maxDur, Math.min(3, maxDur), Math.min(8, maxDur));
        }
        out.set(block.id, {
          blockId: block.id,
          templateId,
          styleHint,
          variables: templateId ? (item.variables ?? {}) : undefined,
          startOffsetSec,
          durationSec,
          rationale: item.rationale ?? '',
        });
      }
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /not found|NOT_FOUND|not supported|404|503|UNAVAILABLE|overload|RESOURCE_EXHAUSTED|429|500|INTERNAL/i.test(msg);
      if (!retryable) {
        console.warn('[motion/director] planning failed:', msg);
        return empty;
      }
    }
  }
  return empty;
};
