import React, { useEffect, useRef } from 'react';
import type { ScreenTake } from './types';

interface Props {
  take: ScreenTake;
}

/**
 * Plays a take applying its trim points and (optionally) skipping silent
 * regions defined in `keepSegments`. Uses ontimeupdate to leap-skip when
 * the video crosses into a silent region.
 */
export const TakeVideoPlayer: React.FC<Props> = ({ take }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Seek to trimStart when the take changes or video loads.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seekStart = () => {
      try { v.currentTime = take.trimStart; } catch { /* ignore */ }
    };
    if (v.readyState >= 1) seekStart();
    else v.addEventListener('loadedmetadata', seekStart, { once: true });
    return () => v.removeEventListener('loadedmetadata', seekStart);
  }, [take.id, take.trimStart]);

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;

    // Past trim end → loop back to trim start.
    if (t >= take.trimEnd) {
      try { v.currentTime = take.trimStart; } catch { /* ignore */ }
      return;
    }
    // Before trim start (e.g. user scrubbed) → snap to start.
    if (t < take.trimStart) {
      try { v.currentTime = take.trimStart; } catch { /* ignore */ }
      return;
    }

    // Cut silence: jump from any moment that falls outside a keep segment to the next keep start.
    if (take.cutSilence && take.keepSegments.length > 0) {
      const inside = take.keepSegments.find(seg => t >= seg.start && t < seg.end);
      if (!inside) {
        const nextKeep = take.keepSegments.find(seg => seg.start > t);
        if (nextKeep) {
          try { v.currentTime = nextKeep.start; } catch { /* ignore */ }
        } else {
          // No more speech — loop.
          try { v.currentTime = take.trimStart; } catch { /* ignore */ }
        }
      }
    }
  };

  return (
    <video
      ref={videoRef}
      src={take.url}
      muted
      playsInline
      controls
      preload="auto"
      autoPlay
      loop={false}
      onTimeUpdate={handleTimeUpdate}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', backgroundColor: 'black', zIndex: 1 }}
    />
  );
};
