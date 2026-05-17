/**
 * Persistent "creator identity" used by social CTA motions (follow card etc).
 *
 * Stored globally in localStorage (not per-project) — the user's @ and avatar
 * don't change per Reel, so it doesn't make sense to re-enter them every time.
 * Motion generation reads from here and substitutes into the Gemini prompt so
 * the rendered card shows real handle + photo instead of an invented one.
 */

const STORAGE_KEY = 'reels.userIdentity';

export interface UserIdentity {
  displayName: string;          // "Rob Boliver" — shown on the follow card
  handle: string;               // "@robboliver" — also shown on the card; @ optional, normalised on save
  avatarDataUrl?: string;       // base64 data URL of the avatar image, embedded in the prompt
  followerCount?: string;       // optional: "12.4K" — purely decorative on the card
  primaryPlatform?: 'instagram' | 'tiktok' | 'youtube' | 'generic';
  /**
   * When true, every reel auto-applies the "social-cta-follow" preset to its
   * final block (the user has agreed once that they want a "follow" CTA on
   * everything they ship). Default true — explicit social CTA is high-value
   * and was the use-case that drove the identity feature.
   */
  autoFollowCta?: boolean;
}

const EMPTY: UserIdentity = {
  displayName: '',
  handle: '',
  primaryPlatform: 'instagram',
  autoFollowCta: true,
};

export const loadUserIdentity = (): UserIdentity => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<UserIdentity>;
    return {
      displayName: parsed.displayName ?? '',
      handle: parsed.handle ?? '',
      avatarDataUrl: parsed.avatarDataUrl,
      followerCount: parsed.followerCount,
      primaryPlatform: parsed.primaryPlatform ?? 'instagram',
      autoFollowCta: parsed.autoFollowCta ?? true,
    };
  } catch {
    return { ...EMPTY };
  }
};

export const saveUserIdentity = (id: UserIdentity): void => {
  try {
    // Normalise handle so the rest of the app doesn't need to second-guess.
    const handle = id.handle.trim().replace(/^@+/, '');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...id, handle }));
  } catch {
    /* localStorage quota or disabled — non-fatal */
  }
};

export const hasUserIdentity = (id: UserIdentity): boolean => {
  return id.displayName.trim().length > 0 || id.handle.trim().length > 0;
};

/** Format a handle for display: always prefixed with a single "@". */
export const formatHandle = (handle: string): string => {
  const trimmed = handle.trim().replace(/^@+/, '');
  return trimmed ? `@${trimmed}` : '';
};
