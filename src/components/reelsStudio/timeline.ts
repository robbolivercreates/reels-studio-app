/**
 * Timeline math.
 *
 * Audio is the source of truth — it always plays end to end, untouched by
 * block-level edits. Blocks lay out sequentially in source-time order:
 *
 *   slot.projectStart === slot.sourceStart
 *   slot.projectEnd   === slot.sourceEnd
 *
 * Avatar blocks may have `avatarVisibleSec` set, which tells the compositor
 * to swap the avatar visual for the active B-roll once the avatar has been on
 * screen for that many seconds. The audio is unaffected.
 */

import type { ScriptBlock } from './types';

export interface Slot {
  blockId: string;
  projectStart: number;
  projectEnd: number;
  sourceStart: number;
  sourceEnd: number;
  /** Avatar-only: seconds the avatar is on screen (from sourceStart). undefined = full block. */
  avatarVisibleSec?: number;
}

export interface TimelineLayout {
  slots: Slot[];
  totalDuration: number;
}

export const computeLayout = (blocks: ScriptBlock[]): TimelineLayout => {
  let totalDuration = 0;
  const slots: Slot[] = blocks.map(b => {
    const slot: Slot = {
      blockId: b.id,
      projectStart: b.start,
      projectEnd: b.end,
      sourceStart: b.start,
      sourceEnd: b.end,
      avatarVisibleSec: b.kind === 'avatar' ? b.avatarVisibleSec : undefined,
    };
    if (b.end > totalDuration) totalDuration = b.end;
    return slot;
  });
  return { slots, totalDuration };
};

export type LayoutHit =
  | { kind: 'block'; slot: Slot; sourceTime: number }
  | { kind: 'past-end' };

export const hitTest = (layout: TimelineLayout, t: number): LayoutHit => {
  if (t >= layout.totalDuration) return { kind: 'past-end' };
  for (const s of layout.slots) {
    if (t >= s.projectStart && t < s.projectEnd) {
      return { kind: 'block', slot: s, sourceTime: s.sourceStart + (t - s.projectStart) };
    }
  }
  return { kind: 'past-end' };
};

export const projectToSourceTime = (layout: TimelineLayout, t: number): { sourceTime: number } => {
  const hit = hitTest(layout, t);
  if (hit.kind === 'block') return { sourceTime: hit.sourceTime };
  const last = layout.slots[layout.slots.length - 1];
  return { sourceTime: last?.sourceEnd ?? 0 };
};

/**
 * For an avatar block, returns true if the avatar should still be visible at the
 * given time within the block. After avatarVisibleSec, B-roll takes over.
 */
export const isAvatarVisibleAt = (slot: Slot, projectTime: number): boolean => {
  if (slot.avatarVisibleSec === undefined) return true;
  return (projectTime - slot.projectStart) < slot.avatarVisibleSec;
};
