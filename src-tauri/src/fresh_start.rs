use std::fs;
use std::io;
use std::path::Path;

// 0.8.0 starts everyone fresh: the first launch after updating sets the
// old settings and open tabs aside, so the app comes up as on a new install
// (default settings, the "How do you want to use remarkdown?" window, the
// tutorial). Recent files, reading progress and every annotation are kept.
// Runs once, before any window loads; the old files are kept beside the new
// ones as `*.before-0.8.0.json`, not deleted.
const MARKER: &str = "fresh-start-0.8.0";
const SET_ASIDE: [&str; 2] = ["settings.json", "session.json"];

pub fn run(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(dir) = app.path().app_data_dir() else { return };
    // Best effort: if it can't run, the app still starts with what it has.
    let _ = run_in(&dir);
}

// Returns whether anything was set aside.
pub fn run_in(dir: &Path) -> io::Result<bool> {
    let marker = dir.join(MARKER);
    if marker.exists() {
        return Ok(false);
    }
    fs::create_dir_all(dir)?;
    let mut moved = false;
    for name in SET_ASIDE {
        let from = dir.join(name);
        if !from.exists() {
            continue;
        }
        let stem = name.trim_end_matches(".json");
        let to = dir.join(format!("{stem}.before-0.8.0.json"));
        if to.exists() {
            fs::remove_file(&to)?;
        }
        fs::rename(&from, &to)?;
        moved = true;
    }
    // Written last: if a move failed, the next launch tries again.
    fs::write(&marker, b"Settings and open tabs were reset for 0.8.0.\n")?;
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn an_update_sets_settings_and_tabs_aside_once() {
        let dir = tempdir().unwrap();
        let d = dir.path();
        fs::write(d.join("settings.json"), b"{\"theme\":\"light\"}").unwrap();
        fs::write(d.join("session.json"), b"{\"tabs\":[]}").unwrap();
        fs::write(d.join("recent.json"), b"[\"a.md\"]").unwrap();

        assert!(run_in(d).unwrap());
        assert!(!d.join("settings.json").exists());
        assert!(!d.join("session.json").exists());
        assert_eq!(fs::read(d.join("settings.before-0.8.0.json")).unwrap(), b"{\"theme\":\"light\"}");
        assert!(d.join("session.before-0.8.0.json").exists());
        assert!(d.join("recent.json").exists());

        // Settings chosen after the reset are kept from then on.
        fs::write(d.join("settings.json"), b"{\"theme\":\"dark\"}").unwrap();
        assert!(!run_in(d).unwrap());
        assert!(d.join("settings.json").exists());
    }

    #[test]
    fn a_new_install_has_nothing_to_set_aside() {
        let dir = tempdir().unwrap();
        assert!(!run_in(dir.path()).unwrap());
        assert!(dir.path().join(MARKER).exists());
    }
}
