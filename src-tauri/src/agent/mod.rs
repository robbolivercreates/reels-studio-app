// Agent subsystem: local MCP server + Claude Code CLI bridge.
//
// PR1 — read-only MCP tools + auto-register with `claude mcp` (done).
// PR2 — spawn `claude -p`, stream events, write tools with approval (this).
// PR3 — export_mp4 + onboarding polish.

pub mod approval;
pub mod auth;
pub mod claude_subprocess;
pub mod mcp_server;
pub mod picker;
pub mod state;
pub mod tool_bridge;

use tauri::{AppHandle, Manager, State};
use tokio_util::sync::CancellationToken;

use approval::PendingApprovals;
use claude_subprocess::RunHandle;
use picker::PendingPickers;
use state::{AgentState, ReelsSnapshot};
use tool_bridge::PendingToolCalls;

pub fn init(app: &AppHandle) {
    let agent_state = AgentState::new();
    let approvals = PendingApprovals::new();
    let tool_calls = PendingToolCalls::new();
    let pickers = PendingPickers::new();
    let run_handle = RunHandle::new();

    app.manage(agent_state.clone());
    app.manage(approvals.clone());
    app.manage(tool_calls.clone());
    app.manage(pickers.clone());
    app.manage(run_handle);

    let cancel = CancellationToken::new();
    app.manage(cancel.clone());

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        match mcp_server::spawn_mcp_server(
            agent_state.clone(),
            app_for_task.clone(),
            approvals.clone(),
            tool_calls.clone(),
            pickers.clone(),
            cancel,
        )
        .await
        {
            Ok(port) => {
                eprintln!("[agent] mcp server listening on 127.0.0.1:{port}/mcp");
                match auth::register_mcp_server(port).await {
                    Ok(_) => eprintln!("[agent] registered `reels` with claude mcp"),
                    Err(e) => eprintln!("[agent] mcp registration skipped: {e}"),
                }
            }
            Err(e) => eprintln!("[agent] failed to start mcp server: {e}"),
        }
    });
}

// ---------------------- Tauri commands ----------------------------------

#[tauri::command]
pub fn agent_publish_state(
    snapshot: ReelsSnapshot,
    state: State<'_, AgentState>,
) -> Result<u64, String> {
    state.replace_snapshot(snapshot);
    Ok(state.snapshot().version)
}

#[tauri::command]
pub fn agent_mcp_port(state: State<'_, AgentState>) -> Option<u16> {
    state.mcp_port()
}

#[tauri::command]
pub async fn agent_health(state: State<'_, AgentState>) -> Result<auth::ClaudeHealth, String> {
    let port = state.mcp_port();
    Ok(auth::health(port).await)
}

#[tauri::command]
pub async fn agent_register_mcp(state: State<'_, AgentState>) -> Result<(), String> {
    let port = state
        .mcp_port()
        .ok_or_else(|| "MCP server ainda não está rodando".to_string())?;
    auth::register_mcp_server(port).await
}

/// Reads bytes from an absolute file path. Used by tools that need to
/// Write raw bytes (typically a picked image/video) to an OS temp file and
/// return its absolute path. Used by the agent chat so attachments can be
/// referenced as `@<path>` in the Claude prompt instead of being inlined as
/// base64 text. Inlining blew up two limits in sequence: ARG_MAX (OS error 7
/// when the prompt is a CLI arg) and the Claude context window ("Prompt is
/// too long") — both fixed by passing the file by path.
///
/// The caller passes the original filename (so the extension survives, which
/// the CLI uses to decide if the file is an image) and the bytes themselves.
/// Files land in `tempdir()/reels-agent-attachments/<random>-<filename>` and
/// stick around for the OS to clean. We don't reuse a stable name across
/// calls — collisions between concurrent sends would mix up content.
#[tauri::command]
pub fn agent_write_attachment_temp(filename: String, bytes: Vec<u8>) -> Result<String, String> {
    // Cap at 50 MB to match agent_read_file_b64 — pictures/clips for the
    // agent shouldn't be bigger; runaway uploads would also fill the temp
    // partition.
    const MAX_BYTES: usize = 50 * 1024 * 1024;
    if bytes.len() > MAX_BYTES {
        return Err(format!(
            "Anexo muito grande ({} MB; limite 50 MB).",
            bytes.len() / (1024 * 1024)
        ));
    }
    // Sanitize the filename — strip any directory component the browser
    // might've included and any null bytes. Spaces are fine, the CLI
    // tolerates quoted paths.
    let safe_name: String = filename
        .rsplit('/')
        .next()
        .unwrap_or("attachment")
        .replace('\0', "_");
    let dir = std::env::temp_dir().join("reels-agent-attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    // Random suffix so concurrent attachments with the same filename don't
    // overwrite each other.
    let nonce: u64 = {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
    };
    let path = dir.join(format!("{nonce:016x}-{safe_name}"));
    std::fs::write(&path, &bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// upload local files to fal.ai (e.g. clone_voice_from_audio). Locked to
/// regular files only — refuses dirs/symlinks. Returns base64 so the IPC
/// JSON channel doesn't blow up on large blobs.
#[tauri::command]
pub fn agent_read_file_b64(path: String) -> Result<String, String> {
    use base64::Engine;
    let meta = std::fs::metadata(&path).map_err(|e| format!("stat {path}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("Não é um arquivo: {path}"));
    }
    // Cap at 50 MB — Minimax voice-clone samples are typically under 30s.
    const MAX_BYTES: u64 = 50 * 1024 * 1024;
    if meta.len() > MAX_BYTES {
        return Err(format!(
            "Arquivo grande demais ({} MB; limite 50 MB).",
            meta.len() / (1024 * 1024)
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}
