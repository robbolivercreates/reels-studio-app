import { GoogleGenAI, Type } from '@google/genai';
import { logActualCost, calculateActualCost } from './costPredictor';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Breakdown modes — accumulative. Each adds a different angle to the analysis. */
export type BreakdownMode = 'script' | 'visual' | 'full' | 'reconstruct';

export interface ViralMoment {
  startSec: number;
  endSec: number;
  /** ex: "Curiosity Gap", "Pattern Interrupt", "Social Proof Stack" */
  technique: string;
  category: 'hook' | 'retention' | 'value' | 'social_proof' | 'cta';
  /** What visually/verbally happens in this segment. */
  description: string;
  /** Psychological explanation of why this technique retains attention. */
  why_it_works: string;
  /** Attention score 0–10. */
  attention_score: number;
  /** Visual detail (camera angle, text overlay, editing cut) — populated when 'visual' mode active. */
  visual_detail?: string;
}

export interface ReconstructionScene {
  scene_index: number;
  startSec: number;
  endSec: number;
  /** Verbatim speech — exactly what the person says, word for word. */
  speech: string;
  /** Physical: how they hold the phone, body position, head angle, gestures, facial expression. */
  physical: string;
  /** Camera & framing: distance (close/medium/wide), angle (eye-level/low/high), movement, selfie vs. tripod. */
  camera: string;
  /** Visuals: background, lighting direction & quality, props, text overlays, stickers, transitions. */
  visuals: string;
  /** Audio: tone of voice, pace, music, sound effects, ambient sound. */
  audio: string;
  /** Director's tip: what specifically makes this scene work / what to replicate carefully. */
  director_note: string;
  /** Ready-to-paste Seedance 2.0 shot-script prompt to recreate this scene with AI video generation. */
  seedance_prompt: string;
}

export interface ReconstructionScript {
  scenes: ReconstructionScene[];
  /** Overall physical setup to recreate the video (location, lighting rig, phone mount, etc.). */
  shooting_setup: string;
  /** Minimal equipment list to reproduce the video. */
  equipment: string[];
}

export interface VideoSocialStats {
  title: string;
  uploader: string;
  view_count?: number;
  like_count?: number;
  duration_sec: number;
  upload_date?: string;
  platform?: string;
}

export interface ViralBreakdown {
  title: string;
  duration_sec: number;
  /** Overall virality score 0–100. */
  virality_score: number;
  /** 3–5 reasons why this video went viral. */
  virality_reasons: string[];
  /** Full second-by-second timeline. */
  timeline: ViralMoment[];
  /** Top 3–5 highest-impact moments from the timeline. */
  key_moments: ViralMoment[];
  /** One-line formula distilling the video's structure. */
  formula: string;
  /** Copyable hook template derived from the original hook. */
  hook_template: string;
  /** Ordered structural beats, e.g. ["Hook 3s", "Problema 8s", "CTA 5s"]. */
  structure: string[];
  /** Ready-to-use prompt for creating a new Reel based on this formula. */
  replication_prompt: string;
  /** Verbatim transcript with timestamps — populated when 'script' mode active. */
  transcript?: { startSec: number; endSec: number; text: string }[];
  /** Copy analysis: hook, tone, banned patterns — populated when 'script' mode active. */
  copy_analysis?: {
    hook_breakdown: string;
    tone: string[];
    power_words: string[];
    cta_formula: string;
  };
  /** Visual editing analysis — populated when 'visual' mode active. */
  visual_analysis?: {
    edit_rhythm: string;
    text_overlays: string[];
    camera_moves: string[];
    broll_types: string[];
    // ── Study-creator extension: editing patterns actionable in our editor ──
    /** Frame-by-frame description of what happens visually in 0–2s. */
    hook_visual?: string;
    /** Scene count, average length, rhythm variance ("8 cenas, média 2.1s, acelera no meio"). */
    pacing?: string;
    /** Caption mechanics: karaoke vs phrase chunks, position, pop effect. */
    caption_style?: string;
    /** Scene archetypes present: talking head, data grid, stamp overlay, product demo, b-roll. */
    scene_archetypes?: string[];
    /** Transition flavors + cadence: hard cuts, pushes, flashes, whip-pans. */
    transition_flavors?: string[];
    /** 3–5 dominant hex colors of the video's visual identity. */
    palette?: string[];
    /** The creator's signature move in one sentence. */
    signature_move?: string;
    /** Actionable techniques to replicate, each mapped to a concrete editing action. */
    what_to_steal?: string[];
  };
  /** Scene-by-scene reconstruction script — populated when 'reconstruct' mode active. */
  reconstruction?: ReconstructionScript;
  /** Social stats injected from yt-dlp metadata (not from Gemini). */
  social_stats?: VideoSocialStats;
  /** Which modes were active for this analysis. */
  modes: BreakdownMode[];
}

// ─── Internal ─────────────────────────────────────────────────────────────────

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

const sanitizeMime = (blob: Blob): string => {
  const t = (blob.type || '').toLowerCase();
  if (t.startsWith('video/')) return t.split(';')[0];
  return 'video/mp4';
};

const MODEL_CANDIDATES = ['gemini-3.1-flash', 'gemini-3.1-pro-preview'];

const MAX_INLINE_BYTES = 18 * 1024 * 1024;
const MAX_FILES_API_BYTES = 500 * 1024 * 1024;

export type BreakdownStatus =
  | { stage: 'analyzing' }
  | { stage: 'uploading'; megabytes: number }
  | { stage: 'processing-upload' };

type VideoPayload =
  | { kind: 'inline'; mimeType: string; data: string }
  | { kind: 'file'; fileUri: string; mimeType: string };

// ─── Dynamic prompt builder ───────────────────────────────────────────────────

const buildPrompt = (modes: BreakdownMode[]): string => {
  const hasScript = modes.includes('script') || modes.includes('full');
  const hasVisual = modes.includes('visual') || modes.includes('full');
  const hasReconstruct = modes.includes('reconstruct') || modes.includes('full');

  const scriptSection = hasScript ? `
MODO ROTEIRO — análise de copy e narrativa:
- "transcript": transcrição VERBATIM frase por frase. REGRA: cada entrada = 1 frase (máximo 2 frases curtas). Para um vídeo de 90s com 15 frases, você deve ter 15 entradas no transcript — NÃO 1, 2 ou 3. Timestamps precisos por frase. Idioma original do vídeo, sem traduzir.
- "copy_analysis":
  - "hook_breakdown": análise detalhada de como o hook abre o vídeo (primeiros 3-5 segundos).
  - "tone": 4-6 adjetivos descrevendo o tom do locutor.
  - "power_words": palavras/frases de alto impacto que o criador usa.
  - "cta_formula": como o CTA é estruturado (urgência, benefício, ação).
` : '';

  const visualSection = hasVisual ? `
MODO VISUAL — análise de imagem/edição:
- Para cada momento na "timeline", preencha "visual_detail" com: ângulo de câmera, texto na tela, tipo de corte, B-roll usado.
- "visual_analysis":
  - "edit_rhythm": ritmo de edição (ex: "corte a cada 2-3s", "jump cuts agressivos", "sem cortes — câmera estática").
  - "text_overlays": lista de textos/legendas que aparecem na tela ao longo do vídeo.
  - "camera_moves": movimentos de câmera (zoom in, pan, estático, selfie, etc.).
  - "broll_types": tipos de B-roll usados (screen recording, produto em mão, ambiente, animação, etc.).
  - "hook_visual": descrição frame a frame do que acontece VISUALMENTE em 0–2s (o que aparece, em que ordem, com que efeito).
  - "pacing": distribuição de ritmo — quantas cenas, duração média, onde acelera/desacelera (ex: "8 cenas, média 2.1s, acelera no meio").
  - "caption_style": mecânica das legendas — karaokê palavra-a-palavra vs blocos de frase, posição na tela, efeito de destaque (pop/cor/escala).
  - "scene_archetypes": arquétipos de cena presentes (talking head, data grid, stamp overlay, demo de produto, b-roll, gráfico animado…).
  - "transition_flavors": sabores de transição usados + cadência (hard cuts, pushes, flashes, whip-pans — e com que frequência alternam).
  - "palette": 3–5 cores dominantes em hex que definem a identidade visual do vídeo.
  - "signature_move": A assinatura visual deste criador em UMA frase (o movimento/efeito que se repete e identifica o estilo).
  - "what_to_steal": 3–6 técnicas acionáveis para replicar, cada uma descrita como ação concreta de edição (ex: "stamp de texto que carimba 0.2s depois do título aparecer", "número gigante contando de 0 ao valor").
` : '';

  const reconstructSection = hasReconstruct ? `
MODO RECONSTRUÇÃO — roteiro de produção para Seedance (clips de até 15s):
Imagine que outra pessoa precisa recriar este vídeo usando IA (Seedance). Cada cena = 1 clip Seedance de até 15 segundos.

⚠️ GRANULARIDADE DAS CENAS (SEEDANCE = máximo 15s por clip):
- Cada cena = máximo 15 segundos.
- Quebre em nova cena em: corte de câmera, mudança de fundo/local, mudança de assunto, ou a cada 12–15s.
- Para 90s de vídeo: mínimo 6 cenas, máximo 15 cenas.
- NUNCA retorne apenas 1, 2 ou 3 cenas para vídeos com mais de 30s — é ERRO CRÍTICO.
- O campo "speech" deve ter TODO o diálogo do intervalo (pode ser um parágrafo inteiro com 3-4 frases).

Crie um "reconstruction" com:
- "scenes": uma cena por bloco visual/narrativo de até 15s.
  Para cada cena, seja MINUCIOSO em todos os campos:

  - "scene_index": número da cena (começa em 1).
  - "startSec" / "endSec": tempo exato em segundos.

  - "speech": TODO o diálogo desta cena — transcreva TODAS as frases ditas neste intervalo, em ordem, como um parágrafo. Se a pessoa diz 3 frases neste bloco de 12s, escreva as 3 frases. Se não fala nada, deixe "". Inclua pausas, repetições, interjeições — tudo, verbatim.

  - "physical": descrição física DETALHADA:
    • Como segura o dispositivo (vertical selfie com mão direita, tripé, mesa)
    • Posição do corpo (sentado em cadeira de escritório, em pé encostado na parede, andando)
    • Inclinação/postura (levemente inclinado à frente, costas retas, relaxado)
    • O que as mãos fazem (mão livre gesticulando, segura objeto, aponta para fora do quadro)
    • Expressão facial (sorriso contido, sobrancelha levantada, olhar direto para a câmera, olha para baixo)
    • Movimentos da cabeça (vira para o lado ao mencionar X, acena afirmativamente)
    • Roupas visíveis se relevante para o contexto

  - "camera": descrição completa da câmera:
    • Distância do rosto (close extremo só nos olhos, close no rosto, plano médio busto, plano médio, plano aberto)
    • Altura e ângulo (ao nível dos olhos, levemente de baixo para cima criando autoridade, levemente de cima para baixo)
    • Movimento durante a cena (completamente estático, leve tremor de mão, zoom in lento de 5% ao longo da cena, pan suave para a direita)
    • Qual câmera aparenta ser (câmera frontal selfie, câmera traseira com braço esticado, câmera em tripé, câmera profissional com operador)
    • Orientação (vertical 9:16, horizontal 16:9)

  - "visuals": tudo que aparece na tela — seja ESPECÍFICO:
    • Fundo: cor exata, textura, objetos visíveis, se é interior/exterior, dia/noite
    • Iluminação: fonte principal (janela ao fundo, ring light frontal, luz de teto difusa, luz natural lateral), temperatura de cor (quente/fria), sombras visíveis
    • Textos sobrepostos: transcreva EXATAMENTE o que está escrito, posição na tela (topo, centro, parte inferior), estilo (fonte grande branca com sombra, legenda automática pequena)
    • Stickers, emojis, setas, efeitos de tela se houver
    • Transições entrando ou saindo desta cena (corte direto, fade, swipe)
    • Props ou objetos que aparecem em mão ou em fundo

  - "audio": descrição completa do áudio:
    • Tom de voz (energético e rápido, calmo e pausado, sussurrado, animado com ênfases)
    • Ritmo da fala (frases curtas e diretas, uma frase longa seguida de pausa dramática)
    • Volume relativo (normal, mais alto para enfatizar ponto X)
    • Música de fundo: existe? Tipo (lofi, pop, dramática, sem música), volume (quase imperceptível, audível mas não domina, dominante)
    • Efeitos sonoros: whoosh, ding, risada enlatada, silêncio proposital, etc.

  - "director_note": em 1-2 frases, o detalhe MAIS CRÍTICO desta cena — o que fará ou quebrará a replicação. O que um diretor avisaria antes de filmar.

  - "seedance_prompt": prompt completo no formato Seedance 2.0 Shot-Script. Siga EXATAMENTE esta estrutura de 6 linhas (substitua os valores entre < >):
    STYLE: <âncora específica — ex: "iPhone 14 selfie, warm indoor light, natural skin tones, slight overexposure" | "35mm handheld film, golden hour exterior, warm shadows" | "iPhone 16 Pro selfie, overcast daylight, desaturated" — NUNCA genérico "cinematic">
    DURATION: <duração desta cena em segundos>s
    SHOT: <MM:SS>-<MM:SS> Shot <N>: <Nome descritivo da cena> (<Tipo de câmera: selfie frontal vertical / câmera traseira / tripé fixo / câmera profissional>).
    SCENE: <Ambiente completo: fundo exato, iluminação, objetos visíveis, texto na tela se houver>.
    ACTION: <Pessoa: ação física detalhada, expressão facial, gesto, o que segura>. Diz: "<diálogo verbatim desta cena — todas as frases ditas, ou resumo se mais de 30 palavras>".
    AUDIO: <Tom de voz, ritmo, música de fundo tipo/volume, efeitos sonoros>.
    CONSTRAINTS: avoid jitter, avoid bent limbs, avoid temporal flicker, avoid identity drift, avoid scene cuts.

- "shooting_setup": parágrafo completo descrevendo o setup para refilmar — localização ideal, como montar a iluminação, posição do suporte de câmera, distância da parede/fundo, o que preparar antes de gravar.
- "equipment": lista completa de tudo que é necessário (ex: "iPhone 15 Pro no modo Cinemático", "Ring light 10 polegadas com difusor", "Suporte de mesa articulado", "Fone de ouvido Bluetooth para escuta de referência").
` : '';

  return `Você é um analista especializado em vídeos virais de formato curto (Reels, TikTok, Shorts).

Assista ao vídeo fornecido e produza um JSON de "viral breakdown" — uma autopsia completa explicando O QUÊ acontece e POR QUÊ cada momento funciona psicologicamente para reter atenção e gerar compartilhamentos.

⚠️ REGRAS DE GRANULARIDADE — OBRIGATÓRIAS:

TIMELINE (análise de engajamento) — segmentos CURTOS:
- Máximo 5s por entrada. Cada frase = nova entrada. Cada corte = nova entrada.
- Vídeo 30s → mínimo 8 entradas. Vídeo 60s → mínimo 15. Vídeo 90s → mínimo 20.
- NUNCA retorne 1, 2 ou 3 entradas para vídeos com mais de 20s — é ERRO CRÍTICO.

CENAS DE RECONSTRUÇÃO (Seedance chunks) — até 15 segundos:
- Cada cena = 1 clip Seedance = máximo 15 segundos.
- Quebre em nova cena em: corte de câmera, mudança de local/fundo, mudança de assunto, ou a cada 12–15s.
- Vídeo 90s → mínimo 6 cenas, máximo 15 cenas.
- O campo "speech" de cada cena deve ter TODA a fala dita naquele intervalo (pode ser um parágrafo com várias frases).

TRANSCRIPT (falas individuais) — uma entrada por frase:
- Cada frase dita = 1 entrada separada. Para 20 frases no vídeo = 20 entradas no transcript.

CAMPOS OBRIGATÓRIOS (sempre presentes):
1. "title": título descritivo curto para este breakdown.
2. "duration_sec": duração total em segundos.
3. "virality_score": score 0–100 de potencial viral. Seja calibrado — só vídeos com hook forte e muito bem produzidos passam de 80.
4. "virality_reasons": 3–5 strings, cada uma nomeando uma razão específica de viralidade.
5. "timeline": todo o vídeo coberto sem lacunas, máximo 5s por entrada.
   - "startSec" / "endSec": intervalo exato em segundos.
   - "technique": nome da técnica (ex: "Curiosity Gap", "Pattern Interrupt", "Social Proof Stack", "Loop Opening", "Contrast Cut", "Micro-CTA", "Authority Anchor", "Open Loop").
   - "category": hook | retention | value | social_proof | cta.
   - "description": o que acontece visual e verbalmente neste instante — seja concreto.
   - "why_it_works": mecanismo psicológico exato.
   - "attention_score": 0–10.
   - "visual_detail": string vazia "" se modo visual não ativo.
6. "key_moments": os 3–5 momentos de maior impacto. Copie o objeto completo da timeline.
7. "formula": 1-2 linhas destilando a estrutura estratégica do vídeo.
8. "hook_template": template fill-in-the-blank derivado do gancho de abertura.
9. "structure": lista ordenada de beats estruturais com duração.
10. "replication_prompt": prompt em PT-BR completo para gerar um novo Reel com a mesma fórmula.
${scriptSection}${visualSection}${reconstructSection}
IDIOMA: escreva todos os campos em PT-BR, exceto nomes de técnicas em "technique" (mantê-los em inglês para clareza).

Retorne APENAS JSON válido. Sem markdown, sem comentários.`;
};

// ─── Schema ───────────────────────────────────────────────────────────────────

const MOMENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    startSec: { type: Type.NUMBER },
    endSec: { type: Type.NUMBER },
    technique: { type: Type.STRING },
    category: { type: Type.STRING, enum: ['hook', 'retention', 'value', 'social_proof', 'cta'] },
    description: { type: Type.STRING },
    why_it_works: { type: Type.STRING },
    attention_score: { type: Type.NUMBER },
    visual_detail: { type: Type.STRING },
  },
  required: ['startSec', 'endSec', 'technique', 'category', 'description', 'why_it_works', 'attention_score', 'visual_detail'],
} as const;

const SCENE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    scene_index: { type: Type.NUMBER },
    startSec: { type: Type.NUMBER },
    endSec: { type: Type.NUMBER },
    speech: { type: Type.STRING },
    physical: { type: Type.STRING },
    camera: { type: Type.STRING },
    visuals: { type: Type.STRING },
    audio: { type: Type.STRING },
    director_note: { type: Type.STRING },
    seedance_prompt: { type: Type.STRING },
  },
  required: ['scene_index', 'startSec', 'endSec', 'speech', 'physical', 'camera', 'visuals', 'audio', 'director_note', 'seedance_prompt'],
} as const;

const buildSchema = (modes: BreakdownMode[]) => {
  const hasScript = modes.includes('script') || modes.includes('full');
  const hasVisual = modes.includes('visual') || modes.includes('full');
  const hasReconstruct = modes.includes('reconstruct') || modes.includes('full');

  const props: Record<string, unknown> = {
    title: { type: Type.STRING },
    duration_sec: { type: Type.NUMBER },
    virality_score: { type: Type.NUMBER },
    virality_reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
    timeline: { type: Type.ARRAY, items: MOMENT_SCHEMA },
    key_moments: { type: Type.ARRAY, items: MOMENT_SCHEMA },
    formula: { type: Type.STRING },
    hook_template: { type: Type.STRING },
    structure: { type: Type.ARRAY, items: { type: Type.STRING } },
    replication_prompt: { type: Type.STRING },
  };

  const required = ['title', 'duration_sec', 'virality_score', 'virality_reasons', 'timeline', 'key_moments', 'formula', 'hook_template', 'structure', 'replication_prompt'];

  if (hasScript) {
    props['transcript'] = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          startSec: { type: Type.NUMBER },
          endSec: { type: Type.NUMBER },
          text: { type: Type.STRING },
        },
        required: ['startSec', 'endSec', 'text'],
      },
    };
    props['copy_analysis'] = {
      type: Type.OBJECT,
      properties: {
        hook_breakdown: { type: Type.STRING },
        tone: { type: Type.ARRAY, items: { type: Type.STRING } },
        power_words: { type: Type.ARRAY, items: { type: Type.STRING } },
        cta_formula: { type: Type.STRING },
      },
      required: ['hook_breakdown', 'tone', 'power_words', 'cta_formula'],
    };
    required.push('transcript', 'copy_analysis');
  }

  if (hasVisual) {
    props['visual_analysis'] = {
      type: Type.OBJECT,
      properties: {
        edit_rhythm: { type: Type.STRING },
        text_overlays: { type: Type.ARRAY, items: { type: Type.STRING } },
        camera_moves: { type: Type.ARRAY, items: { type: Type.STRING } },
        broll_types: { type: Type.ARRAY, items: { type: Type.STRING } },
        hook_visual: { type: Type.STRING },
        pacing: { type: Type.STRING },
        caption_style: { type: Type.STRING },
        scene_archetypes: { type: Type.ARRAY, items: { type: Type.STRING } },
        transition_flavors: { type: Type.ARRAY, items: { type: Type.STRING } },
        palette: { type: Type.ARRAY, items: { type: Type.STRING } },
        signature_move: { type: Type.STRING },
        what_to_steal: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        'edit_rhythm', 'text_overlays', 'camera_moves', 'broll_types',
        'hook_visual', 'pacing', 'caption_style', 'scene_archetypes',
        'transition_flavors', 'palette', 'signature_move', 'what_to_steal',
      ],
    };
    required.push('visual_analysis');
  }

  if (hasReconstruct) {
    props['reconstruction'] = {
      type: Type.OBJECT,
      properties: {
        scenes: { type: Type.ARRAY, items: SCENE_SCHEMA },
        shooting_setup: { type: Type.STRING },
        equipment: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['scenes', 'shooting_setup', 'equipment'],
    };
    required.push('reconstruction');
  }

  return { type: Type.OBJECT, properties: props, required } as const;
};

// ─── Gemini call ──────────────────────────────────────────────────────────────

const callGemini = async (payload: VideoPayload, modes: BreakdownMode[]): Promise<ViralBreakdown> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  type PromptPart =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
    | { fileData: { fileUri: string; mimeType: string } };

  const parts: PromptPart[] = [{ text: buildPrompt(modes) }];
  if (payload.kind === 'inline') {
    parts.push({ inlineData: { mimeType: payload.mimeType, data: payload.data } });
  } else {
    parts.push({ fileData: { fileUri: payload.fileUri, mimeType: payload.mimeType } });
  }

  let lastError: unknown;
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
  let finalModel = '';

  for (const model of MODEL_CANDIDATES) {
    try {
      response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: buildSchema(modes) as unknown as Record<string, unknown>,
          temperature: 0.5,
          maxOutputTokens: 16384,
        },
      });
      finalModel = model;
      break;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not found|NOT_FOUND|not supported|404/i.test(msg)) throw err;
    }
  }

  if (!response) throw lastError instanceof Error ? lastError : new Error('Nenhum modelo Gemini disponível.');

  logActualCost('Viral Breakdown', finalModel, response.usageMetadata, 0);
  const usage = response.usageMetadata;
  const actualCostUSD = usage
    ? calculateActualCost(finalModel, usage.promptTokenCount, usage.candidatesTokenCount, 0, 0)
    : 0;
  void actualCostUSD;

  const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) throw new Error('Gemini não retornou conteúdo. Tente de novo.');

  let parsed: ViralBreakdown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Resposta da IA inválida (não é JSON).');
    parsed = JSON.parse(match[0]);
  }

  if (!parsed.timeline?.length) throw new Error('IA não retornou timeline. Tente de novo.');

  return { ...parsed, modes };
};

// ─── Upload helpers ───────────────────────────────────────────────────────────

const waitForFileActive = async (ai: GoogleGenAI, fileName: string, onStatus?: (s: BreakdownStatus) => void): Promise<void> => {
  const POLL_INTERVAL_MS = 1500;
  const TIMEOUT_MS = 90_000;
  const started = Date.now();
  while (true) {
    const f = await ai.files.get({ name: fileName });
    if (f.state === 'ACTIVE') return;
    if (f.state === 'FAILED') {
      throw new Error(`O Gemini não conseguiu processar o vídeo${f.error?.message ? `: ${f.error.message}` : '.'}`);
    }
    if (Date.now() - started > TIMEOUT_MS) {
      throw new Error('Timeout: o Gemini demorou mais de 90s pra processar o vídeo. Tente de novo.');
    }
    onStatus?.({ stage: 'processing-upload' });
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
};

const uploadAndWait = async (blob: Blob, mimeType: string, onStatus?: (s: BreakdownStatus) => void): Promise<{ fileUri: string; fileName: string }> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  onStatus?.({ stage: 'uploading', megabytes: +(blob.size / 1024 / 1024).toFixed(1) });
  const uploaded = await ai.files.upload({ file: blob, config: { mimeType } });
  if (!uploaded.name || !uploaded.uri) throw new Error('Upload do vídeo retornou resposta inválida.');
  await waitForFileActive(ai, uploaded.name, onStatus);
  return { fileUri: uploaded.uri, fileName: uploaded.name };
};

const deleteFileQuietly = (fileName: string): void => {
  try {
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    void ai.files.delete({ name: fileName }).catch(err => {
      console.warn('[viralBreakdown] cleanup failed:', err);
    });
  } catch (err) {
    console.warn('[viralBreakdown] cleanup skipped:', err);
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyse a video file (Uint8Array from Tauri `readReferenceBytes`) and return a ViralBreakdown.
 * Pass `modes` to control which angles are analysed (accumulative).
 */
export const generateViralBreakdown = async (
  bytes: Uint8Array,
  mimeType?: string,
  onStatus?: (s: BreakdownStatus) => void,
  modes: BreakdownMode[] = ['full'],
): Promise<ViralBreakdown> => {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const resolvedMime = mimeType?.startsWith('video/') ? mimeType : 'video/mp4';
  const blob = new Blob([ab], { type: resolvedMime });
  const mime = sanitizeMime(blob);

  if (blob.size > MAX_FILES_API_BYTES) {
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    throw new Error(`Vídeo de ${mb}MB é grande demais (limite: 500MB). Comprime antes.`);
  }

  if (blob.size <= MAX_INLINE_BYTES) {
    onStatus?.({ stage: 'analyzing' });
    const base64 = await blobToBase64(blob);
    return callGemini({ kind: 'inline', mimeType: mime, data: base64 }, modes);
  }

  const { fileUri, fileName } = await uploadAndWait(blob, mime, onStatus);
  onStatus?.({ stage: 'analyzing' });
  try {
    const result = await callGemini({ kind: 'file', fileUri, mimeType: mime }, modes);
    deleteFileQuietly(fileName);
    return result;
  } catch (err) {
    deleteFileQuietly(fileName);
    throw err;
  }
};
