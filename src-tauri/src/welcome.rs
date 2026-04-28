use std::fs;
use std::path::PathBuf;

use crate::commands::CommandError;

// The welcome document is baked into the binary at compile time. We
// materialise it into the user's app_data_dir on every launch so the
// rest of the app can treat it as a normal file. The bundled bytes are
// the source of truth: if the on-disk copy differs (older build, user
// edits, anything), it gets overwritten and its sidecar wiped so stale
// annotations don't dangle off content that no longer exists.
const WELCOME_MARKDOWN: &str = include_str!("../../examples/welcome.md");

const WELCOME_FILENAME: &str = "welcome.md";
const WELCOME_SIDECAR_FILENAME: &str = "welcome.md.remarkdown.json";

pub fn ensure(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError::Io(format!("no app_data_dir: {e}")))?;
    fs::create_dir_all(&dir).map_err(|e| CommandError::Io(e.to_string()))?;
    let p = dir.join(WELCOME_FILENAME);
    let needs_write = match fs::read(&p) {
        Ok(existing) => existing != WELCOME_MARKDOWN.as_bytes(),
        Err(_) => true,
    };
    if needs_write {
        crate::sidecar::atomic_write(&p, WELCOME_MARKDOWN.as_bytes())
            .map_err(|e| CommandError::Io(e.to_string()))?;
        // Drop the sidecar so old annotations don't dangle off prior
        // content. ENOENT is fine — there may not have been one.
        let sc = dir.join(WELCOME_SIDECAR_FILENAME);
        if let Err(e) = fs::remove_file(&sc) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(CommandError::Io(e.to_string()));
            }
        }
    }
    Ok(p)
}
