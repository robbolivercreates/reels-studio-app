// Reference video downloader & store.
//
// Folder convention: ~/Reels Studio/References/  (fixed; predictable beats configurable)
// Each downloaded/imported video lands here as <safe-name>.mp4 (or original ext).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReferenceMeta {
    pub id: String,
    pub file_name: String,
    pub absolute_path: String,
    pub size_bytes: u64,
    pub source: String,             // "url" | "upload"
    pub source_url: Option<String>,
    pub created_at: u64,             // unix seconds
}

fn references_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Não consegui resolver o diretório home.".to_string())?;
    Ok(home.join("Reels Studio").join("References"))
}

fn ensure_references_dir() -> Result<PathBuf, String> {
    let dir = references_root()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Falha ao criar pasta de referências: {e}"))?;
    Ok(dir)
}

fn safe_filename(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().to_string();
    if trimmed.is_empty() { "reference".to_string() } else { trimmed }
}

fn ensure_extension(name: &str, fallback: &str) -> String {
    if Path::new(name).extension().is_some() {
        name.to_string()
    } else {
        format!("{name}.{fallback}")
    }
}

fn unique_path(dir: &Path, base_name: &str) -> PathBuf {
    let mut candidate = dir.join(base_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(base_name).file_stem().and_then(|s| s.to_str()).unwrap_or("reference").to_string();
    let ext = Path::new(base_name).extension().and_then(|s| s.to_str()).unwrap_or("mp4").to_string();
    let mut i = 1u32;
    loop {
        candidate = dir.join(format!("{stem} ({i}).{ext}"));
        if !candidate.exists() { return candidate; }
        i += 1;
    }
}

fn hash_str(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    hex::encode(&h.finalize()[..8])
}

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn meta_for(absolute: &Path, source: &str, source_url: Option<&str>) -> Result<ReferenceMeta, String> {
    let metadata = std::fs::metadata(absolute).map_err(|e| format!("stat falhou: {e}"))?;
    let file_name = absolute.file_name().and_then(|s| s.to_str()).unwrap_or("reference.mp4").to_string();
    let id_seed = source_url.unwrap_or(&file_name);
    Ok(ReferenceMeta {
        id: hash_str(id_seed),
        file_name,
        absolute_path: absolute.to_string_lossy().into_owned(),
        size_bytes: metadata.len(),
        source: source.to_string(),
        source_url: source_url.map(|s| s.to_string()),
        created_at: now_seconds(),
    })
}

fn validate_inside_references(name: &str) -> Result<PathBuf, String> {
    let dir = references_root()?;
    let candidate = dir.join(name);
    let canonical = candidate.canonicalize().map_err(|e| format!("Caminho inválido: {e}"))?;
    let dir_canonical = dir.canonicalize().map_err(|e| format!("Pasta inválida: {e}"))?;
    if !canonical.starts_with(&dir_canonical) {
        return Err("Caminho fora da pasta de referências.".into());
    }
    Ok(canonical)
}

// ─── COMMANDS ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn references_dir() -> Result<String, String> {
    let dir = ensure_references_dir()?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_references() -> Result<Vec<ReferenceMeta>, String> {
    let dir = ensure_references_dir()?;
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("Falha ao listar pasta: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        if !matches!(ext.as_str(), "mp4" | "mov" | "webm" | "mkv" | "m4v") { continue; }
        if let Ok(meta) = meta_for(&path, "upload", None) {
            out.push(meta);
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[tauri::command]
pub fn delete_reference(file_name: String) -> Result<(), String> {
    let canonical = validate_inside_references(&file_name)?;
    std::fs::remove_file(&canonical).map_err(|e| format!("Falha ao apagar: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn read_reference_bytes(file_name: String) -> Result<Vec<u8>, String> {
    let canonical = validate_inside_references(&file_name)?;
    std::fs::read(&canonical).map_err(|e| format!("Falha ao ler arquivo: {e}"))
}

/// Save bytes coming from the frontend (drag-drop / file picker) into the references folder.
#[tauri::command]
pub fn save_imported_video(bytes: Vec<u8>, original_name: String) -> Result<ReferenceMeta, String> {
    let dir = ensure_references_dir()?;
    let safe = ensure_extension(&safe_filename(&original_name), "mp4");
    let path = unique_path(&dir, &safe);
    std::fs::write(&path, &bytes).map_err(|e| format!("Falha ao salvar arquivo: {e}"))?;
    meta_for(&path, "upload", None)
}

#[derive(Debug, Serialize, Clone)]
pub struct DownloadProgress {
    pub stage: String,         // "starting" | "downloading" | "info" | "done" | "error"
    pub message: String,
    pub percent: Option<f32>,  // 0..100 when known
}

fn parse_yt_dlp_percent(line: &str) -> Option<f32> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with("[download]") { return None; }
    let rest = &trimmed["[download]".len()..];
    let pct_idx = rest.find('%')?;
    let mut start = pct_idx;
    let bytes = rest.as_bytes();
    while start > 0 {
        let c = bytes[start - 1];
        if c.is_ascii_digit() || c == b'.' { start -= 1; } else { break; }
    }
    if start == pct_idx { return None; }
    rest[start..pct_idx].parse::<f32>().ok()
}

/// Download a video from any URL supported by yt-dlp (Instagram, TikTok, YouTube, Facebook, X…).
/// Saves to the references folder and emits "reference://download-progress" events.
/// Requires yt-dlp on PATH (system binary). Will be replaced by sidecar binary later.
#[tauri::command]
pub async fn download_video(app: AppHandle, url: String) -> Result<ReferenceMeta, String> {
    let dir = ensure_references_dir()?;

    let _ = app.emit("reference://download-progress", DownloadProgress {
        stage: "starting".into(),
        message: "Iniciando yt-dlp…".into(),
        percent: None,
    });

    let mut cmd = Command::new("yt-dlp");
    cmd.arg("--no-playlist")
        .arg("--no-warnings")
        .arg("--restrict-filenames")
        .arg("--merge-output-format").arg("mp4")
        .arg("-f").arg("bv*+ba/b")
        .arg("-P").arg(&dir)
        .arg("-o").arg("%(title).80B [%(id)s].%(ext)s")
        .arg("--print").arg("after_move:filepath")
        .arg(&url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!("yt-dlp não encontrado no PATH ({e}). Instale com: brew install yt-dlp")
    })?;

    let stdout = child.stdout.take().ok_or_else(|| "yt-dlp sem stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "yt-dlp sem stderr".to_string())?;

    let app_for_stderr = app.clone();
    let stderr_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let percent = parse_yt_dlp_percent(&line);
            let stage = if percent.is_some() { "downloading" } else { "info" };
            let _ = app_for_stderr.emit("reference://download-progress", DownloadProgress {
                stage: stage.into(),
                message: line,
                percent,
            });
        }
    });

    let app_for_stdout = app.clone();
    let stdout_handle: tokio::task::JoinHandle<Option<PathBuf>> = tokio::spawn(async move {
        let mut found: Option<PathBuf> = None;
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() { continue; }
            let percent = parse_yt_dlp_percent(trimmed);
            if let Some(p) = percent {
                let _ = app_for_stdout.emit("reference://download-progress", DownloadProgress {
                    stage: "downloading".into(),
                    message: trimmed.into(),
                    percent: Some(p),
                });
                continue;
            }
            let candidate = PathBuf::from(trimmed);
            if candidate.exists() { found = Some(candidate); }
        }
        found
    });

    let status = child.wait().await.map_err(|e| format!("yt-dlp travou: {e}"))?;
    let _ = stderr_handle.await;
    let final_path = stdout_handle.await.unwrap_or(None);

    if !status.success() {
        let _ = app.emit("reference://download-progress", DownloadProgress {
            stage: "error".into(),
            message: format!("yt-dlp saiu com código {:?}", status.code()),
            percent: None,
        });
        return Err(format!(
            "yt-dlp falhou (exit {:?}). Verifique se o link é público e se yt-dlp está atualizado.",
            status.code()
        ));
    }

    let path = final_path.ok_or_else(|| "yt-dlp não retornou caminho do arquivo.".to_string())?;
    let _ = dir;
    let meta = meta_for(&path, "url", Some(&url))?;

    let _ = app.emit("reference://download-progress", DownloadProgress {
        stage: "done".into(),
        message: meta.file_name.clone(),
        percent: Some(100.0),
    });

    Ok(meta)
}

/// Open the references folder in Finder/Explorer using `open` (mac) / `xdg-open` (linux) / `explorer` (win).
#[tauri::command]
pub fn reveal_references_dir() -> Result<(), String> {
    let dir = ensure_references_dir()?;
    let path = dir.to_string_lossy().into_owned();
    #[cfg(target_os = "macos")]
    let cmd = std::process::Command::new("open").arg(&path).spawn();
    #[cfg(target_os = "windows")]
    let cmd = std::process::Command::new("explorer").arg(&path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = std::process::Command::new("xdg-open").arg(&path).spawn();
    cmd.map(|_| ()).map_err(|e| format!("Falha ao abrir pasta: {e}"))
}
