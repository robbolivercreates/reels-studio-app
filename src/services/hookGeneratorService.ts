import { GoogleGenAI, Type } from '@google/genai';
import { buildVoicePromptSection, type VoiceProfile } from '../components/reelsStudio/voiceProfile';
import { logActualCost } from './costPredictor';

/**
 * Hook generator — portado da qualidade do VibeStream pro Reels Studio.
 *
 * Gera 9 ganchos virais (um por arquétipo) a partir de um TEMA simples, pra
 * destravar o fluxo "só um tema → reel". A geração do roteiro em si reusa o
 * `generateReelFromContent` (scriptFromContentService) passando o hook escolhido
 * como conteúdo + instrução — então aqui só vive a geração dos hooks.
 *
 * Mesma plumbing dos outros serviços: BYOK localStorage, fallback de modelo
 * Gemini 3.x, responseSchema (parse confiável), logActualCost.
 */

export interface Hook {
  /** Nome do gatilho/arquétipo, ex: "Aha", "Lacuna de Curiosidade". */
  title: string;
  /** Estilo em uma frase, ex: "Reframe inesperado". */
  type: string;
  /** O texto do gancho (2 frases), em linguagem falada. */
  content: string;
}

/**
 * Resultado da pesquisa de tendências virais (via Google Search grounding).
 * Alimenta o gerador de hooks com o que está bombando AGORA pro tema, em vez
 * de pedir 9 ganchos "no vácuo".
 */
export interface ViralContext {
  /** 3-5 ângulos que estão viralizando nos últimos ~30 dias pro tema. */
  trendingAngles: string[];
  /** Uma frase: o clima/emoção que está dirigindo engajamento agora. */
  currentVibe: string;
  /** Quais dos 9 arquétipos estão mais quentes hoje (por nome). */
  hotArchetypes: string[];
}

export interface GenerateHooksOptions {
  /** Público-alvo (opcional). */
  audience?: string;
  /** Tom/estilo (rótulo livre, ex: "Provocativo", "Educativo"). */
  tone?: string;
  /** Perfil de voz — carrega o idioma de saída + regras de vocabulário. */
  voiceProfile?: VoiceProfile;
  /** Contexto viral pesquisado via Google Search (opcional — quando ausente,
   * os hooks são gerados sem viés de tendência, como antes). */
  viralContext?: ViralContext | null;
}

const getApiKey = (): string => {
  const key = localStorage.getItem('GOOGLE_API_KEY');
  if (!key) throw new Error('GOOGLE_API_KEY não configurada. Adicione em Configurações.');
  return key;
};

// Prioriza Gemini 3.1 Flash-Lite, cai pra 3.5 Flash, depois 3.1 Pro. (mesma cadeia dos outros serviços)
const MODEL_CANDIDATES = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-pro-preview'];

// Prompt portado do VibeStream (aiService.ts hooksPrompt) — os 9 arquétipos + regra de voz.
// Removido o opener de Google Search/data fixa (usamos responseSchema, sem tools).
const HOOKS_SYSTEM = `Você é um copywriter de classe mundial pra vídeo curto (Reels/TikTok/Shorts).

Crie 9 ganchos virais — UM para cada tipo de gatilho listado abaixo.

Escreva exatamente como uma pessoa fala. Se não diria isso pra um amigo no bar, reescreva.

REGRA ABSOLUTA — VOZ E PERSPECTIVA:
NUNCA escreva como se o criador tivesse vivido algo ("eu fiz", "quando eu passei por", "minha história foi"). Soa falso e afasta quem assiste.
Os ganchos devem criar identificação na AUDIÊNCIA — quem assiste pensa "isso é sobre mim", não "que história desse criador".
Fale de situações universais, contradições do mundo real, ou direto à audiência com "você", "a gente", "quem nunca".
PROIBIDO: "Eu perdi tudo quando...", "Quando eu tentei X, eu...", "Minha maior falha foi..."
PERMITIDO: "Você acorda cansado mesmo dormindo 8 horas?", "A gente passa anos fazendo certo e ninguém fala o que estava errado."

REGRAS DE ESCRITA:
- ESTRUTURA OBRIGATÓRIA: 2 frases. A PRIMEIRA é o golpe de impacto — curta, direta, trava o scroll. A SEGUNDA desenvolve ou cria tensão. Nunca ao contrário.
- Sem palavras difíceis, sem jargão, sem frase de anúncio ("descubra o segredo", "você não vai acreditar").
- Linguagem do dia a dia, direta, humana. Máximo 20 palavras por frase.

OS 9 GATILHOS (um gancho pra cada):
1. AHA — Mostra algo familiar de um ângulo inesperado. Derruba uma crença comum.
   ✅ "Toda dieta funciona. O problema nunca foi a dieta."
2. CONTRASTE EMOCIONAL — Começa com a emoção oposta ao que vai entregar (tensão → alívio).
   ✅ "Você está fazendo tudo certo e mesmo assim não funciona. E tudo bem."
3. LACUNA DE CURIOSIDADE — Cria uma pergunta na cabeça da pessoa sem responder ainda.
   ✅ "Existe uma coisa que separa quem progride de quem fica parado. Quase ninguém fala disso."
4. IMAGEM MENTAL — Descreve uma cena/situação que a pessoa visualiza na hora.
   ✅ "Você no celular às 23h vendo reels de motivação, e o que importa continua parado."
5. IDENTIFICAÇÃO — Faz a audiência pensar "isso sou eu". Direto pra dor real.
   ✅ "Quem nunca adiou a coisa mais importante do dia pra fazer qualquer outra primeiro."
6. COMPARAÇÃO — Coloca 2 opções lado a lado; a audiência vira juíza.
   ✅ "Tem gente que gasta 200 por mês com X, e gente que gasta 50 com Y. Vê qual funciona."
7. DERRUBADOR DE MITO — Pega uma crença popular e joga água fria. Gera raiva/alívio.
   ✅ "Todo mundo diz que só dá certo aos 25. Mentira. Aos 40 é melhor ainda."
8. ESPECÍFICO NUMÉRICO — Números concretos, tira o abstrato.
   ✅ "94% das pessoas cometem esse erro. Você é uma delas?"
9. CUSTO DE INAÇÃO — Mostra quanto se perde ficando parado. Urgência genuína.
   ✅ "Cada semana que você adia isso, perde potencial que não volta."

Retorne os 9 ganchos no schema fornecido. "title" = nome do gatilho (Aha, Contraste Emocional, Lacuna de Curiosidade, Imagem Mental, Identificação, Comparação, Derrubador de Mito, Específico Numérico, Custo de Inação). "type" = estilo em uma frase. "content" = o texto do gancho, sem aspas, linguagem informal de verdade.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    hooks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          type: { type: Type.STRING },
          content: { type: Type.STRING },
        },
        required: ['title', 'type', 'content'],
      },
    },
  },
  required: ['hooks'],
} as const;

// Modelos que suportam Google Search grounding (mesma cadeia do thumbnailService).
// Grounding NÃO combina com responseSchema, então parseamos o JSON do texto.
const GROUNDING_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash'];

/**
 * Pesquisa, via Google Search grounding, o que está viralizando AGORA pro tema —
 * ângulos em alta, clima atual e quais arquétipos estão mais quentes. O resultado
 * alimenta `generateHooks` pra os 9 ganchos saírem "do momento" em vez de genéricos.
 *
 * Resiliente por design: retorna `null` em qualquer falha (chave ausente, modelo
 * indisponível, JSON inválido) — o gerador de hooks segue sem o viés de tendência.
 * Mesmo padrão inline de grounding do thumbnailService.ts / motionService.ts.
 */
export const researchViralHooks = async (
  topic: string,
  options: { audience?: string; voiceProfile?: VoiceProfile } = {},
): Promise<ViralContext | null> => {
  let ai: GoogleGenAI;
  try {
    ai = new GoogleGenAI({ apiKey: getApiKey() });
  } catch {
    return null; // sem chave → segue sem pesquisa
  }

  const lang = options.voiceProfile?.outputLanguage ?? 'pt-BR';
  const langName = lang.startsWith('en') ? 'inglês'
    : lang.startsWith('es') ? 'espanhol'
    : lang.startsWith('fr') ? 'francês'
    : lang.startsWith('it') ? 'italiano'
    : lang.startsWith('de') ? 'alemão'
    : 'português do Brasil';
  const langLine = `Responda os campos em ${langName}.`;
  const prompt = [
    'Você tem acesso ao Google Search. Pesquise o que está VIRALIZANDO AGORA (últimos ~30 dias)',
    `sobre o tema abaixo em Reels / TikTok / Shorts.`,
    '',
    `TEMA: ${topic.trim()}`,
    options.audience?.trim() ? `PÚBLICO: ${options.audience.trim()}` : '',
    '',
    'Retorne SOMENTE um JSON (sem markdown, sem cercas) com exatamente estas chaves:',
    '{',
    '  "trendingAngles": ["3 a 5 ângulos/abordagens que estão bombando agora pra esse tema"],',
    '  "currentVibe": "uma frase descrevendo o clima/emoção que está dirigindo engajamento agora",',
    '  "hotArchetypes": ["quais destes arquétipos estão mais quentes hoje: Aha, Contraste Emocional, Lacuna de Curiosidade, Imagem Mental, Identificação, Comparação, Derrubador de Mito, Específico Numérico, Custo de Inação"]',
    '}',
    langLine,
  ].filter(Boolean).join('\n');

  for (const model of GROUNDING_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.3,
        },
      });
      logActualCost('Viral Hook Research', model, response.usageMetadata, 1);
      const raw = response.candidates?.[0]?.content?.parts?.find(p => p.text)?.text ?? '';
      if (!raw || raw.trim().length < 5) continue;
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]) as Partial<ViralContext>;
      const trendingAngles = Array.isArray(parsed.trendingAngles)
        ? parsed.trendingAngles.filter(a => typeof a === 'string' && a.trim()).map(a => a.trim())
        : [];
      const hotArchetypes = Array.isArray(parsed.hotArchetypes)
        ? parsed.hotArchetypes.filter(a => typeof a === 'string' && a.trim()).map(a => a.trim())
        : [];
      const currentVibe = typeof parsed.currentVibe === 'string' ? parsed.currentVibe.trim() : '';
      if (trendingAngles.length === 0 && !currentVibe) continue;
      return { trendingAngles, currentVibe, hotArchetypes };
    } catch (err) {
      console.warn(`[viral-research] falha com ${model}:`, err);
    }
  }
  return null; // toda a cadeia falhou → segue sem pesquisa
};

export const generateHooks = async (
  topic: string,
  options: GenerateHooksOptions = {},
): Promise<Hook[]> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const promptLines: string[] = [];
  promptLines.push(HOOKS_SYSTEM);
  promptLines.push('');
  promptLines.push('--- BRIEFING ---');
  promptLines.push(`Tema do vídeo: ${topic.trim()}`);
  if (options.tone?.trim()) promptLines.push(`Tom: ${options.tone.trim()}`);
  if (options.audience?.trim()) promptLines.push(`Público-alvo: ${options.audience.trim()}`);
  const vc = options.viralContext;
  if (vc && (vc.trendingAngles.length > 0 || vc.currentVibe)) {
    promptLines.push('');
    promptLines.push('--- CONTEXTO VIRAL (tendências reais dos últimos ~30 dias) ---');
    if (vc.trendingAngles.length > 0) promptLines.push(`Ângulos em alta: ${vc.trendingAngles.join(' · ')}`);
    if (vc.currentVibe) promptLines.push(`Clima atual: ${vc.currentVibe}`);
    if (vc.hotArchetypes.length > 0) promptLines.push(`Arquétipos mais quentes hoje: ${vc.hotArchetypes.join(', ')}`);
    promptLines.push('INSTRUÇÃO: vise os ganchos pros ângulos e clima acima — devem soar "do momento", como quem');
    promptLines.push('acabou de ver esse ângulo viralizar. Sem inventar fatos; use o contexto só pra mirar a relevância.');
  }
  if (options.voiceProfile) {
    promptLines.push('');
    promptLines.push(buildVoicePromptSection(options.voiceProfile));
    promptLines.push('(Aplique a regra de idioma de saída acima também aos ganchos.)');
  }
  const fullPrompt = promptLines.join('\n');

  let lastError: unknown;
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
  for (const model of MODEL_CANDIDATES) {
    try {
      response = await ai.models.generateContent({
        model,
        contents: { parts: [{ text: fullPrompt }] },
        config: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
          temperature: 0.9, // ganchos pedem divergência
          thinkingConfig: { thinkingBudget: 2048 },
        },
      });
      logActualCost('Hook Generator', model, response.usageMetadata, 0);
      break;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not found|NOT_FOUND|not supported|404/i.test(msg)) throw err;
    }
  }
  if (!response) throw lastError instanceof Error ? lastError : new Error('Nenhum modelo Gemini disponível.');

  const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!raw) throw new Error('Gemini não retornou conteúdo. Tente de novo.');

  let parsed: { hooks?: Hook[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Resposta da IA inválida (não é JSON).');
    parsed = JSON.parse(match[0]);
  }

  const hooks = (parsed.hooks ?? [])
    .filter(h => h && typeof h.content === 'string' && h.content.trim().length > 0)
    .map(h => ({ title: (h.title || 'Gancho').trim(), type: (h.type || '').trim(), content: h.content.trim() }));

  if (hooks.length === 0) throw new Error('IA não retornou ganchos. Tente um tema mais específico.');
  return hooks;
};

/**
 * Monta o "conteúdo" + instrução pra reusar o generateReelFromContent travando
 * o gancho escolhido como abertura do roteiro. Não chama IA aqui — só prepara o
 * input pro serviço existente (ver uso no GuidedWizard).
 */
export const buildHookReelSource = (topic: string, hook: Hook) => ({
  text: `Tema do reel: ${topic.trim()}\n\nGANCHO DE ABERTURA (use EXATAMENTE este como o primeiro bloco — é o hook, no máximo refine levemente): "${hook.content.trim()}"`,
  title: topic.trim(),
});

export const HOOK_REEL_INSTRUCTION =
  'O PRIMEIRO bloco do roteiro DEVE ser o gancho de abertura fornecido (refine no máximo levemente, sem mudar a ideia). ' +
  'Depois do gancho, estruture como História → Entrega (a ideia/dica principal) → CTA único. Mantenha tudo no tema dado.';
