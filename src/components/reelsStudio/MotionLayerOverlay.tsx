/**
 * Motion overlay for the main timeline preview (the "celular" frame).
 *
 * If the motion has a rendered MP4 (videoPath set), loads it via the Tauri
 * asset protocol (convertFileSrc) — no byte serialisation, just a direct URL.
 * Falls back to a live iframe GSAP preview while the MP4 is not yet rendered.
 */

import React, { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { buildFullHtmlDoc } from '../../services/motionService';
import type { MotionConfig, MotionLayer, MotionPlacement } from './motionLibrary';
import { layerOfPlacement, FLOAT_CARD_CENTER, DEFAULT_SCRIM_ALPHA, DEFAULT_SCRIM_SPREAD } from './motionLibrary';

interface Props {
  motion: MotionConfig;
  playing: boolean;
  layer: MotionLayer;
  /** Unified placement — when provided, wins over `layer` and positions the
   *  float band exactly like the export compositor (same y/height math). */
  placement?: MotionPlacement;
  /** Optional local time within the motion clip in seconds. When provided
   *  the preview <video> seeks to match the project playhead instead of
   *  running on its own clock. Without this, blocks late in the timeline
   *  can drift out of sync (the <video> element gets reused across block
   *  switches and its currentTime carries over). */
  localTime?: number;
}

export const MotionLayerOverlay: React.FC<Props> = ({ motion, playing, layer: layerProp, placement, localTime }) => {
  // Placement wins; layer prop kept for legacy callsites.
  const layer: MotionLayer = placement ? layerOfPlacement(placement) : layerProp;
  const [mp4Url, setMp4Url] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Native canvas height: 1350 for carousel (4:5), 1920 otherwise — floats
  // author at FULL frame now (face-safe zone + screen blend). Must mirror
  // the canvasH logic in buildFullHtmlDoc so the live iframe scales 1:1.
  const nativeH = motion.canvasAspect === '4:5' ? 1350 : 1920;

  // Measure wrapper to scale the iframe into the slot.
  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const s = Math.max(w / 1080, h / nativeH);
      setScale(s || 0.5);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [nativeH]);

  // Convert local MP4 path to asset:// URL via Tauri asset protocol.
  useEffect(() => {
    if (motion.videoPath && motion.status === 'ready') {
      try {
        const url = convertFileSrc(motion.videoPath);
        setMp4Url(url);
      } catch {
        setMp4Url(null);
      }
    } else {
      setMp4Url(null);
    }
  }, [motion.videoPath, motion.status, motion.renderedAt]);

  // Sync video play/pause + currentTime with the project playhead.
  // The seek-when-off-by-0.3s threshold mirrors what we do for the avatar
  // clip — frequent micro-seeks cause visible popping in <video>.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !mp4Url) return;
    if (localTime != null && Number.isFinite(localTime)) {
      const target = Math.max(0, localTime);
      if (Math.abs(v.currentTime - target) > 0.3) {
        try { v.currentTime = target; } catch { /* ignore */ }
      }
    }
    if (playing) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [playing, mp4Url, localTime]);

  // When the source mp4 swaps (block change), explicitly reset currentTime
  // to 0 (or localTime). Without this, browsers can keep the previous
  // playback position, which is exactly the symptom in the last block
  // ("preview out of sync until I export the MP4").
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !mp4Url) return;
    const start = localTime != null && Number.isFinite(localTime) ? Math.max(0, localTime) : 0;
    try { v.currentTime = start; } catch { /* ignore */ }
    // localTime intentionally omitted from deps — we only reset on source
    // change, the play/pause effect above handles ongoing sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mp4Url]);

  // Live iframe — inject HTML via srcdoc. Use postMessage to control GSAP.
  useEffect(() => {
    if (mp4Url) return;
    const iframe = iframeRef.current;
    if (!iframe || !motion.html) return;

    const baseDoc = buildFullHtmlDoc(motion, motion.canvasAspect);
    const msgListener = `
<script>
(function() {
  window.addEventListener('message', function(e) {
    try {
      var tl = window.__timelines && window.__timelines["${motion.id}"];
      if (!tl) return;
      if (e.data === 'play') { tl.repeat(0); tl.play(); }
      else if (e.data === 'pause') { tl.pause(); }
    } catch(err) {}
  });
})();
</script>`;
    const doc = baseDoc.includes('</body>')
      ? baseDoc.replace('</body>', msgListener + '</body>')
      : baseDoc + msgListener;

    iframe.srcdoc = doc;

    const onLoad = () => {
      setTimeout(() => {
        try { iframe.contentWindow?.postMessage(playing ? 'play' : 'pause', '*'); }
        catch { /* ignore */ }
      }, 400);
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [motion.html, motion.id, mp4Url, motion.durationSec]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle play on iframe when playing changes.
  useEffect(() => {
    if (mp4Url) return;
    try { iframeRef.current?.contentWindow?.postMessage(playing ? 'play' : 'pause', '*'); }
    catch { /* ignore */ }
  }, [playing, mp4Url]);

  const isSplit = layer === 'split-bottom' || layer === 'split-top';

  // Position + blend for each layer mode.
  // z-index 30 ensures motion sits above the avatar video (z-index 20).
  const wrapperStyle: React.CSSProperties = isSplit
    ? {
        position: 'absolute',
        left: 0, right: 0,
        top: layer === 'split-bottom' ? '50%' : 0,
        bottom: layer === 'split-top' ? '50%' : 0,
        zIndex: 30,
      }
    : layer === 'overlay'
    ? (() => {
        // Float = FULL-FRAME screen blend — identical to composeMotionLayer
        // in mp4Renderer (FULL_FRAME box + screen + contrast filter + the
        // floatShiftY translate), so preview === export. The motion authors
        // its content in the face-safe lower zone; black stays transparent,
        // and the shift moves the card top/middle/bottom instantly. When
        // shifted, the top/bottom edges are feathered (same as the export's
        // featherY pass) so atmosphere gradients can't cut a visible seam.
        const shift = placement?.floatShiftY ?? 0;
        const feather = Math.abs(shift) > 0.005
          ? 'linear-gradient(180deg, transparent 0%, #000 7%, #000 93%, transparent 100%)'
          : undefined;
        return {
          position: 'absolute', left: 0, right: 0,
          top: `${shift * 100}%`, height: '100%',
          opacity: 1, mixBlendMode: 'screen', zIndex: 30,
          filter: 'contrast(1.35) brightness(1.05)',
          ...(feather ? { WebkitMaskImage: feather, maskImage: feather } : {}),
        } as React.CSSProperties;
      })()
    : { position: 'absolute', inset: 0, opacity: 1, zIndex: 30 }; // replace

  const videoStyle: React.CSSProperties = {
    width: '100%', height: '100%',
    objectFit: 'cover',
  };

  const mediaEl = mp4Url ? (
    <video
      ref={videoRef}
      src={mp4Url}
      muted
      playsInline
      style={videoStyle}
    />
  ) : motion.html ? (
    <div className="absolute inset-0 overflow-hidden">
      <iframe
        ref={iframeRef}
        title="motion live preview"
        sandbox="allow-scripts"
        style={{
          width: 1080, height: isSplit ? 960 : nativeH, border: 'none',
          position: 'absolute', top: 0, left: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  ) : null;

  // Contrast scrim — a soft black vertical gradient UNDER the blended motion
  // (over the footage), centered on the card zone + shift. Mirrors the
  // export compositor's scrim pass exactly (same center/spread/alpha math)
  // so preview === export. z-25: above avatar video (20) / placeholder (15)
  // / base video (5), below the motion wrapper (30).
  const scrimEl = (() => {
    if (layer !== 'overlay') return null;
    const a = Math.min(0.85, placement?.scrimAlpha ?? DEFAULT_SCRIM_ALPHA);
    if (a <= 0.005) return null;
    const cy = (FLOAT_CARD_CENTER + (placement?.floatShiftY ?? 0)) * 100; // % of frame
    const spread = (placement?.scrimSpread ?? DEFAULT_SCRIM_SPREAD) * 100; // % — alpha 0 at cy±spread
    const core = spread * 0.36; // % — full alpha at cy±core (scales with band)
    return (
      <div
        className="pointer-events-none"
        style={{
          position: 'absolute', left: 0, right: 0,
          top: `${cy - spread}%`, height: `${spread * 2}%`,
          zIndex: 25,
          background: `linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,${a}) ${((spread - core) / (2 * spread) * 100).toFixed(1)}%, rgba(0,0,0,${a}) ${((spread + core) / (2 * spread) * 100).toFixed(1)}%, rgba(0,0,0,0) 100%)`,
        }}
      />
    );
  })();

  return (
    <>
      {scrimEl}
      <div
        ref={wrapperRef}
        className="pointer-events-none"
        style={wrapperStyle}
      >
        {mediaEl}
      </div>
    </>
  );
};
