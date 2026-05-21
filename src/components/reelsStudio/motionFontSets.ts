/**
 * Font sets for motion graphics — 6 curated typography palettes inspired by
 * the HyperFrames catalog analysis (2026-05-16). Each set ships its own
 * Google Fonts URL + CSS classes. Inter is always loaded as fallback.
 *
 * Why 6 sets instead of 1: in real motion design (HyperFrames, Apple, Buck),
 * each *style* of composition has a font signature. TikTok overlays in DM Sans,
 * Apple-style counters in -apple-system, NYT charts in Libre Baskerville.
 * Mixing fonts within a single composition is amateurish — but using the same
 * 3 fonts for every composition makes every motion look identical.
 *
 * MotionConfig.fontSet picks a set; if absent, the preset's defaultFontSet
 * applies; if the preset doesn't declare one, 'brand' is the default.
 */

import type { FontSet } from './motionLibrary';

interface FontSetDefinition {
  /** Google Fonts URL — null when the set uses only system fonts (Apple). */
  googleFontsUrl: string | null;
  /**
   * CSS injected into the host page <style>. Defines:
   * - .font-display (headlines / hero text)
   * - .font-body    (paragraphs / UI)
   * - .font-tech    (numbers / labels — monospace-ish when relevant)
   * Each set picks its own families. Inter is always available as fallback
   * via the safety link in buildFullHtmlDoc.
   */
  css: string;
  /** Short label shown in the Gemini system prompt to help it understand the vibe. */
  vibe: string;
}

export const FONT_SETS: Record<FontSet, FontSetDefinition> = {
  brand: {
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&display=block',
    css: `
      .font-display { font-family: "Anton", "Inter", system-ui, sans-serif; letter-spacing: -0.01em; text-transform: uppercase; }
      .font-tech    { font-family: "Space Grotesk", "Inter", system-ui, sans-serif; letter-spacing: -0.02em; }
      .font-body    { font-family: "Inter", system-ui, sans-serif; }
    `.trim(),
    vibe: 'Viral/punk/keyword. Headlines gigantes em UPPERCASE Anton, números em Space Grotesk, corpo Inter.',
  },

  social: {
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;900&display=block',
    css: `
      .font-display { font-family: "DM Sans", system-ui, sans-serif; font-weight: 900; letter-spacing: -0.02em; }
      .font-tech    { font-family: "DM Sans", system-ui, sans-serif; font-weight: 700; letter-spacing: -0.01em; }
      .font-body    { font-family: "DM Sans", system-ui, sans-serif; font-weight: 400; }
    `.trim(),
    vibe: 'Social/creator authentic. DM Sans em todos os pesos — fonte assinatura de TikTok/Instagram/YouTube overlays.',
  },

  apple: {
    // -apple-system is native on macOS/iOS Chromium build — JetBrains Mono is the
    // closest Google-hosted match to SF Mono for tabular numbers.
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=block',
    css: `
      .font-display { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; font-weight: 900; letter-spacing: -0.02em; }
      .font-tech    { font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
      .font-body    { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; font-weight: 400; }
    `.trim(),
    vibe: 'Apple keynote / iOS finance. -apple-system pro corpo, JetBrains Mono com tabular-nums pra números. Vibe Apple Money Count.',
  },

  editorial: {
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Libre+Franklin:wght@300;400;500;600;700&display=block',
    css: `
      .font-display { font-family: "Libre Baskerville", Georgia, serif; font-weight: 700; letter-spacing: -0.01em; }
      .font-tech    { font-family: "Libre Franklin", "Inter", sans-serif; font-weight: 600; letter-spacing: -0.01em; }
      .font-body    { font-family: "Libre Franklin", "Inter", sans-serif; font-weight: 400; }
    `.trim(),
    vibe: 'Editorial NYT/Vogue. Serif Libre Baskerville pra headlines, Libre Franklin pra labels. Charts, quotes, dados.',
  },

  tech: {
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=block',
    css: `
      .font-display { font-family: "Space Grotesk", "Inter", system-ui, sans-serif; font-weight: 600; letter-spacing: -0.02em; }
      .font-tech    { font-family: "Space Grotesk", "Inter", system-ui, sans-serif; font-weight: 500; letter-spacing: -0.02em; }
      .font-body    { font-family: "Inter", system-ui, sans-serif; font-weight: 400; }
    `.trim(),
    vibe: 'Técnico/diagramas. Space Grotesk em display, Inter em corpo. Flowcharts, code, system design.',
  },

  display: {
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=block',
    css: `
      .font-display { font-family: "Inter", system-ui, sans-serif; font-weight: 900; letter-spacing: -0.03em; }
      .font-tech    { font-family: "Inter", system-ui, sans-serif; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
      .font-body    { font-family: "Inter", system-ui, sans-serif; font-weight: 400; }
    `.trim(),
    vibe: 'Neutral safe fallback. Inter em todos os papéis. Quando o estilo não pede assinatura forte.',
  },

  cozy: {
    // Anton (heavy condensed display) + Nunito (rounded friendly sans). The
    // signature pairing for the Animado · Notion illustrated style — título
    // bold/condensado que cabe sempre na tela + corpo arredondado acolhedor.
    googleFontsUrl:
      'https://fonts.googleapis.com/css2?family=Anton&family=Nunito:wght@400;500;600;700;800&display=block',
    css: `
      .font-display { font-family: "Anton", system-ui, sans-serif; font-weight: 400; letter-spacing: 0.005em; text-transform: uppercase; }
      .font-tech    { font-family: "Nunito", system-ui, sans-serif; font-weight: 700; letter-spacing: -0.005em; }
      .font-body    { font-family: "Nunito", system-ui, sans-serif; font-weight: 500; }
    `.trim(),
    vibe: 'Aconchego/illustrated. Anton condensada e bold pra headlines (UPPERCASE, cabe sempre), Nunito arredondada pro corpo. Notion-style warm com título impactante.',
  },
};

/** Build the <link> tags + <style> block for the given font set. */
export const buildFontSetHead = (set: FontSet): { links: string; css: string } => {
  const def = FONT_SETS[set];
  const links = def.googleFontsUrl
    ? `<link href="${def.googleFontsUrl}" rel="stylesheet" />`
    : '';
  return { links, css: def.css };
};

/** Compact summary table for the SYSTEM_PROMPT — teaches Gemini when to pick each set. */
export const FONT_SETS_PROMPT_TABLE = `
TYPOGRAPHY SET (you must pick ONE per composition and stick with it):
- brand:      Anton + Space Grotesk + Inter. Viral/hype/keyword reveals — headlines gigantes UPPERCASE.
- social:     DM Sans only (all weights). Overlays Instagram/TikTok/YouTube — authentic creator look.
- apple:      -apple-system (native macOS) + JetBrains Mono. Counters, money, stats, notifications — Apple keynote vibe with tabular-nums.
- editorial:  Libre Baskerville + Libre Franklin. NYT-style charts, quotes, data, editorial pieces.
- tech:       Space Grotesk + Inter. Flowcharts, code, system diagrams, technical content.
- display:    Inter only. Safe neutral fallback when no signature is needed.
- cozy:       Anton (heavy condensed display, UPPERCASE) + Nunito (rounded sans). Illustrated/Notion warm style — título impactante que sempre cabe na tela, corpo arredondado acolhedor.

DO NOT mix typography across sets. The set is FIXED by the preset's defaultFontSet — use the .font-display / .font-tech / .font-body classes that come pre-defined in <style>. Never inject extra <link> tags for additional Google Fonts.
`.trim();
