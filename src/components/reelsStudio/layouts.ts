/**
 * Shared layout geometry for avatar blocks.
 * Coordinates are in 0..1 (normalized) — multiply by canvas/frame size at render time.
 */

import type { BlockLayout } from './types';

export interface LayoutBox {
  /** x in 0..1 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutSlots {
  avatar: LayoutBox | null; // null = avatar not shown in this layout
  media: LayoutBox | null;  // null = media not shown
}

export const getLayoutSlots = (layout: BlockLayout | undefined): LayoutSlots => {
  switch (layout) {
    case 'media-only':
      return {
        avatar: null,
        media: { x: 0, y: 0, w: 1, h: 1 },
      };
    case 'avatar-top':
      return {
        avatar: { x: 0, y: 0,    w: 1, h: 0.5 },
        media:  { x: 0, y: 0.5,  w: 1, h: 0.5 },
      };
    case 'media-top':
      return {
        media:  { x: 0, y: 0,    w: 1, h: 0.5 },
        avatar: { x: 0, y: 0.5,  w: 1, h: 0.5 },
      };
    case 'avatar-only':
    default:
      return {
        avatar: { x: 0, y: 0, w: 1, h: 1 },
        media: null,
      };
  }
};

export const LAYOUT_OPTIONS: { id: BlockLayout; label: string }[] = [
  { id: 'avatar-only', label: 'Só Avatar'    },
  { id: 'media-only',  label: 'Só Mídia'     },
  { id: 'avatar-top',  label: 'Avatar / Mídia' },
  { id: 'media-top',   label: 'Mídia / Avatar' },
];

/**
 * Smart default zoom for an avatar block, given the reel's aspect.
 * HeyGen always renders 16:9 (1920×1080). When the reel is 9:16, we need to
 * zoom into the clip to avoid letterbox; in 16:9 / 1:1 no zoom is needed by default.
 */
export const defaultAvatarZoom = (aspect: '9:16' | '16:9' | '1:1', layout: BlockLayout | undefined): number => {
  // For split layouts the avatar already lives in a smaller box; cover handles fit.
  if (layout === 'avatar-top' || layout === 'media-top') return 1;
  if (aspect === '9:16') return 1.78; // 16/9 ≈ 1.78 — exactly covers a vertical canvas
  return 1;
};
