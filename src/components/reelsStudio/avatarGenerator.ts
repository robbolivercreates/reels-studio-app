import { fal } from '@fal-ai/client';
import type { AudioSlice } from './audioSlicer';

export type HeyGenModel = 'avatar3' | 'avatar4' | 'avatar5';

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
const dimensionsFor = (_aspect: '9:16' | '16:9' | '1:1' | 'carousel'): { width: number; height: number } => {
  return { width: 1920, height: 1080 };
};

interface SubmitArgs {
  audioUrl: string;
  talkingPhotoId: string;
  model: HeyGenModel;
  aspect: '9:16' | '16:9' | '1:1' | 'carousel';
}

// Avatar V lives on the v3 endpoint and requires the talking photo to
// be eligible (the look must have "avatar_v" in its supported_api_engines).
// We do a quick eligibility check first so the error surfaces *before*
// the user waits for a render, and so the message is actionable
// ("essa foto não suporta V — usa IV ou cadastra outra").
async function checkAvatarVEligibility(talkingPhotoId: string, apiKey: string): Promise<void> {
  const res = await fetch(`${HEYGEN_BASE}/v3/avatars/looks/${encodeURIComponent(talkingPhotoId)}`, {
    method: 'GET',
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    // 404 → talking photo isn't a registered look (probably a legacy
    // upload). Treat as "not eligible" so the user sees a clean error.
    if (res.status === 404) {
      throw new Error(
        'Essa foto não está registrada como "look" no HeyGen (necessário para Avatar V). Cadastre uma nova foto ou use Avatar IV.',
      );
    }
    throw new Error(`Falha ao verificar elegibilidade do Avatar V: ${res.status}`);
  }
  const data = await res.json().catch(() => null);
  const supported: string[] = data?.data?.supported_api_engines ?? data?.supported_api_engines ?? [];
  if (!supported.includes('avatar_v')) {
    throw new Error(
      'Essa foto não suporta Avatar V. Tente Avatar IV ou cadastre uma foto compatível.',
    );
  }
}

async function submitAvatarVJob(
  args: { audioUrl: string; talkingPhotoId: string; aspect: '9:16' | '16:9' | '1:1' | 'carousel' },
  apiKey: string,
): Promise<string> {
  await checkAvatarVEligibility(args.talkingPhotoId, apiKey);

  // Avatar V (v3 /videos) has a DIFFERENT shape than Avatar III/IV:
  //   - audio source goes at the body ROOT (`audio_url`), NOT inside `voice`
  //   - no `dimension` key — orientation is derived from the avatar look
  //   - `resolution` is the only size knob ("1080p" / "720p")
  // Sending the v2 shape returns:
  //   "Value error, An audio source is required: provide (script + voice_id), audio_url, or audio_asset_id."
  // ...which is misleading (audio_url IS there, just in the wrong slot).
  const body = {
    type: 'avatar',
    avatar_id: args.talkingPhotoId,
    audio_url: args.audioUrl,
    resolution: '1080p',
    engine: { type: 'avatar_v' },
    background: { type: 'color', value: '#000000' },
  };

  const res = await fetch(`${HEYGEN_BASE}/v3/videos`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    const msg = (errJson as { error?: { message?: string }; message?: string }).error?.message
              ?? (errJson as { message?: string }).message
              ?? res.statusText;
    throw new Error(`HeyGen Avatar V submit ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  const submitJson = await res.json();
  // v3 may return { data: { video_id } } or { video_id } at top — handle both.
  const videoId: string | undefined =
    (submitJson.data ?? submitJson).video_id ??
    (submitJson.data ?? submitJson).id;
  if (!videoId) throw new Error(`HeyGen V3 retornou sem video_id: ${JSON.stringify(submitJson).slice(0, 200)}`);
  return videoId;
}

const submitHeyGenJob = async ({ audioUrl, talkingPhotoId, model, aspect }: SubmitArgs, apiKey: string): Promise<string> => {
  // Avatar V uses the new v3 endpoint with an explicit engine field.
  // Avatar III / IV stay on the legacy v2 endpoint where IV is opted in
  // via `use_avatar_iv_model: true`.
  if (model === 'avatar5') {
    return submitAvatarVJob({ audioUrl, talkingPhotoId, aspect }, apiKey);
  }

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
  // Avatar V videos are created via /v3/videos and must be polled
  // through GET /v3/videos/{id}. III / IV stay on the legacy
  // /v1/video_status.get endpoint, which doesn't recognize V's
  // video_ids.
  endpointVersion: 'v1' | 'v3' = 'v1',
): Promise<string> => {
  const startedAt = Date.now();
  const MAX_POLL_MS = 15 * 60 * 1000;
  let errors = 0;
  const url = endpointVersion === 'v3'
    ? `${HEYGEN_BASE}/v3/videos/${encodeURIComponent(videoId)}`
    : `${HEYGEN_BASE}/v1/video_status.get?video_id=${videoId}`;

  while (true) {
    if (signal?.aborted) throw new Error('Cancelado');
    await new Promise(r => setTimeout(r, 4000));
    if (signal?.aborted) throw new Error('Cancelado');

    if (Date.now() - startedAt > MAX_POLL_MS) {
      throw new Error('Timeout após 15 min — verifique heygen.com');
    }

    let res: Response;
    try {
      res = await fetch(url, {
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
  /** Default photo used when a slice doesn't carry a per-block override. */
  talkingPhotoId: string;
  /** Optional per-block override: maps blockId → talking_photo_id. When a
   *  block has its own entry here, that photo is used instead of the
   *  default. Lets the user mix photos/poses across blocks of the same
   *  reel. */
  talkingPhotoIdByBlock?: Record<string, string>;
  model: HeyGenModel;
  aspect: '9:16' | '16:9' | '1:1' | 'carousel';
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
    const photoForBlock = opts.talkingPhotoIdByBlock?.[slice.blockId] ?? opts.talkingPhotoId;
    const videoId = await submitHeyGenJob({
      audioUrl,
      talkingPhotoId: photoForBlock,
      model: opts.model,
      aspect: opts.aspect,
    }, apiKey);

    update({ status: 'rendering', message: 'Renderizando...' });
    const videoUrl = await pollUntilReady(
      videoId,
      apiKey,
      m => update({ status: 'rendering', message: m }),
      opts.signal,
      opts.model === 'avatar5' ? 'v3' : 'v1',
    );

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
