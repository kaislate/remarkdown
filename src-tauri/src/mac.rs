//! The Mac-only glue: the menu bar, ⌘Q, and files opened from Finder.
//! Everything here is thin; the decisions it leans on (which URLs are
//! files we can open) live in launch.rs, where they're tested on every OS.

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent, Wry};

use crate::launch;

const QUIT: &str = "quit";

/// The app menu a Mac expects. Set only on a Mac: on Windows and Linux an
/// app-wide menu is drawn as a real menu bar inside every window. Without
/// it Tauri would install its default menu, whose Quit skips our save.
///
/// There's no File menu and no ⌘W item: ⌘W stays the page's close-tab
/// shortcut. The Edit items still matter even though the page handles
/// ⌘Z and friends itself (WebKit offers key equivalents to the page before
/// the menu): without an Edit menu, copy and paste don't work in text
/// fields on a Mac.
pub fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "remarkdown",
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    // Our own item, not the predefined Quit: that one ends
                    // the app on the spot, before any window can save.
                    &MenuItem::with_id(app, QUIT, "Quit remarkdown", true, Some("CmdOrCtrl+Q"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
                ],
            )?,
        ],
    )
}

/// ⌘Q asks every window to close, the same as clicking its close button,
/// so each one saves its pending edits first. A window holding edits that
/// wait on a "changed by another program" decision stays open and asks;
/// the app keeps running until it's settled. Once the last window has
/// gone, the app exits the usual way.
pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    if event.id() == QUIT {
        for window in app.webview_windows().values() {
            let _ = window.close();
        }
    }
}

/// Files opened from Finder ("Open With", a double-click when we're the
/// default app, a drop on the Dock icon) arrive here rather than on the
/// command line, sometimes before setup has run. Queuing works either way:
/// a window that's already up is told to drain the queue, and a window
/// still loading drains it once it mounts.
pub fn on_run_event(app: &AppHandle, event: RunEvent) {
    if let RunEvent::Opened { urls } = event {
        launch::enqueue_and_notify(app, launch::paths_from_file_urls(&urls));
    }
}
