use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, thiserror::Error, Serialize)]
pub enum CommandError {
    #[error("dialog cancelled")]
    Cancelled,
    #[error("io error: {0}")]
    Io(String),
    #[error("file not utf-8")]
    NotUtf8,
    #[error("sidecar malformed: {0}")]
    SidecarMalformed(String),
}

impl From<std::io::Error> for CommandError {
    fn from(e: std::io::Error) -> Self { CommandError::Io(e.to_string()) }
}

#[tauri::command]
pub async fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, CommandError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file(move |path| {
            let _ = tx.send(path.map(|p| p.to_string()));
        });
    match rx.await {
        Ok(Some(path)) => Ok(Some(path)),
        Ok(None) => Ok(None),
        Err(_) => Err(CommandError::Cancelled),
    }
}

fn sidecar_path_for(md_path: &Path) -> PathBuf {
    let mut s = md_path.as_os_str().to_owned();
    s.push(".remarkdown.json");
    PathBuf::from(s)
}

#[derive(Debug, Serialize)]
pub struct ReadDocumentResult {
    pub path: String,
    pub dir: String,
    pub markdown: String,
    pub sidecar_raw: Option<String>,
    pub sha256: String,
    pub bytes: u64,
}

#[tauri::command]
pub fn read_document(path: String) -> Result<ReadDocumentResult, CommandError> {
    let md_path = PathBuf::from(&path);
    let bytes = fs::read(&md_path)?;
    let markdown = String::from_utf8(bytes.clone()).map_err(|_| CommandError::NotUtf8)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256 = format!("{:x}", hasher.finalize());

    let sc_path = sidecar_path_for(&md_path);
    let sidecar_raw = if sc_path.exists() {
        Some(fs::read_to_string(&sc_path)?)
    } else {
        None
    };

    let dir = md_path
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    Ok(ReadDocumentResult {
        path: md_path.to_string_lossy().into_owned(),
        dir,
        markdown,
        sidecar_raw,
        sha256,
        bytes: bytes.len() as u64,
    })
}

#[tauri::command]
pub fn write_sidecar(md_path: String, json: String) -> Result<(), CommandError> {
    let md = PathBuf::from(md_path);
    let sc = sidecar_path_for(&md);
    crate::sidecar::atomic_write(&sc, json.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn read_document_returns_markdown_and_sha() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();

        let result = read_document(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.markdown, "# Hello\n");
        assert_eq!(result.bytes, 8);
        assert_eq!(result.sidecar_raw, None);
        assert_eq!(result.sha256.len(), 64);
    }

    #[test]
    fn read_document_returns_sidecar_if_present() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        let sc = dir.path().join("a.md.remarkdown.json");
        fs::write(&md, b"# Hello\n").unwrap();
        fs::write(&sc, b"{\"x\":1}").unwrap();

        let result = read_document(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.sidecar_raw.as_deref(), Some("{\"x\":1}"));
    }

    #[test]
    fn read_document_rejects_non_utf8() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, &[0xff, 0xfe, 0xfd]).unwrap();

        let result = read_document(md.to_string_lossy().into_owned());
        assert!(matches!(result, Err(CommandError::NotUtf8)));
    }
}
