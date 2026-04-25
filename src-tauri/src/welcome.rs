use std::fs;
use std::path::PathBuf;

use crate::commands::CommandError;

// The welcome document is baked into the binary at compile time. On first
// launch (or any time the file has been deleted), we materialise it into the
// user's app_data_dir so the rest of the app can treat it as a normal file
// — annotations on it persist via the regular sidecar pipeline.
const WELCOME_MARKDOWN: &str = include_str!("../../examples/welcome.md");

const WELCOME_FILENAME: &str = "welcome.md";

pub fn ensure(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError::Io(format!("no app_data_dir: {e}")))?;
    fs::create_dir_all(&dir).map_err(|e| CommandError::Io(e.to_string()))?;
    let p = dir.join(WELCOME_FILENAME);
    if !p.exists() {
        fs::write(&p, WELCOME_MARKDOWN).map_err(|e| CommandError::Io(e.to_string()))?;
    }
    Ok(p)
}
