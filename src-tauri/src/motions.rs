// Motion graphics renderer — HyperFrames pipeline.
//
// Folder convention: ~/Reels Studio/Motions/<motion-id>/
//   index.html    — composition (ready to be rendered by HyperFrames)
//   meta.json     — minimal HyperFrames metadata
//   hyperframes.json — config so the CLI finds the project
//   package.json  — script aliases (purely cosmetic, optional)
//   output.mp4    — final rendered MP4 (created by render_motion)
//
// Each motion lives in its own subfolder so multiple motions can render
// concurrently without collision. The folder is reusable: re-rendering
// overwrites output.mp4.

use std::path::PathBuf;
use std::process::Stdio;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MotionRenderResult {
    pub motion_id: String,
    pub html_path: String,
    pub mp4_path: String,
    pub size_bytes: u64,
    pub duration_sec: f32,
}

#[derive(Debug, Serialize, Clone)]
pub struct MotionRenderProgress {
    pub motion_id: String,
    pub stage: String, // "preparing" | "rendering" | "encoding" | "done" | "error"
    pub message: String,
    pub percent: Option<f32>,
}

fn motions_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Não consegui resolver home.".to_string())?;
    Ok(home.join("Reels Studio").join("Motions"))
}

fn motion_dir(motion_id: &str) -> Result<PathBuf, String> {
    // Guard against path traversal in motion_id.
    if motion_id.contains('/') || motion_id.contains('\\') || motion_id.contains("..") {
        return Err("motion_id inválido.".into());
    }
    Ok(motions_root()?.join(motion_id))
}

fn ensure_motion_dir(motion_id: &str) -> Result<PathBuf, String> {
    let dir = motion_dir(motion_id)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Falha ao criar pasta do motion: {e}"))?;
    Ok(dir)
}

const HYPERFRAMES_JSON: &str = r#"{
  "$schema": "https://hyperframes.heygen.com/schema/hyperframes.json",
  "registry": "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  "paths": {
    "blocks": "compositions",
    "components": "compositions/components",
    "assets": "assets"
  }
}
"#;

fn write_project_files(dir: &PathBuf, motion_id: &str, html: &str) -> Result<(), String> {
    std::fs::write(dir.join("index.html"), html)
        .map_err(|e| format!("Falha ao gravar index.html: {e}"))?;
    std::fs::write(dir.join("hyperframes.json"), HYPERFRAMES_JSON)
        .map_err(|e| format!("Falha ao gravar hyperframes.json: {e}"))?;
    let meta = format!(r#"{{ "id": "{}", "name": "{}" }}"#, motion_id, motion_id);
    std::fs::write(dir.join("meta.json"), meta)
        .map_err(|e| format!("Falha ao gravar meta.json: {e}"))?;
    let pkg = r#"{ "name": "motion", "private": true, "type": "module", "scripts": { "render": "npx --yes hyperframes@0.5.0 render" } }"#;
    std::fs::write(dir.join("package.json"), pkg)
        .map_err(|e| format!("Falha ao gravar package.json: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn motions_dir() -> Result<String, String> {
    let root = motions_root()?;
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Falha ao criar pasta de motions: {e}"))?;
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn save_motion_html(motion_id: String, html: String) -> Result<String, String> {
    let dir = ensure_motion_dir(&motion_id)?;
    write_project_files(&dir, &motion_id, &html)?;
    Ok(dir.join("index.html").to_string_lossy().into_owned())
}

#[tauri::command]
pub fn read_motion_html(motion_id: String) -> Result<Option<String>, String> {
    let path = motion_dir(&motion_id)?.join("index.html");
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|e| format!("Falha ao ler index.html: {e}"))
}

#[tauri::command]
pub fn delete_motion(motion_id: String) -> Result<(), String> {
    let dir = motion_dir(&motion_id)?;
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|e| format!("Falha ao apagar: {e}"))?;
    }
    Ok(())
}

/// Render a motion folder to MP4 using HyperFrames CLI.
/// Requires Node + FFmpeg on PATH (HyperFrames pulls in headless Chrome itself).
#[tauri::command]
pub async fn render_motion(app: AppHandle, motion_id: String) -> Result<MotionRenderResult, String> {
    let dir = motion_dir(&motion_id)?;
    let html_path = dir.join("index.html");
    if !html_path.exists() {
        return Err("index.html não encontrado pra esse motion.".into());
    }

    // Patch repeat:-1 → finite count before handing to HyperFrames.
    // HyperFrames is a deterministic frame capturer — infinite GSAP loops break it.
    {
        let html = std::fs::read_to_string(&html_path)
            .map_err(|e| format!("Falha ao ler index.html: {e}"))?;
        if html.contains("repeat: -1") || html.contains("repeat:-1") {
            let patched = html
                .replace("repeat: -1", "repeat: 4")
                .replace("repeat:-1", "repeat:4");
            std::fs::write(&html_path, patched)
                .map_err(|e| format!("Falha ao corrigir repeat:-1: {e}"))?;
        }
    }

    let mp4_path = dir.join("output.mp4");

    let _ = app.emit("motion://render-progress", MotionRenderProgress {
        motion_id: motion_id.clone(),
        stage: "preparing".into(),
        message: "Iniciando HyperFrames…".into(),
        percent: None,
    });

    // Use `npx --yes hyperframes@0.5.0 render -o output.mp4`. Pin the version so
    // upgrades don't surprise us in the middle of a session.
    // Tauri does not inherit the shell PATH, so resolve npx explicitly.
    let npx_path = ["npx", "/usr/local/bin/npx", "/usr/bin/npx", "/opt/homebrew/bin/npx"]
        .iter()
        .find(|&&p| std::path::Path::new(p).exists() || p == "npx")
        .copied()
        .unwrap_or("npx");
    let mut cmd = Command::new(npx_path);
    cmd.current_dir(&dir)
        .env("PATH", "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin")
        .arg("--yes")
        .arg("hyperframes@0.5.0")
        .arg("render")
        .arg("-o")
        .arg("output.mp4")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!("npx não encontrado ({e}). Instale Node.js (brew install node).")
    })?;

    let stdout = child.stdout.take().ok_or_else(|| "sem stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "sem stderr".to_string())?;

    let app_for_stdout = app.clone();
    let mid_for_stdout = motion_id.clone();
    let stdout_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            let percent = parse_percent(trimmed);
            let stage = if percent.is_some() { "rendering" } else { "info" };
            let _ = app_for_stdout.emit("motion://render-progress", MotionRenderProgress {
                motion_id: mid_for_stdout.clone(),
                stage: stage.into(),
                message: trimmed.into(),
                percent,
            });
        }
    });

    let app_for_stderr = app.clone();
    let mid_for_stderr = motion_id.clone();
    let stderr_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            let _ = app_for_stderr.emit("motion://render-progress", MotionRenderProgress {
                motion_id: mid_for_stderr.clone(),
                stage: "info".into(),
                message: trimmed.into(),
                percent: None,
            });
        }
    });

    let status = child.wait().await.map_err(|e| format!("HyperFrames travou: {e}"))?;
    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

    if !status.success() {
        let _ = app.emit("motion://render-progress", MotionRenderProgress {
            motion_id: motion_id.clone(),
            stage: "error".into(),
            message: format!("HyperFrames saiu com código {:?}", status.code()),
            percent: None,
        });
        return Err(format!(
            "HyperFrames falhou (exit {:?}). Rode `cd {} && npm run check` no terminal pra investigar.",
            status.code(), dir.to_string_lossy()
        ));
    }

    if !mp4_path.exists() {
        return Err("HyperFrames terminou sem produzir output.mp4.".into());
    }

    let metadata = std::fs::metadata(&mp4_path).map_err(|e| format!("stat falhou: {e}"))?;

    let _ = app.emit("motion://render-progress", MotionRenderProgress {
        motion_id: motion_id.clone(),
        stage: "done".into(),
        message: "Render concluído.".into(),
        percent: Some(100.0),
    });

    Ok(MotionRenderResult {
        motion_id,
        html_path: html_path.to_string_lossy().into_owned(),
        mp4_path: mp4_path.to_string_lossy().into_owned(),
        size_bytes: metadata.len(),
        duration_sec: 0.0, // HyperFrames doesn't print this in stdout reliably; UI keeps its own duration.
    })
}

#[tauri::command]
pub fn read_motion_video_bytes(motion_id: String) -> Result<Vec<u8>, String> {
    let path = motion_dir(&motion_id)?.join("output.mp4");
    if !path.exists() {
        return Err("output.mp4 ainda não foi renderizado.".into());
    }
    std::fs::read(path).map_err(|e| format!("Falha ao ler MP4: {e}"))
}

fn parse_percent(line: &str) -> Option<f32> {
    // HyperFrames may emit lines like "Rendering frame 60/180 (33%)". Match any "<n>%".
    let bytes = line.as_bytes();
    let pct_idx = line.find('%')?;
    let mut start = pct_idx;
    while start > 0 {
        let c = bytes[start - 1];
        if c.is_ascii_digit() || c == b'.' { start -= 1; } else { break; }
    }
    if start == pct_idx { return None; }
    line[start..pct_idx].parse::<f32>().ok()
}
