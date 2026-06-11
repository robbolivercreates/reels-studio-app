/**
 * Deterministic effect detector.
 *
 * Looks at a single block + its surroundings and returns ONE effect preset
 * recommendation (or none). The Inspector paints an "auto" badge on the
 * recommended effect chip; `createMotionFromBlock` consults this when picking
 * a sensible default for newly-created motions.
 *
 * This is intentionally NOT an AI call. Every rule is a regex / boolean check
 * over data already in `ScriptBlock` + state. Zero cost, zero latency.
 *
 * Rule priority (first match wins):
 *   1. last block + brand has logo     → logo-outro
 *   2. last block + brand identity set → social-cta-follow
 *   3. block has 2 attached assets     → before-after-split
 *   4. block has 1 image with screenshot/web/desktop name hints → browser-chrome
 *   5. block has 1 image with mobile/app/iphone name hints      → phone-mockup
 *   6. (disabled — karaoke-captions hidden until reimplemented native)
 *   7. avatar + avatar-only layout + long text         → pip-talking-head
 *   8. text matches statistic regex   → counter-reveal
 *   9. text matches DM / mensagem     → notification-pop
 *  10. text matches geo (city/country) → map-zoom
 *  11. otherwise → undefined (no badge)
 *
 * Returns the recommendation + a short PT-BR reason for tooltip display.
 *
 * The `roleDetector.ts` companion module covers Style suggestions (vibe).
 * This module is intentionally separate so the two concerns don't tangle.
 */

import type { ScriptBlock, AttachedAsset } from './types';
import type { StylePresetId } from './motionStylePresets';

export interface EffectDetectorCtx {
  block: Pick<ScriptBlock, 'id' | 'kind' | 'text' | 'start' | 'end' | 'layout' | 'attachedAssets'>;
  /** Zero-based position of the block in the reel. */
  index: number;
  /** Total blocks in the reel. */
  total: number;
  /** True when state.brandIdentity has a non-empty logoSvg. */
  brandHasLogo?: boolean;
  /** True when state.brandIdentity has any researched brand fields. */
  brandHasIdentity?: boolean;
  /** Number of WordTimestamp entries belonging to this block (state.audio.words filtered by blockId). */
  audioWordCount?: number;
}

export interface EffectSuggestion {
  /** Recommended effect preset, or undefined if no rule matched. */
  recommendedEffect?: StylePresetId;
  /** Short PT-BR string for tooltip ("Sugerido: ..."). */
  reason: string;
}

// Regexes lifted from roleDetector.ts — reused verbatim to keep parity.
const STAT_NUMBER = /(R\$\s*[\d.,]+|US\$\s*[\d.,]+|[\d.,]+\s*(k|mil|M|milh[õo]es|%|x|×))|[\d]{3,}/i;
const EXAMPLE_HINT = /(olha\s+esse\s+caso|@\w+\s+(disse|tweetou|postou)|recebi\s+(essa\s+)?(mensagem|dm)|esse\s+exemplo)/i;
const GEO_HINT = /\b(S[ãa]o\s+Paulo|Rio\s+de\s+Janeiro|Bras[ií]lia|Salvador|Recife|Curitiba|Belo\s+Horizonte|Porto\s+Alegre|Tokyo|T[óo]quio|New\s+York|Nova\s+York|Paris|London|Londres|Lisboa|Madrid|Berlin|Berlim|Dubai|Mumbai|Shanghai|Xangai|Pequim|Beijing|Moscow|Moscou|S[ií]dney|Sidney|EUA|Brasil|Portugal|Espanha|Fran[çc]a|Alemanha|It[áa]lia|Reino\s+Unido)\b/;
const GEO_TRAJECTORY = /\bde\s+\w+\s+(pra|para)\s+\w+\b/i;

// Filename heuristics for screenshot orientation. AttachedAsset doesn't carry
// width/height yet, so we infer from common naming conventions.
const DESKTOP_HINT = /(screenshot|screen[-_]?shot|desktop|browser|safari|chrome|firefox|web|landing|dashboard|landscape)/i;
const MOBILE_HINT = /(mobile|iphone|ios|android|phone|app[-_]?screen|portrait)/i;

// Didactic / explanatory text patterns. When combined with text length > 100,
// suggests the illustrated-explainer style (icons + diagrams + arrows).
const DIDACTIC_HINT = /\b(como\s+(funciona|fazer|usar)|primeiro|depois|por\s+(fim|último)|passo\s+\d|porque|porém|por\s+que|o\s+que\s+(é|significa)|na\s+prática|funciona\s+assim|imagine\s+(que|assim)|pense\s+(em|nisso)|por\s+um\s+lado|por\s+outro|em\s+(três|quatro|cinco)\s+(passos|etapas|partes))\b/i;
// Stronger trigger for the new "Animado" (character-driven) style: text that
// describes an emotional arc, an attempt, a failure, a realization, or
// anthropomorphizes a system. Hits → Animado wins over generic DIDACTIC_HINT.
const EMOTIONAL_HINT = /\b(errou|errar|tentou|tentar|não\s+consegu|não\s+sabe|confus|frustr|descobriu|descobr|entendeu|imagina\s+só|a\s+(ia|máquina|tecnologia)\s+(pensa|pensou|achou|tenta|tentou|errou)|robô|cérebro|mente|aprende|aprendeu|conexões|neurônios|brilha|brilhou|surpre|wow|nossa|eureca)\b/i;

// Leading emoji (any Unicode emoji at the start of the trimmed text).
// The /u flag + Extended_Pictographic property catches all emoji ranges.
const LEADING_EMOJI = /^\s*\p{Extended_Pictographic}/u;

// Quick word count for short-hero detection.
const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

const isImage = (a: AttachedAsset | undefined): boolean => !!a && a.type === 'image';

/**
 * Run the deterministic detector. Pure function — no side effects.
 */
export const detectEffect = (ctx: EffectDetectorCtx): EffectSuggestion => {
  const { block, index, total, brandHasLogo, brandHasIdentity, audioWordCount } = ctx;
  const text = (block.text ?? '').trim();
  const isLast = total > 0 && index === total - 1;
  const assets = block.attachedAssets ?? [];
  const duration = Math.max(0, (block.end ?? 0) - (block.start ?? 0));

  // 1. Last block with brand logo → logo outro
  if (isLast && brandHasLogo) {
    return { recommendedEffect: 'logo-outro', reason: 'Fechamento com logo da marca' };
  }

  // 2. Last block with brand identity but no logo → social CTA
  if (isLast && brandHasIdentity) {
    return { recommendedEffect: 'social-cta-follow', reason: 'Último bloco — CTA de follow' };
  }

  // 3. Two assets → before/after comparison
  if (assets.length === 2) {
    return { recommendedEffect: 'before-after-split', reason: 'Dois assets anexados — comparação antes/depois' };
  }

  // 4 & 5. Single image asset with naming-based orientation hint.
  if (assets.length === 1 && isImage(assets[0])) {
    const name = assets[0].name;
    if (MOBILE_HINT.test(name)) {
      return { recommendedEffect: 'phone-mockup', reason: 'Asset parece mobile — moldura iPhone' };
    }
    if (DESKTOP_HINT.test(name)) {
      return { recommendedEffect: 'browser-chrome', reason: 'Asset parece desktop — moldura browser' };
    }
  }

  // 6. Short avatar block — DISABLED. Used to suggest karaoke-captions but
  //    that preset is hidden until reimplemented as a NATIVE preset (Gemini
  //    cannot reliably emit per-word timing GSAP). See NOTES.md.
  //    Falls through to the next rules so the block still gets a sensible
  //    auto recommendation (counter-reveal / pip-talking-head / etc).

  // 7. Long avatar-only block → PIP talking-head with content overlay
  if (block.kind === 'avatar' && block.layout === 'avatar-only' && text.length > 180) {
    return { recommendedEffect: 'pip-talking-head', reason: 'Avatar longo — PiP com conteúdo' };
  }

  // 8a. Emoji-led short hero — "💰 R$ 50K", "⚡ 3x mais rápido", "🎯 Foco"
  //     beats the generic counter-reveal because it's a designed hero moment,
  //     not a number-counting animation. Trigger: starts with emoji + short text.
  if (LEADING_EMOJI.test(text) && wordCount(text) <= 8) {
    return { recommendedEffect: 'icon-callout', reason: 'Destaque curto com ícone' };
  }

  // 8b. Stat / number — prefer the motion-pack stat-counter template for clean numbers
  if (STAT_NUMBER.test(text)) {
    // Use the motion-pack template for isolated numeric stats (faster, more reliable)
    const hasIsolatedNumber = /\b\d+(\.\d+)?\s*(GB|MB|TB|k|K|M|B|%|x|s|min|h|ms|reais|R\$|\$|€)\b/i.test(text);
    return {
      recommendedEffect: hasIsolatedNumber ? 'stat-counter' : 'counter-reveal',
      reason: hasIsolatedNumber ? 'Estatística detectada — template contador' : 'Estatística detectada — contador',
    };
  }

  // 8c. Claude/IA command pattern → typewriter-terminal
  const COMMAND_HINT = /\b(claude|comando|terminal|cli|script|automatiz|run|execute|código|code|prompt)\b/i;
  if (COMMAND_HINT.test(text) && text.length < 150) {
    return { recommendedEffect: 'typewriter-terminal', reason: 'Comando Claude/IA detectado — template terminal' };
  }

  // 8d. Tool stack / comparison → app-icon-launcher
  const TOOL_STACK = /\b(stack|ferramentas?|apps?|plugins?|extensões?|integra|ecossistema|conjunto)\b/i;
  if (TOOL_STACK.test(text)) {
    return { recommendedEffect: 'app-icon-launcher', reason: 'Stack de ferramentas detectado — template grid de ícones' };
  }

  // 8e. "Stop using X" / replacement hooks → wastebasket-trash
  const TRASH_HINT = /\b(pare de usar|não precisa de|substitui|jogar fora|dispensar|chega de|sem.*premier|sem.*capcut|sem.*after effects)\b/i;
  if (TRASH_HINT.test(text)) {
    return { recommendedEffect: 'wastebasket-trash', reason: 'Hook de substituição detectado — template lixeira' };
  }

  // 9. DM / example / message — prefer imessage-notif template for authentic iOS look
  if (EXAMPLE_HINT.test(text)) {
    const hasMessageHint = /\b(mensagem|mensagens|dm|chat|notificação|notif|recebi|respondeu|foi enviado)\b/i.test(text);
    return {
      recommendedEffect: hasMessageHint ? 'imessage-notif' : 'notification-pop',
      reason: hasMessageHint ? 'Mensagem detectada — template iMessage' : 'Exemplo / mensagem — banner de notificação',
    };
  }

  // 10. Geo content
  if (GEO_HINT.test(text) || GEO_TRAJECTORY.test(text)) {
    return { recommendedEffect: 'map-zoom', reason: 'Localização detectada — zoom em mapa' };
  }

  // 11. Animado (character-driven explainer) — text with emotional arc,
  //     attempt/failure narrative, or anthropomorphized concept ALWAYS wins.
  //     For more neutral didactic content (process steps, comparison without
  //     emotion), still suggest Animado when text is long enough.
  if (EMOTIONAL_HINT.test(text)) {
    return { recommendedEffect: 'illustrated-explainer', reason: 'Narrativa com emoção — animar com personagens e expressões' };
  }
  if (text.length > 100 && DIDACTIC_HINT.test(text)) {
    return { recommendedEffect: 'illustrated-explainer', reason: 'Conteúdo explicativo — animar com personagens e metáforas' };
  }

  // 12. Avatar fallback — glass-tech. Premium / tech-aspirational default
  //     when nothing else fits and the block has an avatar speaking.
  //     (Historic rule 12 — "first block → bold-pop" — was removed when
  //     captions stopped being emitted by default. The "hook energy"
  //     concept lived inside caption-kinetic-slam, which is no longer
  //     the default treatment. Avatar blocks now fall straight to
  //     glass-tech, matching the app's long-standing default since 44e8e54.)
  if (block.kind === 'avatar') {
    return { recommendedEffect: 'glass-tech', reason: 'Avatar falando — vibe técnica' };
  }

  // 14. No suggestion (b-roll mid-script with no specific signals).
  return { reason: 'Sem efeito sugerido' };
};
