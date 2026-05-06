import type { PersistedAnalysis, ReelsAction, ReelsState, ScriptBlock } from './types';

const uid = () => `b_${Math.random().toString(36).slice(2, 9)}`;

const DEFAULT_BLOCKS: ScriptBlock[] = [
  { id: uid(), kind: 'avatar', text: 'Olá pessoal, hoje eu vou mostrar uma ferramenta incrível que vai mudar como vocês criam conteúdo.', start: 0,    end: 5.2 },
  { id: uid(), kind: 'broll',  text: 'Aqui mostro a interface principal abrindo na tela do computador.',                                            start: 5.2,  end: 13.8 },
  { id: uid(), kind: 'avatar', text: 'Repare como tudo é fluido e intuitivo, do roteiro até a exportação final.',                                  start: 13.8, end: 18.4 },
  { id: uid(), kind: 'broll',  text: 'Demonstração rápida de export pra MP4 e timeline editável.',                                                 start: 18.4, end: 26.0 },
  { id: uid(), kind: 'avatar', text: 'Se gostou, salva esse vídeo e me segue pra mais. Tchau!',                                                    start: 26.0, end: 30.0 },
];

export const INITIAL_STATE: ReelsState = {
  projectName: 'Reel sem título',
  blocks: DEFAULT_BLOCKS,
  audio: {
    status: 'idle',
    url: null,
    duration: 30,
    peaks: [],
    words: [],
    voiceId: null,
    error: null,
    silenceCut: false,
    silencePreset: 'fast',
    keepSegments: [],
    detectedSilenceSec: 0,
    detectingSilence: false,
  },
  selectedVoiceId: 'Wise_Woman',
  aspect: '9:16',
  avatarClips: {},
  avatarModel: 'avatar4',
  selectedPhotoId: null,
  takes: [],
  activeTakeId: null,
  emotion: 'neutral',
  voiceSpeed: 1.0,
  analyses: [],
};

const ANALYSIS_HISTORY_LIMIT = 20;

const dedupeAnalysis = (list: PersistedAnalysis[], next: PersistedAnalysis): PersistedAnalysis[] => {
  // Drop any prior analysis for the same source file, then prepend the new one.
  const filtered = next.sourceFileName
    ? list.filter(a => a.sourceFileName !== next.sourceFileName)
    : list.filter(a => a.createdAt !== next.createdAt);
  return [next, ...filtered].slice(0, ANALYSIS_HISTORY_LIMIT);
};

const markBlockDirty = (state: ReelsState, blockId: string): ReelsState => {
  if (state.audio.status !== 'ready') return state;
  return {
    ...state,
    blocks: state.blocks.map(b => b.id === blockId ? { ...b, dirty: true } : b),
  };
};

export function reducer(state: ReelsState, action: ReelsAction): ReelsState {
  switch (action.type) {
    case 'set-name':
      return { ...state, projectName: action.name };

    case 'add-block': {
      const newBlock: ScriptBlock = { id: uid(), kind: 'avatar', text: '', start: 0, end: 0 };
      if (!action.afterId) return { ...state, blocks: [...state.blocks, newBlock] };
      const idx = state.blocks.findIndex(b => b.id === action.afterId);
      const next = [...state.blocks];
      next.splice(idx + 1, 0, newBlock);
      return { ...state, blocks: next };
    }

    case 'remove-block':
      return { ...state, blocks: state.blocks.filter(b => b.id !== action.id) };

    case 'update-block-text':
      return markBlockDirty(
        { ...state, blocks: state.blocks.map(b => b.id === action.id ? { ...b, text: action.text } : b) },
        action.id,
      );

    case 'toggle-block-kind':
      return {
        ...state,
        blocks: state.blocks.map(b => b.id === action.id ? { ...b, kind: b.kind === 'avatar' ? 'broll' : 'avatar' } : b),
      };

    case 'split-block': {
      const idx = state.blocks.findIndex(b => b.id === action.id);
      if (idx < 0) return state;
      const original = state.blocks[idx];
      const blockLen = Math.max(0, original.end - original.start);
      const MIN_HALF = 0.8;

      // Where to split, in source-time absolute (block.start..block.end).
      const splitAbs = Math.max(original.start + MIN_HALF, Math.min(original.end - MIN_HALF, action.atSec));
      if (splitAbs <= original.start || splitAbs >= original.end) return state; // can't split, too short

      // Text split proportional to time.
      const ratio = (splitAbs - original.start) / blockLen;
      const words = original.text.split(/\s+/).filter(Boolean);
      const splitWordIdx = Math.max(1, Math.min(words.length - 1, Math.round(words.length * ratio)));
      const text1 = words.slice(0, splitWordIdx).join(' ');
      const text2 = words.slice(splitWordIdx).join(' ');

      // Visibility for each half (clamp to new lengths).
      const len1 = splitAbs - original.start;
      const len2 = original.end - splitAbs;
      const origVis = original.avatarVisibleSec;
      let vis1: number | undefined;
      let vis2: number | undefined;
      if (origVis !== undefined) {
        if (origVis <= len1) {
          // First half ends visibility within itself; second half starts already in B-roll.
          vis1 = origVis;
          vis2 = 0;
        } else {
          // Visibility extends into the second half.
          vis1 = undefined;
          vis2 = origVis - len1;
        }
      }

      const hadClip = state.avatarClips[original.id]?.status === 'ready';
      const originalClip = state.avatarClips[original.id];
      const uid = () => `b_${Math.random().toString(36).slice(2, 9)}`;
      const half1Id = uid();
      const half2Id = uid();
      const half1: ScriptBlock = {
        ...original,
        id: half1Id,
        text: text1,
        end: splitAbs,
        // Drop visibility unless it was set and applies to this half.
        ...(vis1 !== undefined ? { avatarVisibleSec: vis1 } : { avatarVisibleSec: undefined }),
        dirty: hadClip ? true : original.dirty,
      };
      const half2: ScriptBlock = {
        ...original,
        id: half2Id,
        text: text2,
        start: splitAbs,
        ...(vis2 !== undefined ? { avatarVisibleSec: vis2 } : { avatarVisibleSec: undefined }),
        dirty: hadClip ? true : original.dirty,
      };
      // Strip undefined avatarVisibleSec so it round-trips clean.
      if (half1.avatarVisibleSec === undefined) delete (half1 as Partial<ScriptBlock>).avatarVisibleSec;
      if (half2.avatarVisibleSec === undefined) delete (half2 as Partial<ScriptBlock>).avatarVisibleSec;

      // Reassign the existing clip to the FIRST half so the user keeps seeing the avatar
      // for that portion. The second half is marked dirty and will need regeneration.
      const newAvatarClips: typeof state.avatarClips = { ...state.avatarClips };
      delete newAvatarClips[original.id];
      if (originalClip) {
        newAvatarClips[half1Id] = { ...originalClip, blockId: half1Id };
      }

      const nextBlocks = [...state.blocks];
      nextBlocks.splice(idx, 1, half1, half2);
      return { ...state, blocks: nextBlocks, avatarClips: newAvatarClips };
    }

    case 'set-avatar-zoom': {
      const clamped = Math.max(1, Math.min(3, action.zoom));
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          if (Math.abs(clamped - 1) < 0.02) {
            const { avatarZoom: _, ...rest } = b;
            return rest;
          }
          return { ...b, avatarZoom: Math.round(clamped * 10) / 10 };
        }),
      };
    }

    case 'set-block-layout': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          if (action.layout === 'avatar-only') {
            const { layout: _, ...rest } = b;
            return rest;
          }
          return { ...b, layout: action.layout };
        }),
      };
    }

    case 'set-block-motion': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          if (action.motion === undefined) {
            const { motion: _, ...rest } = b;
            return rest;
          }
          return { ...b, motion: action.motion };
        }),
      };
    }

    case 'set-avatar-visible-sec': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          const blockLen = Math.max(0, b.end - b.start);
          if (action.sec === undefined) {
            const { avatarVisibleSec: _, ...rest } = b;
            return rest;
          }
          // Clamp between 0.3s minimum and the block's full length.
          const clamped = Math.max(0.3, Math.min(blockLen, action.sec));
          // If the user picks the full length we drop the field so it round-trips clean.
          if (Math.abs(clamped - blockLen) < 0.05) {
            const { avatarVisibleSec: _, ...rest } = b;
            return rest;
          }
          // Mark dirty if the block already has a generated clip — visibility change
          // means the rendered HeyGen output may need to be regenerated.
          const dirty = state.avatarClips[b.id]?.status === 'ready' ? true : b.dirty;
          return { ...b, avatarVisibleSec: Math.round(clamped * 10) / 10, dirty };
        }),
      };
    }

    case 'replace-blocks': {
      // Wipe audio + clips because the script is now different.
      if (state.audio.url) URL.revokeObjectURL(state.audio.url);
      const nextAnalyses = action.analysis
        ? dedupeAnalysis(state.analyses, action.analysis)
        : state.analyses;
      return {
        ...state,
        blocks: action.blocks,
        audio: INITIAL_STATE.audio,
        avatarClips: {},
        // Keep an existing analysis only if no new one is provided. Replacing blocks
        // from a fresh video reference always brings analysis along.
        lastAnalysis: action.analysis ?? state.lastAnalysis,
        analyses: nextAnalyses,
      };
    }

    case 'remove-analysis': {
      const remaining = state.analyses.filter(a => a.createdAt !== action.createdAt);
      const lastWasRemoved = state.lastAnalysis?.createdAt === action.createdAt;
      return {
        ...state,
        analyses: remaining,
        lastAnalysis: lastWasRemoved ? remaining[0] : state.lastAnalysis,
      };
    }

    case 'move-block': {
      const idx = state.blocks.findIndex(b => b.id === action.id);
      if (idx < 0) return state;
      const target = action.direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= state.blocks.length) return state;
      const next = [...state.blocks];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...state, blocks: next };
    }

    case 'set-voice':
      return { ...state, selectedVoiceId: action.voiceId };

    case 'set-emotion':
      return { ...state, emotion: action.emotion };

    case 'set-voice-speed': {
      const clamped = Math.max(0.85, Math.min(1.2, action.speed));
      return { ...state, voiceSpeed: Math.round(clamped * 100) / 100 };
    }

    case 'set-aspect':
      return { ...state, aspect: action.aspect };

    case 'audio-start':
      return { ...state, audio: { ...state.audio, status: 'generating', error: null } };

    case 'audio-success': {
      // Recompute block timings based on real duration + word distribution.
      const blockWords = action.words;
      const blocks = state.blocks.map(b => {
        const ws = blockWords.filter(w => w.blockId === b.id);
        if (ws.length === 0) return { ...b, dirty: false };
        return { ...b, start: ws[0].start, end: ws[ws.length - 1].end, dirty: false };
      }).map((b, idx, arr) => idx === arr.length - 1 ? { ...b, end: action.duration } : { ...b, end: arr[idx + 1].start });

      return {
        ...state,
        blocks,
        audio: {
          status: 'ready',
          url: action.url,
          duration: action.duration,
          peaks: action.peaks,
          words: action.words,
          voiceId: action.voiceId,
          error: null,
          // Preserve user's preset choice but clear stale segment data.
          silenceCut: state.audio.silenceCut,
          silencePreset: state.audio.silencePreset,
          keepSegments: [],
          detectedSilenceSec: 0,
          detectingSilence: false,
        },
        avatarClips: {}, // audio changed → previous clips no longer line up
      };
    }

    case 'audio-error':
      return { ...state, audio: { ...state.audio, status: 'error', error: action.error } };

    case 'reset-audio':
      if (state.audio.url) URL.revokeObjectURL(state.audio.url);
      return { ...state, audio: INITIAL_STATE.audio, avatarClips: {} };

    case 'audio-silence-toggle':
      return { ...state, audio: { ...state.audio, silenceCut: action.on } };

    case 'audio-silence-preset':
      // Switching preset invalidates current detection until rerun.
      return { ...state, audio: { ...state.audio, silencePreset: action.preset, keepSegments: [], detectedSilenceSec: 0 } };

    case 'audio-silence-detect-start':
      return { ...state, audio: { ...state.audio, detectingSilence: true } };

    case 'audio-silence-detect-done':
      return {
        ...state,
        audio: {
          ...state.audio,
          detectingSilence: false,
          keepSegments: action.keepSegments,
          detectedSilenceSec: action.detectedSilenceSec,
        },
      };

    case 'set-avatar-model':
      return { ...state, avatarModel: action.model };

    case 'set-photo':
      return { ...state, selectedPhotoId: action.photoId };

    case 'clip-update': {
      const prev = state.avatarClips[action.blockId];
      const next = {
        blockId: action.blockId,
        status: action.status,
        message: action.message ?? prev?.message,
        videoUrl: action.videoUrl ?? prev?.videoUrl,
        error: action.error ?? (action.status === 'error' ? prev?.error : undefined),
      };
      return { ...state, avatarClips: { ...state.avatarClips, [action.blockId]: next } };
    }

    case 'clear-clips':
      return { ...state, avatarClips: {} };

    case 'add-take':
      return {
        ...state,
        takes: [action.take, ...state.takes],
        activeTakeId: state.activeTakeId ?? action.take.id, // auto-activate first take
      };

    case 'remove-take': {
      const remaining = state.takes.filter(t => t.id !== action.id);
      return {
        ...state,
        takes: remaining,
        activeTakeId: state.activeTakeId === action.id ? (remaining[0]?.id ?? null) : state.activeTakeId,
      };
    }

    case 'rename-take':
      return {
        ...state,
        takes: state.takes.map(t => t.id === action.id ? { ...t, name: action.name } : t),
      };

    case 'update-take':
      return {
        ...state,
        takes: state.takes.map(t => t.id === action.id ? { ...t, ...action.patch } : t),
      };

    case 'set-active-take':
      return { ...state, activeTakeId: action.id };

    case 'hydrate':
      return action.state;

    default:
      return state;
  }
}
