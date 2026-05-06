/**
 * Detects whether the browser can render an MP4 in-browser via WebCodecs.
 * Safari/Firefox have partial or no support — we fall back to a zip bundle
 * so the user is never stranded.
 */

export interface ExportCapability {
  webcodecs: boolean;
  reason?: string;
}

let cached: ExportCapability | null = null;

export const detectExportCapability = async (): Promise<ExportCapability> => {
  if (cached) return cached;

  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
    cached = { webcodecs: false, reason: 'Seu navegador não tem WebCodecs. Use Chrome ou Edge desktop.' };
    return cached;
  }

  try {
    const videoOk = await VideoEncoder.isConfigSupported({
      codec: 'avc1.640028', // H.264 high profile, level 4.0
      width: 1080,
      height: 1920,
      bitrate: 5_000_000,
      framerate: 30,
    });
    const audioOk = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2', // AAC-LC
      sampleRate: 48000,
      numberOfChannels: 1,
      bitrate: 128_000,
    });
    if (!videoOk.supported || !audioOk.supported) {
      cached = { webcodecs: false, reason: 'Codec H.264/AAC não suportado neste navegador.' };
      return cached;
    }
    cached = { webcodecs: true };
    return cached;
  } catch (err) {
    cached = { webcodecs: false, reason: err instanceof Error ? err.message : 'Falha ao testar WebCodecs.' };
    return cached;
  }
};
