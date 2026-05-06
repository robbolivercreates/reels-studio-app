import { saveTakeBlob } from './persistence';
import type { ScreenTake } from './types';

const MAX_RECOMMENDED_BYTES = 200 * 1024 * 1024; // 200 MB

const probeVideo = (blob: Blob): Promise<{ durationMs: number; hasAudio: boolean }> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = url;
    const cleanup = () => { URL.revokeObjectURL(url); };
    const onMeta = () => {
      const durationMs = isFinite(v.duration) ? Math.floor(v.duration * 1000) : 0;
      // hasAudio is unreliable in DOM — most browsers don't expose it on <video>.
      // We default to true for uploads (user usually has audio in their files).
      resolve({ durationMs, hasAudio: true });
      cleanup();
    };
    v.onloadedmetadata = onMeta;
    v.onerror = () => { resolve({ durationMs: 0, hasAudio: true }); cleanup(); };
  });

export interface UploadResult {
  take: ScreenTake;
  warning?: string;
}

export const createTakeFromFile = async (file: File): Promise<UploadResult> => {
  if (!file.type.startsWith('video/')) {
    throw new Error('Esse arquivo não é um vídeo. Use MP4, MOV ou WebM.');
  }
  const warning = file.size > MAX_RECOMMENDED_BYTES
    ? `Arquivo grande (${(file.size / 1024 / 1024).toFixed(0)}MB). Pode demorar pra salvar e atrasar o app — considere comprimir.`
    : undefined;

  const id = `take_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await saveTakeBlob(id, file);
  const url = URL.createObjectURL(file);
  const { durationMs } = await probeVideo(file);

  const take: ScreenTake = {
    id,
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 32) || 'Upload',
    durationMs,
    url,
    hasAudio: true,
    createdAt: Date.now(),
    source: 'upload',
    trimStart: 0,
    trimEnd: durationMs / 1000,
    cutSilence: false,
    keepSegments: [],
    detectedSilenceSec: 0,
  };
  return { take, warning };
};
