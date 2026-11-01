// Which paths the file commands accept from the webview.
//
// The frontend only ever hands the commands a Markdown document's path: one
// the user opened (the Open dialog and drag-and-drop only offer .md and
// .markdown; a double-click brings the extensions we register, plus the
// few more that Linux's text/markdown MIME type and macOS's Markdown UTI
// cover), the welcome doc, or a "(my copy)" saved next to one. A sidecar is
// never named by the frontend; the commands derive it from the document's
// path. So a command refuses anything that isn't such a document, and a
// script that gets into the page can't use them to read or overwrite other
// files.

use std::fs;
use std::path::{Path, PathBuf};

use crate::commands::CommandError;

/// Every extension a document may have: the ones we register (EXTS), then
/// the ones the text/markdown MIME type and the Markdown UTI also cover,
/// which the desktop hands us on a double-click too.
pub const DOCUMENT_EXTS: [&str; 6] = ["md", "markdown", "mkd", "mdown", "mkdn", "mdwn"];

/// True for an absolute path to a file remarkdown opens: one ending in a
/// document extension, in any case. A relative path would resolve against
/// the app's working directory, which the frontend never means.
pub fn is_document_path(path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }
    // `\.\pipe\x.md` and `\?\GLOBALROOT\...` name devices and pipes, not
    // files on a drive or a share. A server name reaches the same pipes
    // (and mailslots) over SMB: `\localhost\pipe\x.md`.
    #[cfg(windows)]
    if let Some(std::path::Component::Prefix(p)) = path.components().next() {
        use std::path::Prefix::{DeviceNS, Verbatim, VerbatimUNC, UNC};
        match p.kind() {
            DeviceNS(_) | Verbatim(_) => return false,
            UNC(_, share) | VerbatimUNC(_, share)
                if share.eq_ignore_ascii_case("pipe") || share.eq_ignore_ascii_case("mailslot") =>
            {
                return false
            }
            _ => {}
        }
    }
    path.file_name().is_some_and(|n| has_document_name(&n.to_string_lossy()))
}

/// True for a file name ending in a document extension.
fn has_document_name(name: &str) -> bool {
    // On Windows `notes.txt:x.md` names a stream of notes.txt, not a file.
    if cfg!(windows) && name.contains(':') {
        return false;
    }
    let name = name.to_ascii_lowercase();
    DOCUMENT_EXTS.iter().any(|ext| name.ends_with(&format!(".{ext}")))
}

/// True for a path named like a document's sidecar: the document's name
/// followed by `.remarkdown.json` (sidecar_path_for in commands.rs).
pub fn is_sidecar_name(path: &Path) -> bool {
    let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()) else {
        return false;
    };
    name.strip_suffix(".remarkdown.json").is_some_and(has_document_name)
}

/// Checks a file before a command reads it. Only a regular file is read,
/// never a FIFO or a device, which could block or never end. The name
/// checks above see only the link's own name, and a cloned repo or a
/// tarball can ship `notes.md -> ~/.ssh/id_rsa`, so a symlink is followed
/// only to a file whose own name `name_ok` accepts. Writes need no such
/// check: atomic_write replaces the link rather than writing through it.
pub fn check_readable(path: &Path, name_ok: fn(&Path) -> bool) -> Result<(), CommandError> {
    match why_unreadable(path, name_ok)? {
        Some(why) => Err(CommandError::Io(why)),
        None => Ok(()),
    }
}

/// Why check_readable refuses `path`, or None when it doesn't. An error
/// only when looking at the path failed, which the caller can tell apart
/// from a refusal: a sidecar that is refused will never load, while one
/// that couldn't be looked at may be fine a moment later.
pub fn why_unreadable(path: &Path, name_ok: fn(&Path) -> bool) -> std::io::Result<Option<String>> {
    if fs::symlink_metadata(path)?.file_type().is_symlink() && !name_ok(&fs::canonicalize(path)?) {
        return Ok(Some(format!("{} links to a file remarkdown does not open", path.display())));
    }
    if !fs::metadata(path)?.is_file() {
        return Ok(Some(format!("{} is not a file", path.display())));
    }
    Ok(None)
}

/// The path, if it is a document (see is_document_path); a clear error
/// otherwise.
pub fn document_path(path: &str) -> Result<PathBuf, CommandError> {
    let p = PathBuf::from(path);
    if is_document_path(&p) {
        Ok(p)
    } else {
        Err(CommandError::Io(format!(
            "{path} is not a Markdown file (remarkdown opens .md and .markdown files)"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::default_app::EXTS;

    fn abs(name: &str) -> PathBuf {
        std::env::temp_dir().join(name)
    }

    #[test]
    fn markdown_files_are_documents() {
        for name in ["a.md", "Read Me.markdown", "NOTES.MD", "x.Markdown", "welcome.md", "Plan (my copy 2).md"] {
            assert!(is_document_path(&abs(name)), "{name}");
        }
    }

    // Linux's text/markdown and macOS's Markdown UTI also cover these, so
    // the desktop hands them to us on a double-click.
    #[test]
    fn other_markdown_extensions_are_documents() {
        for name in ["a.mkd", "a.MDOWN", "a.mkdn", "a.mdwn"] {
            assert!(is_document_path(&abs(name)), "{name}");
        }
    }

    #[test]
    fn other_files_are_not() {
        for name in [
            "id_rsa",
            "notes.txt",
            "a.md.remarkdown.json",
            "a.md.remarkdown.json.corrupt-1700000000",
            "a.mdx",
            "a.md.bak",
            "a.markdown~",
            "md",
            "a.md.",
        ] {
            assert!(!is_document_path(&abs(name)), "{name}");
        }
    }

    #[test]
    fn a_folder_path_without_a_name_is_not() {
        assert!(!is_document_path(&std::env::temp_dir().join("..")));
        #[cfg(windows)]
        assert!(!is_document_path(Path::new(r"C:\")));
        #[cfg(unix)]
        assert!(!is_document_path(Path::new("/")));
    }

    #[test]
    fn relative_paths_are_not() {
        assert!(!is_document_path(Path::new("a.md")));
        assert!(!is_document_path(Path::new("../a.md")));
    }

    #[cfg(windows)]
    #[test]
    fn alternate_data_streams_are_not() {
        assert!(!is_document_path(Path::new(r"C:\Users\v\notes.txt:x.md")));
        assert!(!is_document_path(Path::new(r"C:\Users\v\a.md:secret.md")));
    }

    #[cfg(windows)]
    #[test]
    fn device_paths_are_not() {
        assert!(!is_document_path(Path::new(r"\\.\pipe\x.md")));
        assert!(!is_document_path(Path::new(r"\\?\GLOBALROOT\Device\NamedPipe\x.md")));
        // A server name reaches the same pipes (and mailslots) over SMB.
        for p in [
            r"\\127.0.0.1\pipe\x.md",
            r"\\localhost\PIPE\x.md",
            r"\\?\UNC\localhost\pipe\x.md",
            r"\\server\mailslot\x.md",
        ] {
            assert!(!is_document_path(Path::new(p)), "{p}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn drive_share_and_long_paths_are_documents() {
        for p in [r"C:\Users\v\a.md", r"\\server\share\a.md", r"\\?\C:\Users\v\a.md", r"\\?\UNC\server\share\a.md"] {
            assert!(is_document_path(Path::new(p)), "{p}");
        }
    }

    #[test]
    fn document_path_explains_a_refusal() {
        let p = abs("notes.txt");
        let s = p.to_string_lossy().into_owned();
        match document_path(&s) {
            Err(CommandError::Io(msg)) => {
                assert!(msg.contains(&s), "{msg}");
                assert!(msg.contains(".md and .markdown"), "{msg}");
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
        assert_eq!(document_path(&abs("a.md").to_string_lossy()).unwrap(), abs("a.md"));
    }

    #[test]
    fn sidecars_are_named_after_a_document() {
        for name in ["a.md.remarkdown.json", "Read Me.markdown.remarkdown.json", "A.MD.REMARKDOWN.JSON", "a.mkd.remarkdown.json"] {
            assert!(is_sidecar_name(&abs(name)), "{name}");
        }
        for name in [
            "credentials",
            "a.remarkdown.json",
            "a.txt.remarkdown.json",
            "a.md",
            "a.md.remarkdown.json.corrupt-1700000000",
        ] {
            assert!(!is_sidecar_name(&abs(name)), "{name}");
        }
    }

    #[test]
    fn only_regular_files_are_readable() {
        let dir = tempfile::tempdir().unwrap();
        let md = dir.path().join("a.md");
        fs::write(&md, b"# a").unwrap();
        assert!(check_readable(&md, is_document_path).is_ok());
        let folder = dir.path().join("folder.md");
        fs::create_dir(&folder).unwrap();
        assert!(matches!(check_readable(&folder, is_document_path), Err(CommandError::Io(m)) if m.contains("not a file")));
        assert!(check_readable(&dir.path().join("gone.md"), is_document_path).is_err());
    }

    #[test]
    fn a_refusal_is_told_apart_from_a_failure_to_look() {
        let dir = tempfile::tempdir().unwrap();
        let sidecar = dir.path().join("a.md.remarkdown.json");
        fs::write(&sidecar, b"{}").unwrap();
        assert!(matches!(why_unreadable(&sidecar, is_sidecar_name), Ok(None)));
        let folder = dir.path().join("b.md.remarkdown.json");
        fs::create_dir(&folder).unwrap();
        assert!(matches!(why_unreadable(&folder, is_sidecar_name), Ok(Some(_))));
        let gone = why_unreadable(&dir.path().join("c.md.remarkdown.json"), is_sidecar_name);
        assert!(matches!(gone, Err(e) if e.kind() == std::io::ErrorKind::NotFound));
    }

    // A checked-out `notes.md -> ~/.ssh/id_rsa` is named like a document,
    // but what it reads is not one.
    #[cfg(unix)]
    #[test]
    fn a_symlink_is_read_only_through_to_a_file_of_the_same_kind() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let key = dir.path().join("id_rsa");
        let other = dir.path().join("other.md");
        fs::write(&key, b"private").unwrap();
        fs::write(&other, b"# other").unwrap();
        let to_key = dir.path().join("notes.md");
        let to_md = dir.path().join("alias.md");
        symlink(&key, &to_key).unwrap();
        symlink(&other, &to_md).unwrap();
        assert!(matches!(check_readable(&to_key, is_document_path), Err(CommandError::Io(m)) if m.contains("links to")));
        assert!(check_readable(&to_md, is_document_path).is_ok());
        assert!(check_readable(&to_md, is_sidecar_name).is_err());
    }

    // The extensions accepted here are the ones the installers register,
    // then the ones the MIME type and UTI bring with them.
    #[test]
    fn documents_are_the_associated_file_types() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let assoc: Vec<&str> = conf["bundle"]["fileAssociations"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|a| a["ext"].as_array().unwrap().iter().map(|e| e.as_str().unwrap()))
            .collect();
        assert_eq!(assoc, EXTS);
        assert!(DOCUMENT_EXTS.starts_with(&EXTS));
    }
}
