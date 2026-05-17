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
 * Default zoom for an avatar block. Always 1.0 — the `<video>` element's
 * `object-fit: cover` handles letterbox naturally for whatever aspect the
 * clip happens to be. The user can still drag the slider up to crop tighter.
 *
 * History: this used to return 1.78 for 9:16 because Avatar III/IV rendered
 * 16:9 and needed zooming. Avatar V renders natively vertical, so the same
 * forced zoom was scaling the clip to 1.78× of an already-vertical frame —
 * cropping faces and looking warped.
 */
export const defaultAvatarZoom = (_aspect: '9:16' | '16:9' | '1:1' | 'carousel', _layout: BlockLayout | undefined): number => {
  return 1;
};
