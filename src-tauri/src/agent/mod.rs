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
