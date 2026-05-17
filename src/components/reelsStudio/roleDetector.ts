/**
 * Narrative role detector — pure heuristic that suggests which NarrativeRole
 * fits a given block's text, based on regex patterns + position in the reel.
 *
 * Returns a StylePresetId (the internal mapping) so callers can dispatch
 * `set-block-style-preset` directly. Always returns something; falls back to
 * 'editorial-clean' (concept) as the safe default.
 *
 * Pattern priority is intentional: the FIRST matching rule wins. Later rules
 * are catch-alls. Tuned for PT-BR but tolerates English where it's easy.
 */

import type { StylePresetId } from './motionStylePresets';

interface DetectorCtx {
  text: string;
  index: number;
  total: number;
}

const HOOK_OPENERS = /^(você\s|voce\s|imagina|olha\s|veja|sabia\s|já\s+pensou|prepare-se|atenção)/i;
const PROBLEM_HINT = /(\bo\s+problema\s+(é|e)|já\s+passou|nunca\s+consegu|cansad[oa]\s+de|odeio\s+quando)/i;
const STAT_NUMBER = /(R\$\s*[\d.,]+|US\$\s*[\d.,]+|[\d.,]+\s*(k|mil|M|milh[õo]es|%|x|×))|[\d]{3,}/i;
const STEP_HINT = /^(primeiro|segundo|terceiro|quarto|quinto|passo\s+\d+|[\d]+[.)]\s)/i;
const COMPARISON_HINT = /\b(vs\.?|versus|antes\s*\/\s*depois|antes\s+e\s+depois|ao\s+inv[eé]s|comparado\s+com|melhor\s+que)\b/i;
const EXAMPLE_HINT = /(olha\s+esse\s+caso|@\w+\s+(disse|tweetou|postou)|recebi\s+(essa\s+)?(mensagem|dm)|esse\s+exemplo)/i;
const QUOTE_HINT = /(segundo\s+[A-Z]\w+|—\s*[A-Z]\w+|"[^"]{15,}"|disse\s+["“])/;
const CONCEPT_HINT = /\b(significa|[eé]\s+quando|isso\s+[eé]|por\s+definição|na\s+prática)\b/i;
const LIST_HINT = /\b(são\s+\d+|^\d+\s+(motivos|coisas|raz[ãa]o|raz[õo]es)|os\s+top\s+\d+)/i;
const REFLECTION_HINT = /(pense\s+(nisso|um\s+pouco)|sint[ae]\s|reflit[ae]|pause\s+pra)/i;

// CTA detection: command verbs + handle/social refs.
const CTA_HINT = /^(siga|segue|me\s+segue|comenta|deixa\s+like|salva|compartilha|toca|clica\s+no)\b/i;
const HANDLE_HINT = /@\w+/;
const DOMAIN_HINT = /\b[a-z0-9-]+\.(com|com\.br|br|net|io|app|pro|me|ai)\b/i;

// Tiny geo whitelist — BR + global hits, sufficient for "ele saiu de SP pra Tokyo".
const GEO_HINT = /\b(S[ãa]o\s+Paulo|Rio\s+de\s+Janeiro|Bras[ií]lia|Salvador|Recife|Curitiba|Belo\s+Horizonte|Porto\s+Alegre|Tokyo|T[óo]quio|New\s+York|Nova\s+York|Paris|London|Londres|Lisboa|Madrid|Berlin|Berlim|Dubai|Mumbai|Shanghai|Xangai|Pequim|Beijing|Moscow|Moscou|S[ií]dney|Sidney|EUA|Brasil|Portugal|Espanha|Fran[çc]a|Alemanha|It[áa]lia|Reino\s+Unido)\b/;
const GEO_TRAJECTORY = /\bde\s+\w+\s+(pra|para)\s+\w+\b/i;

/**
 * Detect the best preset id for a block. Returns the preset id (StylePresetId).
 */
export const detectBlockRole = (ctx: DetectorCtx): StylePresetId => {
  const { text, index, total } = ctx;
  const t = text.trim();
  const isFirst = index === 0;
  const isLast = total > 0 && index === total - 1;

  // Last block: CTA / Outro take priority.
  if (isLast) {
    if (CTA_HINT.test(t) || HANDLE_HINT.test(t)) return 'social-cta-follow';
    if (DOMAIN_HINT.test(t)) return 'logo-outro';
  }
  // CTA can appear anywhere if explicit.
  if (CTA_HINT.test(t) && HANDLE_HINT.test(t)) return 'social-cta-follow';

  // First block: hook unless overridden by stronger signal.
  if (isFirst && t.length > 0) {
    if (STAT_NUMBER.test(t) && !HOOK_OPENERS.test(t)) return 'counter-reveal';
    return 'bold-pop';
  }

  // Stat — strong signal, runs before generic narrative patterns.
  if (STAT_NUMBER.test(t)) return 'counter-reveal';

  // Sequenced step.
  if (STEP_HINT.test(t)) return 'glass-tech';

  // Comparison.
  if (COMPARISON_HINT.test(t)) return 'kinetic-bold';

  // Problem.
  if (PROBLEM_HINT.test(t)) return 'cinematic-dark';

  // Example (case study, DM, tweet).
  if (EXAMPLE_HINT.test(t)) return 'notification-pop';

  // Quote / authority.
  if (QUOTE_HINT.test(t)) return 'warm-editorial';

  // Geo content.
  if (GEO_HINT.test(t) || GEO_TRAJECTORY.test(t)) return 'map-zoom';

  // Reflection / contemplation.
  if (REFLECTION_HINT.test(t)) return 'soft-pastel';

  // Numbered list.
  if (LIST_HINT.test(t)) return 'apple-system';

  // Concept / explanation.
  if (CONCEPT_HINT.test(t)) return 'editorial-clean';

  // Hook opener mid-reel still counts.
  if (HOOK_OPENERS.test(t)) return 'bold-pop';

  // Default: safe editorial.
  return 'editorial-clean';
};

/**
 * Batch detect — returns suggestions keyed by block id (the same shape callers
 * use for `state.blocks`). Useful for "Apply suggested roles to all" button.
 */
export const detectRolesForBlocks = <B extends { id: string; text: string }>(blocks: B[]): Record<string, StylePresetId> => {
  const out: Record<string, StylePresetId> = {};
  for (let i = 0; i < blocks.length; i++) {
    out[blocks[i].id] = detectBlockRole({ text: blocks[i].text, index: i, total: blocks.length });
  }
  return out;
};
