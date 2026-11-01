use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, thiserror::Error, Serialize)]
pub enum CommandError {
    #[allow(dead_code)]
    #[error("dialog cancelled")]
    Cancelled,
    #[error("io error: {0}")]
    Io(String),
    #[error("file not utf-8")]
    NotUtf8,
    #[allow(dead_code)]
    #[error("sidecar malformed: {0}")]
    SidecarMalformed(String),
    /// The file on disk is no longer the version the editor started from
    /// (another program changed it). Carries the sha of what's on disk.
    #[error("file changed on disk")]
    Conflict(String),
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
        Ok(None) => Ok(None), // user cancelled the dialog
        Err(_) => Err(CommandError::Io("dialog closed unexpectedly".into())),
    }
}

/// Picks a picture to put in a document (the editor's Image button).
#[tauri::command]
pub async fn open_image_dialog(app: tauri::AppHandle, start_dir: Option<String>) -> Result<Option<String>, CommandError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose a picture")
        .add_filter("Pictures", &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"]);
    if let Some(dir) = start_dir {
        dialog = dialog.set_directory(dir);
    }
    dialog.pick_file(move |path| {
        let _ = tx.send(path.map(|p| p.to_string()));
    });
    match rx.await {
        Ok(path) => Ok(path),
        Err(_) => Err(CommandError::Io("dialog closed unexpectedly".into())),
    }
}

fn sidecar_path_for(md_path: &Path) -> PathBuf {
    let mut s = md_path.as_os_str().to_owned();
    s.push(".remarkdown.json");
    PathBuf::from(s)
}

// Paths reach these commands from the frontend, and a document or sidecar
// can come from someone else (a cloned repo, a tarball). Reads are capped so
// a link to /dev/zero or a FIFO can't hang the app or eat all its memory.
// Neither limit is anywhere near a real file: the largest markdown files
// people keep are a few MB, and a 50 MB one would already take minutes to
// render. Annotation files warn at 2 MB (save.ts), and drawings are what
// make them big; 64 MB is 30 times that.
const DOCUMENT_LIMIT: u64 = 50 * 1024 * 1024;
const SIDECAR_LIMIT: u64 = 64 * 1024 * 1024;

#[derive(Debug)]
enum ReadRefused {
    /// A folder, FIFO, device, socket... anything but an ordinary file.
    NotAFile,
    TooLarge,
    Io(std::io::Error),
}

impl From<std::io::Error> for ReadRefused {
    fn from(e: std::io::Error) -> Self { ReadRefused::Io(e) }
}

/// Reads `path` whole, if it's an ordinary file of at most `limit` bytes.
/// Symlinks are followed, so a linked file still opens.
fn read_capped(path: &Path, limit: u64) -> Result<Vec<u8>, ReadRefused> {
    use std::io::Read;
    // Check before opening: opening a FIFO blocks until something writes
    // to it. Check the opened file too, in case the path changed between.
    if !fs::metadata(path)?.is_file() {
        return Err(ReadRefused::NotAFile);
    }
    let file = fs::File::open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(ReadRefused::NotAFile);
    }
    // A file can grow after metadata() looks at it, so the read itself is
    // capped too: one byte past the limit is enough to know it's too big.
    let mut bytes = Vec::with_capacity(meta.len().min(limit) as usize);
    file.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(ReadRefused::TooLarge);
    }
    Ok(bytes)
}

#[derive(Debug, Serialize)]
pub struct ReadDocumentResult {
    pub path: String,
    pub dir: String,
    pub markdown: String,
    pub sidecar_raw: Option<String>,
    /// A sidecar is there but wasn't read: it's too large or isn't an
    /// ordinary file. The frontend offers to back it up, as for a corrupt one.
    pub sidecar_unreadable: bool,
    pub sha256: String,
    pub bytes: u64,
}

#[tauri::command]
pub fn read_document(path: String) -> Result<ReadDocumentResult, CommandError> {
    let md_path = PathBuf::from(&path);
    let bytes = match read_capped(&md_path, DOCUMENT_LIMIT) {
        Ok(bytes) => bytes,
        Err(ReadRefused::NotAFile) => {
            return Err(CommandError::Io("it isn't an ordinary file".into()))
        }
        Err(ReadRefused::TooLarge) => {
            return Err(CommandError::Io("the file is too large (over 50 MB)".into()))
        }
        Err(ReadRefused::Io(e)) => return Err(e.into()),
    };
    let sha256 = sha256_hex(&bytes);
    let byte_len = bytes.len() as u64;
    let markdown = String::from_utf8(bytes).map_err(|_| CommandError::NotUtf8)?;

    let sc_path = sidecar_path_for(&md_path);
    let mut sidecar_unreadable = false;
    let sidecar_raw = if sc_path.exists() {
        match read_capped(&sc_path, SIDECAR_LIMIT) {
            Ok(raw) => Some(String::from_utf8(raw).map_err(|_| {
                // The same error read_to_string gave before reads were capped.
                std::io::Error::new(std::io::ErrorKind::InvalidData, "stream did not contain valid UTF-8")
            })?),
            Err(ReadRefused::NotAFile | ReadRefused::TooLarge) => {
                sidecar_unreadable = true;
                None
            }
            Err(ReadRefused::Io(e)) => return Err(e.into()),
        }
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
        sidecar_unreadable,
        sha256,
        bytes: byte_len,
    })
}

#[tauri::command]
pub fn write_sidecar(md_path: String, json: String) -> Result<(), CommandError> {
    let md = PathBuf::from(md_path);
    let sc = sidecar_path_for(&md);
    crate::sidecar::atomic_write(&sc, json.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub fn push_recent(
    app: tauri::AppHandle,
    path: String,
    max: Option<usize>,
) -> Result<Vec<String>, CommandError> {
    crate::recent::push(&app, path, max.unwrap_or(crate::recent::DEFAULT_MAX_RECENT))
}

#[tauri::command]
pub fn list_recent(app: tauri::AppHandle) -> Result<Vec<String>, CommandError> {
    crate::recent::list(&app)
}

#[tauri::command]
pub fn clear_recent(app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::recent::clear(&app)
}

#[tauri::command]
pub fn remove_recent(app: tauri::AppHandle, path: String) -> Result<Vec<String>, CommandError> {
    crate::recent::remove(&app, &path)
}

#[tauri::command]
pub fn check_paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| std::path::Path::new(p).is_file()).collect()
}

#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> Result<Option<String>, CommandError> {
    crate::settings::load_json(&app)
}

#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, json: String) -> Result<(), CommandError> {
    crate::settings::save_json(&app, &json)
}

#[tauri::command]
pub fn load_session(app: tauri::AppHandle) -> Result<Option<String>, CommandError> {
    crate::session_file::load_json(&app)
}

#[tauri::command]
pub fn save_session(app: tauri::AppHandle, json: String) -> Result<(), CommandError> {
    crate::session_file::save_json(&app, &json)
}

#[tauri::command]
pub fn load_reading_progress(app: tauri::AppHandle) -> Result<Option<String>, CommandError> {
    crate::reading_progress::load_json(&app)
}

#[tauri::command]
pub fn save_reading_progress(app: tauri::AppHandle, json: String) -> Result<(), CommandError> {
    crate::reading_progress::save_json(&app, &json)
}

#[tauri::command]
pub fn ensure_welcome_doc(app: tauri::AppHandle) -> Result<String, CommandError> {
    let p = crate::welcome::ensure(&app)?;
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn backup_corrupt_sidecar(md_path: String) -> Result<String, CommandError> {
    let md = PathBuf::from(md_path);
    let sc = sidecar_path_for(&md);
    if !sc.exists() {
        return Err(CommandError::Io("sidecar does not exist".into()));
    }
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut backup = sc.clone();
    let backup_name = format!(
        "{}.corrupt-{}",
        sc.file_name().and_then(|n| n.to_str()).unwrap_or("sidecar.json"),
        timestamp
    );
    backup.set_file_name(backup_name);
    fs::rename(&sc, &backup)?;
    Ok(backup.to_string_lossy().into_owned())
}

/// Writes edit-mode markdown and returns the sha256 of what was written.
/// With `expected_sha256`, refuses (Conflict) when the file on disk has
/// changed since the editor last read or wrote it, so another program's
/// edits are never silently overwritten. A file that has disappeared is
/// simply recreated — the user's text is the only copy left.
#[tauri::command]
pub fn write_document(
    path: String,
    markdown: String,
    expected_sha256: Option<String>,
) -> Result<String, CommandError> {
    let p = PathBuf::from(path);
    if let Some(expected) = expected_sha256 {
        // Hashed as it streams in, so checking a large file costs no memory.
        // Not opening anything but an ordinary file keeps a FIFO from
        // blocking forever (the rename below would fail on a folder anyway).
        if let Ok(meta) = fs::metadata(&p) {
            if !meta.is_file() {
                return Err(CommandError::Io("it isn't an ordinary file".into()));
            }
            if let Ok(disk) = fs::File::open(&p).and_then(sha256_of_reader) {
                if disk != expected {
                    return Err(CommandError::Conflict(disk));
                }
            }
        }
    }
    crate::sidecar::atomic_write(&p, markdown.as_bytes())?;
    Ok(sha256_hex(markdown.as_bytes()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn sha256_of_reader(mut reader: impl std::io::Read) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    std::io::copy(&mut reader, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
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

    #[test]
    fn read_document_refuses_a_folder() {
        let dir = tempdir().unwrap();
        let folder = dir.path().join("notes.md");
        fs::create_dir(&folder).unwrap();

        let result = read_document(folder.to_string_lossy().into_owned());
        assert!(matches!(result, Err(CommandError::Io(_))));
    }

    #[test]
    fn read_document_refuses_a_document_over_the_limit() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("huge.md");
        fs::File::create(&md).unwrap().set_len(DOCUMENT_LIMIT + 1).unwrap();

        let result = read_document(md.to_string_lossy().into_owned());
        assert!(matches!(result, Err(CommandError::Io(ref m)) if m.contains("too large")));
    }

    #[test]
    fn read_document_skips_a_sidecar_that_is_a_folder() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();
        fs::create_dir(dir.path().join("a.md.remarkdown.json")).unwrap();

        let result = read_document(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.markdown, "# Hello\n");
        assert_eq!(result.sidecar_raw, None);
        assert!(result.sidecar_unreadable);
    }

    #[test]
    fn read_document_skips_a_sidecar_over_the_limit() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();
        let sc = dir.path().join("a.md.remarkdown.json");
        fs::File::create(&sc).unwrap().set_len(SIDECAR_LIMIT + 1).unwrap();

        let result = read_document(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.sidecar_raw, None);
        assert!(result.sidecar_unreadable);
    }

    #[test]
    fn a_normal_sidecar_is_not_flagged_unreadable() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();

        let result = read_document(md.to_string_lossy().into_owned()).unwrap();
        assert!(!result.sidecar_unreadable);
    }

    #[test]
    fn read_capped_reads_up_to_the_limit_and_refuses_one_byte_more() {
        let dir = tempdir().unwrap();
        let f = dir.path().join("f");
        fs::write(&f, b"12345").unwrap();
        assert_eq!(read_capped(&f, 5).unwrap(), b"12345");
        assert!(matches!(read_capped(&f, 4), Err(ReadRefused::TooLarge)));
    }

    #[cfg(unix)]
    #[test]
    fn read_document_skips_a_sidecar_that_is_a_fifo() {
        // Reading a FIFO waits forever for a writer; it must never be opened.
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();
        let sc = dir.path().join("a.md.remarkdown.json");
        let status = std::process::Command::new("mkfifo").arg(&sc).status().unwrap();
        assert!(status.success());

        let result = read_document(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.sidecar_raw, None);
        assert!(result.sidecar_unreadable);
    }

    #[cfg(unix)]
    #[test]
    fn read_document_skips_a_sidecar_linked_to_a_device() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();
        std::os::unix::fs::symlink("/dev/zero", dir.path().join("a.md.remarkdown.json")).unwrap();

        let result = read_document(md.to_string_lossy().into_owned()).unwrap();
        assert!(result.sidecar_unreadable);
    }

    #[cfg(unix)]
    #[test]
    fn write_document_refuses_to_check_a_fifo() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("n.md");
        let status = std::process::Command::new("mkfifo").arg(&path).status().unwrap();
        assert!(status.success());

        let p = path.to_string_lossy().into_owned();
        let result = write_document(p, "mine".into(), Some(sha_of(b"old")));
        assert!(matches!(result, Err(CommandError::Io(_))));
    }

    #[test]
    fn check_paths_exist_returns_per_path_flags() {
        let dir = tempdir().unwrap();
        let real = dir.path().join("real.md");
        fs::write(&real, b"x").unwrap();
        let fake = dir.path().join("fake.md");
        let result = check_paths_exist(vec![
            real.to_string_lossy().into_owned(),
            fake.to_string_lossy().into_owned(),
        ]);
        assert_eq!(result, vec![true, false]);
    }

    #[test]
    fn backup_corrupt_sidecar_renames_the_file() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        let sc = dir.path().join("a.md.remarkdown.json");
        fs::write(&md, b"# hi\n").unwrap();
        fs::write(&sc, b"{ corrupt").unwrap();

        let result = backup_corrupt_sidecar(md.to_string_lossy().into_owned()).unwrap();
        assert!(result.contains(".corrupt-"));
        assert!(!sc.exists());
        assert!(std::path::Path::new(&result).exists());
    }

    #[test]
    fn write_document_writes_markdown_atomically() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("note.md");
        let body = "# Hello\n\nWorld.\n";
        write_document(path.to_string_lossy().into_owned(), body.to_string(), None).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), body);
    }

    fn sha_of(bytes: &[u8]) -> String {
        let mut h = Sha256::new();
        h.update(bytes);
        format!("{:x}", h.finalize())
    }

    #[test]
    fn write_document_returns_the_new_sha() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("n.md");
        let sha = write_document(path.to_string_lossy().into_owned(), "abc".into(), None).unwrap();
        assert_eq!(sha, sha_of(b"abc"));
    }

    #[test]
    fn write_document_refuses_when_the_file_changed_on_disk() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("n.md");
        fs::write(&path, b"theirs").unwrap();
        let p = path.to_string_lossy().into_owned();
        let err = write_document(p, "mine".into(), Some(sha_of(b"what I loaded"))).unwrap_err();
        assert!(matches!(err, CommandError::Conflict(ref disk) if *disk == sha_of(b"theirs")));
        assert_eq!(fs::read_to_string(&path).unwrap(), "theirs");
    }

    #[test]
    fn write_document_writes_when_the_disk_matches() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("n.md");
        fs::write(&path, b"v1").unwrap();
        let p = path.to_string_lossy().into_owned();
        write_document(p, "v2".into(), Some(sha_of(b"v1"))).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "v2");
    }

    #[test]
    fn write_document_with_an_expected_sha_creates_a_missing_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("gone.md");
        let p = path.to_string_lossy().into_owned();
        write_document(p, "mine".into(), Some(sha_of(b"old"))).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "mine");
    }
}
