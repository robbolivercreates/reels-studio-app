import { useCallback, useRef, useState } from 'react';
import type { ReelsAction, ReelsState } from './types';

/**
 * Actions that mutate user-editable structure and should be reversible
 * via Cmd+Z. Audio generation, clip generation, hydration, persistence
 * and screen takes are excluded — those are paid/expensive side-effects
 * or async events that don't fit the "edit / undo / redo" mental model.
 */
const REVERSIBLE_TYPES = new Set<ReelsAction['type']>([
  'set-name',
  'add-block',
  'remove-block',
  'update-block-text',
  'toggle-block-kind',
  'move-block',
  'replace-blocks',
  'set-avatar-visible-sec',
  'set-block-layout',
  'set-avatar-zoom',
  'split-block',
  'set-aspect',
]);

const TEXT_COALESCE_MS = 800;
const HISTORY_LIMIT = 100;

interface History {
  past: ReelsState[];
  future: ReelsState[];
}

interface Reducer {
  (state: ReelsState, action: ReelsAction): ReelsState;
}

interface ApiBag {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Wraps `useReducer` with an undo/redo stack.
 *
 * Only actions in REVERSIBLE_TYPES create a history entry. Consecutive
 * text edits on the same block within TEXT_COALESCE_MS coalesce into a
 * single entry so undo doesn't unwind keystroke-by-keystroke.
 */
export function useHistoryReducer(
  reducer: Reducer,
  initial: ReelsState,
): [ReelsState, React.Dispatch<ReelsAction>, ApiBag] {
  const [state, setState] = useState<ReelsState>(initial);
  const historyRef = useRef<History>({ past: [], future: [] });
  // For coalescing text edits.
  const lastTextEditRef = useRef<{ blockId: string; t: number } | null>(null);
  const [, force] = useState(0);
  const bump = useCallback(() => force(n => n + 1), []);

  const dispatch = useCallback<React.Dispatch<ReelsAction>>((action) => {
    setState(prev => {
      const next = reducer(prev, action);
      if (next === prev) return prev;

      if (action.type === 'hydrate') {
        // Hydration replaces state wholesale — clear history.
        historyRef.current = { past: [], future: [] };
        lastTextEditRef.current = null;
        bump();
        return next;
      }

      if (REVERSIBLE_TYPES.has(action.type)) {
        const now = performance.now();
        const last = lastTextEditRef.current;
        const isCoalesce = action.type === 'update-block-text'
          && last
          && last.blockId === action.id
          && (now - last.t) < TEXT_COALESCE_MS;

        if (!isCoalesce) {
          const past = historyRef.current.past;
          const trimmed = past.length >= HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT + 1) : past;
          historyRef.current = { past: [...trimmed, prev], future: [] };
        }

        if (action.type === 'update-block-text') {
          lastTextEditRef.current = { blockId: action.id, t: now };
        } else {
          lastTextEditRef.current = null;
        }
      } else {
        // Non-reversible structural mutation (audio gen, clip update, etc.) breaks coalescing.
        lastTextEditRef.current = null;
      }

      bump();
      return next;
    });
  }, [reducer, bump]);

  const undo = useCallback(() => {
    setState(prev => {
      const { past, future } = historyRef.current;
      if (past.length === 0) return prev;
      const previous = past[past.length - 1];
      historyRef.current = { past: past.slice(0, -1), future: [prev, ...future] };
      lastTextEditRef.current = null;
      bump();
      return previous;
    });
  }, [bump]);

  const redo = useCallback(() => {
    setState(prev => {
      const { past, future } = historyRef.current;
      if (future.length === 0) return prev;
      const [nextState, ...rest] = future;
      historyRef.current = { past: [...past, prev], future: rest };
      lastTextEditRef.current = null;
      bump();
      return nextState;
    });
  }, [bump]);

  const api: ApiBag = {
    undo,
    redo,
    canUndo: historyRef.current.past.length > 0,
    canRedo: historyRef.current.future.length > 0,
  };

  return [state, dispatch, api];
}
