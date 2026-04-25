#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod recent;
mod settings;
mod sidecar;
mod welcome;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_file_dialog,
            commands::read_document,
            commands::write_sidecar,
            commands::push_recent,
            commands::list_recent,
            commands::clear_recent,
            commands::remove_recent,
            commands::check_paths_exist,
            commands::backup_corrupt_sidecar,
            commands::load_settings,
            commands::save_settings,
            commands::ensure_welcome_doc,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
