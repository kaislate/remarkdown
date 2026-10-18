use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::commands::CommandError;

/// Paths handed to us by the OS (double-click, "Open with", command line)
/// that the frontend hasn't picked up yet. Filled from argv at startup and
/// from the single-instance callback when a second launch forwards its
/// argv; drained by the `take_pending_opens` command. Queuing (rather than
/// emitting the paths directly) means a double-click that lands while the
/// webview is still booting is never lost.
#[derive(Default)]
pub struct PendingOpens(Mutex<Vec<String>>);

impl PendingOpens {
    pub fn push(&self, paths: Vec<String>) {
        self.0.lock().unwrap().extend(paths);
    }
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

/// argv → existing file paths. Skips argv[0] (the exe) and `-flags`,
/// resolves relative paths against `cwd` (the launching process's working
/// dir), drops anything that isn't an existing file, and de-dupes while
/// preserving first-seen order.
pub fn extract_open_paths(argv: &[String], cwd: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for arg in argv.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let p = Path::new(arg);
        let abs = normalize(&if p.is_absolute() { p.to_path_buf() } else { cwd.join(p) });
        if !abs.is_file() {
            continue;
        }
        let s = abs.to_string_lossy().into_owned();
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// Lexically resolve `.` and `..` so `.\a.md`, `sub\..\a.md` and `a.md`
/// name the same file (the frontend de-dupes open tabs by path).
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

static NEXT_WINDOW: AtomicU32 = AtomicU32::new(1);

/// Labels for "new window per file" windows. Atomic, so concurrent opens
/// can't both pick the same free label.
pub fn next_window_label() -> String {
    format!("doc-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed))
}

/// Queue `paths` and bring a window forward. Called from the single-
/// instance callback when the user double-clicks a file (or re-launches
/// the app) while it's already running. Emits even when `paths` is empty
/// so a plain re-launch just focuses the existing window.
pub fn enqueue_and_notify(app: &AppHandle, paths: Vec<String>) {
    app.state::<PendingOpens>().push(paths);
    let windows = app.webview_windows();
    let target = windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| windows.get("main"))
        .or_else(|| windows.values().next());
    if let Some(w) = target {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to(w.label(), "open-requested", ());
    }
}

#[tauri::command]
pub fn take_pending_opens(app: AppHandle) -> Vec<String> {
    app.state::<PendingOpens>().take()
}

/// Opens `path` in a new top-level window ("new window per file" mode).
/// The path reaches the new webview through an init-script global rather
/// than the URL, so Windows paths need no URL encoding. Must be async:
/// creating a window from a synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn open_document_window(app: AppHandle, path: String) -> Result<(), CommandError> {
    let label = next_window_label();
    let path_js = serde_json::to_string(&path).map_err(|e| CommandError::Io(e.to_string()))?;
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
        .title("remarkdown")
        .inner_size(1100.0, 780.0)
        .min_inner_size(600.0, 400.0)
        .decorations(false)
        .initialization_script(format!("window.__RMD_OPEN__ = {path_js};"))
        .build()
        .map_err(|e| CommandError::Io(e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_exe_and_flags_and_keeps_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        std::fs::write(&a, "x").unwrap();
        let argv = vec![
            "remarkdown.exe".to_string(),
            "--flag".to_string(),
            a.to_string_lossy().into_owned(),
        ];
        assert_eq!(extract_open_paths(&argv, dir.path()), vec![a.to_string_lossy().into_owned()]);
    }

    #[test]
    fn resolves_relative_paths_against_cwd() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("b.md"), "x").unwrap();
        let argv = vec!["exe".to_string(), "b.md".to_string()];
        assert_eq!(
            extract_open_paths(&argv, dir.path()),
            vec![dir.path().join("b.md").to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn drops_missing_and_dedupes_preserving_order() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        std::fs::write(&a, "x").unwrap();
        std::fs::write(&b, "x").unwrap();
        let sa = a.to_string_lossy().into_owned();
        let sb = b.to_string_lossy().into_owned();
        let argv = vec!["exe".into(), sb.clone(), "missing.md".into(), sa.clone(), sb.clone()];
        assert_eq!(extract_open_paths(&argv, dir.path()), vec![sb, sa]);
    }

    #[test]
    fn directories_are_not_files() {
        let dir = tempfile::tempdir().unwrap();
        let argv = vec!["exe".to_string(), dir.path().to_string_lossy().into_owned()];
        assert!(extract_open_paths(&argv, dir.path()).is_empty());
    }

    #[test]
    fn dot_segments_resolve_to_the_same_path() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("a.md"), "x").unwrap();
        let plain = extract_open_paths(&["exe".into(), "a.md".into()], dir.path());
        let dotted = extract_open_paths(&["exe".into(), r".\a.md".into()], dir.path());
        let parent = extract_open_paths(&["exe".into(), "sub/../a.md".into()], dir.path());
        assert_eq!(plain.len(), 1);
        assert_eq!(dotted, plain);
        assert_eq!(parent, plain);
    }

    #[test]
    fn window_labels_are_unique() {
        let a = next_window_label();
        let b = next_window_label();
        assert_ne!(a, b);
        assert!(a.starts_with("doc-"));
    }

    #[test]
    fn queue_drains_once() {
        let q = PendingOpens::default();
        q.push(vec!["a".into(), "b".into()]);
        q.push(vec!["c".into()]);
        assert_eq!(q.take(), vec!["a".to_string(), "b".to_string(), "c".to_string()]);
        assert!(q.take().is_empty());
    }
}
