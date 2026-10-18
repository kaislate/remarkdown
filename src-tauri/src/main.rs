#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod launch;
mod reading_progress;
mod recent;
mod settings;
mod sidecar;
mod welcome;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        // Must be registered first: when a second copy of the app starts
        // (e.g. the user double-clicks another .md while remarkdown is
        // open), this forwards its argv to us and the second copy exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = launch::extract_open_paths(&argv, std::path::Path::new(&cwd));
            launch::enqueue_and_notify(app, paths);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(launch::PendingOpens::default())
        .setup(|app| {
            // Files passed on our own command line (double-click on a cold
            // start). The frontend drains these once it's mounted.
            let argv: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            app.state::<launch::PendingOpens>()
                .push(launch::extract_open_paths(&argv, &cwd));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file_dialog,
            commands::read_document,
            commands::write_sidecar,
            commands::write_document,
            commands::push_recent,
            commands::list_recent,
            commands::clear_recent,
            commands::remove_recent,
            commands::check_paths_exist,
            commands::backup_corrupt_sidecar,
            commands::load_settings,
            commands::save_settings,
            commands::load_reading_progress,
            commands::save_reading_progress,
            commands::ensure_welcome_doc,
            launch::take_pending_opens,
            launch::open_document_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
