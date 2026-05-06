/**
 * Screen recording via getDisplayMedia + MediaRecorder.
 *
 * Captures the user's selected screen/window/tab as VP9 WebM. Audio capture is
 * optional — when enabled the browser asks for system audio permission too
 * (only fully supported in Chrome at the moment).
 */

export interface RecorderOptions {
  withAudio: boolean;
  onTick?: (elapsedMs: number) => void;
  onStop?: (blob: Blob, durationMs: number) => void;
  onError?: (err: Error) => void;
}

export interface ActiveRecorder {
  stop: () => void;
  cancel: () => void;
}

const pickMimeType = (): string => {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return 'video/webm';
};

export const startScreenRecording = async (options: RecorderOptions): Promise<ActiveRecorder> => {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Seu navegador não suporta gravação de tela.');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30 } },
    audio: options.withAudio,
  });

  // Some platforms ignore the audio request silently — we tolerate it.
  if (options.withAudio && stream.getAudioTracks().length === 0) {
    console.warn('[reels/screen] audio requested but no audio track returned');
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_500_000 });
  const chunks: Blob[] = [];

  const startedAt = Date.now();
  let tickHandle: number | null = null;
  let cancelled = false;

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.onerror = (e: Event) => {
    options.onError?.((e as ErrorEvent).error ?? new Error('MediaRecorder error'));
  };

  recorder.onstop = () => {
    if (tickHandle != null) clearInterval(tickHandle);
    stream.getTracks().forEach(t => t.stop());
    if (cancelled) return;
    const blob = new Blob(chunks, { type: mimeType });
    const durationMs = Date.now() - startedAt;
    options.onStop?.(blob, durationMs);
  };

  // The browser's "stop sharing" UI also stops the recorder.
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (recorder.state !== 'inactive') recorder.stop();
  });

  recorder.start(1000); // request a chunk every second

  if (options.onTick) {
    tickHandle = window.setInterval(() => {
      options.onTick?.(Date.now() - startedAt);
    }, 250);
  }

  return {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
    },
    cancel: () => {
      cancelled = true;
      if (recorder.state !== 'inactive') recorder.stop();
    },
  };
};

/** Probe whether the browser can capture system audio via getDisplayMedia. */
export const supportsSystemAudio = (): boolean => {
  // Chromium-only at the moment; Safari/Firefox return video-only streams.
  return /Chrome|Edg/.test(navigator.userAgent) && !/Mobile/.test(navigator.userAgent);
};
