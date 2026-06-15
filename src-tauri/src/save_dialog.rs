// Native "Save As..." dialog + file write.
//
// The HTML `<a download>` path that the export modal uses doesn't reliably
// surface a save dialog inside Tauri's WebView on macOS — the file gets
// silently dropped or saved somewhere the user can't find. This module
// invokes the native macOS save panel via `rfd` so the user picks the
// destination explicitly.

use rfd::AsyncFileDialog;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, serde::Serialize)]
pub struct SaveResult {
    /// Absolute path the user chose, or null if they canceled.
    pub path: Option<String>,
}

/// Step 1: ask the user where to save. Returns the path (or null on cancel).
/// No bytes are exchanged here — the JS side then streams the file contents
/// to that path via `append_chunk_to_file` so we never round-trip a multi-MB
/// payload through Tauri's JSON IPC (which silently corrupts transfers
/// larger than ~50MB on macOS WebKit).
#[tauri::command]
pub async fn pick_save_path(
    app: tauri::AppHandle,
    suggested_name: String,
    extension: String,
) -> Result<SaveResult, String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
        let _ = win.unminimize();
    }

    let mut dialog = AsyncFileDialog::new()
        .set_file_name(&suggested_name)
        .set_title("Salvar como");
    if !extension.is_empty() {
        dialog = dialog.add_filter(extension.to_uppercase(), &[extension.as_str()]);
    }
    let chosen: Option<PathBuf> = dialog.save_file().await.map(|h| h.path().to_path_buf());

    Ok(SaveResult {
        path: chosen.map(|p| p.to_string_lossy().into_owned()),
    })
}

/// Truncate (or create) a file at the given path. Call this once before
/// streaming chunks via `append_chunk_to_file`.
#[tauri::command]
pub fn truncate_file(target_path: String) -> Result<(), String> {
    OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&target_path)
        .map_err(|e| format!("Falha ao criar arquivo: {e}"))?;
    Ok(())
}

/// Append a base64-encoded chunk to a target file. Used to stream large
/// blobs from the WebView in pieces so no single IPC payload exceeds the
/// safe size for Tauri's JSON channel.
#[tauri::command]
pub fn append_chunk_to_file(target_path: String, base64_chunk: String) -> Result<u64, String> {
    use base64::Engine;
    let engine = base64::engine::general_purpose::STANDARD;
    let bytes = engine
        .decode(&base64_chunk)
        .map_err(|e| format!("Base64 inválido: {e}"))?;
    let mut f = OpenOptions::new()
        .append(true)
        .open(&target_path)
        .map_err(|e| format!("Falha ao abrir arquivo: {e}"))?;
    f.write_all(&bytes).map_err(|e| format!("Falha ao gravar: {e}"))?;
    Ok(bytes.len() as u64)
}

/// Legacy single-shot variant. Kept so callers that are sure their payload
/// is small (<10MB) can use the simpler API. For MP4 exports we use the
/// chunked path above.
#[tauri::command]
pub async fn save_file_with_dialog(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    suggested_name: String,
    extension: String,
) -> Result<SaveResult, String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
        let _ = win.unminimize();
    }

    let mut dialog = AsyncFileDialog::new()
        .set_file_name(&suggested_name)
        .set_title("Salvar como");
    if !extension.is_empty() {
        dialog = dialog.add_filter(extension.to_uppercase(), &[extension.as_str()]);
    }
    let chosen: Option<PathBuf> = dialog.save_file().await.map(|h| h.path().to_path_buf());

    let Some(path) = chosen else {
        return Ok(SaveResult { path: None });
    };

    std::fs::write(&path, &bytes).map_err(|e| format!("Falha ao salvar arquivo: {e}"))?;

    Ok(SaveResult {
        path: Some(path.to_string_lossy().into_owned()),
    })
}

/// Copy a file from src to dst (used to move the ffmpeg-muxed temp file to the user's chosen path).
#[tauri::command]
pub fn copy_file(src_path: String, dst_path: String) -> Result<(), String> {
    std::fs::copy(&src_path, &dst_path)
        .map_err(|e| format!("Falha ao copiar arquivo: {e}"))?;
    Ok(())
}

/// Mux a silent video file with an audio file using ffmpeg, writing the result
/// to `output_path`. Both inputs are expected to already exist on disk.
/// Returns the output path on success.
#[tauri::command]
pub async fn mux_video_audio_ffmpeg(
    video_path: String,
    audio_path: String,
    output_path: String,
) -> Result<String, String> {
    use tokio::process::Command;

    // Try to find ffmpeg: $PATH first, then common Homebrew locations.
    let ffmpeg_candidates = [
        "ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ];
    let ffmpeg = ffmpeg_candidates
        .iter()
        .find(|&&p| {
            if p == "ffmpeg" {
                // "ffmpeg" without a path — let the OS resolve it
                true
            } else {
                std::path::Path::new(p).exists()
            }
        })
        .copied()
        .unwrap_or("ffmpeg");

    let output = Command::new(ffmpeg)
        .args([
            "-y",                      // overwrite output
            "-i", &video_path,         // silent video
            "-i", &audio_path,         // audio track
            "-c:v", "copy",            // copy video stream — no re-encode
            "-c:a", "aac",             // encode audio to AAC
            "-b:a", "192k",
            "-ar", "48000",            // explicit resample — sources vary (44.1k TTS mp3 / wav); implicit handling is player roulette
            "-movflags", "+faststart", // moov at the START — players/socials open the file before it's fully read
            "-shortest",               // trim to the shorter of the two streams
            &output_path,
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg não encontrado ou falhou ao iniciar: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg falhou:\n{}", stderr));
    }

    Ok(output_path)
}

/// Reveal a saved file in Finder (selects the file, doesn't open it).
#[tauri::command]
pub fn reveal_file_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Falha ao revelar arquivo: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Falha ao revelar arquivo: {e}"))?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // No standard "reveal in file manager" — open the parent folder.
        let parent = std::path::Path::new(&path)
            .parent()
            .ok_or_else(|| "Não foi possível resolver pasta pai.".to_string())?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Falha ao abrir pasta: {e}"))?;
        Ok(())
    }
}
