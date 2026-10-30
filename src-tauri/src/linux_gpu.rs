// Only Linux calls into this; the logic compiles everywhere so it is tested everywhere.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::path::Path;

// WebKitGTK paints a blank white window on NVIDIA's proprietary driver (Tauri
// issue #9394); turning its DMA-BUF renderer off avoids it. Only the primary
// GPU matters: on a hybrid laptop Intel or AMD drives the display and the
// workaround would only cost speed. Anyone who already set one of the related
// variables has made their own choice, so we leave it alone.
const USER_CHOICE_VARS: [&str; 3] = [
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
    "__NV_DISABLE_EXPLICIT_SYNC",
];

pub fn needs_dmabuf_workaround(drm: &Path, var: impl Fn(&str) -> Option<String>) -> bool {
    if USER_CHOICE_VARS.iter().any(|v| var(v).is_some()) {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(drm) else { return false };
    entries.flatten().any(|e| {
        let name = e.file_name();
        let name = name.to_string_lossy();
        // `card0` is a GPU; `card0-DP-1` is one of its connectors.
        let is_card = name
            .strip_prefix("card")
            .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()));
        if !is_card {
            return false;
        }
        let dev = e.path().join("device");
        read_trimmed(&dev.join("vendor")).as_deref() == Some("0x10de")
            && read_trimmed(&dev.join("boot_vga")).as_deref() == Some("1")
            && driver_name(&dev.join("driver")).as_deref() == Some("nvidia")
    })
}

fn read_trimmed(p: &Path) -> Option<String> {
    std::fs::read_to_string(p).ok().map(|s| s.trim().to_string())
}

// In sysfs `driver` is a symlink to the driver's directory, so its target's
// file name is the driver name. A regular file holding the name is accepted
// too, because symlinks are awkward to create in tests on Windows.
fn driver_name(p: &Path) -> Option<String> {
    if let Ok(target) = std::fs::read_link(p) {
        return target.file_name().map(|n| n.to_string_lossy().into_owned());
    }
    read_trimmed(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn card(drm: &Path, name: &str, vendor: &str, boot_vga: &str, driver: &str) {
        let dev = drm.join(name).join("device");
        fs::create_dir_all(&dev).unwrap();
        fs::write(dev.join("vendor"), format!("{vendor}\n")).unwrap();
        fs::write(dev.join("boot_vga"), format!("{boot_vga}\n")).unwrap();
        fs::write(dev.join("driver"), format!("{driver}\n")).unwrap();
    }
    fn none(_: &str) -> Option<String> { None }

    #[test]
    fn nvidia_boot_gpu_on_the_proprietary_driver() {
        let d = tempfile::tempdir().unwrap();
        card(d.path(), "card0", "0x10de", "1", "nvidia");
        assert!(needs_dmabuf_workaround(d.path(), none));
    }
    #[test]
    fn nouveau_is_fine() {
        let d = tempfile::tempdir().unwrap();
        card(d.path(), "card0", "0x10de", "1", "nouveau");
        assert!(!needs_dmabuf_workaround(d.path(), none));
    }
    #[test]
    fn hybrid_laptop_with_intel_primary_is_fine() {
        let d = tempfile::tempdir().unwrap();
        card(d.path(), "card0", "0x8086", "1", "i915");
        card(d.path(), "card1", "0x10de", "0", "nvidia");
        assert!(!needs_dmabuf_workaround(d.path(), none));
    }
    #[test]
    fn connector_entries_are_skipped() {
        let d = tempfile::tempdir().unwrap();
        card(d.path(), "card0-DP-1", "0x10de", "1", "nvidia");
        assert!(!needs_dmabuf_workaround(d.path(), none));
    }
    #[test]
    fn the_user_having_set_a_variable_wins() {
        let d = tempfile::tempdir().unwrap();
        card(d.path(), "card0", "0x10de", "1", "nvidia");
        for v in ["WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DISABLE_COMPOSITING_MODE", "__NV_DISABLE_EXPLICIT_SYNC"] {
            assert!(!needs_dmabuf_workaround(d.path(), |k| (k == v).then(|| "0".to_string())), "{v}");
        }
    }
    #[test]
    fn no_cards_or_no_directory() {
        let d = tempfile::tempdir().unwrap();
        assert!(!needs_dmabuf_workaround(d.path(), none));
        assert!(!needs_dmabuf_workaround(&d.path().join("missing"), none));
    }
}
