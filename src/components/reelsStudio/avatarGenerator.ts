import { fal } from '@fal-ai/client';
import type { AudioSlice } from './audioSlicer';

export type HeyGenModel = 'avatar3' | 'avatar4';

const HEYGEN_BASE = 'https://api.heygen.com';

const ensureFal = () => {
  const key = localStorage.getItem('FAL_KEY');
  if (!key) throw new Error('FAL_KEY não configurada (necessária para upload de áudio).');
  fal.config({ credentials: key, suppressLocalCredentialsWarning: true });
};

const getHeyGenKey = (): string => {
  const key = localStorage.getItem('HEYGEN_API_KEY');
  if (!key) throw new Error('HEYGEN_API_KEY não configurada. Adicione em Settings.');
  return key;
};

// Always render the HeyGen clip at 1920×1080. Reels in 9:16 or 1:1 crop/zoom on
// the compositor side — this preserves the maximum information from HeyGen and
// avoids in-render letterboxing that's impossible to recover from later.
const dimensionsFor = (_aspect: '9:16' | '16:9' | '1:1'): { width: number; height: number } => {
  return { width: 1920, height: 1080 };
};

interface SubmitArgs {
  audioUrl: string;
  talkingPhotoId: string;
  model: HeyGenModel;
  aspect: '9:16' | '16:9' | '1:1';
}

const submitHeyGenJob = async ({ audioUrl, talkingPhotoId, model, aspect }: SubmitArgs, apiKey: string): Promise<string> => {
  const character: Record<string, unknown> = {
    type: 'talking_photo',
    talking_photo_id: talkingPhotoId,
  };
  if (model === 'avatar4') {
    character.use_avatar_iv_model = true;
    character.expressiveness = 'high';
  }

  const body = {
    video_inputs: [{
      character,
      voice: { type: 'audio', audio_url: audioUrl },
      // Force black letterbox bars instead of HeyGen's default white when the
      // photo's aspect ratio doesn't match the rendered dimension.
      background: { type: 'color', value: '#000000' },
    }],
    dimension: dimensionsFor(aspect),
  };

  const res = await fetch(`${HEYGEN_BASE}/v2/video/generate`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    const msg = (errJson as { error?: { message?: string }; message?: string }).error?.message
              ?? (errJson as { message?: string }).message
              ?? res.statusText;
    throw new Error(`HeyGen submit ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  const submitJson = await res.json();
  const videoId: string | undefined = (submitJson.data ?? submitJson).video_id;
  if (!videoId) throw new Error(`HeyGen retornou sem video_id: ${JSON.stringify(submitJson).slice(0, 200)}`);
  return videoId;
};

const pollUntilReady = async (
  videoId: string,
  apiKey: string,
  onStatus: (s: string) => void,
  signal?: AbortSignal,
): Promise<string> => {
  const startedAt = Date.now();
  const MAX_POLL_MS = 15 * 60 * 1000;
  let errors = 0;

  while (true) {
    if (signal?.aborted) throw new Error('Cancelado');
    await new Promise(r => setTimeout(r, 4000));
    if (signal?.aborted) throw new Error('Cancelado');

    if (Date.now() - startedAt > MAX_POLL_MS) {
      throw new Error('Timeout após 15 min — verifique heygen.com');
    }

    let res: Response;
    try {
      res = await fetch(`${HEYGEN_BASE}/v1/video_status.get?video_id=${videoId}`, {
        headers: { 'x-api-key': apiKey },
      });
    } catch (e) {
      errors++;
      if (errors >= 5) throw new Error(`Erro de rede: ${(e as Error).message}`);
      continue;
    }

    if (!res.ok) {
      errors++;
      if (errors >= 5) throw new Error(`Status check falhou (${res.status})`);
      continue;
    }
    errors = 0;

    const json = await res.json();
    const data = json.data ?? json;
    const status: string = data.status ?? data.video_status ?? '';
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timer = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    if (status === 'completed' || status === 'success') {
      const url: string = data.video_url ?? data.output?.url ?? data.url ?? '';
      if (!url) throw new Error(`Concluído mas sem URL: ${JSON.stringify(json).slice(0, 200)}`);
      return url;
    }
    if (status === 'failed' || status === 'error') {
      const errMsg = data.failure_message ?? data.error ?? data.message ?? 'falha desconhecida';
      throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg).slice(0, 200));
    }
    onStatus(`Renderizando... · ${timer}`);
  }
};

export interface ClipGenerationOptions {
  talkingPhotoId: string;
  model: HeyGenModel;
  aspect: '9:16' | '16:9' | '1:1';
  signal?: AbortSignal;
  onClipUpdate: (blockId: string, update: ClipProgress) => void;
}

export type ClipProgress =
  | { status: 'queued' }
  | { status: 'uploading'; message: string }
  | { status: 'submitting'; message: string }
  | { status: 'rendering'; message: string }
  | { status: 'ready'; videoUrl: string }
  | { status: 'error'; error: string };

/** Generates one HeyGen clip for a single block; reports progress via callback. */
const generateOneClip = async (
  slice: AudioSlice,
  opts: ClipGenerationOptions,
  apiKey: string,
): Promise<{ blockId: string; videoUrl: string }> => {
  const update = (p: ClipProgress) => opts.onClipUpdate(slice.blockId, p);
  try {
    update({ status: 'uploading', message: 'Enviando áudio...' });
    const audioFile = new File([slice.blob], `clip-${slice.blockId}.wav`, { type: 'audio/wav' });
    const audioUrl = await fal.storage.upload(audioFile);
    if (opts.signal?.aborted) throw new Error('Cancelado');

    update({ status: 'submitting', message: 'Submetendo...' });
    const videoId = await submitHeyGenJob({
      audioUrl,
      talkingPhotoId: opts.talkingPhotoId,
      model: opts.model,
      aspect: opts.aspect,
    }, apiKey);

    update({ status: 'rendering', message: 'Renderizando...' });
    const videoUrl = await pollUntilReady(videoId, apiKey, m => update({ status: 'rendering', message: m }), opts.signal);

    update({ status: 'ready', videoUrl });
    return { blockId: slice.blockId, videoUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha';
    update({ status: 'error', error: msg });
    throw err;
  }
};

export interface BatchResult {
  blockId: string;
  ok: boolean;
  videoUrl?: string;
  error?: string;
}

export const generateAvatarClips = async (
  slices: AudioSlice[],
  opts: ClipGenerationOptions,
): Promise<BatchResult[]> => {
  ensureFal();
  const apiKey = getHeyGenKey();
  // Mark everything queued upfront so the UI populates instantly.
  for (const s of slices) opts.onClipUpdate(s.blockId, { status: 'queued' });

  const results = await Promise.allSettled(
    slices.map(s => generateOneClip(s, opts, apiKey)),
  );

  return results.map((r, idx): BatchResult => {
    if (r.status === 'fulfilled') {
      return { blockId: r.value.blockId, ok: true, videoUrl: r.value.videoUrl };
    }
    return { blockId: slices[idx].blockId, ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };
  });
};
