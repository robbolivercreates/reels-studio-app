// Claude Code CLI integration: detect installation, check auth status,
// register/unregister the local MCP server.
//
// Everything here shells out to the user's `claude` binary, inheriting their
// HOME so `~/.claude` credentials are used. We never touch the user's
// auth files directly.

use std::process::Stdio;
use tokio::process::Command;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClaudeHealth {
    pub installed: bool,
    pub authed: bool,
    pub binary_path: Option<String>,
    pub registered: bool,
    pub mcp_port: Option<u16>,
}

/// Locate the `claude` CLI on the user's PATH. Tauri subprocesses inherit
/// the launching shell's PATH on macOS only when launched from a terminal;
/// when launched from Finder the PATH is much shorter. We compensate by
/// also checking a few common install locations.
pub fn find_claude_binary() -> Option<String> {
    if let Ok(p) = which::which("claude") {
        return Some(p.to_string_lossy().into_owned());
    }
    // Common install locations on macOS (npm global, Homebrew, fnm/nvm).
    let home = std::env::var("HOME").ok()?;
    let candidates = [
        format!("{home}/.claude/local/claude"),
        format!("{home}/.local/bin/claude"),
        format!("{home}/.npm-global/bin/claude"),
        "/opt/homebrew/bin/claude".to_string(),
        "/usr/local/bin/claude".to_string(),
    ];
    candidates.into_iter().find(|p| std::path::Path::new(p).is_file())
}

/// Quick liveness probe: `claude --version`. Returns true if exit 0.
pub async fn is_claude_installed() -> bool {
    let Some(bin) = find_claude_binary() else {
        return false;
    };
    Command::new(bin)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Check whether the user is signed in. `claude auth status` exits 0 when
/// authed, non-zero otherwise (works for both Claude.ai subscription and
/// API-key accounts).
pub async fn is_claude_authed() -> bool {
    let Some(bin) = find_claude_binary() else {
        return false;
    };
    Command::new(bin)
        .args(["auth", "status"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Check whether `reels` is already registered as an MCP server in the
/// user's Claude config.
pub async fn is_reels_mcp_registered() -> bool {
    let Some(bin) = find_claude_binary() else {
        return false;
    };
    let output = Command::new(bin)
        .args(["mcp", "list"])
        .output()
        .await;
    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.lines().any(|line| line.trim_start().starts_with("reels"))
        }
        _ => false,
    }
}

/// Register the running MCP server with the user's Claude Code CLI.
/// Idempotent: removes any prior `reels` entry first so port changes
/// across app restarts are picked up cleanly.
pub async fn register_mcp_server(port: u16) -> Result<(), String> {
    let Some(bin) = find_claude_binary() else {
        return Err("Claude Code CLI não encontrado no PATH.".into());
    };

    // Best-effort cleanup of stale registration (ignore error if not present).
    let _ = Command::new(&bin)
        .args(["mcp", "remove", "reels"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;

    let url = format!("http://127.0.0.1:{port}/mcp");
    let status = Command::new(&bin)
        .args([
            "mcp",
            "add",
            "reels",
            "--transport",
            "http",
            url.as_str(),
            "--scope",
            "user",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map_err(|e| format!("spawn claude mcp add: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "`claude mcp add` falhou (exit {})",
            status.code().unwrap_or(-1)
        ))
    }
}

/// Remove the `reels` MCP entry. Called on app shutdown so we don't leave
/// dead URLs in the user's `~/.claude.json`.
#[allow(dead_code)] // wired up in PR3 (window-close handler)
pub async fn unregister_mcp_server() -> Result<(), String> {
    let Some(bin) = find_claude_binary() else {
        return Ok(()); // nothing to do
    };
    let _ = Command::new(bin)
        .args(["mcp", "remove", "reels"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;
    Ok(())
}

/// Composite health check exposed to the React side via `agent_health`.
pub async fn health(mcp_port: Option<u16>) -> ClaudeHealth {
    let binary_path = find_claude_binary();
    let installed = binary_path.is_some() && is_claude_installed().await;
    let authed = if installed { is_claude_authed().await } else { false };
    let registered = if installed { is_reels_mcp_registered().await } else { false };
    ClaudeHealth {
        installed,
        authed,
        binary_path,
        registered,
        mcp_port,
    }
}
