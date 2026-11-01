// Small hand-offs to the OS shell.

use crate::commands::CommandError;
use std::path::{Path, PathBuf};

/// Explorer's argument for "open the folder with this file selected".
/// Explorer parses its own command line: the path must follow `/select,`
/// inside quotes, so it's passed raw rather than through Rust's quoting.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn explorer_select_arg(path: &str) -> String {
    format!("/select,\"{}\"", path.replace('/', "\\"))
}

/// Explorer's argument for "open this folder", when Rust's own quoting
/// would not do. Explorer splits its command line at commas, and Rust
/// quotes an argument only when it has a space or a quote, so a folder
/// named `docs,x` would reach Explorer as two arguments. Such a folder is
/// passed raw, in quotes, as `/select,` does; any other is left as it was.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub fn explorer_folder_arg(dir: &Path) -> Option<String> {
    let dir = dir.to_string_lossy();
    dir.contains(',').then(|| format!("\"{dir}\""))
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

/// What "Show in folder" hands the shell.
#[derive(Debug, PartialEq)]
pub enum Reveal {
    /// The file, selected in its folder.
    Select(PathBuf),
    /// The folder a file that has gone was in.
    Folder(PathBuf),
}

/// The file itself while it exists, else its folder if that is still a
/// folder, else nothing. The path is only known to be named like a
/// document, and the shell runs a file it is asked to open: the "folder"
/// of `C:\Windows\System32\calc.exe\x.md` is a program.
pub fn reveal_target(path: &Path) -> Option<Reveal> {
    if path.is_file() {
        return Some(Reveal::Select(path.to_path_buf()));
    }
    path.parent().filter(|d| d.is_dir()).map(|d| Reveal::Folder(d.to_path_buf()))
}

/// A link from a document that may go to the user's browser or mail app:
/// http(s) to a real host, or mailto. Comes back re-serialized by the URL
/// parser (spaces and quotes percent-encoded), so the OS sees exactly one
/// well-formed URL. Anything else (file:, a UNC path, a custom scheme that
/// would start some other program, the webview's own *.localhost hosts) is
/// refused.
pub fn external_url(raw: &str) -> Option<String> {
    let url = tauri::Url::parse(raw.trim()).ok()?;
    match url.scheme() {
        "http" | "https" => {
            // Hosts that only mean something inside the app's webview.
            let host = url.host_str()?;
            if matches!(host, "tauri.localhost" | "asset.localhost" | "ipc.localhost") {
                return None;
            }
        }
        "mailto" if !url.path().is_empty() => {}
        _ => return None,
    }
    Some(url.to_string())
}

/// Hands a document's web or mail link to the user's browser or mail app.
///
/// Our own command rather than tauri-plugin-opener: the plugin also brings
/// commands to open any path and reveal files, a JS API and a URL scope to
/// keep right. This takes one string, lets through only what external_url
/// does, and is the only thing the page can ask the OS to open.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), CommandError> {
    let url = external_url(&url).ok_or_else(|| CommandError::Io("not a web or mail link".into()))?;
    // A browser can take a moment to start, and a sync command runs on the
    // main thread: the hand-off happens on a thread of its own.
    #[cfg(windows)]
    std::thread::spawn(move || {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Com::{
            CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
        };
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let wide = |s: &str| -> Vec<u16> {
            std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
        };
        let (verb, target) = (wide("open"), wide(&url));
        unsafe {
            // ShellExecute may hand the URL to a shell extension: COM first (STA).
            let com = CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32);
            let result = ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            );
            // ShellExecute returns a value > 32 on success.
            if result as isize <= 32 {
                eprintln!("[remarkdown] could not open the link: {}", result as isize);
            }
            if com >= 0 {
                CoUninitialize();
            }
        }
    });
    // The URL starts with its scheme, so neither tool can read it as an option.
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&url).spawn().map_err(|e| CommandError::Io(e.to_string()))?;
    #[cfg(not(any(windows, target_os = "macos")))]
    std::thread::spawn(move || match std::process::Command::new("xdg-open").arg(&url).spawn() {
        // Waited on so it's reaped rather than left a zombie.
        Ok(mut child) => {
            let _ = child.wait();
        }
        Err(e) => eprintln!("[remarkdown] could not open the link: {e}"),
    });
    Ok(())
}

/// Opens the file's folder in Explorer with the file selected ("Show in
/// folder"). If the file no longer exists, opens its folder instead.
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), CommandError> {
    // Only documents are ever shown (tabs, recent files), and the shell is
    // handed only that document or the folder it is in (reveal_target).
    crate::doc_paths::document_path(&path)?;
    let target = reveal_target(Path::new(&path))
        .ok_or_else(|| CommandError::Io(format!("the folder of {path} no longer exists")))?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("explorer.exe");
        match target {
            Reveal::Select(_) => cmd.raw_arg(explorer_select_arg(&path)),
            Reveal::Folder(dir) => match explorer_folder_arg(&dir) {
                Some(arg) => cmd.raw_arg(arg),
                None => cmd.arg(dir),
            },
        };
        // Explorer's exit code is meaningless (it returns 1 on success).
        cmd.spawn().map_err(|e| CommandError::Io(e.to_string()))?;
        Ok(())
    }
    // A folder is revealed too (-R), not opened: `open` launches a folder
    // that is an app bundle or an installer package, and `Evil.app` is
    // the folder of `Evil.app/missing.md`.
    #[cfg(target_os = "macos")]
    {
        let (Reveal::Select(p) | Reveal::Folder(p)) = target;
        std::process::Command::new("open")
            .arg("-R")
            .arg(p)
            .spawn()
            .map_err(|e| CommandError::Io(e.to_string()))?;
        Ok(())
    }
    // gdbus waits for the file manager's answer: about a second when D-Bus
    // has to start Nautilus, and up to its ~25 s timeout when a stuck name
    // owner holds the call. A sync command runs on the main thread, so that
    // wait would freeze the window; it happens on a thread of its own instead.
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        std::thread::spawn(move || {
            let dir = match target {
                Reveal::Select(p) => {
                    let shown = std::process::Command::new("gdbus")
                        .args(show_items_args(&file_uri(&p)))
                        .status()
                        .map(|s| s.success())
                        .unwrap_or(false);
                    if shown {
                        return;
                    }
                    // No file manager on the bus: just open the folder.
                    match p.parent() {
                        Some(dir) => dir.to_path_buf(),
                        None => return,
                    }
                }
                Reveal::Folder(dir) => dir,
            };
            match std::process::Command::new("xdg-open").arg(&dir).spawn() {
                // Waited on so it's reaped rather than left a zombie.
                Ok(mut child) => {
                    let _ = child.wait();
                }
                Err(e) => eprintln!("[remarkdown] could not open the folder: {e}"),
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

    // Explorer splits its command line at commas, so `docs,x` would reach
    // it as two arguments; Rust quotes only for spaces and quotes.
    #[test]
    fn folder_arg_quotes_a_folder_with_a_comma() {
        assert_eq!(
            explorer_folder_arg(Path::new(r"C:\notes\docs,calc.exe")),
            Some(r#""C:\notes\docs,calc.exe""#.to_string())
        );
    }

    #[test]
    fn folder_arg_leaves_other_folders_to_rusts_quoting() {
        assert_eq!(explorer_folder_arg(Path::new(r"C:\My Docs")), None);
        assert_eq!(explorer_folder_arg(Path::new(r"C:\")), None);
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
    fn web_and_mail_links_go_out_normalized() {
        assert_eq!(external_url("https://example.com/a b").as_deref(), Some("https://example.com/a%20b"));
        assert_eq!(external_url("http://Example.com").as_deref(), Some("http://example.com/"));
        assert_eq!(
            external_url("https://example.com/?q=\"x\"#\"y\"").as_deref(),
            Some("https://example.com/?q=%22x%22#%22y%22")
        );
        assert_eq!(external_url("mailto:me@example.com").as_deref(), Some("mailto:me@example.com"));
        assert_eq!(external_url("http://localhost:3000/docs").as_deref(), Some("http://localhost:3000/docs"));
    }

    #[test]
    fn everything_else_is_refused() {
        for raw in [
            "",
            "not a url",
            "file:///C:/Windows/System32/calc.exe",
            r"\\evil.example\s\r.html",
            "//evil.example/x",
            "C:/Users/me/r.html",
            "javascript:alert(1)",
            "data:text/html,hi",
            "ms-settings:defaultapps",
            "search-ms:query=x",
            "vscode://file/C:/x",
            "asset://localhost/C:/x.html",
            "mailto:",
            "https:",
            "http://asset.localhost/%5C%5Cevil%5Cs%5Cr.html",
            "https://ipc.localhost/write_document",
            "http://tauri.localhost/index.html",
            "HTTP://ASSET.LOCALHOST/x",
        ] {
            assert_eq!(external_url(raw), None, "{raw}");
        }
    }

    #[test]
    fn show_items_array_has_no_quote_inside_the_literal() {
        let uri = file_uri(std::path::Path::new("/tmp/it's.md"));
        let lit = &show_items_args(&uri)[8];
        assert_eq!(lit.matches('\'').count(), 2);
    }

    #[test]
    fn reveal_selects_a_file_that_exists() {
        let dir = tempfile::tempdir().unwrap();
        let md = dir.path().join("a.md");
        std::fs::write(&md, b"x").unwrap();
        assert_eq!(reveal_target(&md), Some(Reveal::Select(md.clone())));
    }

    #[test]
    fn reveal_opens_the_folder_of_a_file_that_is_gone() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(reveal_target(&dir.path().join("gone.md")), Some(Reveal::Folder(dir.path().to_path_buf())));
    }

    // `calc.exe\x.md` is named like a document, but its "folder" is a
    // program, and the shell runs a file it is asked to open.
    #[test]
    fn reveal_never_opens_a_file_as_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("calc.exe");
        std::fs::write(&program, b"MZ").unwrap();
        assert_eq!(reveal_target(&program.join("x.md")), None);
        assert_eq!(reveal_target(&dir.path().join("gone").join("x.md")), None);
    }
}
