// Only Linux calls into this; the logic compiles everywhere so it is tested everywhere.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const ENTRY_NAME: &str = "remarkdown-appimage.desktop";

#[derive(Debug, PartialEq, Eq)]
pub enum Integration {
    Written,
    Unchanged,
    /// Another tool (AppImageLauncher, say) already made an entry for this AppImage.
    ManagedElsewhere,
    /// The path has a control character (a newline, say) that no entry line can hold.
    Skipped,
}

// TryExec is a plain string value: backslash and the control characters that
// would break the line are escaped. The scan below compares in this same form.
fn string_value(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c => out.push(c),
        }
    }
    out
}

// An AppImage sits wherever the user dropped it, so unlike the rpm nothing
// tells the desktop it exists. Quoting follows the desktop entry spec: an
// argument with a reserved character goes in double quotes with `"` `` ` ``
// `$` `\` backslash-escaped, then every backslash is doubled again because
// Exec is a string value. A literal % is %% so it is not read as a field code.
pub fn exec_quote(path: &str) -> String {
    const RESERVED: &str = " \t\n\"'\\><~|&;$*?#()`";
    let quoted = if path.contains(|c: char| RESERVED.contains(c)) {
        let mut s = String::from("\"");
        for c in path.chars() {
            if matches!(c, '"' | '`' | '$' | '\\') {
                s.push('\\');
            }
            s.push(c);
        }
        s.push('"');
        s
    } else {
        path.to_string()
    };
    quoted.replace('\\', "\\\\").replace('%', "%%")
}

pub fn desktop_entry(appimage: &str, icon: &Path) -> String {
    // X-AppImage-Integrate=false keeps AppImageLauncher from adding a second
    // entry. No xdg-mime anywhere: we appear in "Open with", never as default.
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=remarkdown\n\
         Comment=Read and annotate Markdown documents\n\
         Exec={} %F\n\
         TryExec={}\n\
         Icon={}\n\
         MimeType=text/markdown;\n\
         Categories=Office;TextEditor;\n\
         StartupWMClass=remarkdown\n\
         Terminal=false\n\
         X-AppImage-Integrate=false\n",
        exec_quote(appimage),
        string_value(appimage),
        icon.display()
    )
}

/// Where the launcher entry goes: $XDG_DATA_HOME, else ~/.local/share. Each
/// counts only when absolute, as the XDG spec asks; a relative one (HOME="",
/// say) would write under whatever directory the app was started from.
pub fn data_home(xdg_data_home: Option<OsString>, home: Option<OsString>) -> Option<PathBuf> {
    let xdg = xdg_data_home.map(PathBuf::from).filter(|p| p.is_absolute());
    xdg.or_else(|| {
        home.map(PathBuf::from)
            .filter(|h| h.is_absolute())
            .map(|h| h.join(".local/share"))
    })
}

pub fn integrate(appimage: &Path, data_home: &Path, icon_png: &[u8]) -> io::Result<Integration> {
    let apps = data_home.join("applications");
    let appimage_str = appimage.to_string_lossy();
    if appimage_str.chars().any(|c| c.is_control()) {
        return Ok(Integration::Skipped);
    }
    let try_exec = string_value(&appimage_str);

    if let Ok(entries) = fs::read_dir(&apps) {
        for e in entries.flatten() {
            let path = e.path();
            let is_desktop = path.extension().is_some_and(|x| x == "desktop");
            if !is_desktop || e.file_name() == ENTRY_NAME {
                continue;
            }
            let Ok(text) = fs::read_to_string(&path) else { continue };
            if text.lines().any(|l| l.trim().strip_prefix("TryExec=") == Some(try_exec.as_str())) {
                return Ok(Integration::ManagedElsewhere);
            }
        }
    }

    let icon = data_home.join("remarkdown/icon.png");
    let entry = desktop_entry(&appimage_str, &icon);
    let wrote_icon = write_if_changed(&icon, icon_png)?;
    let wrote_entry = write_if_changed(&apps.join(ENTRY_NAME), entry.as_bytes())?;
    Ok(if wrote_icon || wrote_entry { Integration::Written } else { Integration::Unchanged })
}

// Leaves the file's mtime alone when nothing changed.
fn write_if_changed(path: &Path, bytes: &[u8]) -> io::Result<bool> {
    if fs::read(path).is_ok_and(|old| old == bytes) {
        return Ok(false);
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(path, bytes)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    const ICON: &[u8] = b"png-bytes";

    fn entry_path(data: &Path) -> std::path::PathBuf {
        data.join("applications/remarkdown-appimage.desktop")
    }

    // temp_dir() stands in for an absolute path: `/home/me` isn't one on Windows.
    #[test]
    fn data_home_prefers_an_absolute_xdg_data_home() {
        let xdg = std::env::temp_dir().join("xdg");
        let home = std::env::temp_dir().join("me");
        assert_eq!(data_home(Some(xdg.clone().into()), Some(home.into())), Some(xdg));
    }

    #[test]
    fn data_home_falls_back_to_the_home_share_directory() {
        let home = std::env::temp_dir().join("me");
        assert_eq!(data_home(None, Some(home.clone().into())), Some(home.join(".local/share")));
        // A relative XDG_DATA_HOME is ignored, as the XDG spec says.
        assert_eq!(
            data_home(Some("rel/xdg".into()), Some(home.clone().into())),
            Some(home.join(".local/share"))
        );
    }

    // HOME="" would put the entry in `.local/share` under whatever directory
    // the AppImage was started from.
    #[test]
    fn a_relative_or_missing_home_gives_no_data_home() {
        for home in ["", "me", ".local"] {
            assert_eq!(data_home(None, Some(home.into())), None, "{home:?}");
        }
        assert_eq!(data_home(Some("".into()), Some("".into())), None);
        assert_eq!(data_home(None, None), None);
    }

    #[test]
    fn exec_quote_follows_the_desktop_entry_spec() {
        assert_eq!(
            exec_quote("/home/me/My Apps/remark$down's.AppImage"),
            r#""/home/me/My Apps/remark\\$down's.AppImage""#
        );
        assert_eq!(exec_quote("/opt/apps/remarkdown.AppImage"), "/opt/apps/remarkdown.AppImage");
        assert_eq!(exec_quote("/tmp/100%.AppImage"), "/tmp/100%%.AppImage");
        // A backslash is escaped once for the quoting and once for the string value.
        assert_eq!(exec_quote(r"/tmp/a\b"), r#""/tmp/a\\\\b""#);
    }

    #[test]
    fn first_run_writes_the_entry_and_the_icon() {
        let data = tempfile::tempdir().unwrap();
        let app = Path::new("/opt/remarkdown.AppImage");
        assert_eq!(integrate(app, data.path(), ICON).unwrap(), Integration::Written);
        let icon = data.path().join("remarkdown/icon.png");
        assert_eq!(fs::read(&icon).unwrap(), ICON);
        assert_eq!(
            fs::read_to_string(entry_path(data.path())).unwrap(),
            desktop_entry("/opt/remarkdown.AppImage", &icon)
        );
    }

    #[test]
    fn the_entry_has_the_expected_lines_and_never_claims_default() {
        let icon = Path::new("/d/remarkdown/icon.png");
        let e = desktop_entry("/opt/My Apps/r.AppImage", icon);
        for line in [
            "[Desktop Entry]",
            "Type=Application",
            "Name=remarkdown",
            "Comment=Read and annotate Markdown documents",
            "Exec=\"/opt/My Apps/r.AppImage\" %F",
            "TryExec=/opt/My Apps/r.AppImage",
            "Icon=/d/remarkdown/icon.png",
            "MimeType=text/markdown;",
            "Categories=Office;TextEditor;",
            "StartupWMClass=remarkdown",
            "Terminal=false",
            "X-AppImage-Integrate=false",
        ] {
            assert!(e.lines().any(|l| l == line), "missing {line}");
        }
        assert!(e.ends_with('\n'));
    }

    #[test]
    fn second_run_with_the_same_path_changes_nothing() {
        let data = tempfile::tempdir().unwrap();
        let app = Path::new("/opt/remarkdown.AppImage");
        integrate(app, data.path(), ICON).unwrap();
        assert_eq!(integrate(app, data.path(), ICON).unwrap(), Integration::Unchanged);
    }

    #[test]
    fn a_moved_appimage_rewrites_the_entry() {
        let data = tempfile::tempdir().unwrap();
        integrate(Path::new("/opt/remarkdown.AppImage"), data.path(), ICON).unwrap();
        let moved = Path::new("/home/me/Apps/remarkdown.AppImage");
        assert_eq!(integrate(moved, data.path(), ICON).unwrap(), Integration::Written);
        let text = fs::read_to_string(entry_path(data.path())).unwrap();
        assert!(text.contains("TryExec=/home/me/Apps/remarkdown.AppImage"));
        assert!(text.contains("Exec=/home/me/Apps/remarkdown.AppImage %F"));
    }

    #[test]
    fn an_entry_made_by_another_tool_is_left_alone() {
        let data = tempfile::tempdir().unwrap();
        let apps = data.path().join("applications");
        fs::create_dir_all(&apps).unwrap();
        fs::write(
            apps.join("appimagelauncher-remarkdown.desktop"),
            "[Desktop Entry]\nTryExec=/opt/remarkdown.AppImage\n",
        )
        .unwrap();
        let got = integrate(Path::new("/opt/remarkdown.AppImage"), data.path(), ICON).unwrap();
        assert_eq!(got, Integration::ManagedElsewhere);
        assert!(!entry_path(data.path()).exists());
        assert!(!data.path().join("remarkdown/icon.png").exists());
    }

    #[test]
    fn a_backslash_in_the_path_is_escaped_in_try_exec_and_still_matches() {
        let data = tempfile::tempdir().unwrap();
        let app = Path::new("/opt/a\\b.AppImage");
        integrate(app, data.path(), ICON).unwrap();
        let text = fs::read_to_string(entry_path(data.path())).unwrap();
        assert!(text.lines().any(|l| l == "TryExec=/opt/a\\\\b.AppImage"));
        // Another tool writing the same escaped TryExec is recognised.
        let other = tempfile::tempdir().unwrap();
        let apps = other.path().join("applications");
        fs::create_dir_all(&apps).unwrap();
        fs::write(apps.join("x.desktop"), "TryExec=/opt/a\\\\b.AppImage\n").unwrap();
        assert_eq!(integrate(app, other.path(), ICON).unwrap(), Integration::ManagedElsewhere);
    }

    #[test]
    fn a_path_with_a_control_character_is_skipped() {
        let data = tempfile::tempdir().unwrap();
        let app = Path::new("/opt/a\nb.AppImage");
        assert_eq!(integrate(app, data.path(), ICON).unwrap(), Integration::Skipped);
        assert!(!entry_path(data.path()).exists());
        assert!(!data.path().join("remarkdown").exists());
    }

    #[test]
    fn our_own_entry_does_not_count_as_another_tools() {
        let data = tempfile::tempdir().unwrap();
        let app = Path::new("/opt/remarkdown.AppImage");
        integrate(app, data.path(), ICON).unwrap();
        // Our file carries TryExec=<app>; it must not make us back off.
        assert_ne!(integrate(app, data.path(), ICON).unwrap(), Integration::ManagedElsewhere);
    }
}
