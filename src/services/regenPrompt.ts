import type { RegenerateContext, ToneOption, LanguageOption } from '../components/reelsStudio/types';

const TONE_HINTS: Record<Exclude<ToneOption, 'current'>, string> = {
  'more-direct':
    'Be more direct. Shorter sentences. Cut connectors and filler. Get to the point fast.',
  'more-casual':
    'Conversational, FaceTime-style. Casual register with light slang where natural in the target language. Avoid formal/academic phrasing.',
  'more-didactic':
    'Explain like the viewer is seeing this for the first time. Define jargon inline. Build up step by step.',
};

const LANGUAGE_LABELS: Record<Exclude<LanguageOption, 'auto'>, string> = {
  'pt-BR': 'Brazilian Portuguese (pt-BR)',
  'en-US': 'American English (en-US)',
  'es-ES': 'European Spanish (es-ES)',
  'fr-FR': 'French (fr-FR)',
  'it-IT': 'Italian (it-IT)',
  'de-DE': 'German (de-DE)',
};

/**
 * Builds the additional prompt section appended when the user is asking
 * Gemini to regenerate a script. Returns empty string when there's nothing
 * to add (no extra instructions, no previous attempt, no tone override).
 */
export const buildRegenPromptSection = (regen?: RegenerateContext): string => {
  if (!regen) return '';
  const { extraInstructions, previousAttempt, toneOverride, languageOverride } = regen;
  const blocks: string[] = [];

  if (languageOverride && languageOverride !== 'auto') {
    blocks.push(
      `LANGUAGE OVERRIDE (HIGHEST PRIORITY — overrides any voice-profile language setting):\nWrite ALL block text in ${LANGUAGE_LABELS[languageOverride]}. Idioms, CTAs, examples — everything in this language.`,
    );
  }

  if (extraInstructions && extraInstructions.trim()) {
    blocks.push(
      `USER FEEDBACK (regeneration request):\n${extraInstructions.trim()}`,
    );
  }

  if (previousAttempt && previousAttempt.length > 0) {
    const dump = previousAttempt
      .map(b => `[${b.kind}] ${b.text}`)
      .join('\n');
    blocks.push(
      `PREVIOUS ATTEMPT (the user did not like this — please diverge meaningfully, do not repeat the same wording):\n${dump}`,
    );
  }

  if (toneOverride && toneOverride !== 'current') {
    blocks.push(`TONE OVERRIDE: ${toneOverride}\n${TONE_HINTS[toneOverride]}`);
  }

  if (blocks.length === 0) return '';
  return '\n\n=== REGENERATION CONTEXT ===\n' + blocks.join('\n\n') + '\n=== END REGENERATION CONTEXT ===\n';
};
