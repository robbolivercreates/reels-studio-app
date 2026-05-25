# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server only (no Tauri shell)
npm run tauri dev    # Full Tauri app (Rust shell + WebView + Vite HMR)
npm run build        # tsc -b + vite build (web bundle, no Tauri)
npm run tauri build  # Production .app/.dmg/.msi (signs + bundles)
npm run preview      # Preview built web bundle
```

`tauri dev` requires `cargo` on PATH. If running from a non-login shell:

```bash
PATH="$HOME/.cargo/bin:$PATH" npm run tauri dev
```

If port 1420 stays bound after a crash, free it: `lsof -ti:1420 | xargs kill -9`.

DevTools are enabled via the `devtools` feature on the `tauri` crate (`src-tauri/Cargo.toml`) — right-click → Inspect Element inside the running app. Removing that feature flag silently disables the inspector.

No test suite. No lint script — type-checking via `tsc -b` is the only static gate.

## Architecture

Reels Studio is a **Tauri 2 desktop app** (Mac/Windows) for producing short-form vertical videos (Reels/TikTok/Shorts) via a script→audio→avatar→B-roll→export pipeline. The frontend is React 19 + TypeScript + Vite 8; the shell is Rust.

This repo was forked from the web-only `avatar-studio` project once the web waves shipped, so it shares the same React component tree but has diverged — **changes here do not flow back to avatar-studio**, and vice versa.

### Tauri shell (`src-tauri/`)

`src/lib.rs` registers every invoke handler. Modules:
- `references.rs` — reference-video library (`references_dir`, `list_references`, `delete_reference`, `read_reference_bytes`, `save_imported_video`, `download_video`, `reveal_references_dir`). Lives in a fixed user dir managed by Rust; the frontend calls via `@tauri-apps/api/core invoke()`. yt-dlp is invoked as a subprocess for cross-platform IG/TikTok/YouTube/FB downloads — **do not re-introduce CORS proxies on the frontend**, the native command is the authoritative path.
- `motions.rs` — motion-graphics storage and rendering (`save_motion_html`, `render_motion`, `read_motion_video_bytes`, `copy_asset_to_motion`). HTML motion templates render to MP4 server-side.
- `assets.rs` — per-project asset directory (`ensure_assets_dir`, `list_project_assets`, `write_asset_bytes`, `append_asset_chunk`, `reveal_assets_dir`). Chunked writes for large files.
- `capcut.rs` — native CapCut draft writer (`save_capcut_draft`, `capcut_draft_dir_for`, `open_capcut_app`, plus the legacy project/folder helpers). Writes directly into CapCut's drafts directory so the project opens natively, no FCPXML import step.
- `save_dialog.rs` — native save dialogs, file IO, and **ffmpeg muxing** (`mux_video_audio_ffmpeg`). ffmpeg is expected on PATH for the final video+audio mux step in MP4 export.
- `agent/` — Claude Code agent integration (see "Agent integration" below).

`tauri.conf.json` is the source of truth for window size (1400×900, min 1100×720), bundle identifier (`com.robboliver.reelsstudio`), and CSP (currently `null` — relaxed for dev).

### Frontend pipeline (`src/components/reelsStudio/`)

State lives in a single `useReducer` keyed by `ReelsState`. Actions are listed in `types.ts`. The reducer is wrapped by `useHistoryReducer` which records snapshots only for reversible action types (text edit, split, layout/zoom/visibility, add/remove/move/replace block, toggle kind, set-name, set-aspect). Audio generation, clip generation, hydration, screen-take, and analysis actions deliberately do **not** record history — they're paid, async, or wholesale-replace events that don't fit Cmd+Z semantics. Consecutive `update-block-text` on the same block within 800ms coalesce into one history entry.

Key state contracts (full list in `types.ts`):
- `ScriptBlock` — one segment of the script. `kind: 'avatar' | 'broll'`, optional `avatarVisibleSec` (avatar disappears mid-block, B-roll covers), `layout` (4 compositional layouts), `avatarZoom` (1.0–3.0 crop factor for 16:9 → 9:16), optional `motion` config.
- `AudioState` — Minimax TTS output, peaks, word timestamps, plus silence-detection results.
- `ReelsState.avatarClips` — keyed by blockId, tracks HeyGen render lifecycle.
- `ReelsState.takes` — uploaded/recorded B-roll clips, with per-take trim + silence cut.
- `ReelsState.lastAnalysis` / `ReelsState.analyses` — current + history (capped at 20) of `PersistedAnalysis` from video-reference imports. Deduped by `sourceFileName` so re-importing the same video replaces the old entry instead of stacking.

### UI architecture: Inspector pattern

The right-side panel in `ReelsStudio.tsx` is a contextual Inspector, not a static script editor:
- **No selection** → all blocks render expanded as a list (legacy view).
- **`selectedBlockId !== null`** → that block pins to the top expanded (text + layout + visibility + zoom controls), the others collapse into a thin compact navigator below labeled "Outros blocos". Click a compact card to switch selection.

Selection always also seeks the playhead to the block's start (`selectAndSeekBlock` helper) so the preview reflects the layout/zoom being edited. Selecting without seeking would mean editing block 3 while the preview shows block 1 (and that confused users — see git history if questioning the design).

Vibe (emotion + speed) collapses to a one-line summary once `audio.status === 'ready'`. Cost breakdown only appears when audio is unmade or some block is `dirty`. Secondary actions (import script, import video, plan, references) live behind a `⋯ Mais` menu, not the toolbar.

### Audio architecture (critical)

**Audio is the source of truth.** The `<audio>` element drives the playhead via rAF — we read `audio.currentTime` each frame, never force-seek during playback. The only seek is when entering a silent region we should skip (`silenceCutRef.current`). This avoids the popping that came from rAF-driven seeking.

Silence detection uses a **peak-relative threshold** (`rmsMax * dbToLinear(thresholdDb)`), not absolute dB, because Minimax loudness-normalizes to ~-18 LUFS — absolute -38dB never crosses. Presets in `silenceDetector.ts`.

### HeyGen aspect & cropping

HeyGen always renders at **1920×1080 (16:9)** for max info, regardless of project aspect. The 9:16/1:1 crop happens locally in `mp4Renderer.ts` (compositor) and `fcpxmlExporter.ts`. Avatar background is forced to `#000000` to avoid white letterbox bars when the talking-head portrait doesn't fill the 16:9 frame. Per-block `avatarZoom` controls how aggressive the crop is (default 1.78x for 9:16 reels via `defaultAvatarZoom()`).

### Block split semantics

`split-block` reassigns the existing avatar clip to the **first half** so playback keeps showing the avatar, marks both halves dirty, and splits text proportionally to time. The second half always needs a regen. Splitting requires ≥0.8s on each side (`MIN_HALF`).

### Export paths

1. **Native MP4** via WebCodecs (`mp4Renderer.ts`) + `mp4-muxer` — H.264/AAC bundled in-browser. Final video+audio mux uses **ffmpeg as a Rust subprocess** (`save_dialog::mux_video_audio_ffmpeg`), so ffmpeg must be on PATH for that step.
2. **CapCut Desktop — native draft** via `capcutDraftBuilder.ts` + `src-tauri/src/capcut.rs`. Writes a real CapCut draft directly into CapCut's drafts directory (`capcut_draft_dir_for`) and can auto-launch the app (`open_capcut_app`). This is the preferred CapCut path.
3. **CapCut Desktop — FCPXML fallback** via `fcpxmlExporter.ts` — generates FCPXML 1.10 with avatar audio muted at -96dB (audio comes from the master TTS track), bundled with raw assets in a JSZip via `packageBuilder.ts`. Kept for portability and when the native draft path isn't viable.

### Persistence (`persistence.ts` + `useReelsPersistence.ts`)

IndexedDB (DB v3) with the `reqOf<T>` helper that attaches `onsuccess` synchronously *before* the transaction can auto-commit — earlier code attached handlers in a microtask via `Promise.resolve().then()` and hit silent transaction commit hangs ("Salvando..." stuck forever). The hook handles `onblocked`/`onversionchange` for multi-tab upgrades.

Project state, audio blob, clip blobs, take blobs, exports, and the analyses history all live in IndexedDB. Object URLs are recreated on hydration and revoked on changes.

**Hydration gotcha:** `videoUrl` fields persisted from a previous session are stale `blob:` URLs that no longer resolve in the new session. `useReelsPersistence` rebuilds clip URLs **only** from blobs found in `STORE_CLIPS` — if a clip in the persisted state has `status: 'ready'` but no matching blob, it's dropped. Earlier code spread `persisted.avatarClips` first and overwrote, which let dead URLs leak into the `<video>` tag and spam the console with `WebKitBlobResource error 1` until the next dispatch. Don't undo that fix.

The `<audio>` cleanup in `ReelsStudio.tsx` calls `el.removeAttribute('src'); el.load();` on unmount for the same reason — pause alone doesn't stop WebKit from retrying the dead blob URL.

### Keyboard shortcuts

Global handler in `ReelsStudio.tsx`. Disabled inside inputs/textareas/contenteditables (browser undo wins there). Shortcuts: `Cmd+Z`/`Cmd+Shift+Z` (or `Cmd+Y`) undo/redo, `Space` play/pause, `←/→` frame (1/30s), `Shift+←/→` 1s, `Home/End`, `S` split block at playhead (only when ≥0.8s on each side), `Delete`/`Backspace` removes selected block (keeps minimum 1), `Esc` clears selection.

The handler reads from a `shortcutRefs` mirror that's updated each render — that's intentional, so the effect can have an empty deps array without stale-closure bugs.

### API keys

Stored in `localStorage`, gated at startup in `App.tsx`. Required: `FAL_KEY` (Minimax TTS, fal.ai upload), `HEYGEN_API_KEY` (Avatar 4 clips). Optional: `GOOGLE_API_KEY` (Gemini script import + video analysis). Configured via `SettingsModal`.

### Confirm dialogs

`window.confirm()` is unreliable in Tauri WebView on some hosts (silently returns false, blocking destructive actions). For critical confirmations (project clear, etc.), use a custom modal — see `confirmClearOpen` in `ReelsStudio.tsx`. Native `confirm()` is OK for low-stakes prompts where a no-op fallback is acceptable.

### Voice & tone (PT-BR content)

The `voice-docs/voz-rob-boliver.md` file is the spec for any AI-assisted script/caption generation in this app. It is **not** developer documentation — it's domain content describing how the end user (Rob) talks in his videos. Anything that generates Portuguese script text (Gemini imports, scene plans, caption suggestions) should respect those constraints (no "olá pessoal hoje", always close with "até logo, tchau tchau", verbatim CTAs, banned words list, etc.).

### Styling

Tailwind via CDN (no PostCSS step). Custom shadows like `shadow-[0_30px_80px_rgba(0,0,0,0.8)]` inline. Dark theme is hard-coded; no theme toggle.

### Services layer (`src/services/`)

Each external integration lives in its own service module (`captionService`, `carouselScriptService`, `motionService`, `scriptFromContentService`, `videoAnalysisService`, `blockGeneratorService`, `thumbnailService`, …). They all read API keys from `localStorage` directly — there is no central API client. When adding a new Gemini call, register the model ID and per-1M-token rates in `costPredictor.ts` (`PRICING_RATES`) and call `logActualCost(...)` from the service so the cost banner in the UI stays accurate. Pricing in that file is dated and must be kept in sync with Google's published rates.

The thumbnail flow (`thumbnailService.ts` + `thumbnailTemplates.ts` + `components/agent/ThumbnailCard.tsx`) is a two-step Gemini-research → fal.ai-image-gen pipeline: Gemini researches the visual concept and overlay text, fal.ai (`nano-banana` / Qwen edit) renders the PNG. Templates live in `thumbnailTemplates.ts` — edit them there rather than inlining prompts in the service.

### Agent integration (`src-tauri/src/agent/`)

The app embeds a Claude Code agent subprocess so users can co-edit projects with an assistant from inside the desktop shell. Modules:
- `claude_subprocess.rs` — spawns/cancels the `claude` CLI as a child process (`agent_send`, `agent_cancel`).
- `mcp_server.rs` + `agent_mcp_port` / `agent_register_mcp` — local MCP server the subprocess connects to so the agent can call Tauri-side tools.
- `tool_bridge.rs` (`agent_tool_result`) — routes tool calls from the agent into the frontend and back.
- `approval.rs` (`agent_approve`) — human-in-the-loop approval gate for risky tool calls; the UI surfaces a prompt before the agent acts.
- `picker.rs` (`agent_picker_result`) — bridges native file/asset pickers to the agent.
- `state.rs` + `agent_publish_state` — pushes app state snapshots to the agent so it has context.
- `auth.rs` — handles Claude Code auth flow.

`agent::init(&app.handle())` runs at Tauri startup. The `claude` binary must be installed and on PATH for this feature to work.

### Live design notes

`NOTES.md` at the repo root is a live design doc (multi-asset blocks, card UX, etc.) that captures in-flux decisions before they land in code. Skim it when working on the block card, asset attachment, or motion engine — it's where the "why" for half-finished UI work lives.
