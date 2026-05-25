/**
 * Rob Boliver Signature Visual Aesthetic and Prompt Templates
 * Used by the Reels Studio thumbnail generation engine.
 */

export const ROB_BOLIVER_SIGNATURE_SPEC = `
Premium vertical social media cover (Instagram Reels cover) in Rob Boliver's signature visual brand aesthetic.
Visual composition style:
- Deep dark premium canvas background (#0A0A0F) with elegant cinematic depth of field and soft background blur (bokeh).
- A real, high-quality, professional person (the creator) in a confident, dynamic, or engaging pose, positioned in the center or lower-half of the frame.
- Dramatic cinematic lighting with intense, vibrant, but sophisticated glow accents using brand colors: electric cyan (#00B4D8) and rich violet/indigo (#7B2FBE) casting realistic light and reflections on the subject and the scene.
- The lighting should feel like a premium tech studio or high-end startup campaign, with realistic color-grading and high contrast.

Typography style:
- Bold, oversized, heavy all-caps clean sans-serif headline text rendered in the upper-third area of the cover (maximum 3 lines).
- Inspiring Apple Keynote presentations or premium SaaS landing page headlines (like OpenAI, Linear, Framer).
- Ultra-high contrast text: clean solid white letters with a very subtle drop shadow to stand out perfectly against the dark cinematic background.
- High mobile-first readability: text must read instantly when scrolling rapidly on phone screens.

Avoid:
- Abstract AI digital art, flat illustrations, fantasy drawings, or low-quality gamer/cyberpunk neon borders.
- Cyberpunk cityscapes or gaming overlays; prefer dark cinematic, premium tech, or clean, luxurious background textures.
- Watermarks, small badges, icons, social media logos, or clutter; keep it extremely premium, clean, and professional.
`;

/**
 * Builds the prompt for Gemini 3.5 Flash (with Search Grounding) to research and plan the thumbnail.
 */
export function buildResearchPrompt(title: string, script?: string, styleInstructions?: string): string {
  return `You are a World-Class Graphic Designer, Click Psychology Expert, and Branding Strategist.
Your goal is to research and plan a high-converting, premium vertical social media cover/thumbnail (aspect ratio 9:16) for a short-form vertical video (Reel).

VIDEO DETAILS:
- Title/Topic: "${title}"
${script ? `- Script Summary/Body: "${script}"` : ''}
${styleInstructions ? `- User Custom Instructions: "${styleInstructions}"` : ''}

YOUR CRITICAL MISSION (USE GOOGLE SEARCH):
1. **Research Brand Assets & Visuals**: Find the correct visual identities, logos, color schemes, and interfaces associated with the brands or tools mentioned in the video (e.g. if Arc Browser is mentioned, research its distinctive gradient tabs, sidebar interface, and icon style).
2. **CTR Best Practices**: Study what kind of thumbnails perform best for this specific niche (productivity, AI tools, luxury tech).
3. **Typography Overlay Optimization**: Create a highly punchy, optimized, and clickable text overlay for the thumbnail (maximum 3-5 words, in the same language as the video title). It should capture the main hook of the video.

STRUCTURE OF THE GENERATED DESCRIPTION:
You must translate your research into a detailed, descriptive composition prompt in English for the image generation model (GPT Image 2).

Format your response as a JSON object with these EXACT keys:
1. "visualConceptDescription": A detailed narrative description (in English) of the scene, objects, interfaces, logos, subject, composition, and specific visual branding elements researched. DO NOT write the text itself inside the scene description. Keep it descriptive, elegant, and specific.
2. "suggestedOverlayText": A highly optimized and punchy title to be rendered literally on the thumbnail (max 5 words, in the same language as the video, e.g. Portuguese).
3. "researchInsights": A short paragraph (2-3 sentences, in Portuguese) explaining what was found in the search regarding visual trends and how this visual solves the CTR goal.

Return JSON only. Do not wrap in markdown except as a valid JSON string.
`;
}

/**
 * Builds the final prompt for Fal.ai's GPT Image 2 model.
 * Fuses the researched concept with the Rob Boliver brand aesthetic guide.
 */
export function buildFalPrompt(params: {
  visualConceptDescription: string;
  suggestedOverlayText: string;
  creatorPhotoProvided?: boolean;
}): string {
  const { visualConceptDescription, suggestedOverlayText, creatorPhotoProvided } = params;

  const subjectDirective = creatorPhotoProvided
    ? `SUBJECT: You must integrate the likeness of the person from the provided image into the scene. Make it a photorealistic render of this exact person in a confident and natural pose. Harmonize their lighting and shadows to perfectly match the dark atmospheric, cyan and violet tech lighting of the scene.`
    : `SUBJECT: A highly realistic professional person (matching the theme of the video) in a dynamic, confident pose, captured in sharp focus in a high-end tech workspace or premium studio setting.`;

  return `TASK: Design a single premium, high-CTR vertical social media cover (9:16 aspect ratio).
INTENDED USE: High-end Instagram Reels vertical cover.

HEADLINE TEXT TO RENDER (Render this exact short hook in large, oversized, bold, ultra-clean sans-serif letters near the top half of the image):
"${suggestedOverlayText.toUpperCase()}"

TYPOGRAPHY SPEC:
- Modern, clean, heavy sans-serif (inspired by Apple keynote presentations).
- Ultra-high contrast (solid white with a subtle drop shadow to read perfectly on dark backgrounds).
- High readability for mobile screens. Large typography that reads instantly.
- Placed cleanly in the upper-third area, leaving the rest of the image completely free of any text, badges, or watermarks.

VISUAL AESTHETIC DIRECTIVES (Rob Boliver Brand Guide):
${ROB_BOLIVER_SIGNATURE_SPEC}

SCENE COMPOSITION (Researched Details):
${visualConceptDescription}

${subjectDirective}

COMPOSITION RULES:
- Frame strictly as a portrait (9:16 aspect ratio, vertical).
- Centered realistic subject in the lower-middle half of the frame.
- Massive, clean negative space around the text overlay at the top to preserve premium luxury framing.
- Diffused, soft atmospheric lighting using the trademark electric cyan (#00B4D8) and violet (#7B2FBE) accents. No harsh neon borders, no low-quality gaming aesthetics.
- Shallow depth of field (bokeh background).

OUTPUT: A stunning, photo-realistic, cinematic masterpiece ready for social media. Zero additional text, zero watermarks.`;
}
