// Project assets — screenshots and images the user drops in for motion graphics.
//
// Folder: ~/Reels Studio/Projects/<project_name>/Assets/
// Supported: png, jpg, jpeg, webp, gif
//
// The frontend reads the asset list and passes asset:// URLs to Gemini so the
// HTML composition can reference real screenshots instead of AI-generated mockups.

use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectAsset {
    pub name: String,          // filename with extension
    pub path: String,          // absolute path (used with convertFileSrc)
    pub ext: String,           // "png" | "jpg" | "webp" | "gif"
    pub size_bytes: u64,
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

    let supported = ["png", "jpg", "jpeg", "webp", "gif"];
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
        if !supported.contains(&ext.as_str()) { continue; }
        let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        assets.push(ProjectAsset {
            name,
            path: path.to_string_lossy().into_owned(),
            ext,
            size_bytes,
        });
    }

    assets.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(assets)
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
