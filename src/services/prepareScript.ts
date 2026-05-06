// ============================================================================
// Minimax TTS Expression Engine
// Prepares scripts with emotion, interjections, and pacing for speech-2.8-hd
// Adapted from minimax-tts-expressions skill.
// ============================================================================

import type { MinimaxEmotion, VoiceModify } from './minimaxService';

// --- Types -------------------------------------------------------------------

export type Interjection =
  | '(laughs)'
  | '(sighs)'
  | '(coughs)'
  | '(clears throat)'
  | '(gasps)'
  | '(sniffs)'
  | '(groans)'
  | '(yawns)';

export interface CharacterExpressionProfile {
  name: string;
  defaultEmotion: MinimaxEmotion;
  interjectionStyle: {
    preferred: Interjection[];
    frequency: 'low' | 'medium' | 'high'; // max insertions: low=1, medium=2, high=3
  };
  pacing: {
    pauseDuration: number; // seconds (0.01–99.99)
    speed: number;         // speech speed (0.5–2.0)
  };
  voiceModify: VoiceModify;
}

export interface PreparedScript {
  text: string;            // script with (interjections) and <#pause#> markers
  emotion: MinimaxEmotion; // dominant emotion for voice_setting.emotion
  voiceModify: VoiceModify;
  speed: number;
}

// --- Keyword → Emotion Mapping -----------------------------------------------

const EMOTION_KEYWORDS: Record<MinimaxEmotion, string[]> = {
  happy: [
    'amazing', 'awesome', 'love', 'great', 'fantastic', 'incredible',
    'wonderful', 'excited', 'celebrate', 'congrats', 'beautiful', 'perfect',
    'brilliant', 'thrilled', 'delighted', 'joy', 'best', 'win',
  ],
  sad: [
    'unfortunately', 'sorry', 'miss', 'lost', 'sad', 'tragic', 'heartbreaking',
    'disappointing', 'regret', 'farewell', 'goodbye', 'painful', 'struggle',
  ],
  angry: [
    'unacceptable', 'furious', 'outrageous', 'disgusting', 'terrible',
    'horrible', 'worst', 'hate', 'frustrated', 'annoyed', 'ridiculous',
  ],
  fearful: [
    'scary', 'terrifying', 'worried', 'anxious', 'danger', 'threat',
    'nervous', 'afraid', 'panic', 'alarming', 'risky', 'urgent',
  ],
  disgusted: [
    'gross', 'nasty', 'revolting', 'awful', 'hideous', 'repulsive',
    'appalling', 'sickening',
  ],
  surprised: [
    'wow', 'unbelievable', 'shocking', 'unexpected', 'plot twist',
    'no way', 'mind-blowing', 'insane', 'whoa', 'wait what', 'omg',
  ],
  neutral: [],
};

// --- Keyword → Interjection Mapping ------------------------------------------

interface InterjectionTrigger {
  keywords: string[];
  interjection: Interjection;
}

const INTERJECTION_TRIGGERS: InterjectionTrigger[] = [
  { keywords: ['haha', 'lol', 'funny', 'hilarious', 'joke', 'laughing', 'lmao'], interjection: '(laughs)' },
  { keywords: ['unfortunately', 'sadly', 'too bad', 'shame', 'sigh', 'miss'],      interjection: '(sighs)' },
  { keywords: ['wow', 'no way', 'shocking', 'unbelievable', 'omg', 'whoa'],        interjection: '(gasps)' },
  { keywords: ['anyway', 'so', 'moving on', 'now then', 'let me explain'],         interjection: '(clears throat)' },
  { keywords: ['ugh', 'painful', 'struggle', 'tough', 'exhausting'],               interjection: '(groans)' },
  { keywords: ['crying', 'emotional', 'tears', 'moved', 'touching'],               interjection: '(sniffs)' },
];

// --- Character Profiles ------------------------------------------------------

const CHARACTERS: Record<string, CharacterExpressionProfile> = {
  maya:      { name: 'Maya',      defaultEmotion: 'happy',   interjectionStyle: { preferred: ['(laughs)', '(gasps)'],          frequency: 'low' }, pacing: { pauseDuration: 0.5, speed: 1.0  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  jordan:    { name: 'Jordan',    defaultEmotion: 'happy',   interjectionStyle: { preferred: ['(laughs)', '(clears throat)'],  frequency: 'low' }, pacing: { pauseDuration: 0.4, speed: 1.05 }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  emma:      { name: 'Emma',      defaultEmotion: 'happy',   interjectionStyle: { preferred: ['(laughs)', '(sighs)'],          frequency: 'low' }, pacing: { pauseDuration: 0.4, speed: 1.05 }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  tyler:     { name: 'Tyler',     defaultEmotion: 'happy',   interjectionStyle: { preferred: ['(laughs)'],                     frequency: 'low' }, pacing: { pauseDuration: 0.3, speed: 1.1  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  charlotte: { name: 'Charlotte', defaultEmotion: 'neutral', interjectionStyle: { preferred: ['(sighs)', '(clears throat)'],   frequency: 'low' }, pacing: { pauseDuration: 0.8, speed: 0.9  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  marcus:    { name: 'Marcus',    defaultEmotion: 'neutral', interjectionStyle: { preferred: ['(clears throat)'],              frequency: 'low' }, pacing: { pauseDuration: 0.6, speed: 0.95 }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  sophie:    { name: 'Sophie',    defaultEmotion: 'neutral', interjectionStyle: { preferred: ['(sighs)', '(sniffs)'],          frequency: 'low' }, pacing: { pauseDuration: 0.6, speed: 0.95 }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  tom:       { name: 'Tom',       defaultEmotion: 'happy',   interjectionStyle: { preferred: ['(laughs)', '(clears throat)'],  frequency: 'low' }, pacing: { pauseDuration: 0.4, speed: 1.05 }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  fatima:    { name: 'Fatima',    defaultEmotion: 'neutral', interjectionStyle: { preferred: ['(sighs)', '(clears throat)'],   frequency: 'low' }, pacing: { pauseDuration: 0.7, speed: 0.9  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  ethan:     { name: 'Ethan',     defaultEmotion: 'happy',   interjectionStyle: { preferred: ['(laughs)', '(gasps)'],          frequency: 'low' }, pacing: { pauseDuration: 0.3, speed: 1.15 }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  anna:      { name: 'Anna',      defaultEmotion: 'neutral', interjectionStyle: { preferred: ['(clears throat)', '(sighs)'],   frequency: 'low' }, pacing: { pauseDuration: 0.5, speed: 1.0  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  jack:      { name: 'Jack',      defaultEmotion: 'happy',   interjectionStyle: { preferred: ['(laughs)'],                     frequency: 'low' }, pacing: { pauseDuration: 0.4, speed: 1.1  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  emily:     { name: 'Emily',     defaultEmotion: 'happy',   interjectionStyle: { preferred: ['(laughs)', '(gasps)'],          frequency: 'low' }, pacing: { pauseDuration: 0.2, speed: 1.2  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  amir:      { name: 'Amir',      defaultEmotion: 'neutral', interjectionStyle: { preferred: ['(clears throat)', '(sighs)'],   frequency: 'low' }, pacing: { pauseDuration: 0.6, speed: 0.95 }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  olivia:    { name: 'Olivia',    defaultEmotion: 'happy',   interjectionStyle: { preferred: ['(laughs)', '(sighs)'],          frequency: 'low' }, pacing: { pauseDuration: 0.5, speed: 1.0  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  james:     { name: 'James',     defaultEmotion: 'neutral', interjectionStyle: { preferred: ['(clears throat)'],              frequency: 'low' }, pacing: { pauseDuration: 0.5, speed: 1.0  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  lily:      { name: 'Lily',      defaultEmotion: 'happy',   interjectionStyle: { preferred: ['(laughs)', '(gasps)'],          frequency: 'low' }, pacing: { pauseDuration: 0.3, speed: 1.1  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  connor:    { name: 'Connor',    defaultEmotion: 'neutral', interjectionStyle: { preferred: ['(clears throat)', '(groans)'],  frequency: 'low' }, pacing: { pauseDuration: 0.4, speed: 1.05 }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  grace:     { name: 'Grace',     defaultEmotion: 'neutral', interjectionStyle: { preferred: ['(sighs)', '(clears throat)'],   frequency: 'low' }, pacing: { pauseDuration: 0.7, speed: 0.9  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  william:   { name: 'William',   defaultEmotion: 'neutral', interjectionStyle: { preferred: ['(clears throat)'],              frequency: 'low' }, pacing: { pauseDuration: 0.6, speed: 0.9  }, voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
};

// Default for unknown characters
const DEFAULT_CHARACTER: CharacterExpressionProfile = {
  name: 'Default',
  defaultEmotion: 'neutral',
  interjectionStyle: { preferred: ['(clears throat)'], frequency: 'low' },
  pacing: { pauseDuration: 0.4, speed: 1.0 },
  voiceModify: { pitch: 0, intensity: 0, timbre: 0 },
};

// --- Core Engine -------------------------------------------------------------

function detectEmotion(script: string, character: CharacterExpressionProfile): MinimaxEmotion {
  const lower = script.toLowerCase();
  const scores: Partial<Record<MinimaxEmotion, number>> = {};

  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    const count = keywords.reduce((sum, kw) => sum + (lower.includes(kw) ? 1 : 0), 0);
    if (count > 0) scores[emotion as MinimaxEmotion] = count;
  }

  const entries = Object.entries(scores) as [MinimaxEmotion, number][];
  if (entries.length === 0) return character.defaultEmotion;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function findContentInterjections(
  sentences: string[],
  character: CharacterExpressionProfile,
): Map<number, Interjection> {
  const result = new Map<number, Interjection>();
  const maxInsertions = character.interjectionStyle.frequency === 'high' ? 3
    : character.interjectionStyle.frequency === 'medium' ? 2 : 1;
  let count = 0;

  for (let i = 0; i < sentences.length && count < maxInsertions; i++) {
    const lower = sentences[i].toLowerCase();
    for (const trigger of INTERJECTION_TRIGGERS) {
      if (trigger.keywords.some(kw => lower.includes(kw))) {
        const isPreferred = character.interjectionStyle.preferred.includes(trigger.interjection);
        if (isPreferred || count === 0) {
          result.set(i, trigger.interjection);
          count++;
          break;
        }
      }
    }
  }

  return result;
}

function splitSentences(script: string): string[] {
  return script.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 0);
}

function buildTaggedScript(
  sentences: string[],
  interjections: Map<number, Interjection>,
  pauseDuration: number,
): string {
  const pause = `<#${pauseDuration.toFixed(1)}#>`;
  const parts: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const interjection = interjections.get(i);

    // Speakable text first, then interjection after -- never place pause
    // markers directly adjacent to interjection tags (Minimax requires
    // pause markers between speakable text only).
    if (interjection) {
      parts.push(sentences[i]);
      parts.push(interjection);
    } else {
      parts.push(sentences[i]);
    }

    if (i < sentences.length - 1 && !interjections.has(i)) {
      parts.push(pause);
    }
  }

  return parts.join(' ');
}

// --- Public API --------------------------------------------------------------

/**
 * Prepare a raw script for Minimax speech-2.8-hd TTS.
 *
 * Keeps the script text as-is — no forced pauses or auto-injected interjections.
 * Any TTS markup the user explicitly typed in the script (pauses, interjections)
 * is preserved. The function only resolves emotion and speed for the character.
 */
export function prepareScript(
  rawScript: string,
  characterName?: string,
  emotionOverride?: MinimaxEmotion,
): PreparedScript {
  const key = (characterName || '').toLowerCase();
  const character = CHARACTERS[key] ?? DEFAULT_CHARACTER;

  const emotion = emotionOverride ?? detectEmotion(rawScript, character);

  return {
    text: rawScript,
    emotion,
    voiceModify: { pitch: 0, intensity: 0, timbre: 0 },
    speed: character.pacing.speed,
  };
}

export function getCharacterExpression(name: string): CharacterExpressionProfile | undefined {
  return CHARACTERS[name.toLowerCase()];
}

export function listExpressionCharacters(): string[] {
  return Object.values(CHARACTERS).map(c => c.name);
}

export function registerExpressionCharacter(profile: CharacterExpressionProfile): void {
  CHARACTERS[profile.name.toLowerCase()] = profile;
}
