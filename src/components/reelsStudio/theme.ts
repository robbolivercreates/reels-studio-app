/**
 * Design tokens for the Reels Studio app. Two themes — dark and light — selected
 * by `state.appTheme`. Components consume via the `useTheme` hook.
 *
 * Language: Linear / Vercel / Arc. Monochromatic, hairline borders, accent only
 * on focus/selection. CTAs are solid black or white (inverted by theme), never
 * gradients. Status communicates with `dot + text`, not colored pills.
 */

export type AppTheme = 'dark' | 'light';

export interface ThemeTokens {
  bg: {
    /** App canvas background. */
    canvas: string;
    /** Panels, modals — slightly elevated above canvas. */
    surface: string;
    /** Dropdowns, popovers — highest elevation. */
    elevated: string;
    /** Hover state on subtle interactive surfaces. */
    hover: string;
    /** Active / selected state. */
    active: string;
  };
  border: {
    /** Subtlest divider — 1px @ 8% alpha. */
    subtle: string;
    /** Default input/card border. */
    default: string;
  };
  text: {
    /** Headings, values. */
    primary: string;
    /** Labels, descriptions. */
    secondary: string;
    /** Hints, metadata. */
    tertiary: string;
  };
  accent: {
    /** Background of the primary CTA. Inverts by theme so the CTA pops as solid. */
    bg: string;
    /** Foreground of the primary CTA. */
    fg: string;
    /** Focus ring + selection — the ONLY place brand violet appears. */
    focus: string;
  };
  status: {
    ok: string;
    warn: string;
    err: string;
    pending: string;
  };
}

export const THEME_DARK: ThemeTokens = {
  bg: {
    canvas: '#0A0A0B',
    surface: '#141416',
    elevated: '#1C1C1F',
    hover: 'rgba(255,255,255,0.05)',
    active: 'rgba(255,255,255,0.08)',
  },
  border: {
    subtle: 'rgba(255,255,255,0.08)',
    default: 'rgba(255,255,255,0.12)',
  },
  text: {
    primary: '#FAFAFA',
    secondary: '#A1A1AA',
    tertiary: '#71717A',
  },
  accent: {
    bg: '#FAFAFA',
    fg: '#0A0A0B',
    focus: '#8B5CF6',
  },
  status: {
    ok: '#22C55E',
    warn: '#F59E0B',
    err: '#EF4444',
    pending: '#A1A1AA',
  },
};

export const THEME_LIGHT: ThemeTokens = {
  bg: {
    canvas: '#FAFAFA',
    surface: '#FFFFFF',
    elevated: '#F4F4F5',
    hover: 'rgba(0,0,0,0.04)',
    active: 'rgba(0,0,0,0.06)',
  },
  border: {
    subtle: 'rgba(0,0,0,0.08)',
    default: 'rgba(0,0,0,0.12)',
  },
  text: {
    primary: '#0A0A0B',
    secondary: '#52525B',
    tertiary: '#71717A',
  },
  accent: {
    bg: '#0A0A0B',
    fg: '#FAFAFA',
    focus: '#7C3AED',
  },
  status: {
    ok: '#16A34A',
    warn: '#D97706',
    err: '#DC2626',
    pending: '#71717A',
  },
};

export const getTheme = (theme: AppTheme): ThemeTokens =>
  theme === 'light' ? THEME_LIGHT : THEME_DARK;
