/**
 * Small formatters shared between wizard sub-components. Extracted from the
 * deleted modals so the wizard remains self-contained.
 */

export const fmtSize = (b: number): string =>
  b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`;

export const fmtAgo = (ts: number): string => {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
  return `${Math.floor(s / 86400)}d atrás`;
};

export const isYouTubeUrl = (url: string): boolean =>
  url.includes('youtube.com') || url.includes('youtu.be');
