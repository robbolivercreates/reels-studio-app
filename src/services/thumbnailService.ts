import { GoogleGenAI } from '@google/genai';
import { fal } from '@fal-ai/client';
import { invoke } from '@tauri-apps/api/core';
import { buildResearchPrompt, buildFalPrompt } from './thumbnailTemplates';
import { logActualCost } from './costPredictor';

export interface ThumbnailResearchResult {
  visualConceptDescription: string;
  suggestedOverlayText: string;
  researchInsights: string;
}

export interface ThumbnailGenerationOutput {
  dataUrl: string; // "data:image/png;base64,..."
  filename: string;
  insights: string;
  concept: string;
  suggestedText: string;
}

const getGoogleApiKey = (): string => {
  const key = localStorage.getItem('GOOGLE_API_KEY');
  if (!key) throw new Error('GOOGLE_API_KEY não configurada. Adicione em Configurações.');
  return key;
};

const getFalKey = (): string => {
  const key = localStorage.getItem('FAL_KEY');
  if (!key) throw new Error('FAL_KEY não configurada. Adicione em Configurações.');
  return key;
};

const arrayBufferToBase64 = (buf: ArrayBuffer): string => {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
};

function ensureDataUri(base64OrDataUri: string): string {
  if (base64OrDataUri.startsWith('data:')) {
    return base64OrDataUri;
  }
  return `data:image/png;base64,${base64OrDataUri}`;
}

const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
];

function parseGeminiJson(raw: string): ThumbnailResearchResult {
  if (!raw) throw new Error('IA retornou resposta vazia.');

  // Procura por um bloco JSON { ... }
  const match = raw.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : raw;

  try {
    const parsed = JSON.parse(jsonStr);

    const visualConceptDescription = parsed.visualConceptDescription || parsed.visual_concept_description || '';
    const suggestedOverlayText = parsed.suggestedOverlayText || parsed.suggested_overlay_text || '';
    const researchInsights = parsed.researchInsights || parsed.research_insights || '';

    if (!visualConceptDescription || !suggestedOverlayText) {
      throw new Error('Campos obrigatórios ausentes no JSON do Gemini.');
    }

    return {
      visualConceptDescription,
      suggestedOverlayText,
      researchInsights,
    };
  } catch (e) {
    console.error('[thumbnail] Erro ao parsear JSON do Gemini:', raw, e);
    throw new Error('A resposta de pesquisa do Gemini não pôde ser analisada como um JSON estruturado válido.');
  }
}

/**
 * Etapa 1: Pesquisa o nicho e marcas usando o Gemini 3.5 Flash com Google Search Grounding.
 */
export async function researchThumbnailContext(
  title: string,
  script?: string,
  styleInstructions?: string
): Promise<ThumbnailResearchResult> {
  const apiKey = getGoogleApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildResearchPrompt(title, script, styleInstructions);

  let lastError: any = null;
  for (const model of GEMINI_MODELS) {
    try {
      console.log(`[thumbnail] Pesquisando contexto visual via Google Search usando o modelo ${model}...`);
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.2,
        },
      });

      // LOG COST
      logActualCost('Thumbnail Research', model, response.usageMetadata, 1);

      const raw = response.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? '';
      if (!raw || raw.trim().length < 10) {
        throw new Error('Gemini retornou corpo de resposta vazio.');
      }

      console.log('[thumbnail] Resposta bruta do Gemini:', raw.slice(0, 200));
      return parseGeminiJson(raw);
    } catch (err) {
      console.warn(`[thumbnail] Falha com o modelo ${model}:`, err);
      lastError = err;
    }
  }

  throw new Error(`Falha ao realizar pesquisa no Gemini. Último erro: ${lastError?.message || lastError}`);
}

/**
 * Etapa 2: Geração da imagem via fal-ai/gpt-image-2 ou fal-ai/gpt-image-2/edit.
 * Usa somente o FAL_KEY — sem necessidade de openai_api_key no payload.
 */
export async function generateThumbnailImage(
  projectName: string,
  researched: ThumbnailResearchResult,
  creatorPhotoBase64?: string
): Promise<ThumbnailGenerationOutput> {
  const falKey = getFalKey();
  fal.config({ credentials: falKey, suppressLocalCredentialsWarning: true });

  const finalPrompt = buildFalPrompt({
    visualConceptDescription: researched.visualConceptDescription,
    suggestedOverlayText: researched.suggestedOverlayText,
    creatorPhotoProvided: !!creatorPhotoBase64,
  });

  const timestamp = Date.now();
  const filename = `thumbnail-${timestamp}.png`;

  let result: any;
  if (creatorPhotoBase64) {
    console.log('[thumbnail] Enviando prompt e foto para fal-ai/gpt-image-2/edit...');
    const dataUri = ensureDataUri(creatorPhotoBase64);
    result = (await fal.subscribe('fal-ai/gpt-image-2/edit' as any, {
      input: {
        prompt: finalPrompt,
        image_urls: [dataUri],
        quality: 'high',
        output_format: 'png',
        num_images: 1,
      },
    })) as any;
  } else {
    console.log('[thumbnail] Enviando prompt para fal-ai/gpt-image-2...');
    result = (await fal.subscribe('fal-ai/gpt-image-2' as any, {
      input: {
        prompt: finalPrompt,
        image_size: 'portrait_16_9',
        quality: 'high',
        output_format: 'png',
        num_images: 1,
      },
    })) as any;
  }

  console.log('[thumbnail] Resposta do Fal.ai:', JSON.stringify(result).slice(0, 500));

  // GPT Image 2 may return either a CDN URL or a base64 data-URI
  const imageRaw: string | undefined =
    result?.data?.images?.[0]?.url ||
    result?.images?.[0]?.url ||
    result?.image?.url ||
    result?.data?.image?.url;

  if (!imageRaw) {
    throw new Error(`URL da imagem gerada não encontrada na resposta do Fal.ai. Estrutura: ${JSON.stringify(result).slice(0, 300)}`);
  }

  let dataUrl: string;

  if (imageRaw.startsWith('data:')) {
    // Already a base64 data-URI — extract the base64 portion directly
    console.log('[thumbnail] Imagem retornada como data-URI base64.');
    dataUrl = imageRaw;
  } else {
    // CDN URL — fetch the bytes
    console.log('[thumbnail] Baixando imagem gerada de:', imageRaw);
    const fetchResp = await fetch(imageRaw);
    if (!fetchResp.ok) {
      throw new Error(`Falha ao baixar imagem do Fal.ai: ${fetchResp.statusText}`);
    }
    const arrayBuffer = await fetchResp.arrayBuffer();
    const base64Bytes = arrayBufferToBase64(arrayBuffer);
    dataUrl = `data:image/png;base64,${base64Bytes}`;
  }

  return {
    dataUrl,
    filename,
    insights: researched.researchInsights,
    concept: researched.visualConceptDescription,
    suggestedText: researched.suggestedOverlayText,
  };
}

/**
 * Salva explicitamente uma thumbnail em base64 (data URL) na pasta de assets do projeto via Tauri.
 */
export async function saveThumbnailToAssets(
  projectName: string,
  filename: string,
  dataUrl: string
): Promise<string> {
  const base64Bytes = dataUrl.startsWith('data:') ? dataUrl.split(',')[1] : dataUrl;
  console.log(`[thumbnail] Gravando asset ${filename} para o projeto ${projectName}...`);
  const absolutePath = await invoke<string>('write_asset_bytes', {
    projectName,
    filename,
    base64Bytes,
  });
  console.log('[thumbnail] Thumbnail gravada com sucesso em:', absolutePath);
  return absolutePath;
}

/**
 * Orquestrador completo do pipeline de thumbnails.
 */
export async function generateThumbnail(params: {
  projectName: string;
  videoTitle: string;
  scriptSummary?: string;
  instructions?: string;
  creatorPhotoBase64?: string;
}): Promise<ThumbnailGenerationOutput> {
  const { projectName, videoTitle, scriptSummary, instructions, creatorPhotoBase64 } = params;

  console.log('[thumbnail] Iniciando pipeline de thumbnail...');
  const researched = await researchThumbnailContext(videoTitle, scriptSummary, instructions);
  console.log('[thumbnail] Pesquisa de branding e CTR concluída.');

  const result = await generateThumbnailImage(projectName, researched, creatorPhotoBase64);
  return result;
}
