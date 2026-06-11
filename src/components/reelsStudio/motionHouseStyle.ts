/**
 * Estilo da Casa — THE central design tokens for generated motions.
 *
 * Before this module, typography and backgrounds were re-decided by the LLM
 * on every generation (taught via ~700 tokens of prompt prose per call, with
 * inconsistent results). Now the WRAPPER owns the style: `buildFullHtmlDoc`
 * injects ready-made classes (.hs-title / .hs-subtitle / .hs-kicker), CSS
 * variables (--hs-*) and the track-0 atmosphere background — deterministic,
 * hand-crafted once, identical across every motion. The prompt shrinks to
 * "use the provided classes/vars; do NOT paint backgrounds".
 *
 * Two modes:
 *   dark  — pure-black-ish canvas + subtle steel-blue glow (approved palette)
 *   light — warm paper (#FAFAF8) + 1px LINE GRID + soft top accent gradient
 *           (Rob's spec: "no claro, um grid no fundo e um gradiente")
 */

export type HouseMode = 'dark' | 'light';

export const HOUSE_STYLE = {
  /** Existing font set in motionFontSets: Anton (título) + Space Grotesk (números) + Inter (corpo). */
  fontSet: 'brand' as const,
  dark: {
    bg: '#0a0a0c',
    /** Float overlays need PURE black (screen blend transparency). */
    bgOverlay: '#000000',
    text: '#f5f5f5',
    text2: '#a1a1aa',
    accent: '#60A5FA',
    accentSoft: 'rgba(96,165,250,0.16)',
  },
  light: {
    bg: '#FAFAF8',
    text: '#1d1d1f',
    text2: '#52525b',
    accent: '#2563EB',
    accentSoft: 'rgba(37,99,235,0.10)',
  },
} as const;

/**
 * Class + variable kit injected into every generated doc's <style>.
 * The LLM references these instead of declaring its own font/base colors.
 */
export const buildHouseStyleCss = (mode: HouseMode): string => {
  const t = HOUSE_STYLE[mode];
  return `
      :root {
        --hs-bg: ${t.bg};
        --hs-text: ${t.text};
        --hs-text2: ${t.text2};
        --hs-accent: ${t.accent};
        --hs-accent-soft: ${t.accentSoft};
      }
      /* Título da casa — Anton, caixa alta, tracking apertado. */
      .hs-title {
        font-family: "Anton", "Inter", system-ui, sans-serif;
        text-transform: uppercase;
        letter-spacing: -0.01em;
        line-height: 0.96;
        color: var(--hs-text);
        font-weight: 400; /* Anton é single-weight */
      }
      /* Subtítulo da casa — Inter semibold. */
      .hs-subtitle {
        font-family: "Inter", system-ui, sans-serif;
        font-weight: 600;
        letter-spacing: -0.01em;
        line-height: 1.25;
        color: var(--hs-text2);
      }
      /* Kicker/eyebrow — micro-rótulo no accent. */
      .hs-kicker {
        font-family: "Inter", system-ui, sans-serif;
        font-weight: 800;
        font-size: 24px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--hs-accent);
      }
      /* Números/dados — Space Grotesk tabular. */
      .hs-number {
        font-family: "Space Grotesk", "Inter", system-ui, sans-serif;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
        color: var(--hs-text);
      }`;
};

/**
 * Ready-made track-0 atmosphere — injected by the wrapper as the FIRST child
 * of the composition root, so the model never paints backgrounds again.
 *
 *   dark  → near-black canvas + steel-blue radial glow + soft vignette
 *   light → warm paper + 1px line grid (44px tile) + top accent wash +
 *           faint warm vignette
 *
 * NOT used in overlay (float) mode — floats need pure black, no atmosphere
 * (any glow becomes a visible seam when the layer is repositioned).
 */
export const buildHouseAtmosphereDiv = (mode: HouseMode, durationSec: number): string => {
  const dur = Math.max(0.1, durationSec).toFixed(2);
  if (mode === 'light') {
    return [
      `<div id="atmos-bg" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"`,
      `     style="position:absolute; inset:0; background-color:#FAFAF8;`,
      `            background-image:`,
      `              radial-gradient(ellipse 90% 55% at 50% -10%, rgba(37,99,235,0.07) 0%, transparent 62%),`,
      `              linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px),`,
      `              linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px);`,
      `            background-size: auto, 44px 44px, 44px 44px;"></div>`,
      `<div id="atmos-vignette" class="clip" data-start="0" data-duration="${dur}" data-track-index="1"`,
      `     style="position:absolute; inset:0; pointer-events:none;`,
      `            box-shadow: inset 0 0 200px rgba(120,90,60,0.12);"></div>`,
    ].join('\n');
  }
  return [
    `<div id="atmos-bg" class="clip" data-start="0" data-duration="${dur}" data-track-index="0"`,
    `     style="position:absolute; inset:0; background-color:#0a0a0c;`,
    `            background-image:`,
    `              radial-gradient(ellipse 70% 50% at 24% 22%, rgba(96,165,250,0.13) 0%, transparent 60%),`,
    `              radial-gradient(ellipse 60% 45% at 80% 78%, rgba(37,99,235,0.09) 0%, transparent 62%);"></div>`,
    `<div id="atmos-vignette" class="clip" data-start="0" data-duration="${dur}" data-track-index="1"`,
    `     style="position:absolute; inset:0; pointer-events:none;`,
    `            box-shadow: inset 0 0 240px rgba(0,0,0,0.6), inset 0 0 90px rgba(0,0,0,0.4);"></div>`,
  ].join('\n');
};

/**
 * Compact prompt block describing the kit to the model — replaces ~700 tokens
 * of typography + atmosphere lectures per generation.
 */
export const HOUSE_STYLE_PROMPT_BRIEF = `
--- HOUSE STYLE (provided by the runtime — USE, don't recreate) ---
The wrapper already injects: the track-0 BACKGROUND + vignette (do NOT create
any background, gradient, grid, vignette or grain — foreground only), the
fonts, and these ready classes/vars:
  .hs-title    → headline (Anton, UPPERCASE, tight)     · .hs-subtitle → support text (Inter 600)
  .hs-kicker   → eyebrow micro-label (accent colored)   · .hs-number  → stats (Space Grotesk tabular)
  var(--hs-bg) var(--hs-text) var(--hs-text2) var(--hs-accent) var(--hs-accent-soft)
Use these classes for ALL primary text (add font-size/position inline). Never
declare your own font-family for base text and never hardcode base text colors
— use the vars. Accent colors: brand palette when given, else var(--hs-accent).`.trim();
