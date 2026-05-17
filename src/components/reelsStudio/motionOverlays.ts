/**
 * Optional cinematic overlays — film grain, vignette, shimmer sweep.
 *
 * These are universal layers that can be toggled on top of any motion preset.
 * Each returns a `{ css, html, script }` triple injected into buildFullHtmlDoc.
 *
 * Inspired directly by the HyperFrames `registry/components/*` snippets:
 * - grain-overlay  → analog film texture (SVG feTurbulence fractalNoise)
 * - vignette       → radial darkening at edges, CSS variables for runtime tweaks
 * - shimmer-sweep  → light pass for .shimmer-sweep-target elements
 *
 * Toggles live in MotionConfig.overlays (all default false).
 */

import type { MotionOverlays } from './motionLibrary';

interface OverlayBundle {
  /** CSS to inject inside the host <style>. */
  css: string;
  /** Static HTML to inject after #root closes (covers full viewport). */
  html: string;
  /** Optional script injected before the motion's own script. */
  script: string;
}

const GRAIN: OverlayBundle = {
  css: `
    @keyframes hf-grain-noise {
      0%,100% { transform: translate(0,0); }
      10% { transform: translate(-5%,-5%); } 20% { transform: translate(-10%,5%); }
      30% { transform: translate(5%,-10%); } 40% { transform: translate(-5%,15%); }
      50% { transform: translate(-10%,5%); } 60% { transform: translate(15%,0); }
      70% { transform: translate(0,10%); } 80% { transform: translate(-15%,0); }
      90% { transform: translate(10%,5%); }
    }
    #hf-grain-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 100; overflow: hidden; }
    #hf-grain-overlay .grain-texture {
      position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
      background: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
      opacity: 0.15;
      animation: hf-grain-noise 0.5s steps(1) infinite;
    }
  `.trim(),
  html: `<div id="hf-grain-overlay"><div class="grain-texture"></div></div>`,
  script: '',
};

const VIGNETTE: OverlayBundle = {
  // The base atmos-vignette stays (preset-baked). This adds an extra customizable layer
  // with CSS variables so the user/agent can tweak intensity at runtime.
  css: `
    #hf-vignette {
      position: absolute; inset: 0; pointer-events: none; z-index: 90;
      background: radial-gradient(
        var(--hf-vignette-shape, ellipse) at center,
        transparent var(--hf-vignette-size, 45%),
        var(--hf-vignette-color, rgba(0,0,0,0.55)) var(--hf-vignette-edge, 100%)
      );
    }
  `.trim(),
  html: `<div id="hf-vignette"></div>`,
  script: '',
};

const SHIMMER: OverlayBundle = {
  // The .shimmer-sweep-target class can be applied by Gemini to any element it wants
  // to highlight. The script auto-injects the mask div + GSAP timeline that sweeps light.
  css: `
    .shimmer-sweep-target { position: relative; display: inline-block; }
    .shimmer-sweep-target .shimmer-mask {
      position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;
      background: linear-gradient(
        var(--hf-shimmer-angle, 120deg),
        transparent 0%,
        transparent calc(var(--hf-shimmer-pos, -20%) - 10%),
        var(--hf-shimmer-color, rgba(255,255,255,0.6)) var(--hf-shimmer-pos, -20%),
        transparent calc(var(--hf-shimmer-pos, -20%) + 10%),
        transparent 100%
      );
      mix-blend-mode: overlay;
    }
  `.trim(),
  html: '',
  script: `
    (function () {
      document.querySelectorAll(".shimmer-sweep-target").forEach(function (el) {
        if (!el.querySelector(".shimmer-mask")) {
          var mask = document.createElement("div");
          mask.className = "shimmer-mask";
          el.appendChild(mask);
        }
      });
      // Single auto-sweep aligned to motion duration. Gemini can override by registering
      // its own tween on the CSS variable --hf-shimmer-pos.
      if (window.gsap) {
        window.__shimmerTimeline = window.gsap.timeline({ paused: true });
        window.__shimmerTimeline.fromTo(
          ".shimmer-sweep-target",
          { "--hf-shimmer-pos": "-20%" },
          { "--hf-shimmer-pos": "120%", duration: 1.2, ease: "power2.inOut", stagger: 0.15 },
          0,
        );
      }
    })();
  `.trim(),
};

/** Compose enabled overlays into a single triple ready to splice into buildFullHtmlDoc. */
export const buildOverlays = (overlays: MotionOverlays | undefined): OverlayBundle => {
  if (!overlays) return { css: '', html: '', script: '' };
  const cssParts: string[] = [];
  const htmlParts: string[] = [];
  const scriptParts: string[] = [];
  if (overlays.vignette) { cssParts.push(VIGNETTE.css); htmlParts.push(VIGNETTE.html); }
  if (overlays.grain) { cssParts.push(GRAIN.css); htmlParts.push(GRAIN.html); }
  if (overlays.shimmer) { cssParts.push(SHIMMER.css); scriptParts.push(SHIMMER.script); }
  return {
    css: cssParts.join('\n'),
    html: htmlParts.join('\n'),
    script: scriptParts.join('\n'),
  };
};

/** Prompt fragment telling Gemini how to opt into shimmer (the only overlay it controls). */
export const OVERLAYS_PROMPT_HINT = `
PREMIUM POLISH (toggleable layers — already injected if enabled, you don't add them):
- grain  : film grain texture overlays the whole composition (no action from you).
- vignette : extra customizable vignette (no action from you).
- shimmer  : a light sweep runs across elements you mark with class="shimmer-sweep-target".
             ADD this class to ONE hero element (headline, number, logo) when shimmer is enabled.
             Do NOT add the class when shimmer is disabled — it has no effect anyway.
`.trim();
