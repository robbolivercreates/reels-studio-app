/**
 * Estilo de fala por geração — portado do vibestream (SCRIPT_STYLES.yap + YAP_SUBTYPES).
 *
 * "Yap" = monólogo conversacional em 1ª pessoa, tom de bar, frases curtas,
 * uma ideia central só. Subtipos trocam a ESTRUTURA do roteiro mantendo a voz;
 * o toggle "viveu isso?" separa vivência pessoal de comentário/reação (que
 * proíbe a IA de inventar que testou/viveu algo).
 *
 * É uma escolha POR GERAÇÃO feita nos wizards (não um campo permanente do
 * voice profile): os wizards anexam o config na cópia efêmera do profile
 * (`profile.speechStyle`) e persistem a última escolha em localStorage para a
 * regeneração na timeline e o agent reusarem. Os builders retornam '' quando
 * o estilo é 'default', então o caminho padrão fica byte-a-byte inalterado.
 *
 * A voz entra em buildVoicePromptSection (todos os fluxos falados); a
 * estrutura só nos services que compõem o roteiro inteiro. O schema de saída
 * (blocks[]) nunca muda — o Yap orienta conteúdo, não formato.
 */

export type SpeechStyle = 'default' | 'yap';
export type YapType = 'storytime' | 'hottake' | 'ensinar' | 'lancamento';

export interface SpeechStyleConfig {
  style: SpeechStyle;
  /** Subtipo do Yap — muda a estrutura do roteiro. Default: 'storytime'. */
  yapType?: YapType;
  /** true = vivência pessoal; false = comentário/reação (não inventa vivência). Default: true. */
  yapLived?: boolean;
}

export const DEFAULT_SPEECH_STYLE: SpeechStyleConfig = { style: 'default' };

export const YAP_TYPE_OPTIONS: { id: YapType; emoji: string; label: string; desc: string }[] = [
  { id: 'storytime',  emoji: '🎞️', label: 'Storytime',           desc: 'História pessoal com punchline' },
  { id: 'hottake',    emoji: '🔥',  label: 'Opinião / Hot-take',   desc: 'Posicionamento que gera debate' },
  { id: 'ensinar',    emoji: '💡',  label: 'Ensinar / Dica',       desc: 'Ensina algo de forma casual' },
  { id: 'lancamento', emoji: '🚀',  label: 'Lançamento / Produto', desc: 'Oferta de um jeito pessoal' },
];

// ─── Prompts (portados do vibestream aiService.ts) ───────────────────────────

const YAP_VOICE = `REGRA DE VOZ — ESTILO YAP:
Escreva em PRIMEIRA PESSOA, como um monólogo conversacional, falando direto pra câmera como quem desabafa com um amigo. A pessoa É a história.
Tom de bar, cru, espontâneo (mas pensado). Frases curtas (5-12 palavras). Use conectivos naturais espalhados: "tipo", "sabe", "então", "olha", "aí", "mas tipo".
Pode usar tangente — desviar do ponto — DESDE QUE volte ("aliás... não, espera, deixa eu focar"). Detalhe específico e pessoal vale ouro (o que só você viveu).
EVITE: tom corporativo, frase de livro, divagação que não volta, mais de um assunto. UMA ideia central só.`;

const YAP_COMMENTARY = `PERSPECTIVA — COMENTÁRIO (NÃO foi vivência sua): mantenha o papo reto em 1ª pessoa, MAS você está COMENTANDO/ANUNCIANDO/REAGINDO — NUNCA invente que viveu, testou, sentiu ou fez algo que não fez. PROIBIDO: "eu testei", "eu joguei", "eu senti", "aconteceu comigo". USE: "olha isso", "acabaram de lançar", "repara nos números", "tô vendo que", "saiu agora". E NÃO invente os fatos em si: comente só o que está no contexto validado; se não tiver dado real, fale do conceito sem cravar número/funcionalidade/perigo. Opinião sincera sim, afirmação assustadora inventada não.`;

/** Corpos por subtipo — adaptados de "seções numeradas" para fluxo através dos blocos. */
const YAP_BODIES: Record<YapType, string> = {
  storytime: `- STORY (blocos do meio) — Setup MÍNIMO + escalada da história. Abre um loop logo no começo ("a parte mais louca é que...") e segura. Micro-suspense, sobe a energia. 1ª pessoa.
- DELIVER (perto do fim) — O PICO: a punchline / a virada / o que aconteceu de fato. Fecha o loop.
- CTA (último bloco) — Implícito: "me fala se só eu passo por isso", "comenta se já viveu algo assim".`,
  hottake: `- STORY (blocos do meio) — A AFIRMAÇÃO OUSADA (sua opinião forte, contra o senso comum) + a DEFESA pessoal: por que você pensa assim. 1ª pessoa, convicção.
- DELIVER (perto do fim) — O argumento que FECHA: o exemplo ou raciocínio que prova seu ponto.
- CTA (último bloco) — Provoca debate: "concorda ou acha que tô errado? comenta", "muda minha cabeça aí embaixo".`,
  ensinar: `- STORY (blocos do meio) — O PROBLEMA que a pessoa vive + a SACADA que você descobriu (1ª pessoa: "demorei pra sacar isso"). Casual, sem parecer aula.
- DELIVER (perto do fim) — COMO APLICAR: 1 passo simples e prático que a pessoa faz hoje.
- CTA (último bloco) — "salva pra não esquecer", "marca alguém que precisa disso".`,
  lancamento: `- STORY (blocos do meio) — Gancho PESSOAL + por que isso importa: a dor que você (ou seu público) sentia, e a virada. Tom íntimo, sem parecer comercial.
- DELIVER (perto do fim) — A OFERTA/PRODUTO de um jeito casual: o que é, pra quem é, a transformação. Como quem indica pra um amigo.
- CTA (último bloco) — Direto mas natural: "link na bio", "chama na DM que eu te explico", "comenta EU QUERO".`,
};

/**
 * Regra de VOZ do Yap — anexada por buildVoicePromptSection a todos os fluxos
 * falados (roteiro inteiro, regen de bloco, análise de vídeo, agent).
 */
export const buildSpeechStyleVoiceSection = (cfg?: SpeechStyleConfig): string => {
  if (!cfg || cfg.style !== 'yap') return '';
  const lines = [
    '=== ESTILO DE FALA: YAP ===',
    YAP_VOICE,
  ];
  if (cfg.yapLived === false) lines.push(YAP_COMMENTARY);
  lines.push(
    'Em caso de conflito com exemplos do VOICE DOCUMENT acima, estas regras de voz têm prioridade. A lista de palavras proibidas do voice doc continua valendo.',
    '=== FIM DO ESTILO DE FALA ===',
  );
  return lines.join('\n');
};

/**
 * ESTRUTURA do Yap (fluxo HOOK→STORY→DELIVER→CTA do subtipo) — só para os
 * services que compõem um roteiro inteiro. Bloco único e análise de
 * referência não recebem isto (a estrutura da referência vence).
 */
export const buildSpeechStyleStructureSection = (cfg?: SpeechStyleConfig): string => {
  if (!cfg || cfg.style !== 'yap') return '';
  const body = YAP_BODIES[cfg.yapType ?? 'storytime'];
  return [
    '=== FLUXO YAP (tem prioridade sobre framework/style padrão) ===',
    'O roteiro deve fluir nesta ordem através dos blocos (orienta o CONTEÚDO — continue retornando blocks[] avatar/broll normalmente, sem mudar o formato de saída):',
    '- HOOK (1º bloco) — abre o monólogo de um jeito natural, segura a pessoa.',
    body,
    '=== FIM DO FLUXO YAP ===',
  ].join('\n');
};

/**
 * Substitui o HOOKS_SYSTEM do hookGeneratorService quando o estilo é Yap:
 * 9 aberturas naturais de monólogo no lugar dos gatilhos de copywriting.
 * Compatível com o RESPONSE_SCHEMA existente (title/type/content).
 */
export const buildYapHooksSystem = (cfg: SpeechStyleConfig): string => {
  const voiceRule = cfg.yapLived === false
    ? `REGRA DE VOZ — YAP / COMENTÁRIO:
Voz conversacional em 1ª pessoa (papo reto, espontâneo), MAS você está COMENTANDO/REAGINDO/ANUNCIANDO — NÃO contando uma vivência pessoal. Não diga que testou/sentiu/fez.
Abra com uma reação ou opinião sincera forte ("cara, isso é meio surreal", "acabaram de lançar e olha...", "ninguém tá falando disso, mas...").
Nunca invente fatos/números/perigos — só o que é real/está no contexto. Sem fear-bait alarmista. Frases curtas.
BOM: "Acabaram de lançar uma parada meio surreal.", "Ninguém tá comentando isso, mas muda tudo."`
    : `REGRA DE VOZ — ESTILO YAP:
Esses ganchos abrem um monólogo conversacional, então PODEM ser em 1ª pessoa ("eu", "comigo") — como o começo de um desabafo/papo reto direto pra câmera, tom de bar, espontâneo.
Abra um loop ou solte uma opinião pessoal forte que segura a pessoa ("a parte mais louca é que...", "ninguém me falou que...").
Mesmo assim mire IDENTIFICAÇÃO — a pessoa pensa "é exatamente isso" — mas a voz é pessoal e crua. Frases curtas.
BOM: "Eu perdi 3 anos fazendo isso errado e ninguém me avisou.", "Preciso falar de uma coisa que tá me deixando louco."`;

  return `Você escreve aberturas de monólogo pra vídeo curto (Reels/TikTok/Shorts) no estilo Yap: alguém de verdade falando direto pra câmera.

${voiceRule}

Cada gancho é um JEITO DIFERENTE e NATURAL de ABRIR o monólogo (não uma fórmula de copy). Tem que soar como alguém de verdade começando a falar. Varie entre estes ângulos:
1. TAKE FORTE — uma opinião sincera e direta. "essa é a parada mais subestimada do momento."
2. REAÇÃO / NOVIDADE — reage a algo recente. "cara, acabaram de lançar isso e é surreal."
3. NINGUÉM FALA — "ninguém tá comentando isso, mas..."
4. CONTRADIÇÃO — "todo mundo acha X. é exatamente o contrário."
5. CURIOSIDADE CASUAL — "tem uma parada nova que é meio surreal."
6. PERGUNTA GENUÍNA — "você já parou pra pensar..."
7. PEQUENA EPIFANIA — "reparei numa coisa..."
8. CONFISSÃO SINCERA — "vou ser sincero, eu tava cético..."
9. COLD OPEN — já começa no meio do assunto.
Não invente fatos. Siga a REGRA DE VOZ acima.

Pra cada gancho:
- title: o ângulo de abertura (ex: 'Take forte', 'Reação', 'Ninguém fala', 'Contradição', 'Curiosidade casual', 'Pergunta genuína', 'Pequena epifania', 'Confissão sincera', 'Cold open')
- type: uma frase curta descrevendo a vibe
- content: o texto do gancho em português. Sem aspas. Casual, como alguém de verdade começando a falar. 1-2 frases curtas.`;
};

// ─── Persistência (última escolha global — padrão vibestream user_yaptype) ──

const STORAGE_KEY = 'reels_speech_style';

export const loadSpeechStyleConfig = (): SpeechStyleConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SPEECH_STYLE;
    const parsed = JSON.parse(raw);
    if (parsed?.style !== 'yap') return DEFAULT_SPEECH_STYLE;
    return {
      style: 'yap',
      yapType: (YAP_TYPE_OPTIONS.some(o => o.id === parsed.yapType) ? parsed.yapType : 'storytime') as YapType,
      yapLived: parsed.yapLived !== false,
    };
  } catch {
    return DEFAULT_SPEECH_STYLE;
  }
};

export const saveSpeechStyleConfig = (cfg: SpeechStyleConfig): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // localStorage indisponível — escolha só não persiste entre sessões.
  }
};
