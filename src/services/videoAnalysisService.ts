import { GoogleGenAI, Type } from '@google/genai';
import type { ScriptBlock, BlockKind, RegenerateContext } from '../components/reelsStudio/types';
import { buildVoicePromptSection, type VoiceProfile } from '../components/reelsStudio/voiceProfile';
import { buildRegenPromptSection } from './regenPrompt';

export interface BlockDirection {
  /** Index in the blocks array this direction applies to. */
  blockIndex: number;
  /** Tom/energia ("confiante, didático", "energia 7/10"). One short line. */
  delivery: string;
  /** Câmera + plano ("plano médio, vertical 9:16, cabeça no terço superior"). */
  framing: string;
  /** Apenas para B-roll: o que aparece na tela / o que filmar / sequência de ações. */
  screenAction?: string;
  /** Mood / referência visual em 1-2 palavras ("clean", "ritmo cortado", "still life"). */
  mood: string;
}

export interface ProductionNotes {
  /** Equipamento / setup mínimo recomendado pra esse reel específico. */
  setup: string;
  /** 3-5 itens curtos, específicos pro vídeo (não genéricos). */
  watchOuts: string[];
  /** Sugestão de música / ambiente sonoro ("trilha lo-fi", "sem música, só voz"). */
  soundbed: string;
}

export interface VideoAnalysisResult {
  language: string;
  format: string;
  hookStyle: string;
  tone: string[];
  durationSec: number;
  blocks: ScriptBlock[];
  /** Verbatim transcript of the source video, with timestamps. Source language. */
  transcript: { start: number; end: number; text: string }[];
  /** Same length/order as blocks, but with the original verbatim wording. */
  originalBlocks: { kind: BlockKind; text: string }[];
  brollSuggestions: { blockText: string; idea: string }[];
  /** Per-block production direction, aligned by index with blocks. */
  directions: BlockDirection[];
  /** Reel-level production notes (setup, watch-outs, soundbed). */
  production: ProductionNotes;
}

const uid = () => `b_${Math.random().toString(36).slice(2, 9)}`;

const SYSTEM_PROMPT = `You analyse a short-form vertical video (Reel / TikTok / Short) so a user can recreate a similar one in our editor.

You produce ONE JSON object with these fields:

1. "language" (BCP-47): the language detected in the SOURCE video.
2. "format": short tag ("talking head with screen demos", "POV with VO", "carousel of clips"…).
3. "hookStyle": what the speaker / visual does in the first 1-3 seconds to grab attention.
4. "tone": 3-6 short English adjectives describing the source tone.
5. "durationSec": approximate total duration in seconds.
6. "transcript": timestamped transcript in the ORIGINAL language (keep exact wording, skip "um/ah" fillers).
7. "blocks": the script segmented for the editor. Each block:
   - "kind": "avatar" when the speaker is on-camera (or should be reproduced as an avatar talking-head),
   - "kind": "broll" when only voice plays while the visual shows a screen / object / cutaway.
   - "text": the script text the user will RECORD. Apply the REWRITE LEVEL below to decide language and faithfulness.
   Aim for 4-8 blocks for a typical 15-45s reel. Each block 2-7 seconds spoken.
7b. "originalBlocks": EXACTLY the same number of blocks as in "blocks", in the SAME order, but with the VERBATIM original wording (in the SOURCE language). This is what the original creator literally said in each beat — never translated, never rewritten. Used to show the user "what the other person did" alongside their own version. Each entry: { kind, text }.
8. "brollSuggestions": for each broll block, one sentence describing a visual idea. Use the same language as "blocks[].text".
9. "directions": one entry per block (same order as "blocks", "blockIndex" matches). Each entry must contain:
   - "delivery": one short line of acting/voice direction ("confiante, didático, energia 7/10", "casual e baixo, quase sussurrando").
   - "framing": shot description ("plano médio, vertical 9:16, cabeça no terço superior, luz frontal").
   - "screenAction": ONLY for "broll" blocks — concrete sequence of what to film/record (e.g. "abrir o app, clicar Importar, mostrar timeline populando, hover no bloco 3"). For "avatar" blocks, leave empty string.
   - "mood": 1-3 word vibe ("clean", "ritmo cortado", "still life", "frenético").
10. "production": reel-level notes:
    - "setup": one line on equipment/environment specific to THIS reel ("luz natural pela janela, mic lapela, fundo limpo de parede branca").
    - "watchOuts": 3-5 SPECIFIC pitfalls observed in the source video that the user must avoid or replicate ("evite cortar a cabeça em close", "mantenha cursor visível em recordings de tela"). Be specific, not generic.
    - "soundbed": music/audio recommendation ("sem trilha, só voz e ruído ambiente leve", "lo-fi suave a -18dB").

Direction language rule: the "delivery", "framing", "screenAction", "mood", "setup", "watchOuts", and "soundbed" fields MUST be written in the OUTPUT LANGUAGE chosen by the user (see VOICE PROFILE below). They are guidance for the user, not voice-over text — TTS rules do NOT apply here, normal punctuation/numbers/abbreviations are fine.

Anti-plagiarism rule: when rewriting "blocks[].text", never copy >6 consecutive words from the source (besides proper nouns / unavoidable terms). Match meaning, hook structure, beat count, and approximate per-block duration — not phrasing.

Return ONLY valid JSON matching the provided schema. No markdown, no commentary.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    language: { type: Type.STRING },
    format: { type: Type.STRING },
    hookStyle: { type: Type.STRING },
    tone: { type: Type.ARRAY, items: { type: Type.STRING } },
    durationSec: { type: Type.NUMBER },
    transcript: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          start: { type: Type.NUMBER },
          end: { type: Type.NUMBER },
          text: { type: Type.STRING },
        },
        required: ['start', 'end', 'text'],
      },
    },
    blocks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: ['avatar', 'broll'] },
          text: { type: Type.STRING },
        },
        required: ['kind', 'text'],
      },
    },
    originalBlocks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: ['avatar', 'broll'] },
          text: { type: Type.STRING },
        },
        required: ['kind', 'text'],
      },
    },
    brollSuggestions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          blockText: { type: Type.STRING },
          idea: { type: Type.STRING },
        },
        required: ['blockText', 'idea'],
      },
    },
    directions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          blockIndex: { type: Type.NUMBER },
          delivery: { type: Type.STRING },
          framing: { type: Type.STRING },
          screenAction: { type: Type.STRING },
          mood: { type: Type.STRING },
        },
        required: ['blockIndex', 'delivery', 'framing', 'screenAction', 'mood'],
      },
    },
    production: {
      type: Type.OBJECT,
      properties: {
        setup: { type: Type.STRING },
        watchOuts: { type: Type.ARRAY, items: { type: Type.STRING } },
        soundbed: { type: Type.STRING },
      },
      required: ['setup', 'watchOuts', 'soundbed'],
    },
  },
  required: ['language', 'format', 'hookStyle', 'tone', 'durationSec', 'transcript', 'blocks', 'originalBlocks', 'brollSuggestions', 'directions', 'production'],
} as const;

const getApiKey = (): string => {
  const key = localStorage.getItem('GOOGLE_API_KEY');
  if (!key) throw new Error('GOOGLE_API_KEY não configurada. Adicione em Configurações pra analisar vídeos.');
  return key;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
};

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const buf = await blob.arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
};

const sanitizeMime = (file: Blob | { type?: string }): string => {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('video/')) return t.split(';')[0];
  return 'video/mp4';
};

// Flash em primeiro (multimodal barato); Pro como fallback de qualidade.
// Flash Lite foi cortado — em análise de vídeo ele perde direção/tone com
// frequência o suficiente pra atrapalhar mais que ajudar no custo.
const MODEL_CANDIDATES = ['gemini-3-flash-preview', 'gemini-3.1-pro-preview'];

/** Status callback for the UI — surfaces upload/processing stages of large files. */
export type AnalysisStatus =
  | { stage: 'analyzing' }
  | { stage: 'uploading'; megabytes: number }
  | { stage: 'processing-upload' };

/** Encapsulates the video payload sent to Gemini — either inline base64 (small) or a Files API handle (large). */
type VideoPayload =
  | { kind: 'inline'; mimeType: string; data: string }
  | { kind: 'file'; fileUri: string; mimeType: string };

const callGemini = async (
  payload: VideoPayload,
  voiceProfile?: VoiceProfile,
  regen?: RegenerateContext,
): Promise<VideoAnalysisResult> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  type PromptPart =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { fileUri: string; mimeType: string } };

  const promptParts: PromptPart[] = [{ text: SYSTEM_PROMPT }];
  if (voiceProfile) {
    promptParts.push({ text: '\n\n' + buildVoicePromptSection(voiceProfile) });
  }
  const regenSection = buildRegenPromptSection(regen);
  if (regenSection) promptParts.push({ text: regenSection });

  if (payload.kind === 'inline') {
    promptParts.push({ inlineData: { mimeType: payload.mimeType, data: payload.data } });
  } else {
    promptParts.push({ fileData: { fileUri: payload.fileUri, mimeType: payload.mimeType } });
  }

  let lastError: unknown;
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
  for (const model of MODEL_CANDIDATES) {
    try {
      response = await ai.models.generateContent({
        model,
        contents: { parts: promptParts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
          temperature: regen
            ? 0.9
            : voiceProfile?.rewriteLevel === 'reimagine' ? 0.85 : 0.55,
        },
      });
      break;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Only fall through on "model not found / not supported"; rethrow other errors.
      if (!/not found|NOT_FOUND|not supported|404/i.test(msg)) throw err;
    }
  }
  if (!response) throw lastError instanceof Error ? lastError : new Error('Nenhum modelo Gemini disponível.');

  const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) throw new Error('Gemini não retornou conteúdo. Tente de novo.');

  let parsed: {
    language: string;
    format: string;
    hookStyle: string;
    tone: string[];
    durationSec: number;
    transcript: { start: number; end: number; text: string }[];
    blocks: { kind: BlockKind; text: string }[];
    originalBlocks?: { kind: BlockKind; text: string }[];
    brollSuggestions: { blockText: string; idea: string }[];
    directions?: { blockIndex: number; delivery: string; framing: string; screenAction?: string; mood: string }[];
    production?: { setup: string; watchOuts: string[]; soundbed: string };
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Resposta da IA inválida (não é JSON).');
    parsed = JSON.parse(match[0]);
  }

  if (!parsed.blocks?.length) throw new Error('IA não retornou blocos.');

  const blocks: ScriptBlock[] = parsed.blocks.map(b => ({
    id: uid(),
    kind: b.kind === 'broll' ? 'broll' : 'avatar',
    text: b.text.trim(),
    start: 0,
    end: 0,
  }));

  // Normalise directions — ensure 1 entry per block, even if Gemini skipped some.
  const rawDirections = parsed.directions ?? [];
  const directions: BlockDirection[] = blocks.map((_, idx) => {
    const found = rawDirections.find(d => d.blockIndex === idx) ?? rawDirections[idx];
    return {
      blockIndex: idx,
      delivery: found?.delivery?.trim() ?? '',
      framing: found?.framing?.trim() ?? '',
      screenAction: found?.screenAction?.trim() || undefined,
      mood: found?.mood?.trim() ?? '',
    };
  });

  const production: ProductionNotes = {
    setup: parsed.production?.setup?.trim() ?? '',
    watchOuts: (parsed.production?.watchOuts ?? []).map(s => s.trim()).filter(Boolean),
    soundbed: parsed.production?.soundbed?.trim() ?? '',
  };

  // originalBlocks: align length to blocks, fall back to current blocks if Gemini skipped.
  const originalBlocks = (parsed.originalBlocks ?? []).slice(0, blocks.length);
  while (originalBlocks.length < blocks.length) {
    const idx = originalBlocks.length;
    originalBlocks.push({ kind: blocks[idx].kind, text: blocks[idx].text });
  }

  return {
    language: parsed.language ?? 'pt-BR',
    format: parsed.format ?? '',
    hookStyle: parsed.hookStyle ?? '',
    tone: parsed.tone ?? [],
    durationSec: parsed.durationSec ?? 0,
    blocks,
    transcript: parsed.transcript ?? [],
    originalBlocks: originalBlocks.map(b => ({ kind: b.kind === 'broll' ? 'broll' : 'avatar', text: b.text.trim() })),
    brollSuggestions: parsed.brollSuggestions ?? [],
    directions,
    production,
  };
};

/**
 * Inline base64 cap. Gemini hard limit is ~20MB; we keep 2MB of margin to
 * avoid edge-case rejections (base64 inflates size ~33%, plus the rest of the prompt).
 */
const MAX_INLINE_BYTES = 18 * 1024 * 1024;
/**
 * Files API hard cap we surface to the user. Google supports up to 2GB, but
 * 500MB covers every reasonable Reel/TikTok/Short and avoids 30-min uploads.
 */
const MAX_FILES_API_BYTES = 500 * 1024 * 1024;

/** Polls the Files API until the uploaded video is in ACTIVE state (or fails). */
const waitForFileActive = async (
  ai: GoogleGenAI,
  fileName: string,
  onStatus?: (s: AnalysisStatus) => void,
): Promise<void> => {
  const POLL_INTERVAL_MS = 1500;
  const TIMEOUT_MS = 90_000;
  const started = Date.now();
  while (true) {
    const f = await ai.files.get({ name: fileName });
    if (f.state === 'ACTIVE') return;
    if (f.state === 'FAILED') {
      throw new Error(
        `O Gemini não conseguiu processar o vídeo enviado${f.error?.message ? `: ${f.error.message}` : '.'}`,
      );
    }
    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error('Timeout: o Gemini demorou mais de 90s pra processar o vídeo. Tente de novo.');
    }
    onStatus?.({ stage: 'processing-upload' });
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
};

/** Uploads via Files API and waits for ACTIVE. Returns the file URI ready to use in `fileData`. */
const uploadAndWaitForFile = async (
  blob: Blob,
  mimeType: string,
  onStatus?: (s: AnalysisStatus) => void,
): Promise<{ fileUri: string; fileName: string }> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  onStatus?.({ stage: 'uploading', megabytes: +(blob.size / 1024 / 1024).toFixed(1) });
  const uploaded = await ai.files.upload({ file: blob, config: { mimeType } });
  if (!uploaded.name || !uploaded.uri) {
    throw new Error('Upload do vídeo retornou resposta inválida do Gemini.');
  }
  await waitForFileActive(ai, uploaded.name, onStatus);
  return { fileUri: uploaded.uri, fileName: uploaded.name };
};

/** Fire-and-forget cleanup. Failure is logged but never thrown — Google auto-deletes in 48h anyway. */
const deleteFileQuietly = (fileName: string): void => {
  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    void ai.files.delete({ name: fileName }).catch(err => {
      console.warn('[videoAnalysis] cleanup failed (will auto-expire in 48h):', err);
    });
  } catch (err) {
    console.warn('[videoAnalysis] cleanup skipped:', err);
  }
};

/**
 * Decides between inline (≤18MB) and Files API (>18MB, ≤500MB). Above 500MB throws.
 * After Files API analysis, schedules a fire-and-forget delete to keep the user's
 * data on Google servers for as little time as possible.
 */
const analyseFromBlob = async (
  blob: Blob,
  voiceProfile?: VoiceProfile,
  regen?: RegenerateContext,
  onStatus?: (s: AnalysisStatus) => void,
): Promise<VideoAnalysisResult> => {
  const mimeType = sanitizeMime(blob);

  if (blob.size > MAX_FILES_API_BYTES) {
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    throw new Error(
      `Vídeo de ${mb}MB é grande demais (limite: 500MB). Corte um trecho específico do Reel ou comprime antes.`,
    );
  }

  // Small enough → inline (fast, no upload roundtrip).
  if (blob.size <= MAX_INLINE_BYTES) {
    onStatus?.({ stage: 'analyzing' });
    const base64 = await blobToBase64(blob);
    return callGemini({ kind: 'inline', mimeType, data: base64 }, voiceProfile, regen);
  }

  // Larger → Files API.
  const { fileUri, fileName } = await uploadAndWaitForFile(blob, mimeType, onStatus);
  onStatus?.({ stage: 'analyzing' });
  try {
    const result = await callGemini({ kind: 'file', fileUri, mimeType }, voiceProfile, regen);
    // Privacy default: delete the uploaded file as soon as analysis is done.
    // Fire-and-forget — user is already moving on to the preview.
    deleteFileQuietly(fileName);
    return result;
  } catch (err) {
    // On failure, still try to clean up the upload so it doesn't sit on Google for 48h.
    deleteFileQuietly(fileName);
    throw err;
  }
};

export const analyseReferenceBlob = async (
  file: Blob,
  voiceProfile?: VoiceProfile,
  regen?: RegenerateContext,
  onStatus?: (s: AnalysisStatus) => void,
): Promise<VideoAnalysisResult> => {
  return analyseFromBlob(file, voiceProfile, regen, onStatus);
};

export const analyseReferenceFromBytes = async (
  bytes: Uint8Array,
  mimeType?: string,
  voiceProfile?: VoiceProfile,
  regen?: RegenerateContext,
  onStatus?: (s: AnalysisStatus) => void,
): Promise<VideoAnalysisResult> => {
  // BlobPart in modern TS requires ArrayBuffer (not SharedArrayBuffer); slice() guarantees a plain one.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([ab], { type: mimeType?.startsWith('video/') ? mimeType : 'video/mp4' });
  return analyseFromBlob(blob, voiceProfile, regen, onStatus);
};
