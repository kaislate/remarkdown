// The asset protocol, which shows a document's pictures. It replaces
// Tauri's own handler (registering "asset" makes Tauri skip its built-in
// one) for two reasons:
//  - Tauri's handler asks the scope about a path first, and the scope
//    (Scope::is_allowed) runs is_symlink(), exists() and canonicalize() on
//    it: for \\host\share\x.png each of those already connects to the
//    host, and Windows signs in with the user's password hash. A deny
//    pattern in the scope is matched only after that, so it can't help.
//    Here a network or device path is refused before anything touches the
//    filesystem.
//  - The protocol is only ever used for pictures, so it serves nothing
//    else: a script can't read a key, a database or a document through it,
//    and a page can't be loaded from it.
// Tauri's own handler is registered per window and so counts as remote for
// the app's commands; one the app registers counts as the app's own. So
// every response also carries `sandbox`: nothing loaded from here can run
// script, and so nothing loaded from here can call a command.

use std::fs::File;
use std::io::{ErrorKind, Read};
use std::path::{Component, Path, PathBuf, Prefix};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::path::SafePathBuf;
use tauri::utils::mime_type::MimeType;
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    // Reading a picture is disk work: off the thread that runs the window.
    tauri::async_runtime::spawn_blocking(move || {
        let path = request_path(request.uri().path());
        let scope = app.asset_protocol_scope();
        let served = serve(&path, cfg!(windows), |p| scope.is_allowed(p));
        responder.respond(response(served, &app_origin(&app)));
    });
}

/// The answer to a request. `sandbox` keeps script from running in
/// anything served here, even a picture opened as a page, and `nosniff`
/// keeps the window from reading a picture as something else.
fn response(served: Result<(String, Vec<u8>), StatusCode>, origin: &str) -> Response<Vec<u8>> {
    let response = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .header(header::CONTENT_SECURITY_POLICY, "sandbox")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    let built = match served {
        Ok((mime, bytes)) => response.header(header::CONTENT_TYPE, mime).body(bytes),
        Err(status) => response.status(status).body(Vec::new()),
    };
    built.unwrap_or_default()
}

// Where the app's own pages come from, as Tauri works it out for its
// handler: the dev server while developing, else the app's own protocol.
fn app_origin<R: Runtime>(app: &AppHandle<R>) -> String {
    if tauri::is_dev() {
        if let Some(url) = &app.config().build.dev_url {
            return url.origin().ascii_serialization();
        }
    }
    if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
    .into()
}

/// The file a request names, decoded exactly as Tauri's own handler does:
/// the path after its leading slash, percent-decoded.
pub fn request_path(uri_path: &str) -> String {
    let path = uri_path.strip_prefix('/').unwrap_or(uri_path);
    percent_encoding::percent_decode_str(path)
        .decode_utf8_lossy()
        .into_owned()
}

/// A path Windows reaches over the network, or a device path: \\host\share,
/// \\?\…, \\.\… (either slash, in any mix) and NT's own \??\ prefix. On
/// Windows merely looking one up connects to the host and signs in with the
/// user's password hash. A plain string test, so it reads the same on
/// every host; a document's pictures never take these forms.
pub fn is_network_or_device_path(path: &str) -> bool {
    let b = path.trim_start().as_bytes();
    let sep = |i: usize| matches!(b.get(i), Some(b'\\' | b'/'));
    (sep(0) && sep(1)) || (sep(0) && b.get(1..3) == Some(b"??") && sep(3))
}

/// Whether a link's target stays on this machine's disks: a drive, a
/// mounted volume, or a path with no prefix that isn't a network one.
fn is_local_disk(target: &Path) -> bool {
    match target.components().next() {
        Some(Component::Prefix(p)) => match p.kind() {
            Prefix::Disk(_) | Prefix::VerbatimDisk(_) => true,
            Prefix::Verbatim(name) => name
                .to_string_lossy()
                .to_ascii_lowercase()
                .starts_with("volume{"),
            _ => false,
        },
        _ => !is_network_or_device_path(&target.to_string_lossy()),
    }
}

/// Whether opening `path` would pass through a link (a symlink or a
/// junction) to a network share, at the picture or any folder above it.
/// Each step is looked at without following it, and a link only after its
/// target has been checked, so nothing beyond a bad link is ever touched.
fn links_to_network(path: &Path, hops: u8) -> bool {
    if hops > 8 {
        return true;
    }
    let mut at = PathBuf::new();
    for part in path.components() {
        at.push(part);
        if !matches!(part, Component::Normal(_)) {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(&at) else {
            return false;
        };
        if !meta.file_type().is_symlink() {
            continue;
        }
        let Ok(target) = std::fs::read_link(&at) else {
            return true;
        };
        // A relative target is relative to the link's folder; a rooted one
        // (\x on Windows) keeps that folder's drive.
        let target = match at.parent() {
            Some(dir) if target.is_relative() => dir.join(&target),
            _ => target,
        };
        if !is_local_disk(&target) || links_to_network(&target, hops + 1) {
            return true;
        }
    }
    false
}

/// A picture's type and bytes, or why it isn't served. The checks that
/// need no filesystem come first; `check_links` is for Windows, where a
/// link can lead to a share.
fn serve(
    path: &str,
    check_links: bool,
    allowed: impl Fn(&Path) -> bool,
) -> Result<(String, Vec<u8>), StatusCode> {
    if is_network_or_device_path(path) {
        return Err(StatusCode::FORBIDDEN);
    }
    let safe = SafePathBuf::new(PathBuf::from(path)).map_err(|_| StatusCode::FORBIDDEN)?;
    if check_links && links_to_network(safe.as_ref(), 0) {
        return Err(StatusCode::FORBIDDEN);
    }
    if !allowed(safe.as_ref()) {
        return Err(StatusCode::FORBIDDEN);
    }
    let mut file = File::open(&safe).map_err(|e| match e.kind() {
        ErrorKind::NotFound => StatusCode::NOT_FOUND,
        ErrorKind::PermissionDenied => StatusCode::FORBIDDEN,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    })?;
    let failed = |_| StatusCode::INTERNAL_SERVER_ERROR;
    // Its type from the first bytes (or the extension), as Tauri does,
    // before the rest is read.
    let mut bytes = Vec::new();
    (&mut file)
        .take(8192)
        .read_to_end(&mut bytes)
        .map_err(failed)?;
    let mime = MimeType::parse(&bytes, path);
    if !mime.starts_with("image/") {
        return Err(StatusCode::FORBIDDEN);
    }
    file.read_to_end(&mut bytes).map_err(failed)?;
    Ok((mime, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    const NETWORK_AND_DEVICE: &[&str] = &[
        r"\\attacker.example\s\pixel.png",
        "//attacker.example/s/pixel.png",
        r"\/attacker.example/s/pixel.png",
        r"/\attacker.example\s\pixel.png",
        r"\\attacker.example@SSL\s\pixel.png",
        r"\\?\UNC\attacker.example\s\pixel.png",
        r"\\?\C:\Users\me\pixel.png",
        "//?/C:/Users/me/pixel.png",
        "//?/UNC/attacker.example/s/pixel.png",
        r"\\.\pipe\pixel",
        "//./C:/pixel.png",
        r"\??\UNC\attacker.example\s\pixel.png",
        "/??/UNC/attacker.example/s/pixel.png",
        " \\\\attacker.example\\s\\pixel.png",
    ];

    #[test]
    fn decodes_the_path_the_way_tauri_does() {
        assert_eq!(
            request_path("/C%3A%2FUsers%2Fme%2Fa%20b.png"),
            "C:/Users/me/a b.png"
        );
        assert_eq!(request_path("/%2Fhome%2Fme%2Fa.png"), "/home/me/a.png");
        assert_eq!(request_path("/%5C%5Chost%5Cs%5Cx.png"), r"\\host\s\x.png");
        assert_eq!(request_path("/%2F%2Fhost%2Fs%2Fx.png"), "//host/s/x.png");
    }

    #[test]
    fn knows_a_network_or_device_path_in_any_spelling() {
        for p in NETWORK_AND_DEVICE {
            assert!(is_network_or_device_path(p), "{p:?}");
        }
    }

    #[test]
    fn leaves_local_paths_alone() {
        for p in [
            "C:/Users/me/a.png",
            r"C:\Users\me\a.png",
            "/home/me/a.png",
            r"\Users\me\a.png",
            "img/a.png",
            "?/a.png",
            "/?/a.png",
        ] {
            assert!(!is_network_or_device_path(p), "{p:?}");
        }
    }

    #[test]
    fn refuses_a_network_path_before_the_scope_or_the_disk_sees_it() {
        for p in NETWORK_AND_DEVICE {
            let got = serve(p, true, |_| panic!("the scope was asked about {p:?}"));
            assert_eq!(got.unwrap_err(), StatusCode::FORBIDDEN, "{p:?}");
        }
    }

    #[test]
    fn every_response_forbids_script_and_sniffing() {
        let ok = response(
            Ok(("image/png".into(), vec![1, 2])),
            "http://tauri.localhost",
        );
        let refused = response(Err(StatusCode::FORBIDDEN), "http://tauri.localhost");
        for r in [&ok, &refused] {
            let h = r.headers();
            assert_eq!(h[header::CONTENT_SECURITY_POLICY], "sandbox");
            assert_eq!(h[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
            assert_eq!(
                h[header::ACCESS_CONTROL_ALLOW_ORIGIN],
                "http://tauri.localhost"
            );
        }
        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(ok.headers()[header::CONTENT_TYPE], "image/png");
        assert_eq!(ok.body(), &vec![1, 2]);
        assert_eq!(refused.status(), StatusCode::FORBIDDEN);
        assert!(refused.body().is_empty());
    }

    #[test]
    fn serves_a_picture_by_its_content_or_extension() {
        let dir = tempdir().unwrap();
        let png = dir.path().join("no extension");
        fs::write(&png, b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR").unwrap();
        let svg = dir.path().join("logo.svg");
        fs::write(&svg, b"<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
        let png_path = png.to_string_lossy().into_owned();
        let (mime, bytes) = serve(&png_path, true, |_| true).unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, fs::read(&png).unwrap());
        let (mime, _) = serve(&svg.to_string_lossy(), true, |_| true).unwrap();
        assert_eq!(mime, "image/svg+xml");
    }

    #[test]
    fn serves_a_big_picture_whole() {
        let dir = tempdir().unwrap();
        let jpg = dir.path().join("big.jpg");
        let mut data = b"\xFF\xD8\xFF\xE0".to_vec();
        data.resize(100_000, 7);
        fs::write(&jpg, &data).unwrap();
        let (mime, bytes) = serve(&jpg.to_string_lossy(), true, |_| true).unwrap();
        assert_eq!(mime, "image/jpeg");
        assert_eq!(bytes, data);
    }

    #[test]
    fn refuses_anything_that_is_not_a_picture() {
        let dir = tempdir().unwrap();
        for (name, body) in [
            ("notes.md", &b"# secret"[..]),
            ("id_rsa", &b"-----BEGIN OPENSSH PRIVATE KEY-----"[..]),
            ("page.html", &b"<script>alert(1)</script>"[..]),
            ("Login Data", &b"SQLite format 3\0"[..]),
        ] {
            let p = dir.path().join(name);
            fs::write(&p, body).unwrap();
            assert_eq!(
                serve(&p.to_string_lossy(), true, |_| true).unwrap_err(),
                StatusCode::FORBIDDEN,
                "{name}"
            );
        }
    }

    #[test]
    fn missing_climbing_and_out_of_scope() {
        let dir = tempdir().unwrap();
        let gone = dir.path().join("gone.png");
        assert_eq!(
            serve(&gone.to_string_lossy(), true, |_| true).unwrap_err(),
            StatusCode::NOT_FOUND
        );
        let up = format!("{}/../x.png", dir.path().to_string_lossy());
        assert_eq!(
            serve(&up, true, |_| true).unwrap_err(),
            StatusCode::FORBIDDEN
        );
        let png = dir.path().join("a.png");
        fs::write(&png, b"\x89PNG\r\n\x1a\n").unwrap();
        assert_eq!(
            serve(&png.to_string_lossy(), true, |_| false).unwrap_err(),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn a_link_to_a_local_picture_is_fine() {
        let dir = tempdir().unwrap();
        let png = dir.path().join("a.png");
        fs::write(&png, b"\x89PNG\r\n\x1a\n").unwrap();
        let link = dir.path().join("link.png");
        if make_file_link(&png, &link).is_err() {
            return; // no right to make links here (Windows without Developer Mode)
        }
        assert!(!links_to_network(&link, 0));
        assert!(serve(&link.to_string_lossy(), true, |_| true).is_ok());
    }

    // Only Windows reads \\host as a share; elsewhere those backslashes
    // are a file name, and links aren't checked there at all.
    #[cfg(windows)]
    #[test]
    fn a_link_to_a_share_is_refused_without_following_it() {
        let dir = tempdir().unwrap();
        let link = dir.path().join("pixel.png");
        // .invalid never resolves, so a test that did follow it stays offline.
        if make_file_link(Path::new(r"\\attacker.invalid\s\pixel.png"), &link).is_err() {
            return;
        }
        assert!(links_to_network(&link, 0));
        assert_eq!(
            serve(&link.to_string_lossy(), true, |_| true).unwrap_err(),
            StatusCode::FORBIDDEN
        );
    }

    #[cfg(windows)]
    fn make_file_link(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_file(target, link)
    }

    #[cfg(unix)]
    fn make_file_link(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    // A junction needs no special rights, so this one always runs on Windows.
    #[cfg(windows)]
    #[test]
    fn a_picture_through_a_junction_to_a_local_folder_is_fine() {
        let dir = tempdir().unwrap();
        let real = dir.path().join("real");
        fs::create_dir(&real).unwrap();
        fs::write(real.join("a.png"), b"\x89PNG\r\n\x1a\n").unwrap();
        let junction = dir.path().join("junction");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&real)
            .output()
            .unwrap();
        assert!(made.status.success());
        let png = junction.join("a.png");
        assert!(!links_to_network(&png, 0));
        assert_eq!(
            serve(&png.to_string_lossy(), true, |_| true).unwrap().0,
            "image/png"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_link_target_on_a_drive_or_volume_is_local() {
        for p in [
            r"C:\Users\me\a.png",
            r"\\?\C:\Users\me\a.png",
            r"\Users\a.png",
            r"\\?\Volume{0b1c}\a.png",
        ] {
            assert!(is_local_disk(Path::new(p)), "{p:?}");
        }
        for p in [
            r"\\host\s\a.png",
            r"\\?\UNC\host\s\a.png",
            r"\\.\pipe\a",
            r"\\?\GLOBALROOT\Device\x",
        ] {
            assert!(!is_local_disk(Path::new(p)), "{p:?}");
        }
    }
}
