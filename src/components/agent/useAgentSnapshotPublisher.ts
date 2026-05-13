// Publishes a slim snapshot of ReelsState to the Rust agent backend whenever
// it changes. Debounced (300ms) because a typical edit session fires many
// reducer actions in quick succession (timing recomputes, audio peaks, etc.)
// and we don't want to flood IPC.
//
// Only call this once at the top of the React tree.

import { useEffect, useRef } from 'react';
import { publishSnapshot } from './agentBridge';
import type { ReelsSnapshot } from './types';
import type { ReelsState } from '../reelsStudio/types';

const DEBOUNCE_MS = 300;

function toSnapshot(state: ReelsState, projectName: string | undefined): ReelsSnapshot {
  return {
    project_id: null,
    project_name: projectName ?? null,
    aspect: state.aspect ?? null,
    voice_id: state.selectedVoiceId ?? null,
    blocks: state.blocks.map(b => ({
      id: b.id,
      kind: b.kind,
      text: b.text,
      layout: b.layout ?? null,
      duration_sec: typeof b.end === 'number' && typeof b.start === 'number'
        ? Math.max(0, b.end - b.start)
        : null,
      start_sec: typeof b.start === 'number' ? b.start : null,
      end_sec: typeof b.end === 'number' ? b.end : null,
      asset_count: b.attachedAssets?.length ?? 0,
      has_motion: !!b.motion,
    })),
    audio: state.audio
      ? {
          status: state.audio.status,
          duration_sec: state.audio.duration ?? null,
          silence_cut_on: !!state.audio.silenceCut,
          silence_preset: state.audio.silencePreset ?? null,
        }
      : null,
    analyses: (state.analyses ?? []).map(a => ({
      created_at: a.createdAt,
      source_file: a.sourceFileName ?? null,
      source_url: a.sourceUrl ?? null,
      language: a.language ?? null,
      tone: Array.isArray(a.tone) ? a.tone.join(', ') : null,
    })),
  };
}

export function useAgentSnapshotPublisher(state: ReelsState, projectName: string | undefined): void {
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => {
      const snap = toSnapshot(state, projectName);
      void publishSnapshot(snap).catch(err => {
        console.warn('[agent] publishSnapshot failed:', err);
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [state, projectName]);
}
