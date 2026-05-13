import { GoogleGenAI, Type } from '@google/genai';
import type { ScriptBlock, BlockKind, RegenerateContext } from '../components/reelsStudio/types';
import { buildVoicePromptSection, type VoiceProfile } from '../components/reelsStudio/voiceProfile';
import { buildRegenPromptSection } from './regenPrompt';

// ─── STYLES ─────────────────────────────────────────────────────────────

export type ReelStyle =
  | 'viral'
  | 'news'
  | 'informative'
  | 'educational'
  | 'storytelling'
  | 'opinion';

export const STYLE_OPTIONS: { value: ReelStyle; label: string; hint: string; emoji: string }[] = [
  { value: 'viral',        emoji: '🔥', label: 'Viral',        hint: 'Hook agressivo, ganchos de curiosidade, ritmo cortado, CTA emocional.' },
  { value: 'news',         emoji: '📰', label: 'Novidade',     hint: 'Tom de notícia, urgência, "acabou de sair".' },
  { value: 'informative',  emoji: '📚', label: 'Informativo',  hint: 'Calmo e direto, prioriza clareza sobre emoção.' },
  { value: 'educational',  emoji: '🎓', label: 'Educativo',    hint: 'Passo a passo, didático, com exemplos concretos.' },
  { value: 'storytelling', emoji: '📖', label: 'História',     hint: 'Narrativa pessoal, momento de virada, lição.' },
  { value: 'opinion',      emoji: '💬', label: 'Opinião',      hint: 'Posicionamento forte, contrarian, defende uma tese.' },
];

// ─── FRAMEWORKS ─────────────────────────────────────────────────────────

export type Framework =
  | 'auto'
  | 'gbmc'    // Gancho • Benefício • Mostre • CTA (BR)
  | 'aida'    // Atenção • Interesse • Desejo • Ação
  | 'pas'     // Problema • Agitação • Solução
  | 'hookbp'  // Hook • Bridge • Payoff
  | 'loop';   // Open loop → resolution → CTA → loop back

export const FRAMEWORK_OPTIONS: { value: Framework; label: string; hint: string }[] = [
  { value: 'auto',   label: 'Automático',                      hint: 'Gemini escolhe o que melhor encaixa no conteúdo + estilo.' },
  { value: 'gbmc',   label: 'Gancho · Benefício · Mostre · CTA', hint: 'Clássico BR pra Reels (recomendo).' },
  { value: 'aida',   label: 'AIDA',                            hint: 'Atenção · Interesse · Desejo · Ação. Bom pra produto.' },
  { value: 'pas',    label: 'PAS',                             hint: 'Problema · Agitação · Solução. Bom pra dor concreta.' },
  { value: 'hookbp', label: 'Hook · Bridge · Payoff',          hint: 'Tensão controlada, segredo no fim.' },
  { value: 'loop',   label: 'Loop Perfeito',                   hint: 'Final volta pro começo, força replay.' },
];

const FRAMEWORK_INSTRUCTION: Record<Framework, string> = {
  auto:   'Choose the structure that best fits the content and style. State the chosen framework in "frameworkUsed".',
  gbmc:   'Use the BR "Gancho-Benefício-Mostre-CTA" structure: 1) Gancho — provocative open in 1-3s; 2) Benefício — what the viewer gains; 3) Mostre — concrete demonstration / proof; 4) CTA — single clear ask.',
  aida:   'Use AIDA: Attention → Interest → Desire → Action. Each stage = ~1 block.',
  pas:    'Use PAS: Problem → Agitation → Solution. End with a CTA tied to the solution.',
  hookbp: 'Use Hook → Bridge → Payoff: cliffhanger open, brief tension build, surprising payoff. CTA AFTER the payoff.',
  loop:   'Use Loop Perfect: end the script with a phrase or question that loops naturally back to the opening line, encouraging replays. CTA goes between the payoff and the loop trigger.',
};

// ─── DURATION ───────────────────────────────────────────────────────────

export type DurationTarget = 15 | 20 | 30 | 45 | 60;

// ─── INPUT ──────────────────────────────────────────────────────────────

export interface ContentSource {
  /** Plain text content (article, transcript, notes). */
  text: string;
  /** Optional source URL (for traceability — not fetched here). */
  sourceUrl?: string;
  /** Optional title (article headline / video name). */
  title?: string;
}

export interface GenerateOptions {
  style: ReelStyle;
  framework: Framework;
  durationSec: DurationTarget;
  /** Free-form extra instructions from the user. Highest priority. */
  extraInstructions?: string;
  /** Optional voice profile applied (reuses the same one as video analysis). */
  voiceProfile?: VoiceProfile;
}

// ─── OUTPUT ─────────────────────────────────────────────────────────────

export interface GeneratedReel {
  blocks: ScriptBlock[];
  /** Headline-ready summary the user can paste as caption / title. */
  caption: string;
  /** 3-5 hashtags suggested for the platform. */
  hashtags: string[];
  /** Which framework Gemini picked (echoed when 'auto'). */
  frameworkUsed: string;
  /** One-line rationale: why this hook + structure work for this content. */
  rationale: string;
  /** Estimated total spoken duration (seconds, ballpark). */
  estimatedDurationSec: number;
}

// ─── PROMPT ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You compress long-form content (articles, blog posts, transcripts, lecture notes) into a high-impact short-form vertical reel script.

THREE INDEPENDENT DIMENSIONS — apply them ALL simultaneously, do not let one override the others:

1. FRAMEWORK = the STRUCTURE of the script. Decides the order of beats and what each block must accomplish. Examples: AIDA assigns Attention → Interest → Desire → Action; PAS goes Problem → Agitation → Solution; Gancho-Benefício-Mostre-CTA uses those four beats in order. The framework dictates WHERE the hook is, WHERE the proof is, WHERE the CTA is. Follow the chosen framework strictly — every block must map to a stage.

2. STYLE = the OVERALL VIBE. Decides emotional intensity, pacing energy, and stylistic conventions. Examples: "viral" uses aggressive curiosity hooks and emotional CTAs; "informative" stays calm and direct; "news" sounds urgent like breaking news; "storytelling" follows a personal arc. Style affects HOW INTENSE each block lands, not the order.

3. VOICE = the WORDING. Decides vocabulary, sentence shape, pronouns, slang, forbidden words. The voice profile (if present) is a vocabulary and tone reference — never a structural template. Voice is HOW IT SOUNDS, not WHAT GOES WHERE.

How they combine: FRAMEWORK builds the skeleton (block order + purpose). STYLE colors the energy. VOICE chooses the actual words. Same framework + same style + different voices = same structure, different wording. Same voice + same style + different frameworks = different structure, similar wording. Never let voice override framework. Never let style override the user's anti-pomposo word list.

Hard rules:
- The script is for a 9:16 vertical Reel / TikTok / Short.
- Total spoken duration must fit the user's "durationSec" target (±10%). Brazilian Portuguese pace = ~2.5 words/second; English = ~2.7 words/second. Use that to size the script.
- Hook MUST land in the first 3 seconds. The very first sentence is non-negotiable: it has to make the viewer stay. Apply one of the proven hook archetypes (provocative question, contradiction, bold claim, relatable problem, specific number, surprising insight).
- Single clear CTA at the end. Not multiple asks. Not "and follow and like and save and comment".
- Segment into 4-7 blocks. Each block 2-7 seconds spoken (TTS pace). Mark each block as "avatar" (speaker on camera) or "broll" (only voice while screen / cutaway plays). Default to alternation: avatar (hook) → broll (proof/demo) → avatar (insight) → broll (cont.) → avatar (CTA).

REEL FORMAT vs LONG-FORM FORMAT — IMPORTANT:
- Reels are SHORT (15-60s). They do NOT contain a self-introduction block (e.g. "I'm X, on this channel we talk about Y..."). Self-intros are for long-form YouTube videos.
- Reels do NOT end with long sign-offs (e.g. "hope you enjoyed, see you in the next one"). Reels end with ONE punchy CTA related to the content.
- Even if the voice profile shows examples of self-intros and long sign-offs, those are reference for the user's LONG-FORM videos. Do NOT replicate them in a reel script.
- The CTA at the end should be SHORT, in the user's voice, tied to the content's value. Pattern: ONE clear action ("save this", "comment your take", "share with someone who needs this", "link in bio"). Write it in the output language defined by the voice profile.

- Anti-plagiarism: do NOT lift sentences directly from the source. Synthesise, compress, rephrase. Never copy >6 consecutive words from the source.
- Output language follows the OUTPUT LANGUAGE rule from the voice profile. If no profile is given, default to English.

TTS delivery rules (output goes to Minimax speech-2.8-hd):
- Numbers in words (e.g. "fifty percent", not "50%"; "cinquenta por cento", não "50%").
- No emojis, no parentheses, no hashtags, no URLs in "blocks[].text".
- Short sentences. Commas and periods as breathing pauses.
- Hashtags + emojis ARE allowed in the "caption" and "hashtags" fields.

Caption rule:
- 1-2 punchy sentences, optimised for Instagram/TikTok feed preview. Curiosity hook that complements (not duplicates) the spoken hook.

Return ONLY valid JSON matching the provided schema. No markdown.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
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
    caption: { type: Type.STRING },
    hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
    frameworkUsed: { type: Type.STRING },
    rationale: { type: Type.STRING },
    estimatedDurationSec: { type: Type.NUMBER },
  },
  required: ['blocks', 'caption', 'hashtags', 'frameworkUsed', 'rationale', 'estimatedDurationSec'],
} as const;

// ─── INTERNALS ──────────────────────────────────────────────────────────

const uid = () => `b_${Math.random().toString(36).slice(2, 9)}`;

const getApiKey = (): string => {
  const key = localStorage.getItem('GOOGLE_API_KEY');
  if (!key) throw new Error('GOOGLE_API_KEY não configurada. Adicione em Configurações.');
  return key;
};

// Flash como primeira escolha; Pro como fallback se Flash falhar (timeout,
// 503 etc). Flash Lite foi removido — entrega script raso na maioria dos
// artigos longos e o ganho de custo não compensa a regressão de qualidade.
const MODEL_CANDIDATES = ['gemini-3-flash-preview', 'gemini-3.1-pro-preview'];

// Source content can be very long. Gemini Flash handles 1M tokens, but we still
// trim to a sane upper bound to keep latency + cost down. Most articles fit in 30k chars.
const MAX_SOURCE_CHARS = 60_000;

const sanitiseSource = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_SOURCE_CHARS) return trimmed;
  return trimmed.slice(0, MAX_SOURCE_CHARS) + '\n\n[...truncated]';
};

// ─── PUBLIC ─────────────────────────────────────────────────────────────

export const generateReelFromContent = async (
  source: ContentSource,
  options: GenerateOptions,
  regen?: RegenerateContext,
): Promise<GeneratedReel> => {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  const styleDef  = STYLE_OPTIONS.find(s => s.value === options.style)!;
  const frameworkInstr = FRAMEWORK_INSTRUCTION[options.framework];

  const promptLines: string[] = [];
  promptLines.push(SYSTEM_PROMPT);
  promptLines.push('');
  promptLines.push('--- TARGET ---');
  promptLines.push(`durationSec target: ${options.durationSec}s (HARD CAP — never exceed ${options.durationSec * 1.1} seconds of spoken content).`);
  promptLines.push(`style: ${styleDef.label} — ${styleDef.hint}`);
  promptLines.push(`framework: ${frameworkInstr}`);
  if (options.extraInstructions?.trim()) {
    promptLines.push('');
    promptLines.push('--- EXTRA INSTRUCTIONS (highest priority) ---');
    promptLines.push(options.extraInstructions.trim());
  }
  if (options.voiceProfile) {
    promptLines.push('');
    promptLines.push(buildVoicePromptSection(options.voiceProfile));
  }
  const regenSection = buildRegenPromptSection(regen);
  if (regenSection) {
    promptLines.push(regenSection);
  }
  promptLines.push('');
  promptLines.push('--- SOURCE CONTENT ---');
  if (source.title) promptLines.push(`Title: ${source.title}`);
  if (source.sourceUrl) promptLines.push(`URL: ${source.sourceUrl}`);
  promptLines.push('');
  promptLines.push(sanitiseSource(source.text));

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
          // Higher temp when regenerating (force divergence) or for viral/opinion styles.
          temperature: regen
            ? 0.9
            : options.style === 'viral' || options.style === 'opinion' ? 0.85 : 0.55,
        },
      });
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

  let parsed: {
    blocks: { kind: BlockKind; text: string }[];
    caption: string;
    hashtags: string[];
    frameworkUsed: string;
    rationale: string;
    estimatedDurationSec: number;
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

  return {
    blocks,
    caption: parsed.caption?.trim() ?? '',
    hashtags: parsed.hashtags ?? [],
    frameworkUsed: parsed.frameworkUsed ?? options.framework,
    rationale: parsed.rationale?.trim() ?? '',
    estimatedDurationSec: parsed.estimatedDurationSec ?? options.durationSec,
  };
};

// ─── URL FETCHER ────────────────────────────────────────────────────────
// Browser-only fetch via CORS proxies. Strips chrome (nav, footer, scripts).

interface FetchedArticle {
  title: string;
  text: string;
  sourceUrl: string;
}

const CORS_PROXIES = [
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

export const fetchArticleFromUrl = async (url: string): Promise<FetchedArticle> => {
  let html = '';
  let fetched = false;

  // Try direct first (works if server allows CORS).
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('text/html') || ct.includes('text/plain')) {
        html = await res.text();
        fetched = html.length > 200;
      }
    }
  } catch { /* fall through */ }

  if (!fetched) {
    for (const proxy of CORS_PROXIES) {
      try {
        const res = await fetch(proxy(url), { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const text = await res.text();
        if (text.length > 200) {
          html = text;
          fetched = true;
          break;
        }
      } catch { continue; }
    }
  }

  if (!fetched) throw new Error('Não consegui acessar a URL. Cole o texto direto.');

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const title = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
    || doc.querySelector('title')?.textContent?.trim()
    || '';

  // Strip chrome.
  doc.querySelectorAll('script, style, nav, footer, header, iframe, noscript, svg, aside, form, [role="navigation"], [aria-hidden="true"]').forEach(el => el.remove());

  // Try common content selectors.
  const SELECTORS = [
    'article',
    'main',
    '[role="main"]',
    '.article-body', '.post-content', '.entry-content', '.story-body',
    '#content', '#main-content',
  ];
  let mainEl: Element | null = null;
  for (const sel of SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && (el.textContent?.length ?? 0) > 200) { mainEl = el; break; }
  }
  const root = mainEl ?? doc.body;
  const text = (root?.textContent ?? '').replace(/\s+/g, ' ').trim();

  if (text.length < 100) {
    throw new Error('Página sem texto legível. Cole o conteúdo direto.');
  }

  return { title, text, sourceUrl: url };
};
