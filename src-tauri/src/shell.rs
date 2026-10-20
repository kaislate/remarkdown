// Small hand-offs to the OS shell.

use crate::commands::CommandError;

/// Explorer's argument for "open the folder with this file selected".
/// Explorer parses its own command line: the path must follow `/select,`
/// inside quotes, so it's passed raw rather than through Rust's quoting.
pub fn explorer_select_arg(path: &str) -> String {
    format!("/select,\"{}\"", path.replace('/', "\\"))
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
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(CommandError::Io("only supported on Windows".into()))
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
}
