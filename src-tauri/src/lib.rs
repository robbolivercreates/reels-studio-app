mod references;
mod motions;
mod assets;
mod capcut;
mod save_dialog;

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
            motions::copy_asset_to_motion,
            assets::ensure_assets_dir,
            assets::list_project_assets,
            assets::reveal_assets_dir,
            assets::write_asset_bytes,
            assets::append_asset_chunk,
            capcut::save_capcut_project,
            capcut::open_in_capcut,
            capcut::reveal_capcut_folder,
            capcut::save_capcut_draft,
            capcut::capcut_media_dir_for,
            capcut::capcut_draft_dir_for,
            capcut::open_capcut_app,
            save_dialog::save_file_with_dialog,
            save_dialog::reveal_file_in_finder,
            save_dialog::pick_save_path,
            save_dialog::truncate_file,
            save_dialog::append_chunk_to_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
