#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod appimage;
mod commands;
mod default_app;
mod desktop_env;
mod fresh_start;
mod launch;
mod linux_gpu;
#[cfg(target_os = "macos")]
mod mac;
mod reading_progress;
mod recent;
mod session_file;
mod settings;
mod shell;
mod sidecar;
mod welcome;

use tauri::Manager;

// An AppImage isn't registered with the desktop the way the rpm is, so on first
// run it writes its own launcher entry. Never fatal: a read-only home just
// means no launcher entry.
#[cfg(target_os = "linux")]
fn integrate_appimage() {
    let Some(appimage) = std::env::var_os("APPIMAGE").filter(|v| !v.is_empty()) else { return };
    let xdg = std::env::var_os("XDG_DATA_HOME")
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_absolute());
    let Some(data_home) = xdg.or_else(|| {
        std::env::var_os("HOME").map(|h| std::path::Path::new(&h).join(".local/share"))
    }) else {
        return;
    };
    let icon = include_bytes!("../icons/128x128@2x.png");
    match appimage::integrate(std::path::Path::new(&appimage), &data_home, icon) {
        Ok(appimage::Integration::Written) => {
            // Optional: refreshes the "Open with" cache where the tool exists.
            let _ = std::process::Command::new("update-desktop-database")
                .arg(data_home.join("applications"))
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
        Ok(appimage::Integration::ManagedElsewhere) => {
            eprintln!("[remarkdown] another tool already made a launcher entry for this AppImage");
        }
        Ok(appimage::Integration::Skipped) => {
            eprintln!("[remarkdown] the AppImage path has a control character; no launcher entry");
        }
        Ok(appimage::Integration::Unchanged) => {}
        Err(e) => eprintln!("[remarkdown] could not add the AppImage to the launcher: {e}"),
    }
}

fn main() {
    // First statement: set_var is only sound before any other thread exists.
    #[cfg(target_os = "linux")]
    if linux_gpu::needs_dmabuf_workaround(std::path::Path::new("/sys/class/drm"), |k| {
        std::env::var(k).ok()
    }) {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    let builder = tauri::Builder::default()
        // Must be registered first: when a second copy of the app starts
        // (e.g. the user double-clicks another .md while remarkdown is
        // open), this forwards its argv to us and the second copy exits.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = launch::extract_open_paths(&argv, std::path::Path::new(&cwd));
            launch::enqueue_and_notify(app, paths);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(launch::PendingOpens::default())
        .setup(|app| {
            // Before any window reads them: 0.8.0 resets settings once.
            fresh_start::run(app.handle());
            #[cfg(target_os = "linux")]
            integrate_appimage();
            // Files passed on our own command line (double-click on a cold
            // start). The frontend drains these once it's mounted.
            // args_os: std::env::args() panics on arguments that aren't
            // valid Unicode.
            let argv: Vec<String> = std::env::args_os()
                .map(|a| a.to_string_lossy().into_owned())
                .collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            app.state::<launch::PendingOpens>()
                .push(launch::extract_open_paths(&argv, &cwd));
            Ok(())
        });
    // The Mac menu bar; Windows and Linux keep their windows menu-free.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(mac::menu).on_menu_event(mac::on_menu_event);
    builder
        .invoke_handler(tauri::generate_handler![
            commands::open_file_dialog,
            commands::open_image_dialog,
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
            commands::load_session,
            commands::save_session,
            launch::take_pending_opens,
            launch::open_document_window,
            default_app::default_app_status,
            default_app::make_default_app,
            shell::reveal_in_folder,
            desktop_env::desktop_env,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // Files opened from Finder. Nothing to do anywhere else.
            #[cfg(target_os = "macos")]
            mac::on_run_event(app, event);
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
