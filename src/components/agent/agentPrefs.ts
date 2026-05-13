// User preferences for the agent subsystem. Persisted to localStorage.
//
// Today the only user-facing toggle is "use Claude for text generation"
// (off by default — Gemini Flash is faster and cheaper for text tasks).
// All other capabilities (motion, audio, avatar, image) have a single real
// provider today, so they're surfaced as INFO in the settings panel rather
// than as a choice. When a real second option appears, the info row gets
// upgraded to a toggle without redesigning the panel.

import { useCallback, useEffect, useState } from 'react';

// Text-generation provider mode. 'auto' = Gemini when GOOGLE_API_KEY is
// configured, Claude as fallback. 'gemini' / 'claude' = force one path
// regardless of key state. Stored as a string instead of a boolean because
// "Auto" needed to coexist with explicit choices once we added Claude as
// a real provider (not just an opt-in override).
export type TextProvider = 'auto' | 'gemini' | 'claude';
export type ResolvedTextProvider = 'gemini' | 'claude';

const STORAGE_KEY_TEXT_PROVIDER = 'reels.agent.textProvider';
const STORAGE_KEY_GOOGLE = 'GOOGLE_API_KEY';

// Legacy key — earlier we only had a single "use Claude for text" boolean.
// Migrate it forward so users who flipped that toggle don't get reset.
const LEGACY_USE_CLAUDE_KEY = 'reels.agent.useClaudeForText';

function loadTextProvider(): TextProvider {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TEXT_PROVIDER);
    if (raw === 'auto' || raw === 'gemini' || raw === 'claude') return raw;
    // Honor the legacy boolean once, then standardize on the new key.
    if (localStorage.getItem(LEGACY_USE_CLAUDE_KEY) === '1') {
      localStorage.setItem(STORAGE_KEY_TEXT_PROVIDER, 'claude');
      return 'claude';
    }
  } catch {
    /* ignore */
  }
  return 'auto';
}

function saveTextProvider(value: TextProvider): void {
  try {
    localStorage.setItem(STORAGE_KEY_TEXT_PROVIDER, value);
  } catch {
    /* ignore */
  }
}

function hasGoogleKey(): boolean {
  try {
    return !!localStorage.getItem(STORAGE_KEY_GOOGLE);
  } catch {
    return false;
  }
}

/// Resolves the effective provider for a text-generation call. Use this in
/// services (regenerateBlock, generateCarouselScript, etc) right before
/// kicking off the request so the user's setting + key availability are
/// always honored.
export function resolveTextProvider(): ResolvedTextProvider {
  const pref = loadTextProvider();
  if (pref === 'gemini') return 'gemini';
  if (pref === 'claude') return 'claude';
  // 'auto' — prefer Gemini when the user has the key, otherwise Claude.
  return hasGoogleKey() ? 'gemini' : 'claude';
}

/// Read the *raw* setting (not the resolved value). Useful when rendering
/// the settings UI.
export function getTextProvider(): TextProvider {
  return loadTextProvider();
}

// Mini event bus so all consumers stay in sync when one of them changes the
// setting (no React context — keeps this module dependency-free).
const subs = new Set<(v: TextProvider) => void>();

export function useTextProvider(): {
  value: TextProvider;
  resolved: ResolvedTextProvider;
  setValue: (v: TextProvider) => void;
} {
  const [value, setLocalValue] = useState<TextProvider>(loadTextProvider);

  useEffect(() => {
    const handler = (v: TextProvider) => setLocalValue(v);
    subs.add(handler);
    return () => {
      subs.delete(handler);
    };
  }, []);

  const setValue = useCallback((next: TextProvider) => {
    saveTextProvider(next);
    for (const s of subs) s(next);
  }, []);

  const resolved: ResolvedTextProvider =
    value === 'claude' ? 'claude' : value === 'gemini' ? 'gemini' : hasGoogleKey() ? 'gemini' : 'claude';

  return { value, resolved, setValue };
}

// --- Backwards-compat shim (still used in AgentSettingsTab today) -------

/// @deprecated Use `useTextProvider()` instead. Kept so the in-flight
/// settings UI keeps working until it migrates to the 3-option picker.
export function useUseClaudeForText(): {
  value: boolean;
  setValue: (v: boolean) => void;
} {
  const { value, setValue } = useTextProvider();
  const claudeMode = value === 'claude';
  const apply = useCallback(
    (v: boolean) => setValue(v ? 'claude' : 'auto'),
    [setValue],
  );
  return { value: claudeMode, setValue: apply };
}

/// @deprecated Use `resolveTextProvider()` instead.
export function getUseClaudeForText(): boolean {
  return loadTextProvider() === 'claude';
}

// ───────────────────────────────────────────────────────────────────────
// Motion provider — separate from text. Motion has different tradeoffs:
// Gemini Pro has Google Search grounding (auto brand colors); Claude gives
// the user full control over which Claude model (via the chat picker) but
// no grounding. Defaulting independently from text makes "Gemini for motion
// because of grounding, Claude for text because of voice profile" a single
// settings change, not two.

export type MotionProvider = 'auto' | 'gemini' | 'claude';
export type ResolvedMotionProvider = 'gemini' | 'claude';

const STORAGE_KEY_MOTION_PROVIDER = 'reels.agent.motionProvider';

function loadMotionProvider(): MotionProvider {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MOTION_PROVIDER);
    if (raw === 'auto' || raw === 'gemini' || raw === 'claude') return raw;
  } catch {
    /* ignore */
  }
  return 'auto';
}

function saveMotionProvider(value: MotionProvider): void {
  try {
    localStorage.setItem(STORAGE_KEY_MOTION_PROVIDER, value);
  } catch {
    /* ignore */
  }
}

/// Same resolution semantics as `resolveTextProvider`: gemini when key
/// present in 'auto' mode, claude otherwise. Explicit settings win.
export function resolveMotionProvider(): ResolvedMotionProvider {
  const pref = loadMotionProvider();
  if (pref === 'gemini') return 'gemini';
  if (pref === 'claude') return 'claude';
  return hasGoogleKey() ? 'gemini' : 'claude';
}

export function getMotionProvider(): MotionProvider {
  return loadMotionProvider();
}

const motionSubs = new Set<(v: MotionProvider) => void>();

export function useMotionProvider(): {
  value: MotionProvider;
  resolved: ResolvedMotionProvider;
  setValue: (v: MotionProvider) => void;
} {
  const [value, setLocalValue] = useState<MotionProvider>(loadMotionProvider);

  useEffect(() => {
    const handler = (v: MotionProvider) => setLocalValue(v);
    motionSubs.add(handler);
    return () => {
      motionSubs.delete(handler);
    };
  }, []);

  const setValue = useCallback((next: MotionProvider) => {
    saveMotionProvider(next);
    for (const s of motionSubs) s(next);
  }, []);

  const resolved: ResolvedMotionProvider =
    value === 'claude' ? 'claude' : value === 'gemini' ? 'gemini' : hasGoogleKey() ? 'gemini' : 'claude';

  return { value, resolved, setValue };
}

/// Static description of which providers are active for each capability.
/// Surfaced read-only in the Agents settings tab so the user sees what's
/// running without having to configure it. When we add a real alternative
/// (e.g. Veo for video, ElevenLabs for tts), upgrade that entry to a
/// dropdown in `AgentSettingsTab`.
export interface ProviderInfo {
  capability: 'text' | 'image' | 'motion' | 'tts' | 'avatar' | 'analysis';
  label: string;
  /** Human-readable description for the settings row. */
  provider: string;
  /** localStorage key the user keeps the API key under, if any. */
  storageKey?: string;
  /** Short note on cost / behaviour. */
  note?: string;
}

export const ACTIVE_PROVIDERS: ProviderInfo[] = [
  {
    capability: 'text',
    label: 'Texto (roteiro, regen, captions)',
    provider: 'Google Gemini',
    storageKey: 'GOOGLE_API_KEY',
    note: 'Rápido e barato. Pode ser sobrescrito por Claude em Avançado.',
  },
  {
    capability: 'analysis',
    label: 'Análise de vídeo de referência',
    provider: 'Google Gemini',
    storageKey: 'GOOGLE_API_KEY',
  },
  // Image generation lives in a sibling product (avatar-studio); not wired
  // into Reels Studio yet. When we add it, list the chosen provider here.
  // {
  //   capability: 'image',
  //   label: 'Imagem (B-roll, capas)',
  //   provider: 'nanoBanana2 (fal.ai)',
  //   storageKey: 'FAL_KEY',
  // },
  {
    capability: 'motion',
    label: 'Motion graphics',
    provider: 'HyperFrames + Gemini',
    note: 'HTML gerado por IA, renderizado localmente.',
  },
  {
    capability: 'avatar',
    label: 'Clipes de avatar',
    provider: 'HeyGen',
    storageKey: 'HEYGEN_API_KEY',
  },
  {
    capability: 'tts',
    label: 'Áudio (TTS, voice clone)',
    provider: 'Minimax (fal.ai)',
    storageKey: 'FAL_KEY',
  },
];
