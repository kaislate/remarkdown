use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const MAX_RECENT: usize = 10;

#[derive(Serialize, Deserialize, Default)]
struct RecentFile { paths: Vec<String> }

fn recent_path(app: &tauri::AppHandle) -> Result<PathBuf, crate::commands::CommandError> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| {
        crate::commands::CommandError::Io(format!("no app_data_dir: {e}"))
    })?;
    fs::create_dir_all(&dir).map_err(|e| crate::commands::CommandError::Io(e.to_string()))?;
    Ok(dir.join("recent.json"))
}

fn load(app: &tauri::AppHandle) -> Result<RecentFile, crate::commands::CommandError> {
    let p = recent_path(app)?;
    if !p.exists() { return Ok(RecentFile::default()); }
    let raw = fs::read_to_string(&p).map_err(|e| crate::commands::CommandError::Io(e.to_string()))?;
    let parsed = serde_json::from_str::<RecentFile>(&raw).unwrap_or_default();
    Ok(parsed)
}

fn save(app: &tauri::AppHandle, r: &RecentFile) -> Result<(), crate::commands::CommandError> {
    let p = recent_path(app)?;
    let json = serde_json::to_string_pretty(r).map_err(|e| crate::commands::CommandError::Io(e.to_string()))?;
    crate::sidecar::atomic_write(&p, json.as_bytes()).map_err(|e| crate::commands::CommandError::Io(e.to_string()))?;
    Ok(())
}

pub fn push(app: &tauri::AppHandle, path: String) -> Result<Vec<String>, crate::commands::CommandError> {
    let mut r = load(app)?;
    r.paths.retain(|p| p != &path);
    r.paths.insert(0, path);
    r.paths.truncate(MAX_RECENT);
    save(app, &r)?;
    Ok(r.paths.clone())
}

pub fn list(app: &tauri::AppHandle) -> Result<Vec<String>, crate::commands::CommandError> {
    Ok(load(app)?.paths)
}

pub fn clear(app: &tauri::AppHandle) -> Result<(), crate::commands::CommandError> {
    save(app, &RecentFile::default())
}
