/**
 * Logo fetch — given a brand domain, returns an image URL suitable for
 * passing to GPT Image 2 as a reference image alongside the creator's photo.
 *
 * Uses Clearbit Logo API (free, no auth): https://logo.clearbit.com/{domain}
 * Falls back to null on any failure — cover generation still works without logo.
 */

/** Check whether a Clearbit logo exists for a domain (HEAD request). */
export const brandLogoUrl = (domain: string): string =>
  `https://logo.clearbit.com/${domain}?size=400`;

/**
 * Fetch the logo and return it as a base64 data-URI so it can be passed to
 * fal.ai alongside the reference photo in a single edit call.
 *
 * Returns null if the request fails or returns a non-image response.
 */
export const fetchBrandLogoAsDataUri = async (domain: string): Promise<string | null> => {
  try {
    const url = brandLogoUrl(domain);
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/png';
    if (!contentType.startsWith('image/')) return null;
    const blob = await res.blob();
    return new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

/**
 * iTunes App Store icon lookup — fallback for mobile apps without an obvious
 * domain (CapCut, etc). Searches by app name, grabs artworkUrl512 and upgrades
 * it to 1024×1024. Returns a base64 data-URI or null.
 */
export const fetchAppStoreIconAsDataUri = async (appName: string): Promise<string | null> => {
  try {
    const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(appName)}&entity=software&limit=1`;
    const res = await fetch(searchUrl);
    if (!res.ok) return null;
    const json = await res.json() as { results?: Array<{ artworkUrl512?: string }> };
    const artwork = json.results?.[0]?.artworkUrl512;
    if (!artwork) return null;
    const hiRes = artwork.replace('512x512bb.jpg', '1024x1024bb.png').replace('512x512bb.png', '1024x1024bb.png');
    const imgRes = await fetch(hiRes);
    if (!imgRes.ok) return null;
    const blob = await imgRes.blob();
    return new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

/**
 * Quick brand name → domain mapping for common tools.
 * Used as a fallback when Gemini's detectedBrand returns an unrecognised domain.
 */
/**
 * Official brand colors for the mapped brands — used to LOCK the motion's
 * accent palette when a brand is mentioned (base stays black/white; accents
 * come ONLY from here). Without this, Gemini pairs e.g. red+blue with Canva,
 * which reads off-brand and chaotic.
 */
export const KNOWN_BRAND_COLORS: Record<string, string[]> = {
  canva:       ['#8B3DFF', '#00C4CC'],
  claude:      ['#DE7356'],
  anthropic:   ['#DE7356'],
  chatgpt:     ['#10A37F'],
  openai:      ['#10A37F'],
  notion:      ['#2383E2'],
  figma:       ['#F24E1E', '#A259FF', '#1ABCFE'],
  instagram:   ['#E1306C', '#8134AF', '#F58529'],
  youtube:     ['#FF0000'],
  tiktok:      ['#69C9D0', '#EE1D52'],
  linkedin:    ['#0A66C2'],
  spotify:     ['#1DB954'],
  slack:       ['#4A154B', '#36C5F0'],
  zoom:        ['#0B5CFF'],
  google:      ['#4285F4', '#EA4335', '#FBBC05', '#34A853'],
  gemini:      ['#4285F4', '#9168C0'],
  meta:        ['#0082FB'],
  facebook:    ['#1877F2'],
  whatsapp:    ['#25D366'],
  shopify:     ['#95BF47'],
  hubspot:     ['#FF7A59'],
  zapier:      ['#FF4F00'],
  midjourney:  ['#9CA3AF'],
  perplexity:  ['#20808D'],
  copilot:     ['#0078D4'],
  microsoft:   ['#0078D4'],
  adobe:       ['#FA0F00'],
  framer:      ['#0055FF'],
  webflow:     ['#4353FF'],
  vercel:      ['#FFFFFF'],
  supabase:    ['#3ECF8E'],
  stripe:      ['#635BFF'],
};

/** Official accent colors for a detected brand (null → caller uses a neutral rule). */
export const getKnownBrandColors = (name: string): string[] | null =>
  KNOWN_BRAND_COLORS[name.toLowerCase()] ?? null;

/**
 * Detect the FIRST known brand mentioned in free text (word-boundary,
 * case-insensitive). Used by the freeform motion generator to fetch the
 * REAL logo instead of letting Gemini draw a fake one.
 */
export const detectKnownBrand = (text: string): { name: string; domain: string } | null => {
  if (!text) return null;
  for (const [name, domain] of Object.entries(KNOWN_BRAND_DOMAINS)) {
    // 'x' alone is too ambiguous in prose — require the explicit handle.
    if (name === 'x') continue;
    const re = new RegExp(`\\b${name}\\b`, 'i');
    if (re.test(text)) return { name, domain };
  }
  return null;
};

/**
 * Real logo for a detected brand: Clearbit first, iTunes App Store fallback.
 * Returns a data-URI or null (callers degrade to a letter tile).
 */
export const fetchKnownBrandLogo = async (brand: { name: string; domain: string }): Promise<string | null> => {
  const clearbit = await fetchBrandLogoAsDataUri(brand.domain);
  if (clearbit) return clearbit;
  return fetchAppStoreIconAsDataUri(brand.name);
};

export const KNOWN_BRAND_DOMAINS: Record<string, string> = {
  canva:       'canva.com',
  claude:      'anthropic.com',
  anthropic:   'anthropic.com',
  chatgpt:     'openai.com',
  openai:      'openai.com',
  notion:      'notion.so',
  figma:       'figma.com',
  instagram:   'instagram.com',
  youtube:     'youtube.com',
  tiktok:      'tiktok.com',
  linkedin:    'linkedin.com',
  twitter:     'x.com',
  x:           'x.com',
  spotify:     'spotify.com',
  slack:       'slack.com',
  zoom:        'zoom.us',
  google:      'google.com',
  meta:        'meta.com',
  facebook:    'facebook.com',
  whatsapp:    'whatsapp.com',
  shopify:     'shopify.com',
  hubspot:     'hubspot.com',
  zapier:      'zapier.com',
  airtable:    'airtable.com',
  midjourney:  'midjourney.com',
  runway:      'runwayml.com',
  perplexity:  'perplexity.ai',
  gemini:      'google.com',
  copilot:     'microsoft.com',
  microsoft:   'microsoft.com',
  adobe:       'adobe.com',
  framer:      'framer.com',
  webflow:     'webflow.com',
  vercel:      'vercel.com',
  supabase:    'supabase.com',
  stripe:      'stripe.com',
};
