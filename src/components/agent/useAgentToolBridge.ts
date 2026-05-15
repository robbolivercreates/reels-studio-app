// Receives tool-call events from the Rust MCP server, translates them into
// reducer dispatches (and side-effectful service calls where needed), and
// replies back via the `agent_tool_result` command.
//
// Mounted once at the top of <ReelsStudio>. Caller passes the *latest*
// state/dispatch via refs so the listener stays subscribed across re-renders
// without thrashing.

import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  ReelsState,
  ReelsAction,
  BlockLayout,
  ScriptBlock,
  AttachedAsset,
} from '../reelsStudio/types';
import type { MotionConfig } from '../reelsStudio/motionLibrary';
import type { StylePresetId } from '../reelsStudio/motionStylePresets';
import { regenerateBlock, generateNewBlock } from '../../services/blockGeneratorService';
import { ensureProfiles } from '../reelsStudio/voiceProfile';
import {
  generateReelFromContent,
  fetchArticleFromUrl,
  type ReelStyle,
  type Framework,
  type DurationTarget,
} from '../../services/scriptFromContentService';
import { downloadVideo, readReferenceBytes, findReferenceByUrl } from '../reelsStudio/referenceVideoStore';
import { splitLongBlocks } from '../reelsStudio/scriptSplitter';
import { getMaxBlockSec } from './agentPrefs';
import { getCachedAnalysis, putCachedAnalysis, normalizeReelUrl } from './reelAnalysisCache';
import { analyseReferenceFromBytes } from '../../services/videoAnalysisService';
import { importScriptWithAI, importScriptHeuristic } from '../reelsStudio/scriptImporter';
import {
  generateCarouselScript,
  carouselSlidesToBlocks,
  type CarouselTone,
} from '../../services/carouselScriptService';
import { generateInstagramCaption } from '../../services/captionService';
import { uploadAvatarPhotoFromFile } from '../reelsStudio/avatarPhotosStore';
import type { ReelEmotion, AppTheme } from '../reelsStudio/types';
import { VOICE_OPTIONS } from '../reelsStudio/voices';
import {
  loadClonedVoices,
  saveClonedVoice,
  cloneVoiceFromAudio,
  type MinimaxCloneModel,
} from '../../services/minimaxService';

interface ToolCallEvent {
  call_id: string;
  action_type: string;
  payload: Record<string, unknown>;
}

interface BridgeRefs {
  state: ReelsState;
  dispatch: React.Dispatch<ReelsAction>;
  /** Called when the agent asks for `generate-audio`. */
  onGenerateAudio?: () => Promise<void> | void;
  /** Splits any block longer than the user's "Duração máxima do bloco" setting.
   *  Runs the same flow as the "Quebrar blocos longos" menu action — uses the
   *  generated audio's word timestamps to find natural pauses. */
  onSplitLongBlocks?: () => {
    error?: string;
    splitsApplied?: number;
    newBlockCount?: number;
  };
  /** Called when the agent asks for `generate-motion-for-block`. We pass
   *  the block id; ReelsStudio is responsible for running its own
   *  handleAutoMotion pipeline (Gemini + save). */
  onGenerateMotionForBlock?: (blockId: string) => Promise<void> | void;
  /** Render every motion in the project that's stale / missing MP4. */
  onRenderAllMotions?: () => Promise<void> | void;
  /** Batch motion: run the full pipeline for each id in sequence so only
   *  one Chromium spawns at a time. Returns aggregate result for the
   *  agent to report. */
  onGenerateMotionForBlocks?: (ids: string[]) => Promise<{
    ok: number;
    failed: number;
    failedIds: string[];
  }>;
  /** Generate HeyGen clips for all avatar blocks. mock=true uses the
   *  cheap synthetic-colour fallback. */
  onGenerateAvatarClips?: (mock: boolean) => Promise<void> | void;
  /** Apply (or display) a generated Instagram caption. The host component
   *  owns the captionText state + the modal that shows it. */
  onApplyCaption?: (caption: string, opts?: { openModal?: boolean }) => void;
}

// Tracks call_ids we've already sent a tool_result for, so we never
// double-reply (would confuse the Tauri-side MCP server) and so the
// finally-block fallback in the listener can detect "no reply yet".
const repliedCallIds = new Set<string>();

async function reply(callId: string, ok: boolean, value?: unknown, error?: string) {
  if (repliedCallIds.has(callId)) {
    console.warn('[agent] duplicate reply suppressed for', callId);
    return;
  }
  repliedCallIds.add(callId);
  try {
    await invoke('agent_tool_result', {
      callId,
      ok,
      value: value ?? null,
      error: error ?? null,
    });
  } catch (e) {
    console.error('[agent] failed to reply tool_result:', e);
  }
}

function hasReplied(callId: string): boolean {
  return repliedCallIds.has(callId);
}

function inferAssetType(path: string): 'image' | 'video' {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'mov', 'webm', 'mkv', 'm4v'].includes(ext)) return 'video';
  return 'image';
}

/// Parse a JSON string the agent passed (claude-mode passthrough) into a
/// validated array of avatar/broll blocks. Returns null when the string is
/// missing/invalid so the caller can fall back to Gemini.
function parsePassthroughBlocks(raw: unknown): { kind: 'avatar' | 'broll'; text: string }[] | null {
  if (!raw || typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const out: { kind: 'avatar' | 'broll'; text: string }[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const kind = e.kind === 'avatar' ? 'avatar' : e.kind === 'broll' ? 'broll' : null;
    const text = typeof e.text === 'string' ? e.text.trim() : '';
    if (!kind || !text) continue;
    out.push({ kind, text });
  }
  return out.length > 0 ? out : null;
}

/// Mints a fresh ScriptBlock from a {kind,text} pair. The reducer assigns
/// start/end timings once audio is generated, so 0/0 is a fine seed.
function blockFromPassthrough(b: { kind: 'avatar' | 'broll'; text: string }): ScriptBlock {
  return {
    id: `b_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`,
    kind: b.kind,
    text: b.text,
    start: 0,
    end: 0,
  };
}

function makeDraftId(): string {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/// Wraps a promise so it rejects after `ms` instead of hanging forever.
/// Used for tool steps that invoke long-running Tauri commands (yt-dlp,
/// Gemini Vision) — when those hang, the tool never replies, Claude
/// forgets the call_id, and the chat falls out of sync with the agent.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} expirou após ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/// Splits any long block according to the user's "Duração máxima do
/// bloco" setting (Settings → Agents → Avançado). Long avatar blocks
/// burn HeyGen budget; long broll blocks lose visual energy. We split
/// at the latest natural pause (sentence terminator, then comma)
/// before the cap. Imports go through this function uniformly — same
/// rule for video, article, recreate, carousel, and reanalyse.
function applyMaxBlockSec(blocks: ScriptBlock[]): ScriptBlock[] {
  const cap = getMaxBlockSec();
  if (cap == null) return blocks;
  const splits = splitLongBlocks(
    blocks.map(b => ({ kind: b.kind, text: b.text })),
    { maxSec: cap },
  );
  // Always rebuild — the splitter may also have flipped the
  // first/last kind (broll bookends rule) without changing the count,
  // so equal-length is NOT a reliable "nothing changed" signal.
  return splits.map(s => ({
    id: `b_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`,
    kind: s.kind,
    text: s.text,
    start: 0,
    end: 0,
    // Avatar blocks default to avatar-top layout — keeps the speaker
    // on top, broll/asset on bottom. broll blocks stay full-frame.
    layout: s.kind === 'avatar' ? ('avatar-top' as const) : undefined,
  }));
}

/// Surfaces a draft preview card in the agent chat instead of overwriting
/// the project blocks straight away. Returns `{ draftId, blocks }` — the
/// returned blocks are the (possibly split) final list, so callers
/// should save THOSE in `draftsRef`, not their pre-split copies.
///
/// When `sourceUrl` is provided, useAgentChat retires older unresolved
/// drafts of the same URL automatically (so re-importing the same reel
/// doesn't leave stale Apply buttons in the chat history).
function proposeDraftToChat(args: {
  blocks: ScriptBlock[];
  source: string;
  sourceUrl?: string;
  kind: 'reel' | 'carousel';
  meta?: string;
}): { draftId: string; blocks: ScriptBlock[] } {
  // Enforce the user's per-block cap before anything else sees the
  // list — both the preview card and the stored draftsRef get the
  // split version, so Apply produces the same blocks the user reviewed.
  const finalBlocks = applyMaxBlockSec(args.blocks);
  const draftId = makeDraftId();
  type ReelsAgentShim = {
    proposeDraft?: (draft: {
      draftId: string;
      source: string;
      sourceUrl?: string;
      kind: 'reel' | 'carousel';
      blocks: Array<{ kind: 'avatar' | 'broll'; text: string }>;
      meta?: string;
    }) => void;
  };
  const w = window as unknown as Window & { __reelsAgent?: ReelsAgentShim };
  w.__reelsAgent?.proposeDraft?.({
    draftId,
    source: args.source,
    sourceUrl: args.sourceUrl,
    kind: args.kind,
    meta: args.meta,
    blocks: finalBlocks.map(b => ({ kind: b.kind, text: b.text })),
  });
  return { draftId, blocks: finalBlocks };
}

export function useAgentToolBridge(refs: BridgeRefs): void {
  const latest = useRef(refs);
  latest.current = refs;

  // Drafts are imports waiting for the user to click Apply. Storing the
  // full ScriptBlock[] here (not in the chat message) keeps the chat
  // payload small and lets us dispatch replace-blocks atomically.
  const draftsRef = useRef<Map<string, {
    blocks: ScriptBlock[];
    setCarouselAspect?: boolean;
  }>>(new Map());

  // Install the apply/discard callbacks the AgentPanel calls when the
  // user clicks the buttons in a DraftCard.
  useEffect(() => {
    type ReelsAgentShim = {
      proposeDraft?: (draft: unknown) => void;
      applyDraft?: (id: string) => void;
      discardDraft?: (id: string) => void;
    };
    const w = window as unknown as Window & { __reelsAgent?: ReelsAgentShim };
    if (!w.__reelsAgent) w.__reelsAgent = {};
    w.__reelsAgent.applyDraft = (draftId: string) => {
      const entry = draftsRef.current.get(draftId);
      if (!entry) return;
      const { dispatch } = latest.current;
      dispatch({ type: 'replace-blocks', blocks: entry.blocks });
      if (entry.setCarouselAspect) {
        dispatch({ type: 'set-aspect', aspect: 'carousel' });
      }
      draftsRef.current.delete(draftId);
    };
    w.__reelsAgent.discardDraft = (draftId: string) => {
      draftsRef.current.delete(draftId);
    };
    return () => {
      if (w.__reelsAgent) {
        delete w.__reelsAgent.applyDraft;
        delete w.__reelsAgent.discardDraft;
      }
    };
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen<ToolCallEvent>('reels://tool-call', async (event) => {
        const { call_id, action_type, payload } = event.payload;
        const {
          state,
          dispatch,
          onGenerateAudio,
          onSplitLongBlocks,
          onGenerateMotionForBlock,
          onGenerateMotionForBlocks,
          onRenderAllMotions,
          onGenerateAvatarClips,
          onApplyCaption,
        } = latest.current;

        // Guard: every reels://tool-call must produce exactly one
        // agent_tool_result, or the MCP server hangs waiting for the
        // response (which then drops Claude's context for this call_id
        // and makes the chat hallucinate "I didn't import it" on the
        // next turn). `reply` dedupes by call_id globally; the finally
        // below sends a fallback if no handler path replied at all.

        try {
          switch (action_type) {
            case 'update-block-text': {
              const id = String(payload.id);
              const text = String(payload.text);
              const block = state.blocks.find(b => b.id === id);
              if (!block) {
                await reply(call_id, false, null, `Bloco '${id}' não encontrado.`);
                return;
              }
              dispatch({ type: 'update-block-text', id, text });
              await reply(call_id, true, { id, oldText: block.text, newText: text });
              return;
            }

            case 'regenerate-block': {
              const id = String(payload.id);
              const instruction = String(payload.instruction ?? '');
              const passthroughText = payload.text ? String(payload.text).trim() : '';
              const idx = state.blocks.findIndex(b => b.id === id);
              if (idx < 0) {
                await reply(call_id, false, null, `Bloco '${id}' não encontrado.`);
                return;
              }
              const block = state.blocks[idx];

              // Claude-mode passthrough: agent already wrote the text, just
              // apply it without burning a Gemini call.
              if (passthroughText) {
                dispatch({ type: 'update-block-text', id, text: passthroughText });
                await reply(call_id, true, {
                  id,
                  oldText: block.text,
                  newText: passthroughText,
                  kind: block.kind,
                  provider: 'claude',
                });
                return;
              }

              const prev = state.blocks[idx - 1];
              const next = state.blocks[idx + 1];
              const { profiles, activeId } = ensureProfiles();
              const profile = profiles.find(p => p.id === activeId);
              const updated = await regenerateBlock(
                block,
                { prev, next },
                profile,
                instruction,
              );
              dispatch({ type: 'update-block-text', id, text: updated.text });
              if (updated.kind !== block.kind) {
                dispatch({ type: 'toggle-block-kind', id });
              }
              await reply(call_id, true, {
                id,
                oldText: block.text,
                newText: updated.text,
                kind: updated.kind,
                provider: 'gemini',
              });
              return;
            }

            case 'add-block-ai': {
              const kindRaw = String(payload.kind ?? 'avatar');
              const kind: 'avatar' | 'broll' = kindRaw === 'broll' ? 'broll' : 'avatar';
              const prompt = String(payload.prompt ?? '');
              const passthroughText = payload.text ? String(payload.text).trim() : '';
              const afterId = payload.after_id ? String(payload.after_id) : null;
              const afterIdx = afterId
                ? state.blocks.findIndex(b => b.id === afterId)
                : state.blocks.length - 1;
              const prev = afterIdx >= 0 ? state.blocks[afterIdx] : undefined;
              const next = afterIdx >= 0 ? state.blocks[afterIdx + 1] : undefined;

              // Resolve the text: passthrough wins, else call Gemini.
              let finalKind: 'avatar' | 'broll' = kind;
              let finalText = passthroughText;
              let provider: 'gemini' | 'claude' = 'claude';
              if (!finalText) {
                const { profiles, activeId } = ensureProfiles();
                const profile = profiles.find(p => p.id === activeId);
                const created = await generateNewBlock(kind, prompt, { prev, next }, profile);
                finalText = created.text;
                finalKind = created.kind;
                provider = 'gemini';
              }

              // Insert empty block, then patch text/kind once the reducer
              // assigns its id.
              dispatch({ type: 'add-block', afterId: afterId ?? undefined });
              setTimeout(() => {
                const fresh = latest.current.state.blocks.find(
                  b => !b.text && b.id !== prev?.id && b.id !== next?.id,
                );
                if (fresh) {
                  latest.current.dispatch({ type: 'update-block-text', id: fresh.id, text: finalText });
                  if (finalKind !== fresh.kind) {
                    latest.current.dispatch({ type: 'toggle-block-kind', id: fresh.id });
                  }
                }
              }, 0);
              await reply(call_id, true, { kind: finalKind, text: finalText, provider });
              return;
            }

            case 'remove-block': {
              const id = String(payload.id);
              const block = state.blocks.find(b => b.id === id);
              if (!block) {
                await reply(call_id, false, null, `Bloco '${id}' não encontrado.`);
                return;
              }
              if (state.blocks.length <= 1) {
                await reply(call_id, false, null, 'Não posso remover o último bloco — o projeto precisa de pelo menos um.');
                return;
              }
              dispatch({ type: 'remove-block', id });
              await reply(call_id, true, { id, text: block.text });
              return;
            }

            case 'set-block-layout': {
              const id = String(payload.id);
              const layout = String(payload.layout) as BlockLayout;
              const valid: BlockLayout[] = ['avatar-only', 'media-only', 'avatar-top', 'media-top'];
              if (!valid.includes(layout)) {
                await reply(call_id, false, null, `Layout inválido: '${layout}'. Use um de ${valid.join(', ')}.`);
                return;
              }
              dispatch({ type: 'set-block-layout', id, layout });
              await reply(call_id, true, { id, layout });
              return;
            }

            case 'set-block-avatar-photo': {
              const id = String(payload.id);
              const photoId = payload.photo_id == null ? undefined : String(payload.photo_id);
              const block = state.blocks.find(b => b.id === id);
              if (!block) {
                await reply(call_id, false, null, `Bloco '${id}' não encontrado.`);
                return;
              }
              if (block.kind !== 'avatar') {
                await reply(call_id, false, null, `Bloco '${id}' não é do tipo avatar.`);
                return;
              }
              dispatch({ type: 'set-block-avatar-photo', id, photoId });
              await reply(call_id, true, { id, photo_id: photoId ?? null });
              return;
            }

            case 'set-block-kind': {
              const id = String(payload.id);
              const kindRaw = String(payload.kind ?? '');
              if (kindRaw !== 'avatar' && kindRaw !== 'broll') {
                await reply(call_id, false, null, `Kind inválido: '${kindRaw}'. Use 'avatar' ou 'broll'.`);
                return;
              }
              const block = state.blocks.find(b => b.id === id);
              if (!block) {
                await reply(call_id, false, null, `Bloco '${id}' não encontrado.`);
                return;
              }
              // toggle-block-kind is a flip (avatar↔broll). Only fire when
              // the requested kind differs from the current one — calling
              // it twice would undo our change.
              if (block.kind !== kindRaw) {
                dispatch({ type: 'toggle-block-kind', id });
              }
              await reply(call_id, true, { id, kind: kindRaw, changed: block.kind !== kindRaw });
              return;
            }

            case 'set-voice': {
              const voiceId = String(payload.voice_id);
              dispatch({ type: 'set-voice', voiceId });
              await reply(call_id, true, { voiceId });
              return;
            }

            case 'add-block-asset': {
              const blockId = String(payload.block_id);
              const assetPath = String(payload.asset_path);
              const block = state.blocks.find(b => b.id === blockId);
              if (!block) {
                await reply(call_id, false, null, `Bloco '${blockId}' não encontrado.`);
                return;
              }
              const type = String(payload.asset_type ?? '') === 'video' ||
                String(payload.asset_type ?? '') === 'image'
                  ? (String(payload.asset_type) as 'image' | 'video')
                  : inferAssetType(assetPath);
              const fileName = assetPath.split('/').pop() ?? assetPath;
              const asset: AttachedAsset = {
                path: assetPath,
                name: fileName,
                type,
              };
              dispatch({ type: 'add-block-asset', id: blockId, asset });
              await reply(call_id, true, { blockId, asset });
              return;
            }

            case 'split-long-blocks': {
              if (!onSplitLongBlocks) {
                await reply(call_id, false, null, 'Quebra de blocos longos não disponível no momento.');
                return;
              }
              const result = onSplitLongBlocks();
              if (result.error) {
                await reply(call_id, false, null, result.error);
                return;
              }
              await reply(call_id, true, {
                status: 'split-done',
                splitsApplied: result.splitsApplied,
                newBlockCount: result.newBlockCount,
              });
              return;
            }

            case 'remove-silences': {
              const preset = String(payload.preset ?? 'fast');
              if (!['natural', 'fast', 'super'].includes(preset)) {
                await reply(call_id, false, null, `Preset inválido: '${preset}'.`);
                return;
              }
              if (state.audio.status !== 'ready') {
                await reply(call_id, false, null, 'O áudio ainda não foi gerado. Chame generate_audio primeiro.');
                return;
              }
              // Idempotent: only dispatch when something actually changes.
              // Dispatching `audio-silence-preset` blindly clears `keepSegments`
              // while leaving `cutsApplied=true` — the cut effect then sees
              // `wantCut=false` (because no segments), reverts the audio,
              // detection re-runs, and the cut is re-applied. The user sees
              // the timeline flash empty/yellow during that round-trip.
              const presetTyped = preset as 'natural' | 'fast' | 'super';
              if (state.audio.silencePreset !== presetTyped) {
                dispatch({ type: 'audio-silence-preset', preset: presetTyped });
              }
              if (!state.audio.silenceCut) {
                dispatch({ type: 'audio-silence-toggle', on: true });
              }
              await reply(call_id, true, { preset, status: 'silence-cutting-armed' });
              return;
            }

            case 'generate-audio': {
              if (!onGenerateAudio) {
                await reply(call_id, false, null, 'Geração de áudio não disponível no momento.');
                return;
              }
              await onGenerateAudio();
              await reply(call_id, true, { status: 'audio-generation-started' });
              return;
            }

            case 'set-block-motion': {
              const id = String(payload.id);
              const block = state.blocks.find(b => b.id === id);
              if (!block) {
                await reply(call_id, false, null, `Bloco '${id}' não encontrado.`);
                return;
              }
              const motion = payload.motion as MotionConfig | undefined;
              dispatch({ type: 'set-block-motion', id, motion });
              await reply(call_id, true, { id, hasMotion: !!motion });
              return;
            }

            // ---- Wave 1: imports (create-from-source) ----

            case 'import-from-video-url': {
              const rawUrl = String(payload.url ?? '');
              if (!rawUrl) {
                await reply(call_id, false, null, 'URL vazia.');
                return;
              }
              const forceRedownload = !!payload.force_redownload;
              const canonicalUrl = normalizeReelUrl(rawUrl);
              const { profiles, activeId } = ensureProfiles();
              const profile = profiles.find(p => p.id === activeId);
              const profileId = profile?.id ?? null;
              const profileUpdatedAt = profile?.updatedAt ?? 0;

              // Did the agent already pass duration/tone/focus? If yes,
              // the user said "importa esse reel em 45s mais detalhado"
              // and we skip the setup card.
              const hasExplicitHints =
                payload.duration_sec != null ||
                payload.tone != null ||
                payload.focus != null;
              // Permanent "always skip" preference from Settings.
              const userAlwaysSkips =
                typeof window !== 'undefined' &&
                window.localStorage?.getItem('reels.agent.skipReelSetup') === 'true';

              // Hints we'll feed into the analyser. Start from explicit
              // payload values; the setup card (if shown) fills in the
              // rest below.
              let durationHint: number | null | undefined = payload.duration_sec != null
                ? Number(payload.duration_sec)
                : undefined;
              let toneHint = typeof payload.tone === 'string' ? payload.tone : undefined;
              let focusHint = typeof payload.focus === 'string' ? payload.focus : undefined;

              // Step 1 — pre-flight setup card. Runs BEFORE the cache
              // check, because different duration/tone/focus produces
              // different analyses — we don't want a 30s cache hit to
              // return when the user actually wants 45s. The cache key
              // below includes the chosen hints, so once the user
              // picks, future identical picks ARE cached.
              type SetupShim = {
                requestSetup?: (args: { title?: string; subtitle?: string }) => Promise<
                  | { kind: 'submit'; choice: { durationSec: number | null; tone: string; focus: string } }
                  | { kind: 'skip' }
                  | { kind: 'cancel' }
                >;
              };
              const w = window as unknown as Window & { __reelsAgent?: SetupShim };
              if (!hasExplicitHints && !userAlwaysSkips && w.__reelsAgent?.requestSetup) {
                const result = await w.__reelsAgent.requestSetup({
                  subtitle: canonicalUrl,
                });
                if (result.kind === 'cancel') {
                  await reply(call_id, false, null, 'Usuário cancelou antes da geração.');
                  return;
                }
                if (result.kind === 'submit') {
                  durationHint = result.choice.durationSec;
                  toneHint = result.choice.tone;
                  focusHint = result.choice.focus;
                }
                // 'skip' → leave hints undefined (analyser defaults).
              }

              // Cache key includes the chosen hints so swapping duration
              // (or tone, or focus) skips the cache and forces a fresh
              // analysis. Profile id+updatedAt cover voice-profile edits.
              const hintsKey = `d:${durationHint ?? 'orig'}|t:${toneHint ?? 'orig'}|f:${focusHint ?? 'adapt'}`;
              const cacheProfileKey = `${profileId ?? 'none'}|${profileUpdatedAt}|${hintsKey}`;

              // Step 2 — try the IndexedDB analysis cache for this
              // exact (url, profile, hints) combo.
              let blocks: ScriptBlock[];
              let language: string | undefined;
              let tone: string[] | undefined;
              let fileName: string;
              let cacheHit = false;
              const cached = forceRedownload
                ? null
                : await getCachedAnalysis(canonicalUrl, cacheProfileKey, profileUpdatedAt);

              if (cached) {
                console.warn('[import-from-video-url] cache HIT', canonicalUrl, hintsKey);
                blocks = cached.blocks;
                language = cached.language;
                tone = cached.tone;
                const ref = await findReferenceByUrl(canonicalUrl);
                fileName = ref?.fileName ?? `cached: ${canonicalUrl}`;
                cacheHit = true;
              } else {
                // Step 3 — see if the video file is already on disk
                // (Rust References folder is keyed by source_url). Skips
                // yt-dlp when the user pasted the same reel twice but
                // the new hints triggered a cache miss.
                console.warn('[import-from-video-url] start', canonicalUrl, forceRedownload ? '(forced)' : '', { durationHint, toneHint, focusHint });
                let meta;
                const existing = forceRedownload ? null : await findReferenceByUrl(canonicalUrl);
                if (existing) {
                  console.warn('[import-from-video-url] reusing downloaded ref', existing.fileName);
                  meta = existing;
                } else {
                  meta = await withTimeout(downloadVideo(rawUrl), 180_000, 'Download do vídeo');
                  console.warn('[import-from-video-url] downloaded', meta.fileName);
                }

                // Step 4 — read bytes + analyse with Gemini. Hints flow
                // in through the analyser's `extraInstructions` field.
                const bytes = await withTimeout(readReferenceBytes(meta.fileName), 30_000, 'Leitura do vídeo');
                const instructionParts: string[] = [];
                if (durationHint != null) instructionParts.push(`Duração alvo: ${durationHint}s.`);
                if (toneHint && toneHint !== 'original') instructionParts.push(`Tom: ${toneHint}.`);
                if (focusHint && focusHint !== 'adapt') {
                  instructionParts.push(
                    focusHint === 'summarize' ? 'Resuma o conteúdo.' : focusHint === 'detail' ? 'Adicione mais detalhes.' : '',
                  );
                }
                const extraInstruction = instructionParts.filter(Boolean).join(' ') || undefined;
                const regen = extraInstruction ? { extraInstructions: extraInstruction } : undefined;
                const result = await withTimeout(
                  analyseReferenceFromBytes(bytes, undefined, profile, regen),
                  180_000,
                  'Análise do vídeo',
                );
                console.warn('[import-from-video-url] analysed', result.blocks.length, 'blocks');
                blocks = result.blocks;
                language = result.language;
                tone = result.tone;
                fileName = meta.fileName;

                // Persist for next time.
                await putCachedAnalysis({
                  sourceUrl: canonicalUrl,
                  profileId: cacheProfileKey,
                  profileUpdatedAt,
                  blocks,
                  language,
                  tone,
                  analyzedAt: Date.now(),
                });
              }

              // Step 4 — surface as a draft. The user reviews + iterates
              // ("o bloco 3 está mole, deixa mais agressivo") via the
              // regen_draft_block tool — edits stay scoped to the draft
              // until Apply.
              const metaLabel = cacheHit
                ? `${language ?? 'PT-BR'} · ${blocks.length} blocos · cache`
                : `${language ?? 'PT-BR'} · ${blocks.length} blocos`;
              const { draftId, blocks: finalBlocks } = proposeDraftToChat({
                blocks,
                source: fileName,
                sourceUrl: canonicalUrl,
                kind: 'reel',
                meta: metaLabel,
              });
              draftsRef.current.set(draftId, { blocks: finalBlocks });
              await reply(call_id, true, {
                source: fileName,
                blocks: finalBlocks.length,
                language,
                tone,
                cached: cacheHit,
                draft_id: draftId,
                status: 'pending-user-approval',
              });
              return;
            }

            case 'import-from-article': {
              // Claude-mode passthrough: agent already wrote the blocks.
              const passthrough = parsePassthroughBlocks(payload.blocks_json);
              if (passthrough) {
                const blocks = passthrough.map(blockFromPassthrough);
                const articleUrl = payload.url ? String(payload.url) : undefined;
                const { draftId, blocks: finalBlocks } = proposeDraftToChat({
                  blocks,
                  source: articleUrl ?? 'artigo',
                  sourceUrl: articleUrl,
                  kind: 'reel',
                  meta: `${blocks.length} blocos · Claude`,
                });
                draftsRef.current.set(draftId, { blocks: finalBlocks });
                await reply(call_id, true, {
                  blocks: finalBlocks.length,
                  provider: 'claude',
                  draft_id: draftId,
                  status: 'pending-user-approval',
                });
                return;
              }
              const url = payload.url ? String(payload.url) : null;
              const pastedText = payload.text ? String(payload.text) : null;
              if (!url && !pastedText) {
                await reply(call_id, false, null, 'Forneça `url`, `text` ou `blocks_json`.');
                return;
              }
              let text = pastedText ?? '';
              let title = payload.title ? String(payload.title) : undefined;
              let sourceUrl: string | undefined;
              if (!pastedText && url) {
                const fetched = await fetchArticleFromUrl(url);
                text = fetched.text;
                title = title ?? fetched.title;
                sourceUrl = fetched.sourceUrl;
              }
              const { profiles, activeId } = ensureProfiles();
              const profile = profiles.find(p => p.id === activeId);
              const durationSec = Number(payload.duration_sec ?? 30) as DurationTarget;
              const style = (payload.style ? String(payload.style) : 'viral') as ReelStyle;
              const framework = (payload.framework ? String(payload.framework) : 'auto') as Framework;
              const extraInstructions = String(payload.instruction ?? '');
              const generated = await generateReelFromContent(
                { text, title, sourceUrl },
                { style, framework, durationSec, voiceProfile: profile, extraInstructions },
              );
              const { draftId, blocks: finalBlocks } = proposeDraftToChat({
                blocks: generated.blocks,
                source: title ?? url ?? 'artigo',
                sourceUrl: sourceUrl ?? url ?? undefined,
                kind: 'reel',
                meta: `${generated.blocks.length} blocos · ${generated.frameworkUsed}`,
              });
              draftsRef.current.set(draftId, { blocks: finalBlocks });
              await reply(call_id, true, {
                blocks: finalBlocks.length,
                framework: generated.frameworkUsed,
                caption: generated.caption,
                hashtags: generated.hashtags,
                provider: 'gemini',
                draft_id: draftId,
                status: 'pending-user-approval',
              });
              return;
            }

            case 'import-from-script': {
              // Claude-mode passthrough beats every other path.
              const passthrough = parsePassthroughBlocks(payload.blocks_json);
              if (passthrough) {
                const blocks = passthrough.map(blockFromPassthrough);
                dispatch({ type: 'replace-blocks', blocks });
                await reply(call_id, true, { blocks: blocks.length, provider: 'claude' });
                return;
              }
              const text = String(payload.text ?? '').trim();
              if (!text) {
                await reply(call_id, false, null, 'Texto vazio (ou passe blocks_json).');
                return;
              }
              const heuristicOnly = !!payload.heuristic_only;
              const blocks = heuristicOnly
                ? importScriptHeuristic(text)
                : await importScriptWithAI(text);
              dispatch({ type: 'replace-blocks', blocks });
              await reply(call_id, true, {
                blocks: blocks.length,
                heuristic: heuristicOnly,
                provider: heuristicOnly ? 'heuristic' : 'gemini',
              });
              return;
            }

            case 'recreate-full-script': {
              const instruction = String(payload.instruction ?? '').trim();
              // Claude-mode passthrough.
              const passthrough = parsePassthroughBlocks(payload.blocks_json);
              if (passthrough) {
                const blocks = passthrough.map(blockFromPassthrough);
                const { draftId, blocks: finalBlocks } = proposeDraftToChat({
                  blocks,
                  source: instruction || 'reescrita',
                  kind: 'reel',
                  meta: `${blocks.length} blocos · Claude`,
                });
                draftsRef.current.set(draftId, { blocks: finalBlocks });
                await reply(call_id, true, {
                  blocks: finalBlocks.length,
                  provider: 'claude',
                  draft_id: draftId,
                  status: 'pending-user-approval',
                });
                return;
              }
              if (!instruction) {
                await reply(call_id, false, null, 'Instrução vazia (ou passe blocks_json).');
                return;
              }
              // Gemini path.
              const currentText = state.blocks.map(b => `[${b.kind}] ${b.text}`).join('\n');
              if (!currentText.trim()) {
                await reply(call_id, false, null, 'O projeto está vazio — nada pra reescrever.');
                return;
              }
              const { profiles, activeId } = ensureProfiles();
              const profile = profiles.find(p => p.id === activeId);
              const generated = await generateReelFromContent(
                { text: currentText, title: state.projectName || undefined },
                {
                  style: 'viral',
                  framework: 'auto',
                  durationSec: 30,
                  voiceProfile: profile,
                  extraInstructions: instruction,
                },
              );
              const { draftId, blocks: finalBlocks } = proposeDraftToChat({
                blocks: generated.blocks,
                source: instruction,
                kind: 'reel',
                meta: `${generated.blocks.length} blocos · ${generated.frameworkUsed}`,
              });
              draftsRef.current.set(draftId, { blocks: finalBlocks });
              await reply(call_id, true, {
                blocks: finalBlocks.length,
                instruction,
                provider: 'gemini',
                draft_id: draftId,
                status: 'pending-user-approval',
              });
              return;
            }

            case 'generate-carousel': {
              // Claude-mode passthrough: slides_json carries the pre-written
              // slides as `[{text, role?, visualHint?}, ...]`.
              const rawSlides = payload.slides_json;
              if (rawSlides && typeof rawSlides === 'string') {
                try {
                  const parsed = JSON.parse(rawSlides) as unknown;
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    type SlideShape = { text?: unknown; role?: unknown; visualHint?: unknown };
                    // The carouselScriptService's `CarouselSlide` shape uses
                    // role: 'cover' | 'body' | 'cta'. Map free-form roles
                    // from the agent to this trio: the first slide is the
                    // cover, anything labeled cta/closing is the CTA,
                    // everything else is body. Keeps downstream rendering
                    // consistent with the Gemini path.
                    const items = parsed
                      .filter((s): s is SlideShape => !!s && typeof s === 'object')
                      .map(s => {
                        const sh = s as SlideShape;
                        return {
                          text: typeof sh.text === 'string' ? sh.text.trim() : '',
                          rawRole: typeof sh.role === 'string' ? sh.role.toLowerCase() : '',
                          visualHint: typeof sh.visualHint === 'string' ? sh.visualHint : '',
                        };
                      })
                      .filter(s => s.text.length > 0);

                    if (items.length > 0) {
                      const slides = items.map((s, idx) => {
                        let role: 'cover' | 'body' | 'cta';
                        if (idx === 0) role = 'cover';
                        else if (s.rawRole === 'cta' || s.rawRole === 'closing') role = 'cta';
                        else role = 'body';
                        return {
                          slideNumber: idx + 1,
                          role,
                          text: s.text,
                          visualHint: s.visualHint,
                        };
                      });
                      const blocks = carouselSlidesToBlocks(slides);
                      const { draftId, blocks: finalBlocks } = proposeDraftToChat({
                        blocks,
                        source: String(payload.topic ?? 'carrossel'),
                        kind: 'carousel',
                        meta: `${slides.length} slides · Claude`,
                      });
                      draftsRef.current.set(draftId, { blocks: finalBlocks, setCarouselAspect: true });
                      await reply(call_id, true, {
                        slides: slides.length,
                        provider: 'claude',
                        draft_id: draftId,
                        status: 'pending-user-approval',
                      });
                      return;
                    }
                  }
                } catch {
                  // Invalid JSON — fall through to Gemini path.
                }
              }

              const topic = String(payload.topic ?? '').trim();
              if (!topic) {
                await reply(call_id, false, null, 'Tópico vazio (ou passe slides_json).');
                return;
              }
              const numSlides = Math.max(3, Math.min(15, Number(payload.num_slides ?? 7)));
              const tone = String(payload.tone ?? 'educativo') as CarouselTone;
              const carousel = await generateCarouselScript(topic, numSlides, tone);
              const blocks = carouselSlidesToBlocks(carousel.slides);
              const { draftId, blocks: finalBlocks } = proposeDraftToChat({
                blocks,
                source: topic,
                kind: 'carousel',
                meta: `${carousel.slides.length} slides · ${tone}`,
              });
              draftsRef.current.set(draftId, { blocks: finalBlocks, setCarouselAspect: true });
              await reply(call_id, true, {
                slides: carousel.slides.length,
                theme: carousel.theme,
                provider: 'gemini',
                draft_id: draftId,
                status: 'pending-user-approval',
              });
              return;
            }

            // ---- Wave 2: visual tools ----

            case 'apply-style-preset': {
              const id = String(payload.id);
              const preset = String(payload.preset_id) as StylePresetId;
              const block = state.blocks.find(b => b.id === id);
              if (!block) {
                await reply(call_id, false, null, `Bloco '${id}' não encontrado.`);
                return;
              }
              dispatch({ type: 'set-block-style-preset', id, preset });
              await reply(call_id, true, { id, preset });
              return;
            }

            case 'apply-style-preset-cascade': {
              const id = String(payload.id);
              const preset = String(payload.preset_id) as StylePresetId;
              const block = state.blocks.find(b => b.id === id);
              if (!block) {
                await reply(call_id, false, null, `Bloco '${id}' não encontrado.`);
                return;
              }
              dispatch({ type: 'set-block-style-preset-cascade', id, preset });
              await reply(call_id, true, { id, preset, cascade: true });
              return;
            }

            case 'generate-motion-for-block': {
              const id = String(payload.id);
              const block = state.blocks.find(b => b.id === id);
              if (!block) {
                await reply(call_id, false, null, `Bloco '${id}' não encontrado.`);
                return;
              }
              const presetId = payload.preset_id
                ? (String(payload.preset_id) as StylePresetId)
                : undefined;
              if (presetId) {
                dispatch({ type: 'set-block-style-preset', id, preset: presetId });
              }

              // Claude-mode passthrough: agent hand-authored the HTML and
              // we skip the Gemini Pro pipeline entirely. Save the HTML
              // straight into the block's motion config and mark it as
              // pending render (videoPath empty + generatedAt fresh, which
              // motionLibrary.ts treats as "needs render").
              const passthroughHtml = payload.html ? String(payload.html).trim() : '';
              if (passthroughHtml) {
                const existing = block.motion;
                const presetForMotion = (presetId ?? existing?.presetId ?? 'glass-tech') as StylePresetId;
                const intent = String(payload.intent ?? existing?.intent ?? '').trim();
                // Use existing composition id if there is one so timeline
                // registry references stay consistent; otherwise mint one.
                const compositionId =
                  existing?.id ?? `motion-${Math.random().toString(36).slice(2, 10)}`;
                const durationSec =
                  existing?.durationSec ??
                  Math.max(2, (block.end ?? 0) - (block.start ?? 0) || 4);
                const now = Date.now();
                const motion: MotionConfig = {
                  id: compositionId,
                  presetId: presetForMotion,
                  layer: existing?.layer ?? 'replace',
                  intent,
                  text: existing?.text ?? block.text,
                  durationSec,
                  status: 'draft',
                  html: passthroughHtml,
                  generatedAt: now,
                  createdAt: existing?.createdAt ?? now,
                  videoPath: undefined,
                  canvasAspect: existing?.canvasAspect ?? '9:16',
                };
                dispatch({ type: 'set-block-motion', id, motion });
                console.log(
                  '%c[motion] block ' + id + ' · provider=CLAUDE (passthrough html, no Gemini call)',
                  'color: #c084fc; font-weight: bold',
                );
                await reply(call_id, true, {
                  id,
                  preset: presetForMotion,
                  provider: 'claude',
                  status: 'pending-render',
                });
                return;
              }

              if (!onGenerateMotionForBlock) {
                await reply(
                  call_id,
                  false,
                  null,
                  'Pipeline de motion não está disponível no momento.',
                );
                return;
              }
              console.log(
                '%c[motion] block ' + id + ' · provider=GEMINI (calling generateMotionHtml)',
                'color: #fbbf24; font-weight: bold',
              );
              await onGenerateMotionForBlock(id);
              await reply(call_id, true, {
                id,
                preset: presetId,
                provider: 'gemini',
                status: 'motion-generation-started',
              });
              return;
            }

            case 'generate-motion-for-blocks': {
              // Resolve target ids from explicit list or filter.
              const explicitIds = Array.isArray(payload.ids)
                ? (payload.ids as unknown[]).map(x => String(x)).filter(Boolean)
                : null;
              const filter = String(payload.filter ?? 'missing');
              let targetIds: string[] = [];
              if (explicitIds && explicitIds.length > 0) {
                // Validate ids exist in current state.
                targetIds = explicitIds.filter(id => state.blocks.some(b => b.id === id));
              } else {
                targetIds = state.blocks
                  .filter(b => {
                    if (filter === 'broll') return b.kind === 'broll';
                    if (filter === 'avatar') return b.kind === 'avatar';
                    if (filter === 'all') return true;
                    // 'missing' — only blocks without a generated motion yet.
                    return !b.motion?.html;
                  })
                  .map(b => b.id);
              }

              if (targetIds.length === 0) {
                await reply(call_id, true, {
                  ok: 0,
                  failed: 0,
                  skipped: 'no-matching-blocks',
                });
                return;
              }

              // Optional preset: apply to every target before running.
              const presetId = payload.preset_id
                ? (String(payload.preset_id) as StylePresetId)
                : undefined;
              if (presetId) {
                for (const id of targetIds) {
                  dispatch({ type: 'set-block-style-preset', id, preset: presetId });
                }
              }

              // Claude-mode passthrough map: when html_by_id is provided,
              // pre-write each block's motion HTML so the batch loop skips
              // Gemini for those blocks (handleAutoMotionMany will see
              // motion.html already set and call handleRenderMotionMp4).
              const htmlByIdRaw = payload.html_by_id;
              const claudeBlocks: string[] = [];
              if (htmlByIdRaw && typeof htmlByIdRaw === 'string') {
                try {
                  const parsed = JSON.parse(htmlByIdRaw) as Record<string, unknown>;
                  if (parsed && typeof parsed === 'object') {
                    const now = Date.now();
                    const intent = String(payload.intent ?? '').trim();
                    for (const [bid, htmlVal] of Object.entries(parsed)) {
                      if (!targetIds.includes(bid)) continue;
                      const block = state.blocks.find(b => b.id === bid);
                      if (!block) continue;
                      const html = String(htmlVal ?? '').trim();
                      if (!html) continue;
                      const existing = block.motion;
                      const motion: MotionConfig = {
                        id: existing?.id ?? `motion-${Math.random().toString(36).slice(2, 10)}`,
                        presetId: (presetId ?? existing?.presetId ?? 'glass-tech') as StylePresetId,
                        layer: existing?.layer ?? 'replace',
                        intent: intent || existing?.intent || '',
                        text: existing?.text ?? block.text,
                        durationSec: existing?.durationSec ?? Math.max(2, (block.end ?? 0) - (block.start ?? 0) || 4),
                        status: 'draft',
                        html,
                        generatedAt: now,
                        createdAt: existing?.createdAt ?? now,
                        videoPath: undefined,
                        canvasAspect: existing?.canvasAspect ?? '9:16',
                      };
                      dispatch({ type: 'set-block-motion', id: bid, motion });
                      claudeBlocks.push(bid);
                    }
                  }
                } catch {
                  // Ignore malformed json — fall through to Gemini for all.
                }
              }

              if (!onGenerateMotionForBlocks) {
                await reply(call_id, false, null, 'Pipeline batch de motion não disponível.');
                return;
              }
              const geminiBlocks = targetIds.filter(id => !claudeBlocks.includes(id));
              console.log(
                '%c[motion batch] ' + targetIds.length + ' blocks · CLAUDE: ' +
                  claudeBlocks.length + ' · GEMINI: ' + geminiBlocks.length,
                'color: #c084fc; font-weight: bold; font-size: 13px',
              );
              if (claudeBlocks.length > 0) {
                console.log('%c  ↳ CLAUDE blocks: ' + claudeBlocks.join(', '), 'color: #c084fc');
              }
              if (geminiBlocks.length > 0) {
                console.log('%c  ↳ GEMINI blocks: ' + geminiBlocks.join(', '), 'color: #fbbf24');
              }
              const result = await onGenerateMotionForBlocks(targetIds);
              await reply(call_id, true, {
                count: targetIds.length,
                ok: result.ok,
                failed: result.failed,
                failed_ids: result.failedIds,
                filter,
                preset: presetId,
              });
              return;
            }

            case 'render-motions': {
              if (!onRenderAllMotions) {
                await reply(call_id, false, null, 'Renderização de motions não está disponível.');
                return;
              }
              await onRenderAllMotions();
              await reply(call_id, true, { status: 'render-started' });
              return;
            }

            case 'upload-avatar-photo': {
              const imagePath = String(payload.image_path ?? '').trim();
              const explicitName = payload.name ? String(payload.name).trim() : '';
              if (!imagePath) {
                await reply(call_id, false, null, 'image_path vazio.');
                return;
              }
              // Default name = filename without extension.
              const defaultName = (() => {
                const base = imagePath.split('/').pop() ?? imagePath;
                return base.replace(/\.[^.]+$/, '') || base;
              })();
              const photoName = explicitName || defaultName;
              try {
                // 1) Read bytes from disk via the existing helper (validates
                // it's a regular file and caps at 50MB; HeyGen's own 5MB
                // limit is enforced by the upload endpoint).
                const b64 = await invoke<string>('agent_read_file_b64', { path: imagePath });
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const ext = imagePath.split('.').pop()?.toLowerCase() ?? '';
                const mime =
                  ext === 'png' ? 'image/png'
                  : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                  : ext === 'webp' ? 'image/webp'
                  : 'image/jpeg';
                if (mime !== 'image/jpeg' && mime !== 'image/png') {
                  await reply(
                    call_id,
                    false,
                    null,
                    `Formato '${ext}' não suportado pelo HeyGen. Use JPG ou PNG.`,
                  );
                  return;
                }
                const blob = new Blob([bytes], { type: mime });
                const file = new File([blob], `${photoName}.${ext || 'jpg'}`, { type: mime });

                // 2) Upload to HeyGen + persist locally.
                const photo = await uploadAvatarPhotoFromFile(file, photoName);

                // 3) Auto-select the new photo so the agent can immediately
                // call generate_avatar_clips without an extra step.
                dispatch({ type: 'set-photo', photoId: photo.id });

                await reply(call_id, true, {
                  photo_id: photo.id,
                  name: photo.name,
                  talking_photo_id: photo.talkingPhotoId,
                  auto_selected: true,
                });
              } catch (e) {
                await reply(call_id, false, null, e instanceof Error ? e.message : String(e));
              }
              return;
            }

            case 'list-avatar-photos': {
              // Read avatar photos from localStorage and return a slim list
              // for the agent (the full base64 thumbnails go through the
              // picker event separately, so we keep this payload small).
              try {
                const raw = localStorage.getItem('reel_avatar_photos_v1') ?? '[]';
                const parsed = JSON.parse(raw) as Array<{
                  id?: string;
                  name?: string;
                  talkingPhotoId?: string;
                  thumbnailBase64?: string;
                  previewUrl?: string;
                }>;
                const photos = (Array.isArray(parsed) ? parsed : [])
                  .filter(p => p && p.id)
                  .map(p => ({
                    id: p.id!,
                    name: p.name ?? 'Sem nome',
                    is_talking_id: !!p.talkingPhotoId,
                    thumbnail: p.thumbnailBase64
                      ? p.thumbnailBase64.startsWith('data:')
                        ? p.thumbnailBase64
                        : `data:image/jpeg;base64,${p.thumbnailBase64}`
                      : p.previewUrl,
                  }));
                await reply(call_id, true, { photos, count: photos.length });
              } catch (e) {
                await reply(call_id, false, null, e instanceof Error ? e.message : String(e));
              }
              return;
            }

            case 'set-avatar-photo': {
              const photoId = String(payload.photo_id ?? '');
              if (!photoId) {
                await reply(call_id, false, null, 'photo_id vazio.');
                return;
              }
              dispatch({ type: 'set-photo', photoId });
              await reply(call_id, true, { photoId });
              return;
            }

            case 'set-avatar-model': {
              const m = String(payload.model ?? '');
              if (m !== 'avatar3' && m !== 'avatar4' && m !== 'avatar5') {
                await reply(call_id, false, null, `Modelo inválido: '${m}'. Use 'avatar3', 'avatar4' ou 'avatar5'.`);
                return;
              }
              dispatch({ type: 'set-avatar-model', model: m });
              await reply(call_id, true, { model: m });
              return;
            }

            // ---- Wave 3: voice tools ----

            case 'list-voices': {
              const builtin = VOICE_OPTIONS.map(v => ({
                id: v.id,
                name: v.label,
                kind: 'builtin' as const,
                description: v.hint ?? null,
              }));
              const cloned = loadClonedVoices().map(c => ({
                id: c.voiceId,
                name: c.name,
                kind: 'cloned' as const,
                description: `Clonada · ${c.model}`,
              }));
              const voices = [...builtin, ...cloned];
              await reply(call_id, true, { voices, count: voices.length });
              return;
            }

            case 'set-voice-speed': {
              const raw = Number(payload.speed);
              if (!Number.isFinite(raw)) {
                await reply(call_id, false, null, 'Velocidade inválida.');
                return;
              }
              const speed = Math.max(0.5, Math.min(2.0, raw));
              dispatch({ type: 'set-voice-speed', speed });
              await reply(call_id, true, { speed });
              return;
            }

            case 'clone-voice-from-audio': {
              const path = String(payload.audio_path ?? '').trim();
              const name = String(payload.name ?? '').trim();
              const model = (String(payload.model ?? 'speech-02-hd')) as MinimaxCloneModel;
              if (!path) {
                await reply(call_id, false, null, 'audio_path vazio.');
                return;
              }
              if (!name) {
                await reply(call_id, false, null, 'name vazio.');
                return;
              }
              try {
                // Read bytes from disk via the Tauri command and turn them
                // into a Blob so cloneVoiceFromAudio can upload to fal.ai.
                const b64 = await invoke<string>('agent_read_file_b64', { path });
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                // Best-guess MIME from extension; fal.ai is permissive.
                const ext = path.split('.').pop()?.toLowerCase() ?? '';
                const mime =
                  ext === 'mp3' ? 'audio/mpeg'
                  : ext === 'm4a' ? 'audio/m4a'
                  : ext === 'wav' ? 'audio/wav'
                  : ext === 'ogg' ? 'audio/ogg'
                  : 'audio/mpeg';
                const blob = new Blob([bytes], { type: mime });

                const { voiceId, previewUrl } = await cloneVoiceFromAudio(blob, name, { model });

                // Persist locally so the user sees it in the voice picker.
                const localId = `clone_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                const sevenDays = 7 * 24 * 60 * 60 * 1000;
                saveClonedVoice({
                  id: localId,
                  name,
                  voiceId,
                  previewUrl,
                  model,
                  createdAt: Date.now(),
                  expiresAt: Date.now() + sevenDays,
                  lastUsedAt: Date.now(),
                });
                await reply(call_id, true, { voiceId, name, model, previewUrl });
              } catch (e) {
                await reply(call_id, false, null, e instanceof Error ? e.message : String(e));
              }
              return;
            }

            // ---- Wave 3: assets + references ----

            case 'list-assets': {
              try {
                const assets = await invoke<Array<{
                  name: string;
                  path: string;
                  size: number;
                  type?: string;
                }>>('list_project_assets', { projectName: state.projectName });
                const out = (assets ?? []).map(a => ({
                  name: a.name,
                  path: a.path,
                  size: a.size,
                  type: a.type ?? (
                    /\.(mp4|mov|webm|mkv|m4v)$/i.test(a.path) ? 'video' : 'image'
                  ),
                }));
                await reply(call_id, true, { assets: out, count: out.length });
              } catch (e) {
                await reply(call_id, false, null, e instanceof Error ? e.message : String(e));
              }
              return;
            }

            case 'list-references': {
              try {
                const refs = await invoke<Array<{
                  fileName: string;
                  sizeBytes: number;
                  createdAt: number;
                }>>('list_references');
                await reply(call_id, true, { references: refs ?? [], count: (refs ?? []).length });
              } catch (e) {
                await reply(call_id, false, null, e instanceof Error ? e.message : String(e));
              }
              return;
            }

            case 'delete-reference': {
              const fileName = String(payload.file_name ?? '').trim();
              if (!fileName) {
                await reply(call_id, false, null, 'file_name vazio.');
                return;
              }
              try {
                await invoke('delete_reference', { fileName });
                await reply(call_id, true, { fileName, deleted: true });
              } catch (e) {
                await reply(call_id, false, null, e instanceof Error ? e.message : String(e));
              }
              return;
            }

            case 'regenerate-draft-block': {
              const draftId = String(payload.draft_id ?? '').trim();
              const idx = Number(payload.block_index);
              const instruction = String(payload.instruction ?? '').trim();
              const passthroughText = payload.text ? String(payload.text).trim() : '';
              if (!draftId) {
                await reply(call_id, false, null, 'draft_id vazio.');
                return;
              }
              const entry = draftsRef.current.get(draftId);
              if (!entry) {
                await reply(
                  call_id,
                  false,
                  null,
                  `Draft '${draftId}' não encontrado (talvez já tenha sido aplicado ou descartado).`,
                );
                return;
              }
              if (!Number.isFinite(idx) || idx < 0 || idx >= entry.blocks.length) {
                await reply(call_id, false, null, `Index ${idx} fora dos blocos do draft (${entry.blocks.length}).`);
                return;
              }
              const target = entry.blocks[idx];

              let newText = passthroughText;
              let provider: 'gemini' | 'claude' = 'claude';
              if (!newText) {
                // Gemini path: feed regenerateBlock the draft's neighbours
                // so flow stays coherent within the draft.
                const prev = entry.blocks[idx - 1];
                const next = entry.blocks[idx + 1];
                const { profiles, activeId } = ensureProfiles();
                const profile = profiles.find(p => p.id === activeId);
                const result = await regenerateBlock(
                  target,
                  { prev, next },
                  profile,
                  instruction,
                );
                newText = result.text;
                provider = 'gemini';
              }

              // Update the in-memory draft.
              const nextBlocks = entry.blocks.slice();
              nextBlocks[idx] = { ...target, text: newText };
              draftsRef.current.set(draftId, { ...entry, blocks: nextBlocks });

              // Tell the chat to live-update the DraftCard.
              type ReelsAgentShim = {
                updateDraft?: (
                  id: string,
                  mutator: (
                    blocks: Array<{ kind: 'avatar' | 'broll'; text: string }>,
                  ) => Array<{ kind: 'avatar' | 'broll'; text: string }>,
                ) => void;
              };
              const w = window as unknown as Window & { __reelsAgent?: ReelsAgentShim };
              w.__reelsAgent?.updateDraft?.(draftId, blocks => {
                const out = blocks.slice();
                if (idx < out.length) out[idx] = { kind: out[idx].kind, text: newText };
                return out;
              });

              await reply(call_id, true, {
                draft_id: draftId,
                block_index: idx,
                old_text: target.text,
                new_text: newText,
                provider,
              });
              return;
            }

            case 'replace-draft-block': {
              const draftId = String(payload.draft_id ?? '').trim();
              const idx = Number(payload.block_index);
              const text = String(payload.text ?? '').trim();
              const kindRaw = payload.kind ? String(payload.kind) : null;
              if (!draftId || !text) {
                await reply(call_id, false, null, 'draft_id ou text vazio.');
                return;
              }
              const entry = draftsRef.current.get(draftId);
              if (!entry) {
                await reply(call_id, false, null, `Draft '${draftId}' não encontrado.`);
                return;
              }
              if (!Number.isFinite(idx) || idx < 0 || idx >= entry.blocks.length) {
                await reply(call_id, false, null, `Index ${idx} fora dos blocos do draft.`);
                return;
              }
              const target = entry.blocks[idx];
              const nextKind: 'avatar' | 'broll' =
                kindRaw === 'avatar' || kindRaw === 'broll' ? kindRaw : target.kind;
              const nextBlocks = entry.blocks.slice();
              nextBlocks[idx] = { ...target, text, kind: nextKind };
              draftsRef.current.set(draftId, { ...entry, blocks: nextBlocks });

              type ReelsAgentShim = {
                updateDraft?: (
                  id: string,
                  mutator: (
                    blocks: Array<{ kind: 'avatar' | 'broll'; text: string }>,
                  ) => Array<{ kind: 'avatar' | 'broll'; text: string }>,
                ) => void;
              };
              const w = window as unknown as Window & { __reelsAgent?: ReelsAgentShim };
              w.__reelsAgent?.updateDraft?.(draftId, blocks => {
                const out = blocks.slice();
                if (idx < out.length) out[idx] = { kind: nextKind, text };
                return out;
              });

              await reply(call_id, true, {
                draft_id: draftId,
                block_index: idx,
                old_text: target.text,
                new_text: text,
                kind: nextKind,
              });
              return;
            }

            case 'reanalyse-reference': {
              const fileName = String(payload.file_name ?? '').trim();
              if (!fileName) {
                await reply(call_id, false, null, 'file_name vazio.');
                return;
              }
              try {
                const bytes = await invoke<number[] | Uint8Array>('read_reference_bytes', { fileName });
                const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as number[]);
                const { profiles, activeId } = ensureProfiles();
                const profile = profiles.find(p => p.id === activeId);
                const result = await analyseReferenceFromBytes(arr, undefined, profile);
                const { draftId, blocks: finalBlocks } = proposeDraftToChat({
                  blocks: result.blocks,
                  source: fileName,
                  kind: 'reel',
                  meta: `${result.language ?? 'PT-BR'} · ${result.blocks.length} blocos · reanálise`,
                });
                draftsRef.current.set(draftId, { blocks: finalBlocks });
                await reply(call_id, true, {
                  source: fileName,
                  blocks: finalBlocks.length,
                  language: result.language,
                  tone: result.tone,
                  draft_id: draftId,
                  status: 'pending-user-approval',
                });
              } catch (e) {
                await reply(call_id, false, null, e instanceof Error ? e.message : String(e));
              }
              return;
            }

            // ---- Wave 3: caption + config + motion edit ----

            case 'generate-caption-instagram': {
              const passthrough = payload.text ? String(payload.text).trim() : '';
              let caption = passthrough;
              let provider: 'gemini' | 'claude' = 'claude';
              if (!caption) {
                if (state.blocks.length === 0) {
                  await reply(call_id, false, null, 'Adicione blocos ao projeto antes — não há texto pra resumir.');
                  return;
                }
                caption = await generateInstagramCaption(state.blocks, state.projectName);
                provider = 'gemini';
              }
              if (onApplyCaption) {
                onApplyCaption(caption, { openModal: true });
              }
              // Best-effort: also push to clipboard so the user can paste
              // straight into Instagram. Failures are silent (denied perms,
              // sandboxed env etc).
              try {
                await navigator.clipboard.writeText(caption);
              } catch {
                /* ignore */
              }
              await reply(call_id, true, { caption, provider });
              return;
            }

            case 'set-emotion': {
              const raw = String(payload.emotion ?? '');
              const valid: ReelEmotion[] = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'surprised'];
              if (!(valid as string[]).includes(raw)) {
                await reply(call_id, false, null, `Emoção inválida: '${raw}'. Use: ${valid.join(', ')}.`);
                return;
              }
              dispatch({ type: 'set-emotion', emotion: raw as ReelEmotion });
              await reply(call_id, true, { emotion: raw });
              return;
            }

            case 'set-app-theme': {
              const raw = String(payload.theme ?? '');
              if (raw !== 'dark' && raw !== 'light') {
                await reply(call_id, false, null, `Tema inválido: '${raw}'. Use 'dark' ou 'light'.`);
                return;
              }
              dispatch({ type: 'set-app-theme', theme: raw as AppTheme });
              await reply(call_id, true, { theme: raw });
              return;
            }

            case 'set-project-name': {
              const name = String(payload.name ?? '').trim();
              if (!name) {
                await reply(call_id, false, null, 'Nome vazio.');
                return;
              }
              dispatch({ type: 'set-name', name });
              await reply(call_id, true, { name });
              return;
            }

            case 'edit-motion-html': {
              const id = String(payload.id);
              const html = String(payload.html ?? '').trim();
              const intent = payload.intent ? String(payload.intent) : undefined;
              if (!html) {
                await reply(call_id, false, null, 'HTML vazio.');
                return;
              }
              const block = state.blocks.find(b => b.id === id);
              if (!block) {
                await reply(call_id, false, null, `Bloco '${id}' não encontrado.`);
                return;
              }
              if (!block.motion) {
                await reply(
                  call_id,
                  false,
                  null,
                  `Bloco '${id}' não tem motion gerado ainda. Use generate_motion_for_block primeiro.`,
                );
                return;
              }
              // Preserve the original motion's id/preset/duration; just swap
              // the HTML and bump generatedAt so the render-pending detector
              // (generatedAt > renderedAt) lights up the timeline button.
              const motion = {
                ...block.motion,
                html,
                intent: intent ?? block.motion.intent,
                generatedAt: Date.now(),
                // Wipe videoPath so the timeline knows the MP4 is stale.
                videoPath: undefined,
              };
              dispatch({ type: 'set-block-motion', id, motion });
              await reply(call_id, true, { id, hasMotion: true, status: 'pending-render' });
              return;
            }

            case 'generate-avatar-clips': {
              const mock = !!payload.mock;
              if (!mock && state.audio.status !== 'ready') {
                await reply(
                  call_id,
                  false,
                  null,
                  'O áudio precisa estar pronto antes de gerar clipes de avatar (HeyGen depende dele). Use mock=true para teste.',
                );
                return;
              }
              if (!mock && !state.selectedPhotoId) {
                await reply(
                  call_id,
                  false,
                  null,
                  'Selecione uma photo de avatar primeiro (botão "✨ Gerar Clipes" no toolbar tem o picker).',
                );
                return;
              }
              if (!onGenerateAvatarClips) {
                await reply(call_id, false, null, 'Geração de clipes não está disponível.');
                return;
              }
              await onGenerateAvatarClips(mock);
              await reply(call_id, true, { mock, status: 'avatar-clips-started' });
              return;
            }

            default:
              await reply(call_id, false, null, `Action type desconhecido: '${action_type}'.`);
              return;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[bridge] handler threw', action_type, msg);
          await reply(call_id, false, null, msg);
        } finally {
          // Catch the "fell through without replying" path. This shouldn't
          // happen with the current code, but it's cheap insurance against
          // future refactors silently breaking the request/response loop.
          if (!hasReplied(call_id)) {
            console.warn('[bridge] handler returned without replying', action_type, call_id);
            await reply(call_id, false, null, 'Handler retornou sem responder ao agente.');
          }
        }
      });
    };

    void setup();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);
}

// Re-export for convenience.
export type { ScriptBlock };
