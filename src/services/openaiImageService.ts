/**
 * Carousel cover generation via fal-ai/gpt-image-2.
 * Uses FAL_KEY only — no separate OpenAI key needed.
 *
 * Two modes:
 *  - Text-only:  fal-ai/gpt-image-2        (prompt → image)
 *  - Edit mode:  fal-ai/gpt-image-2/edit   (prompt + reference photo → image)
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
 * @param prompt         Complete Rob Boliver-style prompt.
 * @param referencePhoto Optional base64 or data-URI of the creator's face photo.
 */
export const generateCoverImage = async (
  prompt: string,
  referencePhoto?: string,
): Promise<string> => {
  ensureFalConfigured();

  let result: any;

  if (referencePhoto) {
    const dataUri = referencePhoto.startsWith('data:')
      ? referencePhoto
      : `data:image/jpeg;base64,${referencePhoto}`;

    result = await fal.subscribe('fal-ai/gpt-image-2/edit' as any, {
      input: {
        prompt,
        image_urls: [dataUri],
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
