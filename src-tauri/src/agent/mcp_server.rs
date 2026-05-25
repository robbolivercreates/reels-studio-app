// Embedded MCP server using rmcp 1.7's Streamable HTTP transport.
//
// Binds to an ephemeral port on 127.0.0.1 so we coexist with other local MCP
// servers (Daydream squats 7433). The chosen port is stored in AgentState
// and surfaced to the front-end + the `claude mcp add reels …` registration
// step.
//
// Tools fall in three groups:
//   • read-only — answered from the in-memory snapshot published by React
//   • write    — bridged back to React via tool_bridge::dispatch_to_react
//   • approval — `request_user_approval` used by Claude's
//                `--permission-prompt-tool` flag to ask the user before any
//                non-auto-approved tool runs

use std::net::SocketAddr;

use rmcp::{
    handler::server::router::tool::ToolRouter,
    handler::server::wrapper::Parameters,
    model::{
        CallToolResult, Content, Implementation, ProtocolVersion, ServerCapabilities, ServerInfo,
    },
    schemars, tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
    ErrorData as McpError, ServerHandler,
};
use serde::Deserialize;
use serde_json::json;
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use super::approval::{request_approval, PendingApprovals};
use super::state::AgentState;
use super::tool_bridge::{dispatch_to_react, PendingToolCalls};

#[derive(Clone)]
pub struct ReelsAgentService {
    state: AgentState,
    app: AppHandle,
    approvals: PendingApprovals,
    tool_calls: PendingToolCalls,
    pickers: super::picker::PendingPickers,
    #[allow(dead_code)]
    tool_router: ToolRouter<ReelsAgentService>,
}

// ---------- Tool argument types -----------------------------------------

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ReadBlockArgs {
    /// ID of the block to read. Use `list_blocks` first to discover IDs.
    pub id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct EditBlockTextArgs {
    /// ID of the block whose text should change.
    pub id: String,
    /// New text for the block. Plain UTF-8, no markdown.
    pub text: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RegenerateBlockArgs {
    pub id: String,
    /// Optional user instruction guiding the rewrite (e.g. "mais agressivo",
    /// "mais curto", "transforme em pergunta"). Leave empty for a neutral
    /// rewrite that just smooths the existing text.
    #[serde(default)]
    pub instruction: Option<String>,
    /// Optional: when YOU (the agent) already wrote the replacement text,
    /// pass it here. The tool will skip the Gemini round-trip and just
    /// apply your text. Use this when the user's setting routes text
    /// generation through Claude. When omitted, Gemini handles the rewrite.
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AddBlockArgs {
    /// 'avatar' (speaker on camera) or 'broll' (voice-over with B-roll).
    pub kind: String,
    /// Prompt describing what the new block should say or show.
    pub prompt: String,
    /// Optional block id to insert after. Omit to append at the end.
    #[serde(default)]
    pub after_id: Option<String>,
    /// Optional: when YOU already wrote the new block's text, pass it here
    /// to bypass Gemini generation.
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RemoveBlockArgs {
    pub id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetBlockLayoutArgs {
    pub id: String,
    /// One of: 'avatar-only', 'media-only', 'avatar-top', 'media-top'.
    pub layout: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetBlockAvatarPhotoArgs {
    /// Block id (use list_blocks to discover; must be an avatar block).
    pub id: String,
    /// AvatarPhoto id from list_avatar_photos. Pass `null` (or omit) to
    /// clear the per-block override and fall back to the project's
    /// default photo.
    #[serde(default)]
    pub photo_id: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetBlockKindArgs {
    /// Block id (use list_blocks to discover).
    pub id: String,
    /// 'avatar' (speaker on camera) or 'broll' (voice-over with visuals).
    pub kind: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetVoiceArgs {
    /// Voice id from the project's voice list (built-in or cloned).
    pub voice_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AddBrollArgs {
    /// Block id to attach B-roll to.
    pub block_id: String,
    /// Absolute path to an image or video already inside the project's
    /// Assets folder. The asset must exist on disk; call `list_assets`
    /// (PR3) first if you're unsure.
    pub asset_path: String,
    /// 'image' or 'video'. Optional — inferred from extension if omitted.
    #[serde(default)]
    pub asset_type: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetBlockMotionArgs {
    /// ID of the block to set the motion for.
    pub id: String,
    /// Full MotionConfig serialized as a JSON string.
    /// The front-end parses and dispatches `set-block-motion`.
    /// Pass `null` (as the string "null") to clear the motion.
    pub motion_json: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RemoveSilencesArgs {
    /// Aggressiveness preset: 'natural' (gentle), 'fast' (medium), 'super'
    /// (aggressive). Defaults to 'fast' if omitted.
    #[serde(default)]
    pub preset: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ApprovalToolArgs {
    /// Name of the tool the model is requesting permission for.
    pub tool_name: String,
    /// Original tool input that will be passed through if approved.
    pub input: serde_json::Value,
}

// ---- Wave 1: import tools (create-from-source) -------------------------

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ImportFromVideoUrlArgs {
    /// Public URL of a short-form video (Instagram Reel, TikTok, YouTube
    /// Short, Vimeo, etc — anything yt-dlp supports). The agent downloads
    /// the file, runs analysis through Gemini, and replaces the current
    /// project's blocks with the result.
    pub url: String,
    /// Optional extra direction for the analysis ("foca no hook", "mais
    /// curto", "preserva o sotaque", etc).
    #[serde(default)]
    pub instruction: Option<String>,
    /// Set true ONLY when the user explicitly asks to re-download or
    /// re-analyse the same reel ("baixa de novo", "analisa novamente",
    /// "ignora o cache"). Default false → reuses cached analysis +
    /// already-downloaded file, which is fast and free. The response
    /// payload has a `cached` boolean you can mention casually.
    #[serde(default)]
    pub force_redownload: Option<bool>,
    /// Target duration in seconds (15/30/45/60). When the user
    /// specifies a duration ("recria esse reel em 45s"), pass it
    /// here so the setup card is auto-skipped. Omit to let the user
    /// pick interactively or to mirror the source video's length.
    #[serde(default)]
    pub duration_sec: Option<i64>,
    /// Tone: "original" (mimic source) / "casual" / "direct" /
    /// "educational". Pass when the user is explicit ("mais casual",
    /// "mais formal"); skip otherwise — the setup card asks the user.
    #[serde(default)]
    pub tone: Option<String>,
    /// Focus: "adapt" (default — adapt to user's niche), "summarize",
    /// or "detail" (expand). Pass when the user is explicit ("mais
    /// curto, resume", "explica melhor"); skip otherwise.
    #[serde(default)]
    pub focus: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ImportFromArticleArgs {
    /// URL of an article to summarise into a reel script.
    /// Use this OR `text` (not both — if both are passed, `text` wins).
    #[serde(default)]
    pub url: Option<String>,
    /// Raw article text (paste). Used when the user provides text directly.
    #[serde(default)]
    pub text: Option<String>,
    /// Optional title for the reel (auto-derived from article if omitted).
    #[serde(default)]
    pub title: Option<String>,
    /// Target duration in seconds (defaults to 30).
    #[serde(default)]
    pub duration_sec: Option<u32>,
    /// Style preset (e.g. "viral", "cinematic", "tutorial"). Optional.
    #[serde(default)]
    pub style: Option<String>,
    /// Framework override (e.g. "AIDA", "PAS", "Hook-Bridge-Payoff"). Optional.
    #[serde(default)]
    pub framework: Option<String>,
    /// Extra direction passed to Gemini.
    #[serde(default)]
    pub instruction: Option<String>,
    /// Optional: pre-generated block list `[{"kind":"avatar|broll","text":"..."}, ...]`
    /// (serialized as JSON string). When provided, the tool skips Gemini
    /// generation and applies these blocks directly. Use this when YOU
    /// already drafted the reel structure.
    #[serde(default)]
    pub blocks_json: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ImportFromScriptArgs {
    /// Raw script text the user wants turned into avatar/broll blocks.
    pub text: String,
    /// If true, use the heuristic classifier (HOOK/CTA/SHOW regex) instead
    /// of Gemini AI classification. Defaults to false.
    #[serde(default)]
    pub heuristic_only: Option<bool>,
    /// Optional: pre-classified blocks `[{"kind":"avatar|broll","text":"..."}, ...]`
    /// (serialized as JSON string). When provided, bypasses both Gemini
    /// and the heuristic classifier.
    #[serde(default)]
    pub blocks_json: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RecreateFullScriptArgs {
    /// Plain-language instruction for the rewrite (e.g. "deixa mais punk",
    /// "encurta pra 20 segundos", "muda o ângulo pra storytelling").
    pub instruction: String,
    /// Optional: pre-rewritten blocks (same shape as ImportFromArticle).
    /// When provided, the tool skips Gemini and applies your blocks.
    #[serde(default)]
    pub blocks_json: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RegenerateDraftBlockArgs {
    /// `draft_id` returned by the most recent import tool (kept in the
    /// `pending-user-approval` response). Use the most recent one if the
    /// user said "o bloco X tá ruim" without specifying which draft.
    pub draft_id: String,
    /// Zero-based index into the draft's blocks (0 = first block).
    pub block_index: u32,
    /// Plain-language steer for the rewrite — "mais agressivo", "mais
    /// curto", "vira em pergunta", etc.
    pub instruction: String,
    /// Optional: when YOU already wrote the new text (Claude mode), pass
    /// it here to skip Gemini.
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ReplaceDraftBlockArgs {
    /// Draft id (see RegenerateDraftBlockArgs).
    pub draft_id: String,
    /// Zero-based block index.
    pub block_index: u32,
    /// New text. Replaces the block's text verbatim — no AI rewrite.
    pub text: String,
    /// Optional: also switch the block's kind.
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GenerateCarouselArgs {
    /// Topic / brief for the carousel.
    pub topic: String,
    /// Number of slides (3-15, defaults to 7).
    #[serde(default)]
    pub num_slides: Option<u32>,
    /// Tone preset: educativo | viral | inspiracional | vendas | opiniao | storytelling.
    #[serde(default)]
    pub tone: Option<String>,
    /// Optional: pre-generated slides as a JSON string.
    /// Each slide: `{"text":"...","role":"hook|insight|stat|cta|tip|story|closing","visualHint":"..."}`.
    #[serde(default)]
    pub slides_json: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GenerateThumbnailArgs {
    /// O título principal do vídeo para ser usado como base do gancho e pesquisa.
    pub video_title: String,
    /// Resumo do roteiro do Reels (ou o roteiro completo) para contextualização da IA (opcional).
    #[serde(default)]
    pub script_summary: Option<String>,
    /// Instruções personalizadas do usuário sobre o que desenhar ou destacar na thumbnail (opcional).
    #[serde(default)]
    pub instructions: Option<String>,
    /// O estilo estético desejado. Padrão: 'standard' (Rob Boliver signature aesthetic) (opcional).
    #[serde(default)]
    pub style: Option<String>,
    /// Opcional. Foto do criador em base64 (data URI ou bytes puros). Quando fornecida, usa o GPT Image 2 em modo edição para incluir a aparência real do criador na thumbnail.
    #[serde(default)]
    pub creator_photo_base64: Option<String>,
}

// ---- Wave 2: visual tools (motion + avatar) ----------------------------

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ApplyStylePresetArgs {
    /// Block id (use list_blocks first).
    pub id: String,
    /// One of: editorial-clean, bold-pop, glass-tech, kinetic-bold,
    /// soft-pastel, cinematic-dark, apple-system, warm-editorial, claude-ui.
    /// Use list_style_presets to discover.
    pub preset_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ApplyStylePresetCascadeArgs {
    /// Block id to apply on directly.
    pub id: String,
    /// Preset id (see apply_style_preset). Cascades to every other block
    /// that doesn't have generated motion HTML yet.
    pub preset_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GenerateMotionForBlocksArgs {
    /// Explicit block ids to target. When omitted, `filter` decides.
    #[serde(default)]
    pub ids: Option<Vec<String>>,
    /// Used only when `ids` is omitted. One of: 'broll' (only B-roll blocks),
    /// 'avatar' (only avatar blocks), 'all' (every block), 'missing' (every
    /// block without a generated motion). Default: 'missing'.
    #[serde(default)]
    pub filter: Option<String>,
    /// Optional style preset applied to every block in the batch BEFORE
    /// generation. If omitted, each block keeps its current preset.
    #[serde(default)]
    pub preset_id: Option<String>,
    /// Optional shared intent / direction (e.g. "show typing the command",
    /// "Claude-style UI"). Each block inherits this. Leave empty for the
    /// per-block default.
    #[serde(default)]
    pub intent: Option<String>,
    /// Optional: pre-authored HTML map, keyed by block id. Set when YOU
    /// (Claude in Claude-mode) hand-wrote the HTML for each block. The
    /// tool then skips Gemini entirely. Format: JSON object string mapping
    /// `{"block_id_1": "<html>...", "block_id_2": "<html>...", ...}`.
    #[serde(default)]
    pub html_by_id: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GenerateMotionForBlockArgs {
    /// Block id.
    pub id: String,
    /// Optional intent / direction ("emphasize the hook line", "use a
    /// keyboard-typing motion", etc). Leave empty for Gemini default.
    #[serde(default)]
    pub intent: Option<String>,
    /// Optional preset id to apply BEFORE generating. If omitted, uses the
    /// block's existing presetId or the project default (`glass-tech`).
    #[serde(default)]
    pub preset_id: Option<String>,
    /// Optional: when YOU (the agent) crafted the motion HTML yourself
    /// (Claude mode), pass it here. The tool will skip the Gemini Pro
    /// round-trip and save your HTML directly, marking the motion as
    /// pending re-render. Use this when the user's text provider setting
    /// is "Always Claude" or when no GOOGLE_API_KEY is configured. Your
    /// HTML must follow the HyperFrames rules embedded in the system
    /// prompt (timeline registry, composition placeholder, etc).
    #[serde(default)]
    pub html: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RenderMotionsArgs {
    /// If true, render only motions that haven't been rendered yet (or are
    /// stale). If false, re-renders all. Defaults to true.
    #[serde(default)]
    pub pending_only: Option<bool>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GenerateAvatarClipsArgs {
    /// If true, generate cheap mock clips (coloured rectangles) instead of
    /// calling HeyGen. Useful for testing export pipeline without burning
    /// credits. Defaults to false.
    #[serde(default)]
    pub mock: Option<bool>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetAvatarPhotoArgs {
    /// Photo id from `list_avatar_photos`.
    pub photo_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UploadAvatarPhotoArgs {
    /// Absolute path to a JPG or PNG file (typically a chat attachment).
    /// Cap is 5 MB per HeyGen's API limits; larger files will be rejected.
    pub image_path: String,
    /// Optional user-facing label for the photo. Defaults to the file name
    /// (without extension) if omitted.
    #[serde(default)]
    pub name: Option<String>,
}

// ---- Wave 3: caption + config + motion edit ----

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GenerateCaptionInstagramArgs {
    /// Optional: when YOU already wrote the caption (Claude mode), pass
    /// it here. The tool just copies it to the project + (later) to
    /// clipboard. When omitted, Gemini Flash writes one from the script.
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetEmotionArgs {
    /// 'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'surprised'.
    /// Applied to the next audio generation only (existing audio keeps its
    /// current emotion until you regenerate).
    pub emotion: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetAppThemeArgs {
    /// 'dark' or 'light'.
    pub theme: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetProjectNameArgs {
    /// New project name. Becomes the default file name for exports and
    /// shows up in the top bar / project picker.
    pub name: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AttachAssetFromPathArgs {
    /// Block id to attach the asset to.
    pub block_id: String,
    /// Absolute path to a file (image or video). For B-roll uploads via the
    /// chat, use the path the attachment chip exposes.
    pub path: String,
    /// Optional: 'image' or 'video'. Inferred from extension if omitted.
    #[serde(default)]
    pub asset_type: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteReferenceArgs {
    /// Reference file name from `list_references`.
    pub file_name: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ReanalyseReferenceArgs {
    /// Reference file name from `list_references`. Reads the bytes back
    /// and runs Gemini analysis (same pipeline as import_from_video_url)
    /// without re-downloading.
    pub file_name: String,
    /// Optional extra direction.
    #[serde(default)]
    pub instruction: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetVoiceSpeedArgs {
    /// Speed multiplier. 1.0 = normal, 0.5 = half speed, 2.0 = double.
    /// Minimax accepts 0.5–2.0; values outside this range will be clamped.
    pub speed: f32,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CloneVoiceFromAudioArgs {
    /// Absolute path to an audio file (WAV/MP3/M4A) the user uploaded.
    /// When the user attached audio in chat, the file path is exposed
    /// via the attachment chip — use that path here.
    pub audio_path: String,
    /// User-facing label for the cloned voice (e.g. "Marina narradora").
    pub name: String,
    /// Optional: clone model. Default 'speech-02-hd' (best quality).
    /// Options: speech-02-hd, speech-02-turbo, speech-01-hd, speech-01-turbo.
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct EditMotionHtmlArgs {
    /// Block whose motion HTML should be replaced.
    pub id: String,
    /// New full HTML for the motion. When YOU (Claude) hand-craft the
    /// HTML (e.g. "muda o fundo pra preto"), pass it here. The tool
    /// saves it to the project's motion file and marks the block as
    /// pending re-render (so the user sees "Renderizar motions" light up).
    pub html: String,
    /// Optional new intent label (cosmetic — shown in the timeline).
    #[serde(default)]
    pub intent: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SetAvatarModelArgs {
    /// 'avatar3' (cheaper, faster) or 'avatar4' (higher quality, slower).
    pub model: String,
}

// ---------- Tool router -------------------------------------------------

#[tool_router]
impl ReelsAgentService {
    pub fn new(
        state: AgentState,
        app: AppHandle,
        approvals: PendingApprovals,
        tool_calls: PendingToolCalls,
        pickers: super::picker::PendingPickers,
    ) -> Self {
        Self {
            state,
            app,
            approvals,
            tool_calls,
            pickers,
            tool_router: Self::tool_router(),
        }
    }

    // ---- Read tools (auto-approved) ----

    #[tool(
        description = "Lista todos os blocos do roteiro atual. Retorna id, kind (avatar/broll), texto, layout e duração. Use isto antes de qualquer mudança para saber o que está no projeto."
    )]
    async fn list_blocks(&self) -> Result<CallToolResult, McpError> {
        let snap = self.state.snapshot();
        let payload = json!({
            "project_id": snap.project_id,
            "project_name": snap.project_name,
            "aspect": snap.aspect,
            "voice_id": snap.voice_id,
            "block_count": snap.blocks.len(),
            "blocks": snap.blocks,
            "version": snap.version,
        });
        Ok(CallToolResult::success(vec![Content::text(payload.to_string())]))
    }

    #[tool(
        description = "Lê um bloco específico do roteiro pelo id. Retorna texto completo, layout, duração, contagem de assets, status de motion."
    )]
    async fn read_block(
        &self,
        Parameters(args): Parameters<ReadBlockArgs>,
    ) -> Result<CallToolResult, McpError> {
        let snap = self.state.snapshot();
        match snap.blocks.iter().find(|b| b.id == args.id) {
            Some(b) => {
                let payload = serde_json::to_string(b).map_err(|e| {
                    McpError::internal_error(format!("serialize block: {e}"), None)
                })?;
                Ok(CallToolResult::success(vec![Content::text(payload)]))
            }
            None => Ok(CallToolResult::error(vec![Content::text(format!(
                "Bloco '{}' não encontrado. Chame list_blocks para ver IDs válidos.",
                args.id
            ))])),
        }
    }

    #[tool(
        description = "Retorna o estado do projeto (nome, aspect ratio, voz ativa, status do áudio, análises persistidas). Use para entender o contexto antes de sugerir mudanças."
    )]
    async fn get_project_status(&self) -> Result<CallToolResult, McpError> {
        let snap = self.state.snapshot();
        let payload = json!({
            "project_id": snap.project_id,
            "project_name": snap.project_name,
            "aspect": snap.aspect,
            "voice_id": snap.voice_id,
            "block_count": snap.blocks.len(),
            "audio": snap.audio,
            "analyses": snap.analyses,
            "version": snap.version,
        });
        Ok(CallToolResult::success(vec![Content::text(payload.to_string())]))
    }

    // ---- Write tools (require human approval) ----

    #[tool(
        description = "Edita o texto de um bloco existente. NÃO regenera com IA — usa o texto exatamente como fornecido. Use regenerate_block se quiser que o Gemini reescreva."
    )]
    async fn edit_block_text(
        &self,
        Parameters(args): Parameters<EditBlockTextArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "id": args.id, "text": args.text });
        self.bridge_write("update-block-text", payload).await
    }

    #[tool(
        description = "Regenera o texto de um bloco. Modo padrão: Gemini reescreve seguindo a 'instruction'. Modo Claude (preferido quando o setting do usuário aponta pra Claude): VOCÊ escreve o novo texto e passa em 'text' — a tool só aplica. Regras de bom texto: 2-7s falados (~3-5 palavras/s em PT-BR), sem markdown, sem emojis, sem auto-introdução. Mantenha coerência com bloco anterior e próximo (use read_block se precisar)."
    )]
    async fn regenerate_block(
        &self,
        Parameters(args): Parameters<RegenerateBlockArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "id": args.id,
            "instruction": args.instruction.unwrap_or_default(),
            "text": args.text,
        });
        self.bridge_write("regenerate-block", payload).await
    }

    #[tool(
        description = "Adiciona um bloco novo. Modo padrão: Gemini escreve baseado em 'prompt'. Modo Claude: VOCÊ escreve o texto direto e passa em 'text' (a 'prompt' vira o briefing pra você). 'kind' = 'avatar' ou 'broll'. 'after_id' insere depois do bloco indicado (default: final). Mesmas regras de bom texto da regenerate_block."
    )]
    async fn add_block(
        &self,
        Parameters(args): Parameters<AddBlockArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "kind": args.kind,
            "prompt": args.prompt,
            "after_id": args.after_id,
            "text": args.text,
        });
        self.bridge_write("add-block-ai", payload).await
    }

    #[tool(description = "Remove um bloco do roteiro pelo id. Operação irreversível (até o usuário desfazer com Cmd+Z).")]
    async fn remove_block(
        &self,
        Parameters(args): Parameters<RemoveBlockArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "id": args.id });
        self.bridge_write("remove-block", payload).await
    }

    #[tool(
        description = "Muda o layout de um bloco. Layouts válidos: 'avatar-only' (avatar inteiro), 'media-only' (sem avatar), 'avatar-top' (avatar em cima + mídia embaixo), 'media-top' (mídia em cima + avatar embaixo)."
    )]
    async fn set_block_layout(
        &self,
        Parameters(args): Parameters<SetBlockLayoutArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "id": args.id, "layout": args.layout });
        self.bridge_write("set-block-layout", payload).await
    }

    #[tool(
        description = "Define qual foto de avatar usar APENAS naquele bloco. Útil quando o usuário quer alternar fotos/poses entre cenas ('no bloco 2 usa a foto X, no bloco 5 usa a Y'). Use list_avatar_photos primeiro pra pegar os ids. Passe `photo_id: null` (ou omita) pra limpar o override e voltar à foto padrão do projeto. A foto global do projeto é mexida com set_avatar_photo."
    )]
    async fn set_block_avatar_photo(
        &self,
        Parameters(args): Parameters<SetBlockAvatarPhotoArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "id": args.id, "photo_id": args.photo_id });
        self.bridge_write("set-block-avatar-photo", payload).await
    }

    #[tool(
        description = "Muda o tipo de UM bloco entre 'avatar' (falando pra câmera) e 'broll' (narração sobre visual). Não regenera o texto — só troca o tipo. Use isto pra bulk-converter blocos ('vira tudo em broll'). Mais barato que regenerate_block (zero chamadas Gemini)."
    )]
    async fn set_block_kind(
        &self,
        Parameters(args): Parameters<SetBlockKindArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "id": args.id, "kind": args.kind });
        self.bridge_write("set-block-kind", payload).await
    }

    // ---- Draft editing tools (operate within a pending draft, NOT the project) ----

    #[tool(
        description = "Regenera UM bloco DENTRO de um draft pendente (não no roteiro publicado). Use sempre que o usuário disser 'o bloco X tá mole/curto/longo' depois de uma importação que ainda não foi aplicada. NÃO mexe nos blocos do Script editor — só edita o draft preview que está no chat. Modo padrão: Gemini reescreve. Modo Claude: VOCÊ escreve em 'text'. O card do chat atualiza em tempo real após esta tool."
    )]
    async fn regenerate_draft_block(
        &self,
        Parameters(args): Parameters<RegenerateDraftBlockArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "draft_id": args.draft_id,
            "block_index": args.block_index,
            "instruction": args.instruction,
            "text": args.text,
        });
        self.bridge_write("regenerate-draft-block", payload).await
    }

    #[tool(
        description = "Substitui literalmente o texto de UM bloco dentro de um draft pendente. Use quando o usuário ditar o texto exato ('o bloco 2 vira: olha só isso aqui') ou quando você (Claude) decidir escrever direto sem chamada Gemini. 'kind' opcional permite trocar avatar↔broll no mesmo movimento."
    )]
    async fn replace_draft_block(
        &self,
        Parameters(args): Parameters<ReplaceDraftBlockArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "draft_id": args.draft_id,
            "block_index": args.block_index,
            "text": args.text,
            "kind": args.kind,
        });
        self.bridge_write("replace-draft-block", payload).await
    }

    #[tool(
        description = "Gera o áudio TTS para todos os blocos do roteiro usando a voz ativa. Pode levar 30s-3min dependendo do tamanho. Custo aproximado: $0.015/min via Minimax HD."
    )]
    async fn generate_audio(&self) -> Result<CallToolResult, McpError> {
        self.bridge_write("generate-audio", json!({})).await
    }

    #[tool(
        description = "Anexa uma imagem ou vídeo (B-roll) a um bloco. 'asset_path' deve ser um caminho absoluto dentro da pasta Assets do projeto. Auto-ajusta o layout para 'media-top' se necessário."
    )]
    async fn add_broll_to_block(
        &self,
        Parameters(args): Parameters<AddBrollArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "block_id": args.block_id,
            "asset_path": args.asset_path,
            "asset_type": args.asset_type,
        });
        self.bridge_write("add-block-asset", payload).await
    }

    #[tool(
        description = "Define o motion HTML de um bloco (set-block-motion). 'motion_json' é o MotionConfig completo serializado em JSON — inclui id, presetId, layer, intent, text, durationSec, html, status, createdAt. Passe a string 'null' para limpar o motion."
    )]
    async fn set_block_motion_html(
        &self,
        Parameters(args): Parameters<SetBlockMotionArgs>,
    ) -> Result<CallToolResult, McpError> {
        let motion: serde_json::Value = if args.motion_json.trim() == "null" {
            serde_json::Value::Null
        } else {
            serde_json::from_str(&args.motion_json).map_err(|e| {
                McpError::invalid_params(format!("motion_json inválido: {e}"), None)
            })?
        };
        let payload = json!({ "id": args.id, "motion": motion });
        self.bridge_write("set-block-motion", payload).await
    }

    #[tool(
        description = "Detecta e remove silêncios do áudio gerado. 'preset' controla agressividade: 'natural' (preserva pausas), 'fast' (corta médio), 'super' (corta agressivo). Default: 'fast'."
    )]
    async fn remove_silences(
        &self,
        Parameters(args): Parameters<RemoveSilencesArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "preset": args.preset.unwrap_or_else(|| "fast".into()) });
        self.bridge_write("remove-silences", payload).await
    }

    #[tool(
        description = "Quebra blocos do roteiro que são mais longos que a 'Duração máxima do bloco' definida em Settings → Agents → Avançado. Funciona em 2 modos: (1) com áudio gerado, usa word timestamps reais — quebra exata em pausas naturais (ponto/vírgula); (2) sem áudio, usa estimativa palavras/segundo — quebra heurística pelos imports. Se não há limite configurado, retorna erro acionável. Se nenhum bloco passa do limite, retorna 'nothing to split'. Aplica direto, não pede aprovação."
    )]
    async fn split_long_blocks(&self) -> Result<CallToolResult, McpError> {
        self.bridge_write("split-long-blocks", json!({})).await
    }

    #[tool(
        description = "Troca a voz ativa do projeto. 'voice_id' precisa estar na lista de vozes do projeto (built-in ou clonada). Não regenera áudio automaticamente — chame generate_audio depois se quiser."
    )]
    async fn set_voice(
        &self,
        Parameters(args): Parameters<SetVoiceArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "voice_id": args.voice_id });
        self.bridge_write("set-voice", payload).await
    }

    // ---- Import tools (Wave 1 — start a project from a source) ----

    #[tool(
        description = "Importa um Reels existente. Por padrão um card visual pergunta ao usuário duração/tom/foco antes de gerar — SEMPRE deixe esses campos vazios e deixe o card aparecer, A NÃO SER QUE o usuário tenha EXPLICITAMENTE dito na mensagem dele (ex: 'importa esse reel em 45s mais detalhado' → duration_sec=45, focus='detail'). Não invente valores. Não 'lembre' de uma preferência de turn anterior — cada import é uma escolha nova. Cache: re-imports do mesmo URL com mesmas escolhas voltam em <2s (campo `cached: true`). Passe `force_redownload: true` SÓ quando o usuário pedir 'baixa de novo'. NÃO substitui os blocos imediatamente — surface um draft card (campo `draft_id` + status='pending-user-approval'). Confirme ao usuário: 'Pronto, dá uma olhada abaixo e aprova quando estiver bom.'"
    )]
    async fn import_from_video_url(
        &self,
        Parameters(args): Parameters<ImportFromVideoUrlArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "url": args.url,
            "instruction": args.instruction.unwrap_or_default(),
            "force_redownload": args.force_redownload.unwrap_or(false),
            "duration_sec": args.duration_sec,
            "tone": args.tone,
            "focus": args.focus,
        });
        self.bridge_write("import-from-video-url", payload).await
    }

    #[tool(
        description = "Cria um reel a partir de um artigo. Aceita URL (será fetchada) OU texto colado OU 'blocks_json' (string JSON com array `[{\"kind\":\"avatar|broll\",\"text\":\"...\"}, ...]` que VOCÊ já preparou). No modo Claude (texto via assinatura), prefira gerar os blocos você mesmo e passar em blocks_json. Surface um draft card no chat — o usuário aprova com botão Aplicar (campo `draft_id` no retorno + status='pending-user-approval'). Diga ao usuário: 'Pronto, dá uma olhada abaixo e aprova quando estiver bom.'"
    )]
    async fn import_from_article(
        &self,
        Parameters(args): Parameters<ImportFromArticleArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "url": args.url,
            "text": args.text,
            "title": args.title,
            "duration_sec": args.duration_sec.unwrap_or(30),
            "style": args.style,
            "framework": args.framework,
            "instruction": args.instruction.unwrap_or_default(),
            "blocks_json": args.blocks_json,
        });
        self.bridge_write("import-from-article", payload).await
    }

    #[tool(
        description = "Importa um script colado classificando cada bloco como 'avatar' ou 'broll'. Modo padrão: classificação via Gemini (heuristic_only=true usa regex). Modo Claude: VOCÊ classifica e passa 'blocks_json' (string JSON com `[{\"kind\":\"avatar|broll\",\"text\":\"...\"}, ...]`)."
    )]
    async fn import_from_script(
        &self,
        Parameters(args): Parameters<ImportFromScriptArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "text": args.text,
            "heuristic_only": args.heuristic_only.unwrap_or(false),
            "blocks_json": args.blocks_json,
        });
        self.bridge_write("import-from-script", payload).await
    }

    #[tool(
        description = "Reescreve o roteiro inteiro seguindo uma instrução ('deixa mais punk', 'encurta pra 20s'). Modo padrão: Gemini reescreve. Modo Claude: VOCÊ escreve os blocos novos e passa em 'blocks_json' (string JSON com `[{\"kind\":\"avatar|broll\",\"text\":\"...\"}, ...]`). Surface um draft card no chat — o usuário aprova com botão Aplicar antes de substituir o roteiro atual (campo `draft_id` no retorno + status='pending-user-approval'). Diga: 'Reescrevi assim, dá uma olhada e aplica quando estiver bom.'"
    )]
    async fn recreate_full_script(
        &self,
        Parameters(args): Parameters<RecreateFullScriptArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "instruction": args.instruction,
            "blocks_json": args.blocks_json,
        });
        self.bridge_write("recreate-full-script", payload).await
    }

    #[tool(
        description = "Gera um carrossel (N slides) a partir de um tópico. Modo padrão: Gemini gera. Modo Claude: VOCÊ escreve e passa 'slides_json' (string JSON com `[{\"text\":\"...\",\"role\":\"hook|insight|stat|cta|tip|story|closing\",\"visualHint\":\"...\"}, ...]`). num_slides: 3-15 (default 7). tone: educativo|viral|inspiracional|vendas|opiniao|storytelling (default educativo). Surface um draft card no chat — o usuário aprova com Aplicar antes de substituir o projeto (campo `draft_id` + status='pending-user-approval')."
    )]
    async fn generate_carousel(
        &self,
        Parameters(args): Parameters<GenerateCarouselArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "topic": args.topic,
            "num_slides": args.num_slides.unwrap_or(7),
            "tone": args.tone.unwrap_or_else(|| "educativo".into()),
            "slides_json": args.slides_json,
        });
        self.bridge_write("generate-carousel", payload).await
    }

    // ---- Wave 2: visual tools (motion + avatar) ----

    #[tool(
        description = "Lista todos os style presets disponíveis para motion graphics. Retorna id, label PT-BR, mood (dark/light/warm) e descrição curta. Use isto antes de chamar apply_style_preset ou generate_motion_for_block para escolher o preset certo."
    )]
    async fn list_style_presets(&self) -> Result<CallToolResult, McpError> {
        // Static — no React roundtrip needed; we maintain this mirror of
        // motionStylePresets.ts here so the agent can discover options
        // without waiting on a tool-call event.
        let presets = json!([
            { "id": "editorial-clean", "label": "Editorial limpo", "mood": "light",
              "desc": "Tipografia editorial, layout leve, vibe revista." },
            { "id": "bold-pop", "label": "Bold pop", "mood": "light",
              "desc": "Cores vivas, contraste alto, animação punchy." },
            { "id": "glass-tech", "label": "Tech vidro", "mood": "dark",
              "desc": "Glassmorphism, glow, ambiente tech moderno (default)." },
            { "id": "kinetic-bold", "label": "Kinético bold", "mood": "dark",
              "desc": "Texto enorme animado, ritmo de TikTok energético." },
            { "id": "soft-pastel", "label": "Pastel suave", "mood": "light",
              "desc": "Cores pastel, animações lentas, calmo." },
            { "id": "cinematic-dark", "label": "Cinematográfico dark", "mood": "dark",
              "desc": "Vibe filme noir, contraste alto, vinheta forte." },
            { "id": "apple-system", "label": "Apple system", "mood": "light",
              "desc": "Inspirado nos keynotes da Apple — limpo e premium." },
            { "id": "warm-editorial", "label": "Editorial quente", "mood": "warm",
              "desc": "Tons cream/sépia, vibe newsletter premium." },
            { "id": "claude-ui", "label": "Claude UI", "mood": "light",
              "desc": "Mimica a interface do Claude — útil pra demos meta." }
        ]);
        Ok(CallToolResult::success(vec![Content::text(presets.to_string())]))
    }

    #[tool(
        description = "Gera uma thumbnail (capa de Reels/TikTok 9:16) premium com IA. Utiliza um fluxo em duas etapas: (1) pesquisa grounded (Gemini 3.5 Flash) sobre marcas e logotipos citados e CTR do nicho; (2) fusão com o padrão estético Rob Boliver (deep dark background, electric cyan/sapphire/indigo/violet accents, tipografia oversized bold sans-serif) e geração final de imagem via GPT Image 2 no Fal.ai. Salva o arquivo diretamente na pasta Assets do projeto."
    )]
    async fn generate_thumbnail(
        &self,
        Parameters(args): Parameters<GenerateThumbnailArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "video_title": args.video_title,
            "script_summary": args.script_summary,
            "instructions": args.instructions,
            "style": args.style.unwrap_or_else(|| "standard".into()),
            "creator_photo_base64": args.creator_photo_base64,
        });
        self.bridge_write("generate-thumbnail", payload).await
    }

    #[tool(
        description = "Aplica um style preset (vibe visual) em UM bloco específico. Não regenera o motion HTML automaticamente — chame generate_motion_for_block depois se quiser que o HTML seja gerado com o novo preset."
    )]
    async fn apply_style_preset(
        &self,
        Parameters(args): Parameters<ApplyStylePresetArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "id": args.id, "preset_id": args.preset_id });
        self.bridge_write("apply-style-preset", payload).await
    }

    #[tool(
        description = "Aplica style preset em UM bloco + propaga pra todos os outros que ainda não têm motion HTML gerado. Útil pra definir a vibe do reel inteiro de uma vez. Blocos com motion HTML já gerado mantêm o preset antigo."
    )]
    async fn apply_style_preset_cascade(
        &self,
        Parameters(args): Parameters<ApplyStylePresetCascadeArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "id": args.id, "preset_id": args.preset_id });
        self.bridge_write("apply-style-preset-cascade", payload).await
    }

    #[tool(
        description = "Gera o motion graphic (HTML+CSS+JS via HyperFrames) para UM bloco. \
        \
        Dois modos: \
        • Modo padrão (Gemini Pro): omita o campo 'html'. Gemini gera o HTML com Google Search grounding (capta cores de marca automaticamente quando o bloco menciona produtos). \
        • Modo Claude (quando o usuário definiu 'Sempre Claude' em settings, ou não tem GOOGLE_API_KEY): você gera o HTML diretamente seguindo o HyperFrames Reference Pack que está no seu system prompt e passa em 'html'. Mais lento mas usa só a assinatura Claude. \
        \
        Em qualquer modo, depois de chamar isto chame render_motions para virar MP4. Custo Gemini: ~$0.02 por bloco. Custo Claude: ~$0.04 por bloco em tokens."
    )]
    async fn generate_motion_for_block(
        &self,
        Parameters(args): Parameters<GenerateMotionForBlockArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "id": args.id,
            "intent": args.intent.unwrap_or_default(),
            "preset_id": args.preset_id,
            "html": args.html,
        });
        self.bridge_write("generate-motion-for-block", payload).await
    }

    #[tool(
        description = "Gera motion para MÚLTIPLOS blocos numa única chamada. UMA aprovação só (não 8 cards separados). O front-end serializa a renderização (1 Chromium por vez) pra não saturar o Mac. SEMPRE prefira esta tool sobre chamar generate_motion_for_block em paralelo — nunca dispare múltiplos generate_motion_for_block no mesmo turno. \
        \
        Modo padrão (Gemini): omita html_by_id. Cada bloco vai pelo Gemini Pro um após o outro, com a fila de render rodando em série. \
        \
        Modo Claude: passe html_by_id (JSON string) com `{\"block_id\": \"<html>\", ...}` para cada bloco que VOCÊ já hand-authored. Blocos sem entrada no mapa caem no Gemini. \
        \
        Filtros (quando `ids` é omitido): 'missing' (default — só blocos sem motion gerado), 'broll' (só blocos B-roll), 'avatar' (só avatar), 'all' (todos). \
        \
        Retorna `{ ok: N, failed: M, failed_ids: [...] }`."
    )]
    async fn generate_motion_for_blocks(
        &self,
        Parameters(args): Parameters<GenerateMotionForBlocksArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "ids": args.ids,
            "filter": args.filter.unwrap_or_else(|| "missing".into()),
            "preset_id": args.preset_id,
            "intent": args.intent.unwrap_or_default(),
            "html_by_id": args.html_by_id,
        });
        self.bridge_write("generate-motion-for-blocks", payload).await
    }

    #[tool(
        description = "Renderiza os motions do projeto em MP4 (HyperFrames CLI + Chromium headless). Cada render leva ~30-60s por bloco. pending_only=true (default) só renderiza os que mudaram desde a última render."
    )]
    async fn render_motions(
        &self,
        Parameters(args): Parameters<RenderMotionsArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "pending_only": args.pending_only.unwrap_or(true),
        });
        self.bridge_write("render-motions", payload).await
    }

    #[tool(
        description = "Gera clipes de avatar (HeyGen) para todos os blocos do tipo 'avatar' do projeto. Requer áudio já gerado e photo selecionada. Use mock=true para clipes coloridos sintéticos (zero custo HeyGen, ideal pra testar export)."
    )]
    async fn generate_avatar_clips(
        &self,
        Parameters(args): Parameters<GenerateAvatarClipsArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "mock": args.mock.unwrap_or(false) });
        self.bridge_write("generate-avatar-clips", payload).await
    }

    // ---- Avatar photo management ----

    #[tool(
        description = "Lista todas as photos de avatar disponíveis (HeyGen talking photos) com id, nome e thumbnail. Use isto antes de set_avatar_photo se precisar saber os ids."
    )]
    async fn list_avatar_photos(&self) -> Result<CallToolResult, McpError> {
        match super::tool_bridge::dispatch_to_react(
            &self.app,
            &self.tool_calls,
            "list-avatar-photos",
            json!({}),
        )
        .await
        {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(value.to_string())])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Falha ao listar photos: {e}"
            ))])),
        }
    }

    #[tool(
        description = "Define qual photo de avatar usar para os próximos clipes. photo_id vem de list_avatar_photos. Use pick_avatar_photo se quiser mostrar um picker visual pro usuário escolher."
    )]
    async fn set_avatar_photo(
        &self,
        Parameters(args): Parameters<SetAvatarPhotoArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "photo_id": args.photo_id });
        self.bridge_write("set-avatar-photo", payload).await
    }

    #[tool(
        description = "Faz upload de uma nova foto pro HeyGen e cadastra como avatar disponível. \
        \
        Use quando o usuário arrasta uma imagem no chat e pede pra subir/cadastrar/usar como avatar. O path da imagem vem do anexo (atributo `<image_path>` na mensagem do usuário, ou o file path absoluto se ele colou). \
        \
        Aceita JPG/PNG até 5MB. Retorna o `photo_id` da photo cadastrada — APÓS o upload, automaticamente seleciona ela como photo ativa (não precisa chamar set_avatar_photo depois). \
        \
        Custo: 1 request HeyGen pra upload (o talking_photo gerado fica cadastrado na conta do usuário; pode ser reutilizado depois)."
    )]
    async fn upload_avatar_photo(
        &self,
        Parameters(args): Parameters<UploadAvatarPhotoArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "image_path": args.image_path,
            "name": args.name,
        });
        self.bridge_write("upload-avatar-photo", payload).await
    }

    #[tool(
        description = "Abre um picker visual NO CHAT com todas as photos de avatar disponíveis. O usuário clica em uma thumbnail e a escolha é aplicada automaticamente. Retorna a photo escolhida ou erro se o usuário cancelou. Esta é a tool preferida quando o usuário não especificou qual photo usar."
    )]
    async fn pick_avatar_photo(&self) -> Result<CallToolResult, McpError> {
        // 1) Ask React for the photo list (it lives in localStorage).
        let list_result = super::tool_bridge::dispatch_to_react(
            &self.app,
            &self.tool_calls,
            "list-avatar-photos",
            json!({}),
        )
        .await;
        let photos_value = match list_result {
            Ok(v) => v,
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Falha ao listar photos: {e}"
                ))]));
            }
        };
        let photos = photos_value
            .get("photos")
            .and_then(|p| p.as_array())
            .cloned()
            .unwrap_or_default();

        if photos.is_empty() {
            return Ok(CallToolResult::error(vec![Content::text(
                "Nenhuma photo de avatar cadastrada. Adicione uma photo no app antes (botão Avatars → Add photo).".to_string(),
            )]));
        }

        // 2) Convert to picker options.
        let options: Vec<super::picker::PickerOption> = photos
            .iter()
            .filter_map(|p| {
                let id = p.get("id")?.as_str()?.to_string();
                let name = p.get("name")?.as_str()?.to_string();
                let thumbnail = p
                    .get("thumbnail")
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string());
                let is_talking_id = p
                    .get("is_talking_id")
                    .and_then(|t| t.as_bool())
                    .unwrap_or(false);
                Some(super::picker::PickerOption {
                    id,
                    label: name,
                    description: None,
                    thumbnail,
                    badge: if is_talking_id { Some("TalkingID".into()) } else { None },
                })
            })
            .collect();

        // 3) Open the picker, wait for the user's pick.
        let chosen = super::picker::request_picker(
            &self.app,
            &self.pickers,
            "photo",
            "Qual photo usar para os clipes?",
            Some("Toque numa para selecionar."),
            options,
        )
        .await;

        let Some(photo_id) = chosen else {
            return Ok(CallToolResult::error(vec![Content::text(
                "Seleção cancelada pelo usuário.".to_string(),
            )]));
        };

        // 4) Apply the choice via existing set-photo bridge.
        match super::tool_bridge::dispatch_to_react(
            &self.app,
            &self.tool_calls,
            "set-avatar-photo",
            json!({ "photo_id": photo_id }),
        )
        .await
        {
            Ok(_) => Ok(CallToolResult::success(vec![Content::text(
                json!({ "photo_id": photo_id, "selected": true }).to_string(),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Photo escolhida mas falha ao aplicar: {e}"
            ))])),
        }
    }

    #[tool(
        description = "Define o modelo HeyGen para gerar clipes: 'avatar3' (mais barato e rápido) ou 'avatar4' (qualidade superior, mais lento e caro)."
    )]
    async fn set_avatar_model(
        &self,
        Parameters(args): Parameters<SetAvatarModelArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "model": args.model });
        self.bridge_write("set-avatar-model", payload).await
    }

    // ---- Wave 3: caption + config + motion edit ----

    #[tool(
        description = "Gera (ou aplica) a descrição do Instagram para o reel atual. Modo padrão: Gemini Flash escreve baseado nos blocos. Modo Claude: VOCÊ escreve a caption e passa em 'text' (use markdown apenas se o usuário pedir; o ideal é caption corrida com 1 quebra entre frases e hashtags ao fim). A caption fica no painel de Descrição."
    )]
    async fn generate_caption_instagram(
        &self,
        Parameters(args): Parameters<GenerateCaptionInstagramArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "text": args.text });
        self.bridge_write("generate-caption-instagram", payload).await
    }

    #[tool(
        description = "Define a emoção da voz para a próxima geração de áudio TTS. Valores: neutral, happy, sad, angry, fearful, surprised. Não regera áudio existente — chame generate_audio depois se quiser aplicar."
    )]
    async fn set_emotion(
        &self,
        Parameters(args): Parameters<SetEmotionArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "emotion": args.emotion });
        self.bridge_write("set-emotion", payload).await
    }

    #[tool(
        description = "Troca o tema visual do app entre 'dark' e 'light'. Aplicado imediatamente em toda a UI (timeline, modais, painel do agente)."
    )]
    async fn set_app_theme(
        &self,
        Parameters(args): Parameters<SetAppThemeArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "theme": args.theme });
        self.bridge_write("set-app-theme", payload).await
    }

    #[tool(
        description = "Renomeia o projeto atual. O nome aparece na top bar e vira o nome default de arquivos exportados."
    )]
    async fn set_project_name(
        &self,
        Parameters(args): Parameters<SetProjectNameArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "name": args.name });
        self.bridge_write("set-project-name", payload).await
    }

    #[tool(
        description = "Substitui o HTML de um motion existente em UM bloco. Use quando o usuário pedir mudança específica num motion já gerado ('muda o background pra preto', 'aumenta o tamanho do texto'). VOCÊ escreve o HTML novo seguindo as regras do HyperFrames (timeline registry, animation grammar). Marca o motion como pending re-render."
    )]
    async fn edit_motion_html(
        &self,
        Parameters(args): Parameters<EditMotionHtmlArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "id": args.id,
            "html": args.html,
            "intent": args.intent,
        });
        self.bridge_write("edit-motion-html", payload).await
    }

    // ---- Wave 3: voice tools ----

    #[tool(
        description = "Lista todas as vozes disponíveis: built-in Minimax (Marina, Rob, etc) + vozes clonadas pelo usuário. Retorna id, nome, tipo (builtin/cloned) e indicador de preview disponível. Use isto antes de set_voice ou pick_voice."
    )]
    async fn list_voices(&self) -> Result<CallToolResult, McpError> {
        match super::tool_bridge::dispatch_to_react(
            &self.app,
            &self.tool_calls,
            "list-voices",
            json!({}),
        )
        .await
        {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(value.to_string())])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Falha ao listar vozes: {e}"
            ))])),
        }
    }

    #[tool(
        description = "Abre um picker visual NO CHAT com todas as vozes disponíveis (built-in + clonadas). Usuário clica numa pra selecionar. Preferida sobre set_voice quando o usuário não especificou qual voz. Retorna a voz escolhida."
    )]
    async fn pick_voice(&self) -> Result<CallToolResult, McpError> {
        let list_result = super::tool_bridge::dispatch_to_react(
            &self.app,
            &self.tool_calls,
            "list-voices",
            json!({}),
        )
        .await;
        let voices_value = match list_result {
            Ok(v) => v,
            Err(e) => {
                return Ok(CallToolResult::error(vec![Content::text(format!(
                    "Falha ao listar vozes: {e}"
                ))]));
            }
        };
        let voices = voices_value
            .get("voices")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        if voices.is_empty() {
            return Ok(CallToolResult::error(vec![Content::text(
                "Nenhuma voz disponível.".to_string(),
            )]));
        }

        let options: Vec<super::picker::PickerOption> = voices
            .iter()
            .filter_map(|v| {
                let id = v.get("id")?.as_str()?.to_string();
                let name = v.get("name")?.as_str()?.to_string();
                let kind = v.get("kind").and_then(|k| k.as_str()).unwrap_or("builtin");
                let description = v
                    .get("description")
                    .and_then(|d| d.as_str())
                    .map(|s| s.to_string());
                let badge = if kind == "cloned" { Some("Clonada".into()) } else { None };
                Some(super::picker::PickerOption {
                    id,
                    label: name,
                    description,
                    thumbnail: None,
                    badge,
                })
            })
            .collect();

        let chosen = super::picker::request_picker(
            &self.app,
            &self.pickers,
            "voice",
            "Qual voz usar?",
            Some("Toque numa pra selecionar."),
            options,
        )
        .await;

        let Some(voice_id) = chosen else {
            return Ok(CallToolResult::error(vec![Content::text(
                "Seleção cancelada pelo usuário.".to_string(),
            )]));
        };

        match super::tool_bridge::dispatch_to_react(
            &self.app,
            &self.tool_calls,
            "set-voice",
            json!({ "voice_id": voice_id }),
        )
        .await
        {
            Ok(_) => Ok(CallToolResult::success(vec![Content::text(
                json!({ "voice_id": voice_id, "selected": true }).to_string(),
            )])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Voz escolhida mas falha ao aplicar: {e}"
            ))])),
        }
    }

    #[tool(
        description = "Ajusta a velocidade da fala (TTS Minimax). 1.0 = normal, 0.5 = metade, 2.0 = dobro. Aplica na próxima geração de áudio — chame generate_audio depois pra ouvir."
    )]
    async fn set_voice_speed(
        &self,
        Parameters(args): Parameters<SetVoiceSpeedArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "speed": args.speed });
        self.bridge_write("set-voice-speed", payload).await
    }

    #[tool(
        description = "Clona uma voz a partir de um arquivo de áudio (WAV/MP3/M4A). Recebe o path absoluto do arquivo (geralmente um anexo do chat) + nome user-facing. Custo: ~$0.50 via fal.ai. A voz clonada expira em 7 dias se não usada. Default model: speech-02-hd (alta qualidade)."
    )]
    async fn clone_voice_from_audio(
        &self,
        Parameters(args): Parameters<CloneVoiceFromAudioArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "audio_path": args.audio_path,
            "name": args.name,
            "model": args.model.unwrap_or_else(|| "speech-02-hd".into()),
        });
        self.bridge_write("clone-voice-from-audio", payload).await
    }

    // ---- Wave 3: assets + references ----

    #[tool(
        description = "Lista todos os assets (imagens e vídeos) na pasta Assets do projeto atual. Retorna name, path absoluto, type (image/video) e tamanho. Use isto antes de attach_asset_from_path."
    )]
    async fn list_assets(&self) -> Result<CallToolResult, McpError> {
        match super::tool_bridge::dispatch_to_react(
            &self.app,
            &self.tool_calls,
            "list-assets",
            json!({}),
        )
        .await
        {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(value.to_string())])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Falha ao listar assets: {e}"
            ))])),
        }
    }

    #[tool(
        description = "Anexa um arquivo (imagem/vídeo) a um bloco como B-roll. Aceita path absoluto (de list_assets, de um anexo do chat ou de qualquer arquivo no disco). Auto-detecta image/video pela extensão se 'asset_type' for omitido."
    )]
    async fn attach_asset_from_path(
        &self,
        Parameters(args): Parameters<AttachAssetFromPathArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "block_id": args.block_id,
            "asset_path": args.path,
            "asset_type": args.asset_type,
        });
        self.bridge_write("add-block-asset", payload).await
    }

    #[tool(
        description = "Lista os vídeos de referência analisados que ficam em ~/Reels Studio/References/. Retorna fileName, sizeBytes e createdAt pra cada um. Use antes de reanalyse_reference ou delete_reference."
    )]
    async fn list_references(&self) -> Result<CallToolResult, McpError> {
        match super::tool_bridge::dispatch_to_react(
            &self.app,
            &self.tool_calls,
            "list-references",
            json!({}),
        )
        .await
        {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(value.to_string())])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Falha ao listar referências: {e}"
            ))])),
        }
    }

    #[tool(
        description = "Apaga um vídeo de referência do disco. Irreversível. Use o fileName de list_references."
    )]
    async fn delete_reference(
        &self,
        Parameters(args): Parameters<DeleteReferenceArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "file_name": args.file_name });
        self.bridge_write("delete-reference", payload).await
    }

    #[tool(
        description = "Re-roda a análise Gemini num vídeo de referência já salvo (sem baixar de novo). Surface um draft card no chat — o usuário aprova antes de substituir o roteiro atual (campo `draft_id` + status='pending-user-approval'). fileName vem de list_references."
    )]
    async fn reanalyse_reference(
        &self,
        Parameters(args): Parameters<ReanalyseReferenceArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "file_name": args.file_name,
            "instruction": args.instruction.unwrap_or_default(),
        });
        self.bridge_write("reanalyse-reference", payload).await
    }

    // ---- Approval prompt tool ----
    // Claude Code invokes this whenever the model tries a tool not in the
    // auto-allowed list (i.e. any write tool above). We surface a card to
    // the user and return the standard {behavior: allow|deny, …} response.

    #[tool(
        description = "Solicita aprovação humana antes de executar uma tool sensível. Esta tool é chamada automaticamente pelo runtime do Claude Code via --permission-prompt-tool — não a invoque diretamente."
    )]
    async fn request_user_approval(
        &self,
        Parameters(args): Parameters<ApprovalToolArgs>,
    ) -> Result<CallToolResult, McpError> {
        let decision = request_approval(
            &self.app,
            &self.approvals,
            args.tool_name.clone(),
            args.input.clone(),
        )
        .await;

        let body = if decision.allow {
            json!({
                "behavior": "allow",
                "updatedInput": decision.updated_input.unwrap_or(args.input),
            })
        } else {
            json!({
                "behavior": "deny",
                "message": decision.reason.unwrap_or_else(|| "Usuário rejeitou a ação.".into()),
            })
        };
        Ok(CallToolResult::success(vec![Content::text(body.to_string())]))
    }
}

// ---------- Helpers -----------------------------------------------------

impl ReelsAgentService {
    /// Shared implementation for every write tool: emit a `reels://tool-call`
    /// event the React bridge listens for, wait for the front-end to apply
    /// it and reply via `agent_tool_result`.
    async fn bridge_write(
        &self,
        action_type: &str,
        payload: serde_json::Value,
    ) -> Result<CallToolResult, McpError> {
        match dispatch_to_react(&self.app, &self.tool_calls, action_type, payload).await {
            Ok(value) => Ok(CallToolResult::success(vec![Content::text(value.to_string())])),
            Err(e) => Ok(CallToolResult::error(vec![Content::text(format!(
                "Falha ao aplicar `{action_type}` no front-end: {e}"
            ))])),
        }
    }
}

#[tool_handler]
impl ServerHandler for ReelsAgentService {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::from_build_env())
            .with_protocol_version(ProtocolVersion::V_2025_03_26)
            .with_instructions(
                "Reels Studio MCP server. Tools de leitura (list_blocks, read_block, get_project_status) \
                são auto-aprovadas. Tools de escrita pedem confirmação do usuário antes de aplicar. \
                Use list_blocks/get_project_status antes de qualquer mudança para entender o estado atual."
                    .to_string(),
            )
    }
}

/// Public entry-point. Binds to 127.0.0.1:0 (ephemeral), records the chosen
/// port in AgentState, and serves the MCP HTTP service until `cancel` fires.
/// Returns the chosen port so callers can register it with `claude mcp add`.
pub async fn spawn_mcp_server(
    state: AgentState,
    app: AppHandle,
    approvals: PendingApprovals,
    tool_calls: PendingToolCalls,
    pickers: super::picker::PendingPickers,
    cancel: CancellationToken,
) -> Result<u16, String> {
    let bind: SocketAddr = "127.0.0.1:0".parse().expect("static bind addr");
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .map_err(|e| format!("bind mcp listener: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?
        .port();

    state.set_mcp_port(port);

    let factory_state = state.clone();
    let factory_app = app.clone();
    let factory_approvals = approvals.clone();
    let factory_tool_calls = tool_calls.clone();
    let factory_pickers = pickers.clone();
    let service = StreamableHttpService::new(
        move || {
            Ok(ReelsAgentService::new(
                factory_state.clone(),
                factory_app.clone(),
                factory_approvals.clone(),
                factory_tool_calls.clone(),
                factory_pickers.clone(),
            ))
        },
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default(),
    );

    let router = axum::Router::new().nest_service("/mcp", service);
    let shutdown_cancel = cancel.clone();

    tokio::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async move {
            shutdown_cancel.cancelled().await;
        });
        if let Err(e) = server.await {
            eprintln!("[agent] mcp server exited with error: {e}");
        }
    });

    Ok(port)
}
