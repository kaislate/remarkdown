use std::fs;
use std::path::PathBuf;

use crate::commands::CommandError;

// The open-tabs session (`session.json` in app_data_dir). Same storage
// pattern as settings.json: the frontend owns the shape, Rust just persists
// the string atomically.

fn session_path(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError::Io(format!("no app_data_dir: {e}")))?;
    fs::create_dir_all(&dir).map_err(|e| CommandError::Io(e.to_string()))?;
    Ok(dir.join("session.json"))
}

pub fn load_json(app: &tauri::AppHandle) -> Result<Option<String>, CommandError> {
    let p = session_path(app)?;
    if !p.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&p).map_err(|e| CommandError::Io(e.to_string()))?;
    Ok(Some(raw))
}

pub fn save_json(app: &tauri::AppHandle, json: &str) -> Result<(), CommandError> {
    let p = session_path(app)?;
    crate::sidecar::atomic_write(&p, json.as_bytes())
        .map_err(|e| CommandError::Io(e.to_string()))?;
    Ok(())
}
