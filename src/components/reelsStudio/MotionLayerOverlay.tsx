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
}

export const MotionLayerOverlay: React.FC<Props> = ({ motion, playing, layer }) => {
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

  // Sync video play/pause.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !mp4Url) return;
    if (playing) {
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [playing, mp4Url]);

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
      if (e.data === 'play') { tl.repeat(-1); tl.play(); }
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

  // Match the export compositor blend behaviour in the CSS preview.
  // overlay → screen blend at 88% opacity (same as mp4Renderer)
  // replace → normal, full opacity (replaces everything underneath)
  const style: React.CSSProperties =
    layer === 'overlay'
      ? { opacity: 0.88, mixBlendMode: 'screen' }
      : { opacity: 1 };

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0 pointer-events-none"
      style={style}
    >
      {mp4Url ? (
        <video
          ref={videoRef}
          src={mp4Url}
          loop
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : motion.html ? (
        <div className="absolute inset-0 overflow-hidden">
          <iframe
            ref={iframeRef}
            title="motion live preview"
            sandbox="allow-scripts"
            style={{
              width: 1080, height: 1920, border: 'none',
              position: 'absolute', top: 0, left: 0,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          />
        </div>
      ) : null}
    </div>
  );
};
