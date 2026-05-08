/**
 * Module-level singleton holding the most recent cut audio + remapped blocks.
 *
 * This sits outside React's render cycle entirely so HMR remounts, persistence
 * rehydration, and reducer races can't desync it from the component refs.
 * The cut effect writes here when `audio-cuts-apply-done` fires; the export
 * paths read from here. Cleared on revert.
 */

import type { ScriptBlock } from './types';

interface CutSession {
  audioBlob: Blob;
  blocks: ScriptBlock[];
  duration: number;
}

let current: CutSession | null = null;

export const setCutSession = (session: CutSession) => {
  current = session;
};

export const clearCutSession = () => {
  current = null;
};

export const getCutSession = (): CutSession | null => current;
