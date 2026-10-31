//! Which OS and kind of desktop we're running on, so the frontend can match
//! each platform's conventions (shortcut keys, window chrome, tiling WMs).

use serde::Serialize;

#[derive(Serialize)]
pub struct DesktopEnv {
    pub os: &'static str,
    pub tiling: bool,
}

// Env vars that only a tiling compositor/WM sets for its own session.
const TILING_VARS: [&str; 4] = ["HYPRLAND_INSTANCE_SIGNATURE", "NIRI_SOCKET", "SWAYSOCK", "I3SOCK"];
// XDG_CURRENT_DESKTOP entries (lowercased) that name a tiling desktop.
const TILING_DESKTOPS: [&str; 5] = ["hyprland", "sway", "niri", "i3", "river"];

/// True when the session looks like a tiling window manager, where the window
/// is sized by the WM and our own title bar buttons make no sense. Takes the
/// env lookup as a parameter so it can be tested without touching the real env.
pub fn is_tiling_desktop(var: impl Fn(&str) -> Option<String>) -> bool {
    let set = |k: &str| var(k).is_some_and(|v| !v.is_empty());
    if TILING_VARS.iter().any(|k| set(k)) {
        return true;
    }
    var("XDG_CURRENT_DESKTOP").is_some_and(|d| {
        d.split(':')
            .any(|part| TILING_DESKTOPS.contains(&part.trim().to_lowercase().as_str()))
    })
}

#[tauri::command]
pub fn desktop_env() -> DesktopEnv {
    let os = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "windows"
    };
    // Only Linux has tiling desktops; skip the env reads elsewhere.
    let tiling = cfg!(target_os = "linux")
        && is_tiling_desktop(|k| std::env::var(k).ok().filter(|v| !v.is_empty()));
    DesktopEnv { os, tiling }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| m.get(k).cloned()
    }

    #[test]
    fn compositor_sockets_mean_tiling() {
        for var in ["HYPRLAND_INSTANCE_SIGNATURE", "NIRI_SOCKET", "SWAYSOCK", "I3SOCK"] {
            assert!(is_tiling_desktop(env(&[(var, "/run/x")])), "{var}");
        }
    }

    #[test]
    fn tiling_desktop_names_mean_tiling() {
        for d in ["Hyprland", "sway:wlroots", "niri", "i3", "river"] {
            assert!(is_tiling_desktop(env(&[("XDG_CURRENT_DESKTOP", d)])), "{d}");
        }
    }

    #[test]
    fn stacking_desktops_are_not_tiling() {
        for d in ["GNOME", "ubuntu:GNOME", "KDE", ""] {
            assert!(!is_tiling_desktop(env(&[("XDG_CURRENT_DESKTOP", d)])), "{d}");
        }
        assert!(!is_tiling_desktop(env(&[])));
        assert!(!is_tiling_desktop(env(&[("SWAYSOCK", "")])));
    }
}
