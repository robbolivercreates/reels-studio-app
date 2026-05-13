/**
 * Utility hook that resolves design tokens for the active app theme.
 *
 * Reels Studio doesn't use a React context for state — the reducer lives at the
 * top of ReelsStudio.tsx and is prop-drilled. So instead of a context-based
 * provider, callers pass `appTheme` directly and get back the resolved tokens.
 *
 * This is intentional: it keeps the consumer code explicit ("this component is
 * rendering tokens for theme X") and avoids a third source of truth.
 */

import { useMemo } from 'react';
import { type AppTheme, type ThemeTokens, getTheme } from './theme';

export const useTheme = (appTheme: AppTheme | undefined): ThemeTokens => {
  return useMemo(() => getTheme(appTheme ?? 'dark'), [appTheme]);
};
