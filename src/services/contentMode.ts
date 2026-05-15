import type { ContentMode } from '../components/reelsStudio/types';

/**
 * Heuristic to suggest a default content mode based on the source size.
 * - Short Reel/TikTok (≤90s) or short article (≤2000 words) → 'adapt'
 * - Longer → 'trailer' (promise + glimpse + CTA-bait, not a tutorial)
 *
 * Caller can always override what we suggest.
 */
export const suggestContentMode = (input:
  | { kind: 'video'; durationSec: number }
  | { kind: 'article'; wordCount: number }
  | { kind: 'script'; wordCount: number }
): ContentMode => {
  if (input.kind === 'video') {
    return input.durationSec > 90 ? 'trailer' : 'adapt';
  }
  return input.wordCount > 2000 ? 'trailer' : 'adapt';
};

/**
 * Builds the prompt section that tells Gemini how to transform the source.
 * Injected once near the top of the user brief (after voice profile,
 * before the source content). When mode is 'adapt' (default), returns an
 * empty string — the legacy prompt rules apply unchanged.
 */
export const buildContentModeSection = (mode: ContentMode | undefined): string => {
  if (!mode || mode === 'adapt') return '';

  if (mode === 'compress') {
    return [
      '',
      '=== CONTENT MODE: COMPRESS ===',
      'The source is already short-form material. Your job: KEEP THE WORDING (verbatim where possible)',
      'and just trim filler so it fits the target duration. Do NOT rewrite the speaker\'s phrasing.',
      'Do NOT change the structure. Pick the strongest contiguous moments and drop the rest.',
      '=== END CONTENT MODE ===',
      '',
    ].join('\n');
  }

  // 'trailer' — the heavyweight mode.
  return [
    '',
    '=== CONTENT MODE: TRAILER (HIGHEST PRIORITY OVER ANY DEFAULT STRUCTURE) ===',
    'This Reel is a TRAILER for long-form content, not a tutorial.',
    'Your goal: make the viewer WANT the long-form. Do NOT teach the method.',
    '',
    'MANDATORY STRUCTURE (use these 5 beats — adapt count to fit duration, but never skip Hook, Tease and CTA):',
    '  1. HOOK (≤3s, 1 block)',
    '     - Provocative statement, specific number, contradiction, or "imagine if" question.',
    '     - MUST be in the user\'s voice (pull patterns from the voice profile).',
    '     - Banned: "olá pessoal", "hoje vou te ensinar", "vamos lá", any warm-up.',
    '',
    '  2. PROBLEM (≤4s, 1 block)',
    '     - The specific pain or wish the long-form addresses, named concretely.',
    '     - One reality the viewer recognises. No generalities.',
    '',
    '  3. TEASE (≤8s, 1-2 blocks)',
    '     - Mention what the long-form covers WITHOUT teaching the method.',
    '     - Allowed: "no vídeo completo eu mostro 3 maneiras", "a terceira foi a que me deu 40 mil views".',
    '     - Forbidden: explaining HOW any step works. No "primeiro você faz X depois Y".',
    '     - Curiosity gap is the goal — name the payoff, withhold the path.',
    '',
    '  4. PROOF / GLIMPSE (≤6s, 1 block, ALWAYS B-roll)',
    '     - Block kind MUST be "broll". The text describes what the viewer SEES on screen',
    '       (a result, an output, a before/after) — NOT what the avatar says.',
    '     - Example: "Carrossel pronto em 1 minuto e 22 segundos. Sem template."',
    '     - This block is short, factual, visual. No teaching.',
    '',
    '  5. CTA-BAIT (≤4s, 1 block, ALWAYS avatar)',
    '     - Pattern: "Comenta [KEYWORD] aqui embaixo que eu te mando [recurso] no DM."',
    '     - The KEYWORD is ONE word, uppercase, related to the topic (CANVA, NOTION, IA, GUIA, etc).',
    '     - Avoid generic "link na bio". The comment-to-DM bait outperforms link-in-bio by 4-6x in 2026.',
    '     - Output that keyword in the dedicated `commentKeyword` field too.',
    '',
    'GLOBAL RULES:',
    '- NEVER teach a step-by-step in this Reel. If the source has tutorial steps, REFUSE to repeat them.',
    '- NEVER include self-intro ("eu sou o Rob, aqui falamos sobre...").',
    '- NEVER include long sign-off ("espero que tenha gostado, tchau tchau"). That\'s long-form only.',
    '- Total spoken duration: 4-7 blocks, 15-30s sweet spot, 60s hard cap.',
    '- The Reel must end with the CTA-bait block — nothing after.',
    '',
    'OUTPUT NOTE: if your schema supports `commentKeyword`, fill it with the single uppercase word.',
    'If it does not, embed the keyword inside the CTA block text exactly as it appears in the CTA.',
    '=== END CONTENT MODE ===',
    '',
  ].join('\n');
};
