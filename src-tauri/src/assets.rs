// Project assets — screenshots, images, and videos the user drops in for
// motion graphics and per-block overlays.
//
// Folder: ~/Reels Studio/Projects/<project_name>/Assets/
// Supported: png, jpg, jpeg, webp, gif, mp4, mov, webm
//
// The frontend reads the asset list and passes asset:// URLs to Gemini (for
// motion HTML) or attaches single assets to specific blocks (top-half overlay).

use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectAsset {
    pub name: String,          // filename with extension
    pub path: String,          // absolute path (used with convertFileSrc)
    pub ext: String,           // image: png|jpg|jpeg|webp|gif · video: mp4|mov|webm
    pub size_bytes: u64,
    pub kind: String,          // "image" | "video"
}

fn sanitize_project_name(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' || c == '.' { c } else { '_' })
        .collect::<String>()
        .trim()
        .to_string()
}

fn assets_dir(project_name: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Não consegui resolver home.")?;
    let safe = sanitize_project_name(project_name);
    if safe.is_empty() {
        return Err("Nome de projeto inválido.".into());
    }
    Ok(home.join("Reels Studio").join("Projects").join(&safe).join("Assets"))
}

#[tauri::command]
pub fn ensure_assets_dir(project_name: String) -> Result<String, String> {
    let dir = assets_dir(&project_name)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Falha ao criar pasta de assets: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_project_assets(project_name: String) -> Result<Vec<ProjectAsset>, String> {
    let dir = assets_dir(&project_name)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let images = ["png", "jpg", "jpeg", "webp", "gif"];
    let videos = ["mp4", "mov", "webm"];
    let mut assets = vec![];

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Falha ao ler pasta: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() { continue; }
        let name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if name.starts_with('.') { continue; }
        let ext = path.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let kind = if images.contains(&ext.as_str()) {
            "image"
        } else if videos.contains(&ext.as_str()) {
            "video"
        } else {
            continue;
        };
        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        assets.push(ProjectAsset {
            name,
            path: path.to_string_lossy().into_owned(),
            ext,
            size_bytes,
            kind: kind.to_string(),
        });
    }

    assets.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(assets)
}

/// Write a dropped/picked file's bytes into the project's universal Assets
/// folder. The frontend reads the dropped File via FileReader → base64 →
/// passes here as a chunked stream OR as a single bytes payload.
///
/// Uses base64 over the IPC bridge to avoid Tauri's JSON Vec<u8> bloat
/// (~5x size, silent truncation past ~50MB). For the asset drop flow
/// most images are small (<5MB), so a single shot is fine; videos go
/// through the chunked path.
#[tauri::command]
pub fn write_asset_bytes(
    project_name: String,
    filename: String,
    base64_bytes: String,
) -> Result<String, String> {
    use base64::Engine as _;
    let dir = assets_dir(&project_name)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Falha ao criar pasta de assets: {e}"))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_bytes)
        .map_err(|e| format!("Base64 inválido: {e}"))?;
    let dest = dir.join(safe_asset_filename(&filename));
    std::fs::write(&dest, &bytes)
        .map_err(|e| format!("Falha ao escrever asset: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Chunked variant for large videos. Frontend calls truncate first, then
/// streams chunks; final chunk completes the file.
#[tauri::command]
pub fn append_asset_chunk(
    project_name: String,
    filename: String,
    base64_chunk: String,
    truncate: bool,
) -> Result<String, String> {
    use base64::Engine as _;
    use std::io::Write as _;
    let dir = assets_dir(&project_name)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Falha ao criar pasta de assets: {e}"))?;
    let dest = dir.join(safe_asset_filename(&filename));
    let chunk = base64::engine::general_purpose::STANDARD
        .decode(&base64_chunk)
        .map_err(|e| format!("Base64 inválido: {e}"))?;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(!truncate)
        .truncate(truncate)
        .open(&dest)
        .map_err(|e| format!("Falha ao abrir destino: {e}"))?;
    f.write_all(&chunk).map_err(|e| format!("Falha ao gravar chunk: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Allow only safe characters in user-provided asset filenames.
fn safe_asset_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || ".-_ ".contains(c) { c } else { '_' })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        format!("asset-{ts}.bin")
    } else {
        trimmed.to_string()
    }
}

#[tauri::command]
pub fn reveal_assets_dir(project_name: String) -> Result<(), String> {
    let dir = assets_dir(&project_name)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Falha ao criar pasta: {e}"))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("Falha ao abrir pasta: {e}"))?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("Falha ao abrir pasta: {e}"))?;
    Ok(())
}
