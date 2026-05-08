// CapCut export — saves a project bundle (FCPXML + media files) into a fixed
// folder under ~/Movies/Reels Studio/ and asks the OS to open the FCPXML in
// CapCut Desktop. CapCut imports it and creates a new project with the timeline
// already assembled.
//
// We deliberately don't try to write CapCut's proprietary `.draft` format —
// that's reverse-engineered, fragile, and would break on every CapCut update.

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

fn projects_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Não consegui resolver o diretório home.".to_string())?;
    // Movies/ on mac is the standard location for video projects; on Windows we
    // fall back to Videos/ which has the same role.
    #[cfg(target_os = "macos")]
    let root = home.join("Movies").join("Reels Studio");
    #[cfg(not(target_os = "macos"))]
    let root = home.join("Videos").join("Reels Studio");
    Ok(root)
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
    if trimmed.is_empty() { "reel".to_string() } else { trimmed }
}

#[derive(Debug, Deserialize)]
pub struct CapcutFile {
    pub name: String,
    /// File contents as raw bytes.
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
pub struct CapcutSaveResult {
    /// Absolute path to the saved FCPXML file.
    pub fcpxml_path: String,
    /// Absolute path to the project folder containing the FCPXML + media.
    pub folder_path: String,
}

/// Persist all files of a CapCut export bundle into ~/Movies/Reels Studio/<project>/.
/// `project_name` is sanitized; existing folder is overwritten so re-exports replace
/// the old bundle (the user's CapCut project keeps a copy of the import anyway).
#[tauri::command]
pub fn save_capcut_project(
    project_name: String,
    fcpxml_name: String,
    fcpxml_content: String,
    media: Vec<CapcutFile>,
) -> Result<CapcutSaveResult, String> {
    let root = projects_root()?;
    std::fs::create_dir_all(&root).map_err(|e| format!("Falha ao criar pasta: {e}"))?;

    let safe_project = safe_filename(&project_name);
    let project_dir = root.join(&safe_project);

    // Wipe previous contents — we want this folder to mirror the latest export
    // exactly, not accumulate stale media from old timelines.
    if project_dir.exists() {
        std::fs::remove_dir_all(&project_dir)
            .map_err(|e| format!("Falha ao limpar pasta antiga: {e}"))?;
    }
    std::fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Falha ao criar pasta do projeto: {e}"))?;

    // Write the FCPXML.
    let safe_fcpxml = safe_filename(&fcpxml_name);
    let fcpxml_path = project_dir.join(&safe_fcpxml);
    std::fs::write(&fcpxml_path, fcpxml_content.as_bytes())
        .map_err(|e| format!("Falha ao gravar FCPXML: {e}"))?;

    // Write each media file.
    for file in &media {
        let safe = safe_filename(&file.name);
        let target = project_dir.join(&safe);
        std::fs::write(&target, &file.bytes)
            .map_err(|e| format!("Falha ao gravar {}: {e}", safe))?;
    }

    Ok(CapcutSaveResult {
        fcpxml_path: fcpxml_path.to_string_lossy().into_owned(),
        folder_path: project_dir.to_string_lossy().into_owned(),
    })
}

/// Ask the OS to open the FCPXML file in CapCut Desktop.
/// On mac: `open -a "CapCut" <path>`. If CapCut isn't installed, this returns
/// an error and the caller should fall back to revealing the folder so the user
/// can drag the file in manually.
#[tauri::command]
pub fn open_in_capcut(fcpxml_path: String) -> Result<(), String> {
    let path = PathBuf::from(&fcpxml_path);
    if !path.exists() {
        return Err(format!("Arquivo não encontrado: {fcpxml_path}"));
    }

    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("-a")
            .arg("CapCut")
            .arg(&path)
            .status()
            .map_err(|e| format!("Falha ao executar 'open': {e}"))?;
        if !status.success() {
            return Err(
                "CapCut não encontrado. Instale o CapCut Desktop e tente de novo."
                    .into(),
            );
        }
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        // On Windows we try to associate via 'start' — if CapCut Desktop registered
        // the .fcpxml extension, this will open it. Otherwise the user gets the
        // "open with" picker.
        let status = std::process::Command::new("cmd")
            .args(["/C", "start", "", &fcpxml_path])
            .status()
            .map_err(|e| format!("Falha ao executar 'start': {e}"))?;
        if !status.success() {
            return Err("Falha ao abrir o arquivo no CapCut.".into());
        }
        Ok(())
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let status = std::process::Command::new("xdg-open")
            .arg(&path)
            .status()
            .map_err(|e| format!("Falha ao executar 'xdg-open': {e}"))?;
        if !status.success() {
            return Err("Falha ao abrir o arquivo.".into());
        }
        Ok(())
    }
}

// ─── Native CapCut draft writer ──────────────────────────────────────────
// Writes a CapCut Desktop project directly into ~/Movies/CapCut/User Data/
// Projects/com.lveditor.draft/<name>/. CapCut auto-discovers projects from
// that folder, so the next time the user opens CapCut the project shows up
// under "Recent" with the timeline already assembled — no FCPXML import step.
//
// Media files (audio.mp3, clip-avatar-*.mp4) live separately under
// ~/Movies/Reels Studio/<project>/ and are referenced by absolute path in the
// draft_info.json (CapCut doesn't copy media into the project folder either).

fn capcut_drafts_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Não consegui resolver o diretório home.".to_string())?;
    Ok(home
        .join("Movies")
        .join("CapCut")
        .join("User Data")
        .join("Projects")
        .join("com.lveditor.draft"))
}

fn reels_media_root() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Não consegui resolver o diretório home.".to_string())?;
    #[cfg(target_os = "macos")]
    let root = home.join("Movies").join("Reels Studio");
    #[cfg(not(target_os = "macos"))]
    let root = home.join("Videos").join("Reels Studio");
    Ok(root)
}

#[derive(Debug, Deserialize)]
pub struct CapcutDraftMedia {
    /// Filename inside the media folder (e.g. "audio.mp3", "clip-avatar-01.mp4").
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
pub struct CapcutDraftFiles {
    pub draft_info: String,
    pub draft_meta: String,
    pub draft_settings: String,
    pub draft_agency_config: String,
    pub draft_biz_config: String,
}

#[derive(Debug, Serialize)]
pub struct CapcutDraftSaveResult {
    /// Path to the draft folder inside CapCut's Projects dir.
    pub draft_path: String,
    /// Path to the media folder where audio + clips were saved.
    pub media_path: String,
}

/// Persist a CapCut draft project + its media files. Two folders are created:
/// 1) ~/Movies/Reels Studio/<project>/         → media files (audio + clips)
/// 2) ~/Movies/CapCut/User Data/Projects/com.lveditor.draft/<project>/
///                                              → draft JSON files
/// The draft JSON references the media files by absolute path under (1).
#[tauri::command]
pub fn save_capcut_draft(
    project_name: String,
    files: CapcutDraftFiles,
    media: Vec<CapcutDraftMedia>,
) -> Result<CapcutDraftSaveResult, String> {
    let safe_name = safe_filename(&project_name);

    // ─── 1. Media folder ────────────────────────────────────────────────
    let media_root = reels_media_root()?;
    std::fs::create_dir_all(&media_root)
        .map_err(|e| format!("Falha ao criar pasta de mídias: {e}"))?;
    let media_dir = media_root.join(&safe_name);
    if media_dir.exists() {
        std::fs::remove_dir_all(&media_dir)
            .map_err(|e| format!("Falha ao limpar mídias antigas: {e}"))?;
    }
    std::fs::create_dir_all(&media_dir)
        .map_err(|e| format!("Falha ao criar pasta do projeto: {e}"))?;

    for m in &media {
        let safe = safe_filename(&m.name);
        let target = media_dir.join(&safe);
        std::fs::write(&target, &m.bytes)
            .map_err(|e| format!("Falha ao gravar {}: {e}", safe))?;
    }

    // ─── 2. CapCut draft folder ────────────────────────────────────────
    let drafts_root = capcut_drafts_root()?;
    if !drafts_root.exists() {
        return Err(format!(
            "Pasta de projetos do CapCut não encontrada: {}\nAbra o CapCut uma vez antes de exportar.",
            drafts_root.display()
        ));
    }
    let draft_dir = drafts_root.join(&safe_name);
    if draft_dir.exists() {
        std::fs::remove_dir_all(&draft_dir)
            .map_err(|e| format!("Falha ao limpar projeto antigo no CapCut: {e}"))?;
    }
    std::fs::create_dir_all(&draft_dir)
        .map_err(|e| format!("Falha ao criar projeto no CapCut: {e}"))?;

    // Required JSON files
    std::fs::write(draft_dir.join("draft_info.json"), files.draft_info.as_bytes())
        .map_err(|e| format!("Falha ao gravar draft_info.json: {e}"))?;
    std::fs::write(draft_dir.join("draft_meta_info.json"), files.draft_meta.as_bytes())
        .map_err(|e| format!("Falha ao gravar draft_meta_info.json: {e}"))?;
    std::fs::write(draft_dir.join("draft_settings"), files.draft_settings.as_bytes())
        .map_err(|e| format!("Falha ao gravar draft_settings: {e}"))?;
    std::fs::write(draft_dir.join("draft_agency_config.json"), files.draft_agency_config.as_bytes())
        .map_err(|e| format!("Falha ao gravar draft_agency_config.json: {e}"))?;
    std::fs::write(draft_dir.join("draft_biz_config.json"), files.draft_biz_config.as_bytes())
        .map_err(|e| format!("Falha ao gravar draft_biz_config.json: {e}"))?;

    // Empty subfolders that CapCut expects
    for sub in &["Resources", "subdraft", "matting", "qr_upload", "smart_crop", "common_attachment", "adjust_mask"] {
        let _ = std::fs::create_dir_all(draft_dir.join(sub));
    }

    Ok(CapcutDraftSaveResult {
        draft_path: draft_dir.to_string_lossy().into_owned(),
        media_path: media_dir.to_string_lossy().into_owned(),
    })
}

/// Resolve the absolute path where the media folder lives for a given project,
/// without writing anything. Used by the frontend to put correct paths in the
/// draft_info.json *before* calling save_capcut_draft.
#[tauri::command]
pub fn capcut_media_dir_for(project_name: String) -> Result<String, String> {
    let media_root = reels_media_root()?;
    let safe_name = safe_filename(&project_name);
    Ok(media_root.join(&safe_name).to_string_lossy().into_owned())
}

/// Resolve the absolute path where the CapCut draft folder will live.
#[tauri::command]
pub fn capcut_draft_dir_for(project_name: String) -> Result<String, String> {
    let root = capcut_drafts_root()?;
    let safe_name = safe_filename(&project_name);
    Ok(root.join(&safe_name).to_string_lossy().into_owned())
}

/// Open the CapCut app (no specific document — the project will appear in
/// the recent projects list because we just wrote it under CapCut's Projects dir).
#[tauri::command]
pub fn open_capcut_app() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("-a")
            .arg("CapCut")
            .status()
            .map_err(|e| format!("Falha ao executar 'open': {e}"))?;
        if !status.success() {
            return Err("CapCut não encontrado. Instale o CapCut Desktop e tente de novo.".into());
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        let status = std::process::Command::new("cmd")
            .args(["/C", "start", "", "CapCut"])
            .status()
            .map_err(|e| format!("Falha ao executar 'start': {e}"))?;
        if !status.success() {
            return Err("Falha ao abrir o CapCut.".into());
        }
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Err("Linux: abra o CapCut manualmente.".into())
    }
}

/// Reveal the saved project folder in Finder/Explorer.
#[tauri::command]
pub fn reveal_capcut_folder(folder_path: String) -> Result<(), String> {
    let path = Path::new(&folder_path);
    if !path.exists() {
        return Err(format!("Pasta não encontrada: {folder_path}"));
    }
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(path).spawn();
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(path).spawn();
    result.map(|_| ()).map_err(|e| format!("Falha ao abrir pasta: {e}"))
}
