/**
 * Shared modal chrome helpers — keeps backdrop/card/header styles consistent
 * across every modal in the app and lets us theme them via tokens without
 * touching the inner content of each modal.
 *
 * Strategy: each modal calls `useModalChrome(appTheme)` to get inline styles
 * for the four "chrome" surfaces (backdrop, card, header divider, body
 * divider). The form fields and buttons inside the modal can migrate to
 * tokens later — for now, getting the wrapper right is what makes the modal
 * "respect the theme."
 */

import { useMemo } from 'react';
import { getTheme, type AppTheme } from './theme';

export interface ModalChromeStyles {
  /** Full-screen backdrop. */
  backdrop: React.CSSProperties;
  /** Inner card (the actual modal). */
  card: React.CSSProperties;
  /** Header divider — pass to a `borderBottom` style. */
  headerDivider: React.CSSProperties;
  /** Body divider — same but for footer/section dividers. */
  bodyDivider: React.CSSProperties;
  /** Primary text inside the modal. */
  textPrimary: React.CSSProperties;
  /** Secondary text inside the modal. */
  textSecondary: React.CSSProperties;
  /** Close button (icon-only). */
  closeButton: React.CSSProperties;
}

export const useModalChrome = (appTheme: AppTheme | undefined): ModalChromeStyles => {
  return useMemo(() => {
    const tokens = getTheme(appTheme ?? 'dark');
    const isLight = (appTheme ?? 'dark') === 'light';
    return {
      backdrop: {
        backgroundColor: isLight ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.7)',
      },
      card: {
        backgroundColor: tokens.bg.surface,
        color: tokens.text.primary,
        border: `1px solid ${tokens.border.subtle}`,
        boxShadow: isLight ? '0 30px 80px rgba(0,0,0,0.18)' : '0 30px 80px rgba(0,0,0,0.8)',
      },
      headerDivider: {
        borderBottom: `1px solid ${tokens.border.subtle}`,
      },
      bodyDivider: {
        borderTop: `1px solid ${tokens.border.subtle}`,
      },
      textPrimary: { color: tokens.text.primary },
      textSecondary: { color: tokens.text.secondary },
      closeButton: { color: tokens.text.tertiary },
    };
  }, [appTheme]);
};
