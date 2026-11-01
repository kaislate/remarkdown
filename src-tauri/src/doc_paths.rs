// Which paths the file commands accept from the webview.
//
// The frontend only ever hands the commands a Markdown document's path: one
// the user opened (the Open dialog and drag-and-drop only offer .md and
// .markdown, double-click only comes for the extensions we register), the
// welcome doc, or a "(my copy)" saved next to one. A sidecar is never named
// by the frontend; the commands derive it from the document's path. So a
// command refuses anything that isn't such a document, and a script that
// gets into the page can't use them to read or overwrite other files.

use std::path::{Path, PathBuf};

use crate::commands::CommandError;
use crate::default_app::EXTS;

/// True for an absolute path to a file remarkdown opens: one ending in .md
/// or .markdown, in any case. A relative path would resolve against the
/// app's working directory, which the frontend never means.
pub fn is_document_path(path: &Path) -> bool {
    if !path.is_absolute() {
        return false;
    }
    let Some(name) = path.file_name().map(|n| n.to_string_lossy()) else {
        return false;
    };
    // On Windows `notes.txt:x.md` names a stream of notes.txt, not a file.
    if cfg!(windows) && name.contains(':') {
        return false;
    }
    let name = name.to_ascii_lowercase();
    EXTS.iter().any(|ext| name.ends_with(&format!(".{ext}")))
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

    fn abs(name: &str) -> PathBuf {
        std::env::temp_dir().join(name)
    }

    #[test]
    fn markdown_files_are_documents() {
        for name in ["a.md", "Read Me.markdown", "NOTES.MD", "x.Markdown", "welcome.md", "Plan (my copy 2).md"] {
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

    // The extensions accepted here are the ones the installers register.
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
    }
}
