// Helping the user make remarkdown their default app for .md files.
//
// Windows 8+ protects the per-user default ("UserChoice") with a hash so
// apps can't set it themselves — only the user can, through Windows UI.
// What we can do is (1) register remarkdown properly as a handler for .md /
// .markdown (HKCU, no admin), and (2) open the right Windows UI:
//   - Windows 11: Settings → Default apps, deep-linked to remarkdown's page
//     (ms-settings:defaultapps?registeredAppUser=remarkdown), one click.
//   - Windows 10: the shell's "How do you want to open this file?" dialog
//     with "Always use this app" available.
// The installer also registers us (bundle.fileAssociations + the NSIS hooks
// in windows/hooks.nsh); registering again at runtime makes dev/portable
// builds work and repairs a registration pointing at an old exe path.

use serde::Serialize;

pub const PROG_ID: &str = "remarkdown.Markdown";
pub const APP_NAME: &str = "remarkdown";
pub const EXTS: [&str; 2] = ["md", "markdown"];
const CAPABILITIES_KEY: &str = r"Software\remarkdown\Capabilities";

/// Every (key under HKCU, value name, string value) we write. Value name ""
/// is the key's default value. Pure so it can be tested on any platform.
pub fn registry_plan(exe: &str) -> Vec<(String, String, String)> {
    let mut plan = vec![
        (format!(r"Software\Classes\{PROG_ID}"), String::new(), "Markdown document".to_string()),
        (format!(r"Software\Classes\{PROG_ID}\DefaultIcon"), String::new(), format!("\"{exe}\",0")),
        (format!(r"Software\Classes\{PROG_ID}\shell\open\command"), String::new(), format!("\"{exe}\" \"%1\"")),
        (CAPABILITIES_KEY.to_string(), "ApplicationName".to_string(), APP_NAME.to_string()),
        (
            CAPABILITIES_KEY.to_string(),
            "ApplicationDescription".to_string(),
            "Read and annotate Markdown documents".to_string(),
        ),
        (r"Software\RegisteredApplications".to_string(), APP_NAME.to_string(), CAPABILITIES_KEY.to_string()),
    ];
    for ext in EXTS {
        plan.push((format!(r"{CAPABILITIES_KEY}\FileAssociations"), format!(".{ext}"), PROG_ID.to_string()));
        plan.push((format!(r"Software\Classes\.{ext}\OpenWithProgids"), PROG_ID.to_string(), String::new()));
    }
    plan
}

/// ProgIDs that mean "remarkdown is the default": ours, the MSI installer's
/// (`<product>.<ext>`), and the one Windows uses when the user picked our
/// exe through "Choose another app → browse".
pub fn is_our_prog_id(id: &str) -> bool {
    matches!(id, "remarkdown.Markdown" | "remarkdown.md" | "remarkdown.markdown")
        || id.eq_ignore_ascii_case(r"Applications\remarkdown.exe")
}

/// Windows 11 reports itself as NT 10.0 with build >= 22000.
pub fn is_win11(build: u32) -> bool {
    build >= 22000
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct DefaultAppStatus {
    pub supported: bool,
    pub md: bool,
    pub markdown: bool,
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    pub fn register(exe: &str) -> std::io::Result<()> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for (key, name, value) in registry_plan(exe) {
            let (k, _) = hkcu.create_subkey(&key)?;
            k.set_value(&name, &value)?;
        }
        notify_assoc_changed();
        Ok(())
    }

    pub fn notify_assoc_changed() {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, std::ptr::null(), std::ptr::null());
        }
    }

    /// The user's chosen ProgID for `.ext`. Newer Windows 11 builds keep it
    /// under UserChoiceLatest; fall back to UserChoice.
    pub fn user_choice(ext: &str) -> Option<String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let base = format!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.{ext}");
        for sub in ["UserChoiceLatest", "UserChoice"] {
            if let Ok(k) = hkcu.open_subkey(format!(r"{base}\{sub}")) {
                if let Ok(id) = k.get_value::<String, _>("ProgId") {
                    return Some(id);
                }
            }
        }
        None
    }

    pub fn os_build() -> u32 {
        RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
            .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber"))
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0)
    }

    pub fn open_default_apps_settings() -> bool {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let verb = wide("open");
        let uri = wide(&format!("ms-settings:defaultapps?registeredAppUser={APP_NAME}"));
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                uri.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        // ShellExecute returns a value > 32 on success.
        result as isize > 32
    }

    /// The "How do you want to open this file?" dialog for `path`, set up to
    /// register the user's choice as the default for its extension without
    /// opening the file. Modal, so it runs on its own thread.
    pub fn open_with_dialog(path: String) {
        std::thread::spawn(move || {
            use windows_sys::Win32::System::Com::{
                CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
            };
            use windows_sys::Win32::UI::Shell::{
                SHOpenWithDialog, OAIF_ALLOW_REGISTRATION, OAIF_FORCE_REGISTRATION, OAIF_REGISTER_EXT, OPENASINFO,
            };
            let file = wide(&path);
            let info = OPENASINFO {
                pcszFile: file.as_ptr(),
                pcszClass: std::ptr::null(),
                oaifInFlags: OAIF_ALLOW_REGISTRATION | OAIF_REGISTER_EXT | OAIF_FORCE_REGISTRATION,
            };
            unsafe {
                // Shell dialogs need COM on the calling thread (STA).
                let com = CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32);
                let hr = SHOpenWithDialog(std::ptr::null_mut(), &info);
                if hr < 0 {
                    eprintln!("[remarkdown] SHOpenWithDialog failed: 0x{:08x}", hr as u32);
                }
                if com >= 0 {
                    CoUninitialize();
                }
            }
        });
    }
}

#[tauri::command]
pub fn default_app_status() -> DefaultAppStatus {
    #[cfg(windows)]
    {
        let ours = |ext: &str| imp::user_choice(ext).map(|id| is_our_prog_id(&id)).unwrap_or(false);
        DefaultAppStatus { supported: true, md: ours("md"), markdown: ours("markdown") }
    }
    #[cfg(not(windows))]
    {
        DefaultAppStatus { supported: false, md: false, markdown: false }
    }
}

#[tauri::command]
pub async fn make_default_app(app: tauri::AppHandle) -> Result<(), crate::commands::CommandError> {
    #[cfg(windows)]
    {
        use crate::commands::CommandError;
        let exe = std::env::current_exe().map_err(|e| CommandError::Io(e.to_string()))?;
        imp::register(&exe.to_string_lossy()).map_err(|e| CommandError::Io(e.to_string()))?;
        if is_win11(imp::os_build()) && imp::open_default_apps_settings() {
            return Ok(());
        }
        // Windows 10 (or the Settings link failed): the Open-with dialog
        // needs a real .md file to ask about — the welcome doc always exists.
        let sample = crate::welcome::ensure(&app)?;
        imp::open_with_dialog(sample.to_string_lossy().into_owned());
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err(crate::commands::CommandError::Io("only supported on Windows".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_plan_points_command_and_icon_at_exe() {
        let plan = registry_plan(r"C:\Apps\remarkdown.exe");
        assert!(plan.contains(&(
            r"Software\Classes\remarkdown.Markdown\shell\open\command".into(),
            String::new(),
            r#""C:\Apps\remarkdown.exe" "%1""#.into(),
        )));
        assert!(plan.contains(&(
            r"Software\Classes\remarkdown.Markdown\DefaultIcon".into(),
            String::new(),
            r#""C:\Apps\remarkdown.exe",0"#.into(),
        )));
    }

    #[test]
    fn registry_plan_registers_capabilities_for_both_extensions() {
        let plan = registry_plan("x.exe");
        for ext in [".md", ".markdown"] {
            assert!(plan.contains(&(
                r"Software\remarkdown\Capabilities\FileAssociations".into(),
                ext.into(),
                "remarkdown.Markdown".into(),
            )));
        }
        assert!(plan.contains(&(
            r"Software\RegisteredApplications".into(),
            "remarkdown".into(),
            r"Software\remarkdown\Capabilities".into(),
        )));
        assert!(plan.contains(&(r"Software\Classes\.md\OpenWithProgids".into(), "remarkdown.Markdown".into(), String::new())));
    }

    #[test]
    fn recognises_all_of_our_prog_ids() {
        for id in ["remarkdown.Markdown", "remarkdown.md", "remarkdown.markdown", r"Applications\remarkdown.exe", r"Applications\Remarkdown.EXE"] {
            assert!(is_our_prog_id(id), "{id}");
        }
        for id in ["VSCode.md", "Applications\\notepad.exe", ""] {
            assert!(!is_our_prog_id(id), "{id}");
        }
    }

    #[test]
    fn win11_threshold() {
        assert!(!is_win11(19045));
        assert!(is_win11(22000));
        assert!(is_win11(26100));
    }
}
