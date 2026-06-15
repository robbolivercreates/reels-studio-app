/**
 * Carousel cover generation via fal-ai/gpt-image-2.
 * Uses FAL_KEY only — no separate OpenAI key needed.
 *
 * Modes:
 *  - Text-only:           fal-ai/gpt-image-2        (prompt → image)
 *  - Photo reference:     fal-ai/gpt-image-2/edit   (prompt + creator photo → image)
 *  - Photo + brand logo:  fal-ai/gpt-image-2/edit   (prompt + creator photo + logo → image)
 */

import { fal } from '@fal-ai/client';

const ensureFalConfigured = () => {
  const key = localStorage.getItem('FAL_KEY');
  if (!key) throw new Error('FAL_KEY não configurada. Adicione em Configurações → Chaves de API.');
  fal.config({ credentials: key, suppressLocalCredentialsWarning: true });
};

/** True when FAL_KEY is present — used to gate the generate button. */
export const hasCoverImageKey = (): boolean => !!localStorage.getItem('FAL_KEY');

/**
 * Generate a cover image using GPT Image 2 via fal.ai.
 * Returns a CDN URL or base64 data-URI.
 *
 * @param prompt           Complete Rob Boliver-style prompt.
 * @param referencePhoto   Optional base64 or data-URI of the creator's face photo.
 * @param brandLogoDataUri Optional base64 data-URI of the detected brand logo (e.g. Canva, Claude).
 *                         When provided, both images are sent to the edit endpoint so GPT Image 2
 *                         can render the real logo photo-realistically as the TOPIC ANCHOR in the scene.
 */
export const generateCoverImage = async (
  prompt: string,
  referencePhoto?: string,
  brandLogoDataUri?: string,
): Promise<string> => {
  ensureFalConfigured();

  let result: any;

  if (referencePhoto) {
    const photoDataUri = referencePhoto.startsWith('data:')
      ? referencePhoto
      : `data:image/jpeg;base64,${referencePhoto}`;

    const imageUrls = brandLogoDataUri
      ? [photoDataUri, brandLogoDataUri]
      : [photoDataUri];

    // Tell the model how to use each reference image when a logo is present.
    const logoInstruction = brandLogoDataUri
      ? '\n\nREFERENCE IMAGES PROVIDED:\n- Image 1: creator\'s face photo — use for subject facial identity, hair, beard, build.\n- Image 2: brand logo — render it photo-realistically as the TOPIC ANCHOR in the scene (floating UI card, holographic display, or physical object on the desk, lit by the cyan hero light).'
      : '';

    result = await fal.subscribe('fal-ai/gpt-image-2/edit' as any, {
      input: {
        prompt: prompt + logoInstruction,
        image_urls: imageUrls,
        quality: 'high',
        output_format: 'png',
        num_images: 1,
      },
    });
  } else {
    result = await fal.subscribe('fal-ai/gpt-image-2' as any, {
      input: {
        prompt,
        image_size: 'portrait_4_3',
        quality: 'high',
        output_format: 'png',
        num_images: 1,
      },
    });
  }

  const imageUrl: string | undefined =
    (result as any)?.data?.images?.[0]?.url ??
    (result as any)?.images?.[0]?.url ??
    (result as any)?.image?.url ??
    (result as any)?.data?.image?.url;

  if (!imageUrl) {
    throw new Error(`Imagem não encontrada na resposta. Estrutura: ${JSON.stringify(result).slice(0, 200)}`);
  }

  return imageUrl;
};

// Keep legacy export name for any future callers that may check for key presence.
/** @deprecated Use hasCoverImageKey() */
export const getOpenAIKey = (): string | null => localStorage.getItem('FAL_KEY');
