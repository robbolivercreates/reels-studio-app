import { uploadHeyGenTalkingPhoto } from '../../services/geminiService';

export interface AvatarPhoto {
  id: string;
  name: string;
  talkingPhotoId: string;
  thumbnailBase64: string;
  imageBase64: string;
  /** Direct HeyGen preview URL — used when CORS blocks base64 caching. */
  previewUrl?: string;
  createdAt: number;
}

const STORAGE_KEY = 'reel_avatar_photos_v1';
const LEGACY_TALKING_PHOTO_ID = 'HEYGEN_TALKING_PHOTO_ID';
const LEGACY_AVATAR_ID = 'HEYGEN_AVATAR_ID';

export const loadAvatarPhotos = (): AvatarPhoto[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

const writeAvatarPhotos = (all: AvatarPhoto[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
};

export const saveAvatarPhoto = (photo: AvatarPhoto) => {
  const all = loadAvatarPhotos();
  all.unshift(photo);
  writeAvatarPhotos(all);
  // Mirror to legacy keys so the rest of the app keeps working with the most recent upload.
  localStorage.setItem(LEGACY_TALKING_PHOTO_ID, photo.talkingPhotoId);
  localStorage.setItem(LEGACY_AVATAR_ID, photo.talkingPhotoId);
};

export const deleteAvatarPhoto = (id: string) => {
  writeAvatarPhotos(loadAvatarPhotos().filter(p => p.id !== id));
};

export const renameAvatarPhoto = (id: string, name: string) => {
  writeAvatarPhotos(loadAvatarPhotos().map(p => p.id === id ? { ...p, name } : p));
};

const fileToBase64 = (file: File | Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const downscale = async (base64: string, maxSize: number, quality = 0.8): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas 2D unavailable'));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to load image for downscale'));
    img.src = base64;
  });
};

export const uploadAvatarPhotoFromFile = async (
  file: File,
  name: string,
): Promise<AvatarPhoto> => {
  const result = await uploadHeyGenTalkingPhoto(file);
  const fullBase64 = await fileToBase64(file);
  const thumbnailBase64 = await downscale(fullBase64, 256, 0.75).catch(() => fullBase64);
  const imageBase64 = await downscale(fullBase64, 1024, 0.9).catch(() => fullBase64);
  const photo: AvatarPhoto = {
    id: `ap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || `Foto ${new Date().toLocaleDateString()}`,
    talkingPhotoId: result.talkingPhotoId,
    thumbnailBase64,
    imageBase64,
    createdAt: Date.now(),
  };
  saveAvatarPhoto(photo);
  return photo;
};

/**
 * Imports a photo by pasting an existing HeyGen talking_photo_id (no upload).
 * Useful when the user already has a Photo Avatar registered on HeyGen.
 */
export const importAvatarPhotoByTalkingId = (
  talkingPhotoId: string,
  name: string,
  thumbnailBase64?: string,
): AvatarPhoto => {
  const photo: AvatarPhoto = {
    id: `ap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || 'Avatar HeyGen',
    talkingPhotoId: talkingPhotoId.trim(),
    thumbnailBase64: thumbnailBase64 ?? '',
    imageBase64: thumbnailBase64 ?? '',
    createdAt: Date.now(),
  };
  saveAvatarPhoto(photo);
  return photo;
};

// ─── REMOTE FETCH (HeyGen account listing) ──────────────────────────────
const HEYGEN_BASE = 'https://api.heygen.com';

export interface RemoteHeyGenAvatar {
  talkingPhotoId: string;
  name: string;
  previewUrl?: string;
  source: 'talking_photo' | 'avatar';
}

const fetchAsBase64 = async (url: string): Promise<string | undefined> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
};

export const fetchHeyGenAvatars = async (): Promise<RemoteHeyGenAvatar[]> => {
  const apiKey = localStorage.getItem('HEYGEN_API_KEY');
  if (!apiKey) throw new Error('HEYGEN_API_KEY não configurada.');

  const res = await fetch(`${HEYGEN_BASE}/v2/avatars`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HeyGen ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  const json = await res.json();
  const data = json.data ?? json;
  console.log('[reels/heygen] /v2/avatars response:', {
    talking_photos_count: (data.talking_photos ?? []).length,
    avatars_count: (data.avatars ?? []).length,
    sample_talking_photo: (data.talking_photos ?? [])[0],
    sample_avatar: (data.avatars ?? [])[0],
  });

  const result: RemoteHeyGenAvatar[] = [];

  // Talking photos (most relevant for our pipeline)
  const talkingPhotos = data.talking_photos ?? [];
  for (const tp of talkingPhotos) {
    const id = tp.talking_photo_id ?? tp.id;
    if (!id) continue;
    result.push({
      talkingPhotoId: id,
      name: tp.talking_photo_name ?? tp.name ?? `Talking photo ${String(id).slice(0, 6)}`,
      previewUrl: tp.preview_image_url ?? tp.image_url,
      source: 'talking_photo',
    });
  }

  // Photo avatars / instant avatars (also usable as talking_photo)
  const avatars = data.avatars ?? [];
  for (const av of avatars) {
    const id = av.talking_photo_id ?? av.avatar_id ?? av.id;
    if (!id) continue;
    // Skip duplicates if it's already in talking_photos
    if (result.some(r => r.talkingPhotoId === id)) continue;
    result.push({
      talkingPhotoId: id,
      name: av.avatar_name ?? av.name ?? `Avatar ${String(id).slice(0, 6)}`,
      previewUrl: av.preview_image_url ?? av.image_url,
      source: 'avatar',
    });
  }

  return result;
};

export const importRemoteAvatar = async (remote: RemoteHeyGenAvatar): Promise<AvatarPhoto> => {
  let thumbnailBase64 = '';
  let imageBase64 = '';
  // Try to cache as base64 (works when CORS allows). If blocked, we still save
  // the raw previewUrl below — <img> elements ignore CORS for display.
  if (remote.previewUrl) {
    const fullBase64 = await fetchAsBase64(remote.previewUrl);
    if (fullBase64) {
      thumbnailBase64 = await downscale(fullBase64, 256, 0.75).catch(() => fullBase64);
      imageBase64 = await downscale(fullBase64, 1024, 0.9).catch(() => fullBase64);
    } else {
      console.warn('[reels] CORS blocked base64 cache for', remote.name, '— will use direct URL');
    }
  }
  const photo: AvatarPhoto = {
    id: `ap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: remote.name,
    talkingPhotoId: remote.talkingPhotoId,
    thumbnailBase64,
    imageBase64,
    previewUrl: remote.previewUrl,
    createdAt: Date.now(),
  };
  saveAvatarPhoto(photo);
  return photo;
};
