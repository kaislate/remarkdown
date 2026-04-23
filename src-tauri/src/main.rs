#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod recent;
mod sidecar;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_file_dialog,
            commands::read_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
