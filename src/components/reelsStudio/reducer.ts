import type { PersistedAnalysis, ReelsAction, ReelsState, ScriptBlock } from './types';

const uid = () => `b_${Math.random().toString(36).slice(2, 9)}`;

// Empty starter — one blank avatar block, ready for the user to type into.
// Limpar projeto traz o app de volta exatamente a este estado.
const DEFAULT_BLOCKS: ScriptBlock[] = [
  { id: uid(), kind: 'avatar', text: '', start: 0, end: 0 },
];

export const INITIAL_STATE: ReelsState = {
  activeProjectId: null,
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
  motionColorMode: 'dark',
  motionEnergy: 'energetic',
  appTheme: 'dark',
  lastAvatarLayout: 'avatar-top',
  projectMode: 'generate',
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

    case 'set-active-project-id':
      return { ...state, activeProjectId: action.id };

    case 'add-block': {
      const newBlock: ScriptBlock = {
        id: uid(),
        kind: 'avatar',
        text: '',
        start: 0,
        end: 0,
        // Sticky layout: new avatar blocks inherit the last layout the user chose.
        // 'avatar-only' is the implicit fallback when state has no preference yet.
        ...(state.lastAvatarLayout && state.lastAvatarLayout !== 'avatar-only'
          ? { layout: state.lastAvatarLayout }
          : {}),
      };
      if (!action.afterId) return { ...state, blocks: [...state.blocks, newBlock] };
      const idx = state.blocks.findIndex(b => b.id === action.afterId);
      const next = [...state.blocks];
      next.splice(idx + 1, 0, newBlock);
      return { ...state, blocks: next };
    }

    case 'remove-block': {
      // Remove the block AND every piece of state keyed by its id, so nothing
      // orphaned lingers on the timeline (avatar clip, motion overlay, etc.).
      // The block's `motion` and `attachedAsset` live inside the block object,
      // so they vanish with the filter automatically.
      const { [action.id]: _droppedClip, ...remainingClips } = state.avatarClips;
      return {
        ...state,
        blocks: state.blocks.filter(b => b.id !== action.id),
        avatarClips: remainingClips,
      };
    }

    case 'duplicate-block': {
      // Duplicate text + layout/style/asset metadata, but DROP per-block
      // generated artifacts (motion HTML/video, avatar clip) — those are tied
      // to the source block and would just be confusing on a clone.
      const idx = state.blocks.findIndex(b => b.id === action.id);
      if (idx < 0) return state;
      const source = state.blocks[idx];
      const { motion: _m, dirty: _d, ...rest } = source;
      const clone: ScriptBlock = {
        ...rest,
        id: uid(),
        // Reset timings to zero — they get rewritten by audio-success/reorder.
        start: 0,
        end: 0,
        // Audio is no longer in sync with the cloned block until regenerated.
        dirty: state.audio.status === 'ready' ? true : undefined,
      };
      const nextBlocks = [...state.blocks];
      nextBlocks.splice(idx + 1, 0, clone);
      return { ...state, blocks: nextBlocks };
    }

    case 'update-block-text':
      return markBlockDirty(
        { ...state, blocks: state.blocks.map(b => b.id === action.id ? { ...b, text: action.text } : b) },
        action.id,
      );

    case 'toggle-block-kind':
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          const newKind = b.kind === 'avatar' ? 'broll' : 'avatar';
          // If the block has any attached assets, re-derive the layout from
          // the new kind. avatar+assets = media-top (split). broll+assets =
          // media-only (full frame, no avatar half).
          const hasAssets = (b.attachedAssets?.length ?? 0) > 0;
          if (!hasAssets) return { ...b, kind: newKind };
          const layout = newKind === 'broll' ? 'media-only' : 'media-top';
          return { ...b, kind: newKind, layout };
        }),
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

    case 'set-avatar-offset-y': {
      const clamped = Math.max(-0.5, Math.min(0.5, action.offsetY));
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          if (Math.abs(clamped) < 0.01) {
            const { avatarOffsetY: _, ...rest } = b;
            return rest;
          }
          return { ...b, avatarOffsetY: Math.round(clamped * 100) / 100 };
        }),
      };
    }

    case 'set-block-layout': {
      const targetBlock = state.blocks.find(b => b.id === action.id);
      // When the user changes the layout of an avatar block, remember the choice
      // so future avatar blocks (add/resplit/replace) start with the same layout.
      const stickyUpdate = targetBlock?.kind === 'avatar'
        ? { lastAvatarLayout: action.layout }
        : {};
      return {
        ...state,
        ...stickyUpdate,
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

    case 'set-block-avatar-photo': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          if (action.photoId === undefined) {
            const { avatarPhotoId: _, ...rest } = b;
            return rest;
          }
          return { ...b, avatarPhotoId: action.photoId };
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

    case 'set-block-style-preset': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          if (action.preset === undefined) {
            const { stylePresetOverride: _s, ...rest } = b;
            return rest;
          }
          return { ...b, stylePresetOverride: action.preset };
        }),
      };
    }

    case 'set-block-motion-model': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          if (action.model === undefined) {
            const { motionModelOverride: _m, ...rest } = b;
            return rest;
          }
          return { ...b, motionModelOverride: action.model };
        }),
      };
    }

    case 'set-block-style-preset-cascade': {
      // Apply preset to the target block AND all blocks without generated motion HTML.
      // Other blocks that already have motion.html are never touched — user already approved their style.
      // For the TARGET block: if it already has a generated motion, we invalidate motion.html
      // and reset status to 'draft' so the next motion render uses the new preset. Otherwise the
      // visible chip and the cached motion would silently drift.
      return {
        ...state,
        blocks: state.blocks.map(b => {
          const hasMotion = !!(b.motion?.html);
          if (b.id !== action.id && hasMotion) return b;
          const isTargetWithMotion = b.id === action.id && hasMotion;
          const nextMotion = isTargetWithMotion && b.motion
            ? { ...b.motion, html: '', status: 'draft' as const, videoPath: undefined, errorMessage: undefined }
            : b.motion;
          if (action.preset === undefined) {
            const { stylePresetOverride: _s, ...rest } = b;
            return { ...rest, motion: nextMotion };
          }
          return { ...b, stylePresetOverride: action.preset, motion: nextMotion };
        }),
      };
    }

    // Multi-asset handlers — replace the legacy single-asset action.
    // Layout derivation rule (shared): empty list → strip auto-layout,
    // non-empty → media-top (avatar) or media-only (broll).
    case 'set-block-assets': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          const next = action.assets;
          if (!next || next.length === 0) {
            const { attachedAssets: _a, attachedAsset: _legacy, layout: _l, ...rest } = b;
            return rest;
          }
          const layout = b.kind === 'broll' ? 'media-only' : 'media-top';
          // Drop legacy single-asset field on every write.
          const { attachedAsset: _legacy, ...rest } = b;
          return { ...rest, attachedAssets: next, layout };
        }),
      };
    }

    case 'add-block-asset': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          const current = b.attachedAssets ?? [];
          // Prevent dup paths in the carousel — adding the same file twice
          // doesn't make sense visually.
          if (current.some(a => a.path === action.asset.path)) return b;
          const next = [...current, action.asset];
          const layout = b.kind === 'broll' ? 'media-only' : 'media-top';
          const { attachedAsset: _legacy, ...rest } = b;
          return { ...rest, attachedAssets: next, layout };
        }),
      };
    }

    case 'remove-block-asset': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          const current = b.attachedAssets ?? [];
          if (action.index < 0 || action.index >= current.length) return b;
          const next = current.filter((_, i) => i !== action.index);
          if (next.length === 0) {
            const { attachedAssets: _a, attachedAsset: _legacy, layout: _l, ...rest } = b;
            return rest;
          }
          return { ...b, attachedAssets: next };
        }),
      };
    }

    case 'reorder-block-assets': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          const current = b.attachedAssets ?? [];
          const { fromIndex, toIndex } = action;
          if (fromIndex === toIndex) return b;
          if (fromIndex < 0 || fromIndex >= current.length) return b;
          if (toIndex < 0 || toIndex >= current.length) return b;
          const next = [...current];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { ...b, attachedAssets: next };
        }),
      };
    }

    case 'set-block-skip-asset-gate': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          // Strip the flag when false to keep persistence payload small —
          // undefined and false read identically through the gate helper.
          if (!action.skip) {
            const { skipAssetGate: _, ...rest } = b;
            return rest;
          }
          return { ...b, skipAssetGate: true };
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
      // Drop cached brand identity — new script may have a different brand.
      const { brandIdentity: _, ...stateWithoutBrand } = state;
      return {
        ...stateWithoutBrand,
        blocks: action.blocks,
        audio: INITIAL_STATE.audio,
        avatarClips: {},
        // Keep an existing analysis only if no new one is provided. Replacing blocks
        // from a fresh video reference always brings analysis along.
        lastAnalysis: action.analysis ?? state.lastAnalysis,
        analyses: nextAnalyses,
      };
    }

    case 'resplit-blocks': {
      // Split-only flow — same audio file, new block boundaries +
      // re-tagged word timestamps. Avatar clips on UNTOUCHED blocks
      // survive as-is. Clips on SPLIT blocks get migrated to the
      // head piece (which still starts at the original block's start),
      // because the audio at that range is exactly what the clip was
      // rendered for. Tail pieces inherit nothing and stay broll.
      const nextClips: typeof state.avatarClips = {};
      for (const [id, clip] of Object.entries(state.avatarClips)) {
        if (!action.removedIds.includes(id)) {
          nextClips[id] = clip;
          continue;
        }
        const newId = action.oldIdToHeadId[id];
        if (newId) {
          // Migrate the clip to the head piece. The head's audio
          // window is `[block.start, cutAt]` — a prefix of the
          // original clip's audio, so playback aligned to the new
          // shorter duration matches.
          nextClips[newId] = clip;
        }
      }
      // Apply sticky avatar layout: any new avatar block coming in without
      // an explicit layout inherits the user's last choice. Existing avatar
      // blocks with their own layout are untouched.
      const sticky = state.lastAvatarLayout;
      const stickyApplied = (sticky && sticky !== 'avatar-only')
        ? action.blocks.map(b =>
            b.kind === 'avatar' && b.layout === undefined ? { ...b, layout: sticky } : b
          )
        : action.blocks;
      return {
        ...state,
        blocks: stickyApplied,
        audio: { ...state.audio, words: action.words },
        avatarClips: nextClips,
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

    case 'reorder-blocks': {
      // Apply new order while keeping each block's duration intact. Sequential
      // start/end timestamps are rewritten so they stay contiguous in source-time.
      // If audio is already generated, blocks become dirty (audio order no longer
      // matches the script — user must regenerate audio).
      const byId = new Map(state.blocks.map(b => [b.id, b]));
      const reordered: ScriptBlock[] = [];
      let cursor = 0;
      for (const id of action.orderedIds) {
        const b = byId.get(id);
        if (!b) continue;
        const dur = Math.max(0, b.end - b.start);
        reordered.push({ ...b, start: cursor, end: cursor + dur });
        cursor += dur;
      }
      // If list of ids didn't include every block (defensive), keep the rest at the end.
      for (const b of state.blocks) {
        if (!action.orderedIds.includes(b.id)) {
          const dur = Math.max(0, b.end - b.start);
          reordered.push({ ...b, start: cursor, end: cursor + dur });
          cursor += dur;
        }
      }
      const audioReady = state.audio.status === 'ready';
      const blocks = audioReady
        ? reordered.map(b => ({ ...b, dirty: true }))
        : reordered;
      return { ...state, blocks };
    }

    case 'set-block-transition': {
      return {
        ...state,
        blocks: state.blocks.map(b => {
          if (b.id !== action.id) return b;
          if (action.transition === 'fade') {
            // 'fade' is the default — strip the field for clean round-trips.
            const { transition: _, ...rest } = b;
            return rest;
          }
          return { ...b, transition: action.transition };
        }),
      };
    }

    case 'set-brand-identity': {
      if (action.brand === undefined) {
        const { brandIdentity: _, ...rest } = state;
        return rest;
      }
      return { ...state, brandIdentity: action.brand };
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

    case 'set-motion-energy':
      return { ...state, motionEnergy: action.energy };

    case 'set-motion-color-mode':
      return { ...state, motionColorMode: action.mode };
    case 'set-app-theme':
      return { ...state, appTheme: action.theme };

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

    case 'enter-edit-mode': {
      // Reuse the active take (or the first take) as the base video. Keeps
      // blocks/audio/overlayElements as-is — just flips the mode so the base
      // video + overlay-elements path takes over.
      const base = state.takes.find(t => t.id === state.activeTakeId) ?? state.takes[0];
      if (!base) return state; // nothing to use as a base video
      return {
        ...state,
        projectMode: 'edit',
        baseVideoTake: base,
        activeTakeId: base.id,
        overlayElements: state.overlayElements ?? [],
      };
    }

    case 'add-overlay-element':
      return { ...state, overlayElements: [...(state.overlayElements ?? []), action.element] };

    case 'update-overlay-element':
      return {
        ...state,
        overlayElements: (state.overlayElements ?? []).map(el =>
          el.id === action.id ? { ...el, ...action.patch } : el,
        ),
      };

    case 'remove-overlay-element':
      return {
        ...state,
        overlayElements: (state.overlayElements ?? []).filter(el => el.id !== action.id),
      };

    case 'set-overlay-motion':
      return {
        ...state,
        overlayElements: (state.overlayElements ?? []).map(el =>
          el.id === action.id ? { ...el, motion: action.motion } : el,
        ),
      };

    case 'edit-video-loaded': {
      // "Editar vídeo pronto": the uploaded video becomes the base track and
      // its extracted audio becomes the master. We mirror `audio-success`
      // (status ready + words + peaks) but the source is the video, not TTS —
      // so voiceId is null. Blocks arrive pre-segmented from the transcript.
      return {
        ...state,
        projectMode: 'edit',
        baseVideoTake: action.baseVideoTake,
        takes: [action.baseVideoTake, ...state.takes.filter(t => t.id !== action.baseVideoTake.id)],
        activeTakeId: action.baseVideoTake.id,
        blocks: action.blocks,
        overlayElements: [],
        avatarClips: {},
        audio: {
          status: 'ready',
          url: action.audioUrl,
          duration: action.duration,
          peaks: action.peaks,
          words: action.words,
          voiceId: null,
          error: null,
          silenceCut: state.audio.silenceCut,
          silencePreset: state.audio.silencePreset,
          keepSegments: [],
          detectedSilenceSec: 0,
          detectingSilence: false,
        },
      };
    }

    case 'audio-error':
      return { ...state, audio: { ...state.audio, status: 'error', error: action.error } };

    case 'reset-audio':
      if (state.audio.url) URL.revokeObjectURL(state.audio.url);
      return { ...state, audio: INITIAL_STATE.audio, avatarClips: {} };

    case 'audio-silence-toggle':
      // Just flips the flag — the apply/revert side-effect lives in a UI
      // effect that calls the cut worker (or restores the original blob).
      // No-op when the value is unchanged so callers (e.g. the agent bridge)
      // can dispatch defensively without triggering re-renders.
      if (state.audio.silenceCut === action.on) return state;
      return { ...state, audio: { ...state.audio, silenceCut: action.on } };

    case 'audio-silence-preset': {
      // Switching preset invalidates current detection until rerun. No-op
      // when the preset hasn't actually changed — otherwise we'd needlessly
      // wipe keepSegments and force the cut effect to revert + re-detect +
      // re-apply, which the user sees as a flash on the timeline.
      if (state.audio.silencePreset === action.preset) return state;
      return {
        ...state,
        audio: {
          ...state.audio,
          silencePreset: action.preset,
          keepSegments: [],
          detectedSilenceSec: 0,
        },
      };
    }

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

    case 'audio-cuts-applying':
      return { ...state, audio: { ...state.audio, applyingCuts: true } };

    case 'audio-cuts-apply-done': {
      // Revoke the previous active object URL (might be the original).
      if (state.audio.url && state.audio.url !== action.url) {
        try { URL.revokeObjectURL(state.audio.url); } catch { /* noop */ }
      }
      return {
        ...state,
        blocks: action.blocks,
        audio: {
          ...state.audio,
          url: action.url,
          duration: action.duration,
          peaks: action.peaks,
          words: action.words,
          applyingCuts: false,
          cutsApplied: true,
          originalBlocks: action.originalBlocks,
          originalWords: action.originalWords,
          originalDuration: action.originalDuration,
          originalPeaks: action.originalPeaks,
        },
      };
    }

    case 'audio-cuts-revert': {
      // Restore the original audio + blocks. Caller has already created a
      // fresh object URL for the original blob and passes it in `url`.
      if (state.audio.url && state.audio.url !== action.url) {
        try { URL.revokeObjectURL(state.audio.url); } catch { /* noop */ }
      }
      return {
        ...state,
        blocks: state.audio.originalBlocks ?? state.blocks,
        audio: {
          ...state.audio,
          url: action.url,
          duration: state.audio.originalDuration ?? state.audio.duration,
          peaks: state.audio.originalPeaks ?? state.audio.peaks,
          words: state.audio.originalWords ?? state.audio.words,
          cutsApplied: false,
          applyingCuts: false,
          originalBlocks: undefined,
          originalWords: undefined,
          originalDuration: undefined,
          originalPeaks: undefined,
        },
      };
    }

    case 'audio-cuts-cancel': {
      // Used when an apply attempt fails before the new audio URL is ready —
      // simply clear the in-flight flag so the user isn't stuck on the
      // "aplicando cortes..." spinner. State otherwise unchanged.
      return {
        ...state,
        audio: { ...state.audio, applyingCuts: false },
      };
    }

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

    case 'set-base-video-offset-y':
      return state.baseVideoTake
        ? { ...state, baseVideoTake: { ...state.baseVideoTake, offsetY: action.offsetY } }
        : state;

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
