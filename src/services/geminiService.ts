/**
 * Reels Studio uses only the HeyGen talking-photo upload from this service.
 * The full geminiService (image gen, video gen, etc.) lives in Avatar Studio
 * and was intentionally left behind.
 */

const getHeyGenKey = (): string => {
  const key = localStorage.getItem('HEYGEN_API_KEY');
  if (!key) throw new Error('HeyGen API Key not set. Please add it in Settings.');
  return key;
};

export interface HeyGenTalkingPhoto {
  talkingPhotoId: string;
  imageUrl?: string;
}

export const uploadHeyGenTalkingPhoto = async (file: File): Promise<HeyGenTalkingPhoto> => {
  const apiKey = getHeyGenKey();
  const contentType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

  console.log('[heygen] Uploading talking photo...', { name: file.name, size: file.size, contentType });
  const res = await fetch('https://upload.heygen.com/v1/talking_photo', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': contentType },
    body: file,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[heygen] Talking photo upload failed:', res.status, errText);
    throw new Error(`HeyGen talking photo upload failed (${res.status}): ${errText || res.statusText}`);
  }

  const json = await res.json();
  console.log('[heygen] Upload response:', JSON.stringify(json));
  const data = json.data ?? json;
  const talkingPhotoId: string = data.talking_photo_id ?? data.id;
  if (!talkingPhotoId) throw new Error(`HeyGen upload: no talking_photo_id in response — ${JSON.stringify(json)}`);

  return { talkingPhotoId, imageUrl: data.talking_photo_url ?? data.image_url };
};
