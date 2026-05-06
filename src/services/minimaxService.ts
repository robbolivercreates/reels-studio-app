// ─── MINIMAX TTS SERVICE (via fal.ai) ────────────────────────────────────────
// All Minimax TTS calls are routed through fal.ai using FAL_KEY.
// Replaces the previous ElevenLabs integration.
// Endpoint: fal-ai/minimax/speech-2.8-hd (best quality, supports interjections + pauses)

import { fal } from '@fal-ai/client';

const ensureConfigured = () => {
  const key = localStorage.getItem('FAL_KEY');
  if (!key) throw new Error('FAL API Key not set. Please add it in Settings.');
  fal.config({ credentials: key, suppressLocalCredentialsWarning: true });
};

// ─── TYPES ────────────────────────────────────────────────────────────

export type MinimaxEmotion = 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';

export const TTS_LANGUAGES = [
  'auto', 'English', 'Chinese', 'Spanish', 'French', 'Portuguese', 'German',
  'Italian', 'Japanese', 'Korean', 'Russian', 'Arabic', 'Turkish', 'Dutch',
  'Polish', 'Thai', 'Vietnamese', 'Indonesian', 'Hindi', 'Czech',
] as const;
export type TtsLanguage = typeof TTS_LANGUAGES[number];

export interface VoiceModify {
  pitch: number;      // -100 to 100
  intensity: number;  // -100 to 100
  timbre: number;     // -100 to 100
}

export interface VoiceSettings {
  speed: number;       // 0.5-2.0
  vol: number;         // 0-10
  pitch: number;       // -12 to 12
  emotion: MinimaxEmotion;
  voiceModify: VoiceModify;
}

// ─── DEFAULTS & PER-CHARACTER SETTINGS ───────────────────────────────

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  speed: 1.0,
  vol: 1,
  pitch: 0,
  emotion: 'neutral',
  voiceModify: { pitch: 0, intensity: 0, timbre: 0 },
};

export const CHARACTER_VOICE_SETTINGS: Record<string, VoiceSettings> = {
  maya:      { speed: 1.0,  vol: 1, pitch: 0, emotion: 'happy',   voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  jordan:    { speed: 1.05, vol: 1, pitch: 0, emotion: 'happy',   voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  emma:      { speed: 1.05, vol: 1, pitch: 0, emotion: 'happy',   voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  tyler:     { speed: 1.1,  vol: 1, pitch: 0, emotion: 'happy',   voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  charlotte: { speed: 0.9,  vol: 1, pitch: 0, emotion: 'neutral', voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  marcus:    { speed: 0.95, vol: 1, pitch: 0, emotion: 'neutral', voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  sophie:    { speed: 0.95, vol: 1, pitch: 0, emotion: 'neutral', voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  tom:       { speed: 1.05, vol: 1, pitch: 0, emotion: 'happy',   voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  fatima:    { speed: 0.9,  vol: 1, pitch: 0, emotion: 'neutral', voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  ethan:     { speed: 1.15, vol: 1, pitch: 0, emotion: 'happy',   voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  anna:      { speed: 1.0,  vol: 1, pitch: 0, emotion: 'neutral', voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  jack:      { speed: 1.1,  vol: 1, pitch: 0, emotion: 'happy',   voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  emily:     { speed: 1.2,  vol: 1, pitch: 0, emotion: 'happy',   voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  amir:      { speed: 0.95, vol: 1, pitch: 0, emotion: 'neutral', voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  olivia:    { speed: 1.0,  vol: 1, pitch: 0, emotion: 'happy',   voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  james:     { speed: 1.0,  vol: 1, pitch: 0, emotion: 'neutral', voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  lily:      { speed: 1.1,  vol: 1, pitch: 0, emotion: 'happy',   voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  connor:    { speed: 1.05, vol: 1, pitch: 0, emotion: 'neutral', voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  grace:     { speed: 0.9,  vol: 1, pitch: 0, emotion: 'neutral', voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
  william:   { speed: 0.9,  vol: 1, pitch: 0, emotion: 'neutral', voiceModify: { pitch: 0, intensity: 0, timbre: 0 } },
};

export const getCharacterVoiceSettings = (characterName: string): VoiceSettings => {
  return CHARACTER_VOICE_SETTINGS[characterName.toLowerCase()] ?? DEFAULT_VOICE_SETTINGS;
};

// ─── MINIMAX INTERJECTION TAGS ───────────────────────────────────────
// Only these 8 interjections are supported inline in the text.

export const INTERJECTION_TAGS = [
  { tag: '(laughs)',        label: 'Laughs',        emoji: '😄' },
  { tag: '(sighs)',         label: 'Sighs',         emoji: '😮‍💨' },
  { tag: '(coughs)',        label: 'Coughs',        emoji: '😷' },
  { tag: '(clears throat)', label: 'Clears throat', emoji: '🎤' },
  { tag: '(gasps)',         label: 'Gasps',         emoji: '😲' },
  { tag: '(sniffs)',        label: 'Sniffs',        emoji: '🤧' },
  { tag: '(groans)',        label: 'Groans',        emoji: '😩' },
  { tag: '(yawns)',         label: 'Yawns',         emoji: '🥱' },
];

// Re-export as EMOTION_TAGS for backward compat with UI components
export const EMOTION_TAGS = INTERJECTION_TAGS;

// ─── SCRIPT MOOD DETECTION ──────────────────────────────────────────
// Analyzes script content to pick the best Minimax emotion enum value.

export interface ScriptMood {
  energy: 'high' | 'medium' | 'low';
  warmth: 'warm' | 'neutral' | 'cool';
  intensity: number;
  emotion: MinimaxEmotion;
}

const HYPE_WORDS = /\b(incredible|amazing|unbelievable|must|now|hurry|don't miss|limited|exclusive|best ever|game.?changer|obsessed|insane|epic|fire|legendary|huge|massive|deal|discount|offer|launch|drop|alert|breaking)\b/gi;
const WARM_WORDS = /\b(journey|grateful|love|together|feel|heart|care|family|home|remember|cherish|beautiful|meaningful|special|thank|blessed|appreciate|close to my heart)\b/gi;
const INTIMATE_WORDS = /\b(just|quietly|honestly|between us|real talk|truth is|I have to say|confess|admit|vulnerable|personal|raw|open up)\b/gi;
const SAD_WORDS = /\b(miss|lost|gone|remember when|used to|never again|farewell|goodbye|sorry|regret|wish I|if only|heartbreak|grief|mourn)\b/gi;
const ANGRY_WORDS = /\b(angry|furious|frustrated|ridiculous|annoying|can't stand|hate|outraged|unacceptable|disgusting)\b/gi;
const SURPRISE_WORDS = /\b(wow|oh my|no way|unbelievable|shocking|didn't expect|plot twist|suddenly|out of nowhere)\b/gi;
const FEAR_WORDS = /\b(scared|afraid|nervous|terrified|worried|anxious|panic|dread|unsettling|creepy)\b/gi;

const EXPLICIT_TONE_MAP: Record<string, MinimaxEmotion> = {
  energetic: 'happy', excited: 'happy', hype: 'happy', fun: 'happy',
  calm: 'neutral', relaxed: 'neutral', chill: 'neutral',
  professional: 'neutral', serious: 'neutral', formal: 'neutral',
  warm: 'happy', friendly: 'happy', heartfelt: 'happy',
  intimate: 'neutral', sad: 'sad', motivational: 'happy',
  inspiring: 'happy', confident: 'neutral', playful: 'happy', bold: 'happy',
  angry: 'angry', frustrated: 'angry',
  surprised: 'surprised', shocked: 'surprised',
  nervous: 'fearful', anxious: 'fearful',
};

export function detectScriptMood(script: string, explicitTone?: string): ScriptMood {
  if (explicitTone) {
    const key = explicitTone.toLowerCase().trim();
    const emotion = EXPLICIT_TONE_MAP[key];
    if (emotion) {
      const energy = ['happy', 'surprised', 'angry'].includes(emotion) ? 'high' : 'low';
      const warmth = ['happy'].includes(emotion) ? 'warm' : 'neutral';
      return { energy: energy as ScriptMood['energy'], warmth: warmth as ScriptMood['warmth'], intensity: 0.8, emotion };
    }
  }

  const wordCount = script.split(/\s+/).length;
  const exclamations = (script.match(/!/g) || []).length;
  const capsWords = (script.match(/\b[A-Z]{2,}\b/g) || []).length;

  const hypeHits = (script.match(HYPE_WORDS) || []).length;
  const warmHits = (script.match(WARM_WORDS) || []).length;
  const sadHits = (script.match(SAD_WORDS) || []).length;
  const angryHits = (script.match(ANGRY_WORDS) || []).length;
  const surpriseHits = (script.match(SURPRISE_WORDS) || []).length;
  const fearHits = (script.match(FEAR_WORDS) || []).length;

  // Score each emotion
  const scores: Record<MinimaxEmotion, number> = {
    happy: hypeHits * 2 + warmHits * 1.5 + exclamations * 0.5 + capsWords * 0.3,
    sad: sadHits * 3,
    angry: angryHits * 3,
    surprised: surpriseHits * 3 + exclamations * 0.3,
    fearful: fearHits * 3,
    disgusted: 0,
    neutral: wordCount * 0.01,
  };

  const best = (Object.entries(scores) as [MinimaxEmotion, number][])
    .sort((a, b) => b[1] - a[1])[0];
  const emotion = best[1] > 1 ? best[0] : 'neutral';

  let energyScore = 0;
  energyScore += Math.min(exclamations / Math.max(wordCount / 20, 1), 1) * 0.3;
  energyScore += Math.min(capsWords / Math.max(wordCount / 30, 1), 1) * 0.2;
  energyScore += Math.min(hypeHits / 3, 1) * 0.3;
  energyScore -= Math.min(sadHits / 2, 1) * 0.3;

  let warmthScore = 0;
  warmthScore += Math.min(warmHits / 3, 1) * 0.4;
  warmthScore += Math.min((script.match(INTIMATE_WORDS) || []).length / 2, 1) * 0.3;

  const energy: ScriptMood['energy'] = energyScore > 0.25 ? 'high' : energyScore < -0.15 ? 'low' : 'medium';
  const warmth: ScriptMood['warmth'] = warmthScore > 0.25 ? 'warm' : warmthScore < -0.15 ? 'cool' : 'neutral';
  const intensity = Math.min(Math.abs(energyScore) + Math.abs(warmthScore), 1);

  return { energy, warmth, intensity, emotion };
}

// ─── ADAPTIVE VOICE (mood → voice_modify adjustments) ────────────────

interface FlexRange {
  intensity: number;
  pitch: number;
  speed: number;
}

const CHARACTER_FLEX: Record<string, FlexRange> = {
  emma:      { intensity: 8,  pitch: 3, speed: 0.04 },
  jordan:    { intensity: 12, pitch: 5, speed: 0.06 },
  maya:      { intensity: 10, pitch: 4, speed: 0.05 },
  marcus:    { intensity: 10, pitch: 4, speed: 0.04 },
  fatima:    { intensity: 12, pitch: 5, speed: 0.04 },
  tyler:     { intensity: 15, pitch: 5, speed: 0.06 },
  charlotte: { intensity: 6,  pitch: 3, speed: 0.04 },
  sophie:    { intensity: 6,  pitch: 2, speed: 0.03 },
  tom:       { intensity: 8,  pitch: 3, speed: 0.04 },
  ethan:     { intensity: 15, pitch: 5, speed: 0.06 },
  anna:      { intensity: 6,  pitch: 3, speed: 0.04 },
  jack:      { intensity: 15, pitch: 5, speed: 0.06 },
  emily:     { intensity: 15, pitch: 5, speed: 0.06 },
  amir:      { intensity: 10, pitch: 4, speed: 0.04 },
  olivia:    { intensity: 10, pitch: 4, speed: 0.05 },
  james:     { intensity: 6,  pitch: 2, speed: 0.03 },
  lily:      { intensity: 12, pitch: 4, speed: 0.05 },
  connor:    { intensity: 8,  pitch: 3, speed: 0.04 },
  grace:     { intensity: 15, pitch: 5, speed: 0.06 },
  william:   { intensity: 6,  pitch: 2, speed: 0.03 },
};

const DEFAULT_FLEX: FlexRange = { intensity: 10, pitch: 4, speed: 0.04 };

export function adjustVoiceForMood(
  baseSettings: VoiceSettings,
  mood: ScriptMood,
  characterName?: string,
): VoiceSettings {
  const flex = characterName
    ? CHARACTER_FLEX[characterName.toLowerCase()] ?? DEFAULT_FLEX
    : DEFAULT_FLEX;

  const scale = mood.intensity;
  let intensityShift = 0;
  let pitchShift = 0;
  let speedShift = 0;

  if (mood.energy === 'high') {
    intensityShift = +flex.intensity * scale;
    speedShift = +flex.speed * scale;
  } else if (mood.energy === 'low') {
    intensityShift = -flex.intensity * 0.4 * scale;
    speedShift = -flex.speed * scale;
  }

  if (mood.warmth === 'warm') {
    pitchShift = +flex.pitch * 0.5 * scale;
  } else if (mood.warmth === 'cool') {
    pitchShift = -flex.pitch * 0.3 * scale;
  }

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  return {
    speed: clamp(baseSettings.speed + speedShift, 0.5, 2.0),
    vol: baseSettings.vol,
    pitch: baseSettings.pitch,
    emotion: mood.emotion,
    voiceModify: {
      pitch: clamp(baseSettings.voiceModify.pitch + Math.round(pitchShift), -100, 100),
      intensity: clamp(baseSettings.voiceModify.intensity + Math.round(intensityShift), -100, 100),
      timbre: baseSettings.voiceModify.timbre,
    },
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────

const urlToBlob = async (url: string): Promise<Blob> => {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch audio (${res.status})`);
      return res.blob();
    } catch (err) {
      console.warn(`[minimax] Audio fetch attempt ${attempt}/5 failed:`, err);
      if (attempt === 5) throw err;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error('Audio fetch failed after 5 attempts');
};

// ─── TEXT-TO-SPEECH ──────────────────────────────────────────────────
// Routes through fal-ai/minimax/speech-2.8-hd (best quality).
// v2.8 uses `prompt` (not `text`), supports interjection tags, pause
// markers <#x#>, and voice_modify (pitch/intensity/timbre).

const TTS_ENDPOINT = 'fal-ai/minimax/speech-2.8-hd';

export const generateSpeech = async (
  text: string,
  voiceId: string,
  settings: VoiceSettings = DEFAULT_VOICE_SETTINGS,
  language: TtsLanguage = 'English',
): Promise<Blob> => {
  ensureConfigured();
  console.log('[fal/minimax-tts] Generating speech with voice:', voiceId, '| emotion:', settings.emotion, '| language:', language);

  const input: Record<string, any> = {
    prompt: text,
    voice_setting: {
      voice_id: voiceId,
      speed: settings.speed,
      vol: settings.vol,
      pitch: settings.pitch,
      emotion: settings.emotion,
    },
    audio_setting: {
      sample_rate: 44100,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
    language_boost: language,
    output_format: 'url',
    normalization_setting: {
      enabled: true,
      target_loudness: -18,
      target_peak: -0.5,
    },
  };

  const vm = settings.voiceModify;
  if (vm && (vm.pitch !== 0 || vm.intensity !== 0 || vm.timbre !== 0)) {
    input.voice_modify = {
      pitch: vm.pitch,
      intensity: vm.intensity,
      timbre: vm.timbre,
    };
  }

  let lastErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await fal.subscribe(TTS_ENDPOINT as any, { input });

      const audioUrl = (result.data as any).audio?.url;
      if (!audioUrl) {
        console.error('[fal/minimax-tts] Unexpected response:', JSON.stringify(result.data).slice(0, 500));
        throw new Error('No audio returned from Minimax TTS');
      }
      console.log('[fal/minimax-tts] Audio URL:', audioUrl);
      return urlToBlob(audioUrl);
    } catch (err) {
      lastErr = err;
      console.warn(`[fal/minimax-tts] Attempt ${attempt}/3 failed:`, err);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
};

// generateSpeechDirect is now an alias — Minimax always goes through fal.ai
export const generateSpeechDirect = async (
  text: string,
  voiceId: string,
  settings: VoiceSettings = DEFAULT_VOICE_SETTINGS,
  _signal?: AbortSignal,
  language: TtsLanguage = 'English',
): Promise<Blob> => {
  return generateSpeech(text, voiceId, settings, language);
};

// ─── AMBIENT SOUND GENERATION ────────────────────────────────────────
// SFX generation via fal.ai — provider-agnostic, kept from previous service.

const ROOM_AMBIENT_PROMPTS: Partial<Record<string, string>> = {
  podcast:  'treated recording studio room tone, barely audible ventilation hum, very quiet acoustic foam room, professional booth silence',
  studio:   'quiet home studio room tone, soft HVAC hum, slight air movement, gentle electrical hum',
  room:     'quiet bedroom room tone, gentle ventilation, soft distant residential hum, peaceful indoor ambience',
  office:   'open plan office ambience, steady HVAC ventilation, subtle distant keyboard typing and activity, fluorescent hum',
  car:      'car interior idle ambience, low engine rumble, light road surface noise, gentle cabin resonance',
  bathroom: 'small tiled bathroom room tone, faint pipe resonance, very quiet water hiss, ceramic echo',
  outdoor:  'peaceful outdoor ambience, light natural breeze, distant birdsong, open air natural sounds',
};

export interface AmbientOption {
  id: string;
  label: string;
  emoji: string;
  category: string;
  prompt: string;
}

export const AMBIENT_LIBRARY: AmbientOption[] = [
  { id: 'lib_booth',      label: 'Booth',       emoji: '🎙️', category: 'Indoor',      prompt: 'treated recording studio room tone, barely audible ventilation hum, professional booth silence' },
  { id: 'lib_bedroom',    label: 'Bedroom',     emoji: '🛋️', category: 'Indoor',      prompt: 'quiet bedroom at night, soft ventilation, distant residential hum, peaceful interior silence' },
  { id: 'lib_office',     label: 'Office',      emoji: '💼', category: 'Indoor',      prompt: 'open plan office ambience, steady HVAC hum, distant keyboard typing, fluorescent light buzz' },
  { id: 'lib_cafe',       label: 'Café',        emoji: '☕', category: 'Indoor',      prompt: 'busy coffee shop ambience, espresso machine hiss, gentle chatter, cups clinking, soft background music' },
  { id: 'lib_library',    label: 'Library',     emoji: '📚', category: 'Indoor',      prompt: 'quiet library ambience, soft page turning, very faint air conditioning, hushed indoor silence' },
  { id: 'lib_restaurant', label: 'Restaurant',  emoji: '🍽️', category: 'Indoor',      prompt: 'restaurant dining ambience, moderate crowd murmur, cutlery sounds, soft background music, kitchen distant' },
  { id: 'lib_gym',        label: 'Gym',         emoji: '🏋️', category: 'Indoor',      prompt: 'gym ambience, distant weights and equipment, steady ventilation, motivational music in background' },
  { id: 'lib_car',        label: 'Car',         emoji: '🚗', category: 'Transport',   prompt: 'car interior driving ambience, smooth engine hum, light road surface noise, gentle cabin resonance, wind buffet' },
  { id: 'lib_train',      label: 'Train',       emoji: '🚆', category: 'Transport',   prompt: 'train carriage interior ambience, rhythmic track clatter, gentle carriage sway, steady engine rumble' },
  { id: 'lib_airplane',   label: 'Airplane',    emoji: '✈️', category: 'Transport',   prompt: 'airplane cabin ambience, steady jet engine roar, gentle cabin pressure hum, distant passenger murmur' },
  { id: 'lib_forest',     label: 'Forest',      emoji: '🌲', category: 'Outdoor',     prompt: 'forest ambience, birdsong chorus, light wind through leaves, distant woodpecker, natural outdoor peace' },
  { id: 'lib_beach',      label: 'Beach',       emoji: '🏖️', category: 'Outdoor',     prompt: 'ocean beach ambience, gentle waves rolling on shore, distant seagulls, light sea breeze, peaceful coastal' },
  { id: 'lib_city',       label: 'City',        emoji: '🏙️', category: 'Outdoor',     prompt: 'urban city street ambience, distant traffic, pedestrian chatter, occasional car horn, city life background' },
  { id: 'lib_rain',       label: 'Rain',        emoji: '🌧️', category: 'Outdoor',     prompt: 'steady rain on window, soft rainfall ambience, gentle dripping, cozy indoor rain sound, no thunder' },
  { id: 'lib_wind',       label: 'Wind',        emoji: '💨', category: 'Outdoor',     prompt: 'open field wind ambience, steady breeze, rustling grass, natural outdoor wind without rain' },
  { id: 'lib_fireplace',  label: 'Fireplace',   emoji: '🔥', category: 'Atmospheric', prompt: 'cozy fireplace crackling ambience, wood burning, gentle fire sounds, warm indoor atmosphere' },
  { id: 'lib_night',      label: 'Night',       emoji: '🌙', category: 'Atmospheric', prompt: 'quiet night ambience, crickets chirping, distant owl, soft nocturnal nature sounds, peaceful darkness' },
  { id: 'lib_underground',label: 'Underground', emoji: '🚇', category: 'Atmospheric', prompt: 'underground subway station ambience, distant train rumble, echo, ventilation hum, urban underground' },

  { id: 'amb_maya_bedroom',       label: 'Maya\'s Bedroom',       emoji: '🛏️', category: 'Character', prompt: 'cosy bedroom at night, fairy lights and string lights gentle warmth, soft duvet fabric, very quiet phone-on-bed ambience, distant residential hum through closed window, intimate and close, peaceful' },
  { id: 'amb_jordan_kitchen',     label: 'Jordan\'s Kitchen',     emoji: '🍳', category: 'Character', prompt: 'modern apartment kitchen ambience, quiet refrigerator hum, marble countertop reflections, subtle air movement, morning energy, urban apartment building, clean and bright' },
  { id: 'amb_emma_office',        label: 'Emma\'s Office',        emoji: '💻', category: 'Character', prompt: 'quiet home office room tone, laptop fan whirring softly, bookshelf-dampened acoustics, ring light electrical hum barely audible, professional calm, pencil-on-desk stillness' },
  { id: 'amb_tyler_bedroom',      label: 'Tyler\'s Bedroom',      emoji: '🎮', category: 'Character', prompt: 'bedroom at night enclosed room tone, gaming PC fan soft hum, LED strip lighting silence, 11pm stillness, phone recording close-mic ambience, contained quiet' },
  { id: 'amb_charlotte_bathroom', label: 'Charlotte\'s Bathroom', emoji: '🚿', category: 'Character', prompt: 'tiled bathroom room tone, faint pipe resonance, gentle water hiss, ceramic tile echo, exhaust fan low hum, post-shower moisture in the air, intimate echoey space' },
  { id: 'amb_marcus_garden',      label: 'Marcus\'s Garden',      emoji: '🌿', category: 'Character', prompt: 'English backyard garden afternoon, birdsong and sparrows, gentle breeze through hedgerow, open air no room tone, distant suburban neighbourhood, warm afternoon peace, no traffic' },
  { id: 'amb_sophie_livingroom',  label: 'Sophie\'s Living Room', emoji: '🕯️', category: 'Character', prompt: 'near-silent minimalist living room, barely audible ventilation, Scandinavian apartment quiet, meditative stillness, the quietest room you can imagine, candle-flame silence' },
  { id: 'amb_tom_meeting',        label: 'Tom\'s Meeting Room',   emoji: '📋', category: 'Character', prompt: 'meeting room ambience, HVAC ventilation steady hum, slight echo off whiteboard and glass partitions, fluorescent ceiling, very distant office activity through closed door' },
  { id: 'amb_fatima_livingroom',  label: 'Fatima\'s Living Room', emoji: '🛋️', category: 'Character', prompt: 'cosy living room evening ambience, warm lamp light tone, soft cushions and throws, gentle residential quiet, distant London traffic through windows, settled comfortable evening' },
  { id: 'amb_ethan_locker',       label: 'Ethan\'s Locker Room',  emoji: '🏋️', category: 'Character', prompt: 'gym locker room ambience, metal surfaces echo, distant shower running, ventilation fan, hard floor footstep echo, post-workout space, slightly humid acoustic' },
  { id: 'amb_anna_kitchen',       label: 'Anna\'s Kitchen',       emoji: '🍞', category: 'Character', prompt: 'bright morning kitchen room tone, warm space, ceramic and wood surfaces, gentle kettle hum, window letting in garden birdsong, domestic peace, morning light energy' },
  { id: 'amb_jack_studio',        label: 'Jack\'s Art Studio',    emoji: '🎨', category: 'Character', prompt: 'cluttered art studio room tone, creative space with mixed surfaces, paint and canvas, hardwood floor, slight ventilation, open and lived-in acoustic, casual workspace' },
  { id: 'amb_emily_dorm',         label: 'Emily\'s Dorm Room',    emoji: '✨', category: 'Character', prompt: 'dorm room at desk, fairy lights and string lights warm ambience, close-mic phone angle room tone, small cosy space, young bedroom energy, posters and soft furnishings' },
  { id: 'amb_amir_livingroom',    label: 'Amir\'s Living Room',   emoji: '🏠', category: 'Character', prompt: 'modern suburban living room ambience, air conditioning soft hum, comfortable sofa, American home quiet, gentle afternoon stillness, clean and spacious' },
  { id: 'amb_olivia_car',         label: 'Olivia\'s Car',         emoji: '🚗', category: 'Character', prompt: 'car interior parked engine off, windows up, suburban quiet outside muffled, compressed cabin acoustic, dashboard stillness, slight leather and plastic, parking lot peace' },
  { id: 'amb_james_study',        label: 'James\'s Study',        emoji: '📚', category: 'Character', prompt: 'home study room tone, bookshelf-lined walls absorbing all echo, warm desk lamp hum, leather and wood, deep quiet, old house peace, grandfather clock barely ticking in distance' },
  { id: 'amb_lily_library',       label: 'Lily\'s Library',       emoji: '📖', category: 'Character', prompt: 'university library study nook, hushed academic silence, very faint air conditioning, distant pages turning, whisper-quiet environment, carpet and shelves absorbing sound' },
  { id: 'amb_connor_beach',       label: 'Connor\'s Beach',       emoji: '🏖️', category: 'Character', prompt: 'coastal beach outdoor ambience, gentle waves breaking on shore, wind in phone microphone light buffeting, distant seagulls, salt air open space, Australian coast' },
  { id: 'amb_grace_loft',         label: 'Grace\'s Loft',         emoji: '🧱', category: 'Character', prompt: 'loft flat room tone, exposed brick walls reflecting sound, high ceilings, open space echo, trendy apartment South London, hardwood floors, bluetooth speaker in distance' },
  { id: 'amb_william_workshop',   label: 'William\'s Workshop',   emoji: '🔧', category: 'Character', prompt: 'garage workshop room tone, fluorescent tube light buzzing, concrete floor and walls, slight echo, workbench with metal tools, AM radio barely audible in background' },
];

const ambientCache = new Map<string, Blob>();

export const generateAmbientSound = async (
  id: string,
  customPrompt?: string,
): Promise<Blob | undefined> => {
  if (ambientCache.has(id)) return ambientCache.get(id)!;

  try { ensureConfigured(); } catch { return undefined; }

  const prompt = customPrompt ?? ROOM_AMBIENT_PROMPTS[id];
  if (!prompt) return undefined;

  try {
    console.log('[fal/sfx] Generating ambient:', id);
    const result = await fal.subscribe('fal-ai/elevenlabs/sound-effects/v2' as any, {
      input: { text: prompt, duration_seconds: 10 },
    });

    const audioUrl = (result.data as any).audio?.url;
    if (!audioUrl) return undefined;

    const blob = await urlToBlob(audioUrl);
    ambientCache.set(id, blob);
    return blob;
  } catch (e) {
    console.warn('[fal/sfx] Ambient generation failed:', e);
    return undefined;
  }
};

export const cacheAmbientBlob = (id: string, blob: Blob): void => {
  ambientCache.set(id, blob);
};

export const getCachedAmbientBlob = (id: string): Blob | undefined => {
  return ambientCache.get(id);
};

// ─── VOICE DESIGN (via fal.ai Minimax) ──────────────────────────────

export interface VoiceDesignPreview {
  customVoiceId: string;
  audioUrl: string;
}

export interface VoiceDesignResponse {
  previews: VoiceDesignPreview[];
  text: string;
}

export const designVoice = async (
  voiceDescription: string,
  previewText?: string,
  _signal?: AbortSignal,
): Promise<VoiceDesignResponse> => {
  ensureConfigured();

  const text = previewText?.slice(0, 500) || 'Hello, this is a preview of my designed voice. How does it sound?';

  console.log('[fal/minimax-voice-design] Designing voice…', { description: voiceDescription.slice(0, 60) });

  const result = await fal.subscribe('fal-ai/minimax/voice-design' as any, {
    input: {
      prompt: voiceDescription,
      preview_text: text,
    },
  });

  const data = result.data as any;
  const customVoiceId = data.custom_voice_id;
  const audioUrl = data.audio?.url;

  if (!customVoiceId) throw new Error('No voice ID returned from Minimax voice design');

  console.log('[fal/minimax-voice-design] Got voice:', customVoiceId);
  return {
    previews: [{ customVoiceId, audioUrl: audioUrl || '' }],
    text,
  };
};

// ─── VOICE CLONE (via fal.ai Minimax) ────────────────────────────────

export type MinimaxCloneModel =
  | 'speech-02-hd'
  | 'speech-02-turbo'
  | 'speech-01-hd'
  | 'speech-01-turbo';

export interface CloneVoiceOptions {
  noiseReduction?: boolean;          // clean up sample
  volumeNormalization?: boolean;     // normalize sample volume
  accuracy?: number;                 // 0-1 text validation threshold
  previewText?: string;              // sample sentence for preview
  model?: MinimaxCloneModel;
}

export interface CloneVoiceResult {
  voiceId: string;
  previewUrl?: string;
}

export const cloneVoiceFromAudio = async (
  audioBlob: Blob,
  voiceName: string,
  options: CloneVoiceOptions = {},
): Promise<CloneVoiceResult> => {
  ensureConfigured();

  console.log('[fal/minimax-voice-clone] Cloning voice:', {
    voiceName,
    audioSize: audioBlob.size,
    audioType: audioBlob.type,
    options,
  });

  const audioUrl = await fal.storage.upload(audioBlob);

  // Build minimal input — only include optional params when set so we don't
  // override fal's safer defaults. `accuracy` in particular is a strict
  // text-validation gate and a wrong threshold will reject the whole job.
  const input: Record<string, any> = {
    audio_url: audioUrl,
    model: options.model ?? 'speech-02-hd',
  };
  if (options.previewText && options.previewText.trim().length > 0) {
    input.text = options.previewText.slice(0, 500);
  }
  if (options.noiseReduction !== undefined) {
    input.noise_reduction = options.noiseReduction;
  }
  if (options.volumeNormalization !== undefined) {
    input.need_volume_normalization = options.volumeNormalization;
  }
  if (options.accuracy !== undefined) {
    input.accuracy = options.accuracy;
  }

  console.log('[fal/minimax-voice-clone] Submitting input:', { ...input, audio_url: '<uploaded>' });

  try {
    const result = await fal.subscribe('fal-ai/minimax/voice-clone' as any, { input });
    const data = result.data as any;
    const voiceId = data.custom_voice_id;
    if (!voiceId) throw new Error('No voice_id returned from Minimax voice clone');
    console.log('[fal/minimax-voice-clone] Created cloned voice:', voiceId);
    return { voiceId, previewUrl: data.audio?.url };
  } catch (err: any) {
    console.error('[fal/minimax-voice-clone] Full error:', err, 'body:', err?.body, 'response:', err?.response);
    throw err;
  }
};

// ─── CLONED VOICE STORAGE (localStorage) ─────────────────────────────
// Cloned voices auto-delete from fal after 7 days unless used with TTS.
// We track expiry locally and let the user extend it with one tap.

export interface ClonedVoice {
  id: string;            // unique local id
  name: string;          // user-facing label
  voiceId: string;       // fal custom_voice_id
  previewUrl?: string;
  model: MinimaxCloneModel;
  createdAt: number;
  expiresAt: number;     // createdAt + 7 days, refreshed when used
  lastUsedAt?: number;
}

const CLONED_VOICES_KEY = 'cloned_voices_v1';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const loadClonedVoices = (): ClonedVoice[] => {
  try {
    return JSON.parse(localStorage.getItem(CLONED_VOICES_KEY) || '[]');
  } catch {
    return [];
  }
};

const writeClonedVoices = (all: ClonedVoice[]) => {
  localStorage.setItem(CLONED_VOICES_KEY, JSON.stringify(all));
};

export const saveClonedVoice = (v: ClonedVoice) => {
  const all = loadClonedVoices();
  all.unshift(v);
  writeClonedVoices(all);
};

export const updateClonedVoice = (id: string, patch: Partial<ClonedVoice>) => {
  const all = loadClonedVoices().map(v => (v.id === id ? { ...v, ...patch } : v));
  writeClonedVoices(all);
};

export const deleteClonedVoice = (id: string) => {
  writeClonedVoices(loadClonedVoices().filter(v => v.id !== id));
};

// Refresh local expiry after a successful TTS call.
export const touchClonedVoice = (voiceId: string) => {
  const now = Date.now();
  const all = loadClonedVoices().map(v =>
    v.voiceId === voiceId ? { ...v, lastUsedAt: now, expiresAt: now + SEVEN_DAYS_MS } : v,
  );
  writeClonedVoices(all);
};
