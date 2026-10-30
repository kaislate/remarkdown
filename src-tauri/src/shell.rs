// Small hand-offs to the OS shell.

use crate::commands::CommandError;
use std::path::Path;

/// Explorer's argument for "open the folder with this file selected".
/// Explorer parses its own command line: the path must follow `/select,`
/// inside quotes, so it's passed raw rather than through Rust's quoting.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn explorer_select_arg(path: &str) -> String {
    format!("/select,\"{}\"", path.replace('/', "\\"))
}

/// An absolute `file://` URI for a path. Everything but RFC 3986's unreserved
/// characters and `/` is percent-encoded byte by byte, so quotes and spaces
/// can't break the GVariant text the file manager is handed. A plain string
/// transform, so it reads the same on every host.
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
pub fn file_uri(path: &Path) -> String {
    let mut uri = String::from("file://");
    for &b in path.to_string_lossy().as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~' | b'/') {
            uri.push(b as char);
        } else {
            uri.push_str(&format!("%{b:02X}"));
        }
    }
    uri
}

/// `gdbus call` arguments (no program name) asking the desktop's file manager
/// to show one item, selected, in its folder. gdbus reads GVariant text, so the
/// uris are `['…']` and the startup id an empty string, `""`. Nautilus, Dolphin,
/// Thunar and Nemo all answer this call.
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
pub fn show_items_args(uri: &str) -> Vec<String> {
    [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.FileManager1",
        "--object-path",
        "/org/freedesktop/FileManager1",
        "--method",
        "org.freedesktop.FileManager1.ShowItems",
    ]
    .iter()
    .map(|s| s.to_string())
    .chain([format!("['{uri}']"), "\"\"".to_string()])
    .collect()
}

/// Opens the file's folder in Explorer with the file selected ("Show in
/// folder"). If the file no longer exists, opens its folder instead.
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), CommandError> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let p = std::path::Path::new(&path);
        let mut cmd = std::process::Command::new("explorer.exe");
        if p.is_file() {
            cmd.raw_arg(explorer_select_arg(&path));
        } else if let Some(dir) = p.parent() {
            cmd.arg(dir);
        }
        // Explorer's exit code is meaningless (it returns 1 on success).
        cmd.spawn().map_err(|e| CommandError::Io(e.to_string()))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let p = Path::new(&path);
        let mut cmd = std::process::Command::new("open");
        if p.is_file() {
            cmd.arg("-R").arg(p);
        } else if let Some(dir) = p.parent() {
            cmd.arg(dir);
        }
        cmd.spawn().map_err(|e| CommandError::Io(e.to_string()))?;
        Ok(())
    }
    // gdbus waits for the file manager's answer: about a second when D-Bus
    // has to start Nautilus, and up to its ~25 s timeout when a stuck name
    // owner holds the call. A sync command runs on the main thread, so that
    // wait would freeze the window; it happens on a thread of its own instead.
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let p = std::path::PathBuf::from(path);
        std::thread::spawn(move || {
            if p.is_file() {
                let shown = std::process::Command::new("gdbus")
                    .args(show_items_args(&file_uri(&p)))
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
                if shown {
                    return;
                }
            }
            // No file manager on the bus (or the file is gone): just open the folder.
            let dir = if p.is_dir() { Some(p.as_path()) } else { p.parent() };
            if let Some(dir) = dir {
                match std::process::Command::new("xdg-open").arg(dir).spawn() {
                    // Waited on so it's reaped rather than left a zombie.
                    Ok(mut child) => {
                        let _ = child.wait();
                    }
                    Err(e) => eprintln!("[remarkdown] could not open the folder: {e}"),
                }
            }
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn select_arg_quotes_paths_with_spaces() {
        assert_eq!(
            explorer_select_arg(r"C:\My Docs\Plan B.md"),
            r#"/select,"C:\My Docs\Plan B.md""#
        );
    }

    #[test]
    fn select_arg_uses_backslashes() {
        assert_eq!(explorer_select_arg("C:/a/b.md"), r#"/select,"C:\a\b.md""#);
    }

    #[test]
    fn file_uri_encodes_everything_but_unreserved_and_slash() {
        assert_eq!(
            file_uri(std::path::Path::new("/home/me/My Notes/\u{dc}n\u{ef}code's.md")),
            "file:///home/me/My%20Notes/%C3%9Cn%C3%AFcode%27s.md"
        );
    }

    #[test]
    fn file_uri_keeps_unreserved_characters() {
        assert_eq!(
            file_uri(std::path::Path::new("/a-b_c.d~e/F9")),
            "file:///a-b_c.d~e/F9"
        );
    }

    #[test]
    fn show_items_args_end_with_the_uri_array_and_empty_startup_id() {
        let args = show_items_args("file:///home/me/a%27b.md");
        assert_eq!(args[args.len() - 2], "['file:///home/me/a%27b.md']");
        assert_eq!(args[args.len() - 1], "\"\"");
        assert_eq!(args[0], "call");
        assert!(args.contains(&"org.freedesktop.FileManager1.ShowItems".to_string()));
    }

    #[test]
    fn show_items_array_has_no_quote_inside_the_literal() {
        let uri = file_uri(std::path::Path::new("/tmp/it's.md"));
        let lit = &show_items_args(&uri)[8];
        assert_eq!(lit.matches('\'').count(), 2);
    }
}
