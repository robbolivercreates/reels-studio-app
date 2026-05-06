mod references;
mod motions;
mod assets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            references::references_dir,
            references::list_references,
            references::delete_reference,
            references::read_reference_bytes,
            references::save_imported_video,
            references::download_video,
            references::reveal_references_dir,
            motions::motions_dir,
            motions::save_motion_html,
            motions::read_motion_html,
            motions::delete_motion,
            motions::render_motion,
            motions::read_motion_video_bytes,
            assets::ensure_assets_dir,
            assets::list_project_assets,
            assets::reveal_assets_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
