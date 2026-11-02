use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tauri_plugin_dialog::DialogExt;

use crate::doc_paths::{check_readable, document_path, is_document_path, is_sidecar_name, why_unreadable};

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
        .add_filter("Markdown", &crate::default_app::EXTS)
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

/// Opens `path` to read. On macOS and Linux it doesn't wait: opening a FIFO
/// blocks until something writes to it, and a path looked at a moment ago
/// can have been swapped for one since. O_NONBLOCK changes nothing for an
/// ordinary file.
fn open_to_read(path: &Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    options.open(path)
}

/// Reads `path` whole, if it's an ordinary file of at most `limit` bytes.
/// Symlinks are followed, so a linked file still opens.
fn read_capped(path: &Path, limit: u64) -> Result<Vec<u8>, ReadRefused> {
    use std::io::Read;
    // Check before opening, and the opened file too, in case the path
    // changed between (see open_to_read).
    if !fs::metadata(path)?.is_file() {
        return Err(ReadRefused::NotAFile);
    }
    let file = open_to_read(path)?;
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
    /// A sidecar is there but will never load: it's too large, isn't an
    /// ordinary file, or isn't text. The frontend offers to back it up, as
    /// for a corrupt one.
    pub sidecar_unreadable: bool,
    pub sha256: String,
    pub bytes: u64,
}

// Commands that read or write a file the frontend names run on a thread of
// their own instead of the main one: a file on a network share answers as
// slowly as the server likes (a sidecar can be a link to one), and the
// window can't redraw while a main-thread command waits. Nor on one of the
// async runtime's workers, where `#[tauri::command(async)]` runs a plain fn:
// there are only as many of those as the machine has cores, every async
// command shares them, and a share that has stopped answering (a stalled
// NFS mount, a link into /net) would hold one for good.
async fn on_blocking_thread<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, CommandError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| CommandError::Io(e.to_string()))
}

#[tauri::command]
pub async fn read_document(path: String) -> Result<ReadDocumentResult, CommandError> {
    on_blocking_thread(move || read_document_blocking(path)).await?
}

fn read_document_blocking(path: String) -> Result<ReadDocumentResult, CommandError> {
    let md_path = document_path(&path)?;
    check_readable(&md_path, is_document_path)?;
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
        // A sidecar that will never load (too large, not an ordinary file,
        // not text) doesn't keep the document from opening; the frontend
        // offers to back it up. Any other error may pass (a file another
        // program has open, a cloud file not downloaded yet), and backing
        // the sidecar up would hide its annotations from the user, so the
        // document fails to open with the error, as it always has. Only a
        // sidecar that has gone since exists() looked counts as none. One
        // that links to a file that isn't a sidecar (check_readable) is
        // never read, and will never load either.
        let read = match why_unreadable(&sc_path, is_sidecar_name) {
            Ok(None) => read_capped(&sc_path, SIDECAR_LIMIT),
            Ok(Some(_)) => Err(ReadRefused::NotAFile),
            Err(e) => Err(ReadRefused::Io(e)),
        };
        match read {
            Ok(raw) => match String::from_utf8(raw) {
                Ok(text) => Some(text),
                Err(_) => {
                    sidecar_unreadable = true;
                    None
                }
            },
            Err(ReadRefused::NotAFile | ReadRefused::TooLarge) => {
                sidecar_unreadable = true;
                None
            }
            Err(ReadRefused::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => None,
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
pub async fn write_sidecar(md_path: String, json: String) -> Result<(), CommandError> {
    on_blocking_thread(move || write_sidecar_blocking(md_path, json)).await?
}

fn write_sidecar_blocking(md_path: String, json: String) -> Result<(), CommandError> {
    let md = document_path(&md_path)?;
    let sc = sidecar_path_for(&md);
    crate::sidecar::atomic_write_user_file(&sc, json.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub fn push_recent(
    app: tauri::AppHandle,
    path: String,
    max: Option<usize>,
) -> Result<Vec<String>, CommandError> {
    // Recent files are probed and offered again at every launch, so only a
    // document read_document would open is kept.
    document_path(&path)?;
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
pub async fn check_paths_exist(paths: Vec<String>) -> Result<Vec<bool>, CommandError> {
    on_blocking_thread(move || check_paths_exist_blocking(paths)).await
}

fn check_paths_exist_blocking(paths: Vec<String>) -> Vec<bool> {
    // Only documents are ever asked about; anything else reads as missing,
    // as does a path read_document would refuse (a pipe, a link elsewhere).
    paths
        .iter()
        .map(|p| document_path(p).is_ok_and(|p| check_readable(&p, is_document_path).is_ok()))
        .collect()
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

/// Moves a sidecar that couldn't be loaded aside, and returns where to.
/// None when there is no sidecar any more (the user moved or deleted it):
/// there's nothing left to protect, so that isn't an error.
#[tauri::command]
pub async fn backup_corrupt_sidecar(md_path: String) -> Result<Option<String>, CommandError> {
    on_blocking_thread(move || backup_corrupt_sidecar_blocking(md_path)).await?
}

fn backup_corrupt_sidecar_blocking(md_path: String) -> Result<Option<String>, CommandError> {
    let md = document_path(&md_path)?;
    let sc = sidecar_path_for(&md);
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
    match fs::rename(&sc, &backup) {
        Ok(()) => Ok(Some(backup.to_string_lossy().into_owned())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Writes edit-mode markdown and returns the sha256 of what was written.
/// With `expected_sha256`, refuses (Conflict) when the file on disk has
/// changed since the editor last read or wrote it, so another program's
/// edits are never silently overwritten. A file that has disappeared is
/// simply recreated — the user's text is the only copy left.
#[tauri::command]
pub async fn write_document(
    path: String,
    markdown: String,
    expected_sha256: Option<String>,
) -> Result<String, CommandError> {
    on_blocking_thread(move || write_document_blocking(path, markdown, expected_sha256)).await?
}

fn write_document_blocking(
    path: String,
    markdown: String,
    expected_sha256: Option<String>,
) -> Result<String, CommandError> {
    let p = document_path(&path)?;
    if let Some(expected) = expected_sha256 {
        // Hashed as it streams in, so checking a large file costs no memory.
        // Not opening anything but an ordinary file keeps a FIFO from
        // blocking forever (the rename below would fail on a folder anyway).
        if let Ok(meta) = fs::metadata(&p) {
            if !meta.is_file() {
                return Err(CommandError::Io("it isn't an ordinary file".into()));
            }
            if let Ok(disk) = open_to_read(&p).and_then(sha256_of_reader) {
                if disk != expected {
                    return Err(CommandError::Conflict(disk));
                }
            }
        }
    }
    crate::sidecar::atomic_write_user_file(&p, markdown.as_bytes())?;
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
    fn file_commands_leave_the_async_runtime_its_workers() {
        // One more stuck read than the runtime has workers. Each waits for
        // all the others to have started, which they only can if none of
        // them is holding a worker.
        let stuck = std::thread::available_parallelism().map_or(1, |n| n.get()) + 1;
        let all_started = std::sync::Arc::new(std::sync::Barrier::new(stuck));
        let (done, finished) = std::sync::mpsc::channel();
        for _ in 0..stuck {
            let all_started = all_started.clone();
            let done = done.clone();
            tauri::async_runtime::spawn(async move {
                let _ = on_blocking_thread(move || {
                    all_started.wait();
                })
                .await;
                let _ = done.send(());
            });
        }
        for _ in 0..stuck {
            finished
                .recv_timeout(std::time::Duration::from_secs(10))
                .expect("a read waited for a worker another read was holding");
        }
    }

    #[test]
    fn read_document_returns_markdown_and_sha() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();

        let result = read_document_blocking(md.to_string_lossy().into_owned()).unwrap();
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

        let result = read_document_blocking(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.sidecar_raw.as_deref(), Some("{\"x\":1}"));
    }

    #[test]
    fn read_document_rejects_non_utf8() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, &[0xff, 0xfe, 0xfd]).unwrap();

        let result = read_document_blocking(md.to_string_lossy().into_owned());
        assert!(matches!(result, Err(CommandError::NotUtf8)));
    }

    #[test]
    fn read_document_refuses_a_folder() {
        let dir = tempdir().unwrap();
        let folder = dir.path().join("notes.md");
        fs::create_dir(&folder).unwrap();

        let result = read_document_blocking(folder.to_string_lossy().into_owned());
        // check_readable refuses it before read_capped would.
        assert!(matches!(result, Err(CommandError::Io(ref m)) if m.contains("not a file")));
    }

    #[test]
    fn read_document_refuses_a_document_over_the_limit() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("huge.md");
        fs::File::create(&md).unwrap().set_len(DOCUMENT_LIMIT + 1).unwrap();

        let result = read_document_blocking(md.to_string_lossy().into_owned());
        assert!(matches!(result, Err(CommandError::Io(ref m)) if m.contains("too large")));
    }

    #[test]
    fn read_document_skips_a_sidecar_that_is_a_folder() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();
        fs::create_dir(dir.path().join("a.md.remarkdown.json")).unwrap();

        let result = read_document_blocking(md.to_string_lossy().into_owned()).unwrap();
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

        let result = read_document_blocking(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.sidecar_raw, None);
        assert!(result.sidecar_unreadable);
    }

    #[test]
    fn read_document_opens_with_a_sidecar_that_is_not_text() {
        // A sidecar is someone else's file as often as the document is; a
        // broken one must not keep the document from opening.
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();
        fs::write(dir.path().join("a.md.remarkdown.json"), [0xff, 0xfe, 0x00]).unwrap();

        let result = read_document_blocking(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.markdown, "# Hello\n");
        assert_eq!(result.sidecar_raw, None);
        assert!(result.sidecar_unreadable);
    }

    // A sidecar that can't be read right now may be fine a moment later, so
    // it isn't treated as broken (which would set it aside on the next
    // save): the document fails to open with the error, as it always has.
    #[cfg(unix)]
    #[test]
    fn read_document_fails_on_a_sidecar_it_may_not_read() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();
        let sc = dir.path().join("a.md.remarkdown.json");
        fs::write(&sc, b"{}").unwrap();
        fs::set_permissions(&sc, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::read(&sc).is_ok() {
            return; // running as root: nothing is unreadable
        }

        let result = read_document_blocking(md.to_string_lossy().into_owned());
        assert!(matches!(result, Err(CommandError::Io(_))));
    }

    #[cfg(windows)]
    #[test]
    fn read_document_fails_while_another_program_has_the_sidecar_locked() {
        // What antivirus or a sync client does for a moment.
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();
        let sc = dir.path().join("a.md.remarkdown.json");
        fs::write(&sc, b"{}").unwrap();
        let lock = fs::OpenOptions::new().read(true).share_mode(0).open(&sc).unwrap();

        let result = read_document_blocking(md.to_string_lossy().into_owned());
        assert!(matches!(result, Err(CommandError::Io(_))));
        drop(lock);
        assert_eq!(fs::read(&sc).unwrap(), b"{}");
    }

    #[test]
    fn a_normal_sidecar_is_not_flagged_unreadable() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();

        let result = read_document_blocking(md.to_string_lossy().into_owned()).unwrap();
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

        let result = read_document_blocking(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.sidecar_raw, None);
        assert!(result.sidecar_unreadable);
    }

    // read_capped looks at the path before opening it, but a local process
    // can swap a FIFO in between; the open itself mustn't wait for a writer.
    #[cfg(unix)]
    #[test]
    fn open_to_read_does_not_wait_for_a_fifo_writer() {
        let dir = tempdir().unwrap();
        let fifo = dir.path().join("f");
        let status = std::process::Command::new("mkfifo").arg(&fifo).status().unwrap();
        assert!(status.success());

        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(open_to_read(&fifo).and_then(|f| f.metadata()).map(|m| m.is_file()));
        });
        let opened = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("opening the FIFO waited for a writer");
        assert!(!opened.unwrap());
    }

    #[test]
    fn open_to_read_reads_an_ordinary_file() {
        use std::io::Read;
        let dir = tempdir().unwrap();
        let f = dir.path().join("f");
        fs::write(&f, b"hello").unwrap();
        let mut text = String::new();
        open_to_read(&f).unwrap().read_to_string(&mut text).unwrap();
        assert_eq!(text, "hello");
    }

    #[cfg(unix)]
    #[test]
    fn read_document_skips_a_sidecar_linked_to_a_device() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# Hello\n").unwrap();
        std::os::unix::fs::symlink("/dev/zero", dir.path().join("a.md.remarkdown.json")).unwrap();

        let result = read_document_blocking(md.to_string_lossy().into_owned()).unwrap();
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
        let result = write_document_blocking(p, "mine".into(), Some(sha_of(b"old")));
        assert!(matches!(result, Err(CommandError::Io(_))));
    }

    #[test]
    fn check_paths_exist_returns_per_path_flags() {
        let dir = tempdir().unwrap();
        let real = dir.path().join("real.md");
        fs::write(&real, b"x").unwrap();
        let fake = dir.path().join("fake.md");
        let result = check_paths_exist_blocking(vec![
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

        let result = backup_corrupt_sidecar_blocking(md.to_string_lossy().into_owned()).unwrap().unwrap();
        assert!(result.contains(".corrupt-"));
        assert!(!sc.exists());
        assert!(std::path::Path::new(&result).exists());
    }

    #[test]
    fn backup_corrupt_sidecar_with_no_sidecar_left_has_nothing_to_do() {
        // The user moved the broken file away themselves: nothing to protect,
        // so saving annotations must not be held up.
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# hi\n").unwrap();

        let result = backup_corrupt_sidecar_blocking(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn write_document_writes_markdown_atomically() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("note.md");
        let body = "# Hello\n\nWorld.\n";
        write_document_blocking(path.to_string_lossy().into_owned(), body.to_string(), None).unwrap();
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
        let sha = write_document_blocking(path.to_string_lossy().into_owned(), "abc".into(), None).unwrap();
        assert_eq!(sha, sha_of(b"abc"));
    }

    #[test]
    fn write_document_refuses_when_the_file_changed_on_disk() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("n.md");
        fs::write(&path, b"theirs").unwrap();
        let p = path.to_string_lossy().into_owned();
        let err = write_document_blocking(p, "mine".into(), Some(sha_of(b"what I loaded"))).unwrap_err();
        assert!(matches!(err, CommandError::Conflict(ref disk) if *disk == sha_of(b"theirs")));
        assert_eq!(fs::read_to_string(&path).unwrap(), "theirs");
    }

    #[test]
    fn write_document_writes_when_the_disk_matches() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("n.md");
        fs::write(&path, b"v1").unwrap();
        let p = path.to_string_lossy().into_owned();
        write_document_blocking(p, "v2".into(), Some(sha_of(b"v1"))).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "v2");
    }

    // A script that got into the page can only reach Markdown documents
    // through the commands, never other files.
    #[test]
    fn read_document_refuses_a_file_that_is_not_markdown() {
        let dir = tempdir().unwrap();
        let secret = dir.path().join("id_rsa");
        fs::write(&secret, b"private").unwrap();
        let result = read_document_blocking(secret.to_string_lossy().into_owned());
        assert!(matches!(result, Err(CommandError::Io(ref m)) if m.contains("not a Markdown file")));
    }

    #[test]
    fn write_document_refuses_a_file_that_is_not_markdown() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("autostart.bat");
        let result = write_document_blocking(target.to_string_lossy().into_owned(), "evil".into(), None);
        assert!(matches!(result, Err(CommandError::Io(_))));
        assert!(!target.exists());
    }

    #[test]
    fn sidecar_commands_refuse_a_file_that_is_not_markdown() {
        let dir = tempdir().unwrap();
        let txt = dir.path().join("notes.txt");
        let txt_sidecar = dir.path().join("notes.txt.remarkdown.json");
        fs::write(&txt_sidecar, b"{ corrupt").unwrap();
        let p = txt.to_string_lossy().into_owned();
        assert!(matches!(write_sidecar_blocking(p.clone(), "{}".into()), Err(CommandError::Io(_))));
        assert_eq!(fs::read_to_string(&txt_sidecar).unwrap(), "{ corrupt");
        assert!(matches!(backup_corrupt_sidecar_blocking(p), Err(CommandError::Io(_))));
        assert!(txt_sidecar.exists());
    }

    #[test]
    fn write_sidecar_writes_next_to_a_document() {
        let dir = tempdir().unwrap();
        let md = dir.path().join("a.md");
        write_sidecar_blocking(md.to_string_lossy().into_owned(), "{\"x\":1}".into()).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("a.md.remarkdown.json")).unwrap(), "{\"x\":1}");
    }

    #[test]
    fn check_paths_exist_reports_only_documents() {
        let dir = tempdir().unwrap();
        let other = dir.path().join("secret.txt");
        fs::write(&other, b"x").unwrap();
        assert_eq!(check_paths_exist_blocking(vec![other.to_string_lossy().into_owned()]), vec![false]);
    }

    #[test]
    fn write_document_with_an_expected_sha_creates_a_missing_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("gone.md");
        let p = path.to_string_lossy().into_owned();
        write_document_blocking(p, "mine".into(), Some(sha_of(b"old"))).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "mine");
    }

    // git and tar check out symlinks on macOS and Linux, so a repo can ship
    // a document or a sidecar that points at a secret.
    #[cfg(unix)]
    #[test]
    fn read_document_does_not_read_through_a_link_to_another_kind_of_file() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let secret = dir.path().join("credentials");
        fs::write(&secret, b"private").unwrap();
        let md = dir.path().join("notes.md");
        symlink(&secret, &md).unwrap();
        assert!(matches!(read_document_blocking(md.to_string_lossy().into_owned()), Err(CommandError::Io(_))));

        let real = dir.path().join("README.md");
        fs::write(&real, b"# hi").unwrap();
        symlink(&secret, dir.path().join("README.md.remarkdown.json")).unwrap();
        // The document still opens; its sidecar is offered for backing up.
        let result = read_document_blocking(real.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.sidecar_raw, None);
        assert!(result.sidecar_unreadable);
    }

    #[cfg(unix)]
    #[test]
    fn read_document_follows_a_link_to_another_document() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let shared = dir.path().join("shared.md");
        fs::write(&shared, b"# shared").unwrap();
        fs::write(dir.path().join("shared.md.remarkdown.json"), b"{}").unwrap();
        let md = dir.path().join("notes.md");
        symlink(&shared, &md).unwrap();
        symlink(dir.path().join("shared.md.remarkdown.json"), dir.path().join("notes.md.remarkdown.json")).unwrap();
        let result = read_document_blocking(md.to_string_lossy().into_owned()).unwrap();
        assert_eq!(result.markdown, "# shared");
        assert_eq!(result.sidecar_raw.as_deref(), Some("{}"));
    }
}
