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
import type { MotionConfig, MotionLayer } from './motionLibrary';

interface Props {
  motion: MotionConfig;
  playing: boolean;
  layer: MotionLayer;
  /** Optional local time within the motion clip in seconds. When provided
   *  the preview <video> seeks to match the project playhead instead of
   *  running on its own clock. Without this, blocks late in the timeline
   *  can drift out of sync (the <video> element gets reused across block
   *  switches and its currentTime carries over). */
  localTime?: number;
}

export const MotionLayerOverlay: React.FC<Props> = ({ motion, playing, layer, localTime }) => {
  const [mp4Url, setMp4Url] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Measure wrapper to scale the 1080x1920 iframe into the slot.
  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const s = Math.max(w / 1080, h / 1920);
      setScale(s || 0.5);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

    const baseDoc = buildFullHtmlDoc(motion);
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
    ? {
        // Mobile-first floating overlay (Submagic / Hormozi style): the motion
        // floats over the presenter's chest area, NOT in the bottom-third.
        // Why bottom: '20%' and not 0: Reels/TikTok/Shorts UI (likes, comments,
        // caption rail, progress bar) eats the bottom ~15-20% of the frame, so
        // any content placed there gets occluded once the video is uploaded.
        // The 22% height + 20% bottom puts the overlay center at ~y:0.69 of the
        // frame — well inside the cross-platform safe zone (y:0.11-0.80).
        position: 'absolute', left: 0, right: 0, bottom: '20%', height: '22%',
        opacity: 1, mixBlendMode: 'screen', zIndex: 30,
        filter: 'contrast(1.35) brightness(1.05)',
      }
    : { position: 'absolute', inset: 0, opacity: 1, zIndex: 30 }; // replace

  // Overlay (lower-third) needs `contain` — `cover` would crop the motion's
  // sides off; here we want the whole motion squeezed into the bottom band.
  const videoStyle: React.CSSProperties = {
    width: '100%', height: '100%',
    objectFit: layer === 'overlay' ? 'contain' : 'cover',
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
          width: 1080, height: isSplit ? 960 : 1920, border: 'none',
          position: 'absolute', top: 0, left: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      />
    </div>
  ) : null;

  return (
    <div
      ref={wrapperRef}
      className="pointer-events-none"
      style={wrapperStyle}
    >
      {mediaEl}
    </div>
  );
};
