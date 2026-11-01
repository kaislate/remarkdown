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
// script, and so nothing loaded from here can call a command. And no
// window may open a page from here (navigation_guard).

use std::fs::File;
use std::io::{ErrorKind, Read};
use std::path::{Component, Path, PathBuf, Prefix};

use tauri::http::{header, HeaderMap, Request, Response, StatusCode};
use tauri::path::SafePathBuf;
use tauri::plugin::TauriPlugin;
use tauri::utils::mime_type::MimeType;
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder, Url};

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
        let served = if opened_as_page(request.headers()) {
            Err(StatusCode::FORBIDDEN)
        } else {
            serve(&path, |p| scope.is_allowed(p))
        };
        responder.respond(response(served, &app_origin(&app)));
    });
}

/// Whether the window asked for this as a page (a link followed, a frame)
/// rather than as a picture. The protocol only shows pictures, so that is
/// refused outright, on top of `sandbox`. A webview that doesn't say is
/// served as before.
fn opened_as_page(headers: &HeaderMap) -> bool {
    let dest = headers.get("sec-fetch-dest").and_then(|v| v.to_str().ok());
    dest.is_some_and(|d| {
        ["document", "iframe", "frame", "embed", "object"]
            .iter()
            .any(|page| d.eq_ignore_ascii_case(page))
    })
}

/// Whether a URL names something served here: asset://… on macOS and
/// Linux, http(s)://asset.localhost on Windows. The url parser has already
/// undone any escapes and case in the host.
pub fn is_asset_page(url: &Url) -> bool {
    match url.scheme() {
        "asset" => true,
        "http" | "https" => url
            .host_str()
            .is_some_and(|h| h.trim_end_matches('.') == "asset.localhost"),
        _ => false,
    }
}

/// Keeps every window from opening a page served here. Because the app
/// registers this protocol itself, Tauri counts such a page as one of the
/// app's own, which may call its commands. `sandbox` and `opened_as_page`
/// already keep script from running in one; this keeps a link in a
/// document (to an .svg, say) from ever opening one at all.
pub fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("asset-pages")
        .on_navigation(|_, url| !is_asset_page(url))
        .build()
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

/// A folder macOS mounts from another host the first time anything looks
/// in it: /net/<host> and /Network/…, as Linux's autofs often does for /net
/// too. Refused everywhere, as the app never sends one on Windows. That
/// includes the pictures of a document opened from /net itself: nothing
/// here knows which host the document came from, and macOS has had /net
/// off by default since 10.15. Other automount roots (/afs, a custom autofs
/// map) aren't known.
pub fn is_automount_path(path: &str) -> bool {
    let mut parts = Path::new(path).components();
    parts.next() == Some(Component::RootDir)
        && matches!(parts.next(), Some(Component::Normal(name))
            if name.eq_ignore_ascii_case("net") || name.eq_ignore_ascii_case("network"))
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

/// What a step of a path is on disk, looked at without following it.
enum Entry {
    Missing,
    Plain,
    /// A symlink or a junction, and where it leads (None: unreadable).
    Link(Option<PathBuf>),
}

fn on_disk(at: &Path) -> Entry {
    match std::fs::symlink_metadata(at) {
        Err(_) => Entry::Missing,
        Ok(meta) if !meta.file_type().is_symlink() => Entry::Plain,
        Ok(_) => Entry::Link(std::fs::read_link(at).ok()),
    }
}

/// Whether opening `path` would pass through a link (a symlink or a
/// junction) to a network share or into an automounted folder, at the
/// picture or any folder above it. Each step is looked at without following
/// it, and a link only after its target has been checked, so nothing beyond
/// a bad link is ever touched. The walk goes on from where a link really
/// leads, the way the OS follows one, so a `..` in a later link climbs from
/// there.
fn links_to_network(path: &Path, look: &impl Fn(&Path) -> Entry) -> bool {
    // What's left to walk, last part first.
    let mut rest: Vec<PathBuf> = steps(path);
    let mut at = PathBuf::new();
    let mut links = 0;
    while let Some(part) = rest.pop() {
        if part.as_os_str() == ".." {
            at.pop();
            continue;
        }
        // A drive or root replaces what came before, as push does.
        at.push(&part);
        if !matches!(part.components().next(), Some(Component::Normal(_))) {
            continue;
        }
        // Looking in /net/<host> is what mounts it. (On Windows a link's
        // target is on a drive, so this never matches there.)
        if is_automount_path(&at.to_string_lossy()) {
            return true;
        }
        let target = match look(&at) {
            // Missing as we read it, but after a link maybe not as Windows
            // reads it, so then it's refused. A plain missing picture is
            // left for the open to report.
            Entry::Missing => return links > 0,
            Entry::Plain => continue,
            Entry::Link(None) => return true,
            Entry::Link(Some(target)) => target,
        };
        links += 1;
        if links > 32 || !is_local_disk(&target) {
            return true;
        }
        // A relative target is relative to the link's folder; a rooted one
        // (\x on Windows) keeps that folder's drive.
        at.pop();
        rest.extend(steps(&target));
    }
    false
}

// A path's parts, last first, with `.` dropped.
fn steps(path: &Path) -> Vec<PathBuf> {
    path.components()
        .filter(|c| !matches!(c, Component::CurDir))
        .map(|c| PathBuf::from(c.as_os_str()))
        .rev()
        .collect()
}

/// A picture's type and bytes, or why it isn't served. The checks that
/// need no filesystem come first, then the links on the way: on Windows one
/// can lead to a share, and on macOS and Linux into /net (a cloned repo
/// keeps its symlinks there). Only then does the scope, which follows them,
/// see the path. The app only ever asks for a full path; a relative one
/// would be looked up from wherever the app was started (/ for a Mac app
/// opened from Finder), so `net/host/x.png` would reach /net/host.
fn serve(path: &str, allowed: impl Fn(&Path) -> bool) -> Result<(String, Vec<u8>), StatusCode> {
    if is_network_or_device_path(path) || is_automount_path(path) || !Path::new(path).is_absolute()
    {
        return Err(StatusCode::FORBIDDEN);
    }
    let safe = SafePathBuf::new(PathBuf::from(path)).map_err(|_| StatusCode::FORBIDDEN)?;
    if links_to_network(safe.as_ref(), &on_disk) {
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
            let got = serve(p, |_| panic!("the scope was asked about {p:?}"));
            assert_eq!(got.unwrap_err(), StatusCode::FORBIDDEN, "{p:?}");
        }
    }

    #[test]
    fn refuses_an_automounted_network_folder() {
        for p in [
            "/net/attacker.example/export/x.png",
            "/NET/attacker.example/x.png",
            "/./net/attacker.example/x.png",
            "/Network/Servers/attacker.example/x.png",
            "/net",
        ] {
            assert!(is_automount_path(p), "{p:?}");
            let got = serve(p, |_| panic!("the scope was asked about {p:?}"));
            assert_eq!(got.unwrap_err(), StatusCode::FORBIDDEN, "{p:?}");
        }
        for p in [
            "/Users/me/net/x.png",
            "/network.png",
            "net/x.png",
            "C:/net/x.png",
        ] {
            assert!(!is_automount_path(p), "{p:?}");
        }
    }

    // A relative path would be looked up from wherever the app was started
    // (/ for a Mac app opened from Finder), so `net/host/x.png` would reach
    // /net/host. The app only ever asks for full paths.
    #[test]
    fn refuses_a_relative_path_before_the_scope_or_the_disk_sees_it() {
        for p in [
            "net/attacker.example/x.png",
            "Network/Servers/attacker.example/x.png",
            "img/x.png",
            "./img/x.png",
            "../x.png",
        ] {
            let got = serve(p, |_| panic!("the scope was asked about {p:?}"));
            assert_eq!(got.unwrap_err(), StatusCode::FORBIDDEN, "{p:?}");
        }
    }

    #[test]
    fn knows_a_page_served_by_this_protocol() {
        for u in [
            "asset://localhost/%2Fhome%2Fme%2Fx.svg",
            "http://asset.localhost/C%3A%2Fx.svg",
            "https://asset.localhost/C%3A%2Fx.svg",
            "HTTP://ASSET.LOCALHOST/x.svg",
            "http://asset.localhost./x.svg",
            "http://user@asset.localhost/x.svg",
            "http://asset%2Elocalhost/x.svg",
            "http://asset.localhost:8080/x.svg",
        ] {
            assert!(is_asset_page(&Url::parse(u).unwrap()), "{u}");
        }
        for u in [
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
            "tauri://localhost/",
            "http://localhost:1420/",
            "https://example.com/asset.localhost/x.svg",
            "http://asset.localhost.example.com/x.svg",
            "http://ipc.localhost/x",
        ] {
            assert!(!is_asset_page(&Url::parse(u).unwrap()), "{u}");
        }
    }

    #[test]
    fn a_picture_opened_as_a_page_is_refused() {
        let asked = |dest: Option<&str>| {
            let mut r = Request::builder().uri("http://asset.localhost/C%3A%2Fa.svg");
            if let Some(d) = dest {
                r = r.header("sec-fetch-dest", d);
            }
            opened_as_page(r.body(Vec::<u8>::new()).unwrap().headers())
        };
        for dest in ["document", "iframe", "frame", "embed", "object", "Document"] {
            assert!(asked(Some(dest)), "{dest}");
        }
        // An <img>, a CSS background, a fetch, or a webview that doesn't
        // say: served as before.
        for dest in [Some("image"), Some("empty"), None] {
            assert!(!asked(dest), "{dest:?}");
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
        let (mime, bytes) = serve(&png_path, |_| true).unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, fs::read(&png).unwrap());
        let (mime, _) = serve(&svg.to_string_lossy(), |_| true).unwrap();
        assert_eq!(mime, "image/svg+xml");
    }

    #[test]
    fn serves_a_big_picture_whole() {
        let dir = tempdir().unwrap();
        let jpg = dir.path().join("big.jpg");
        let mut data = b"\xFF\xD8\xFF\xE0".to_vec();
        data.resize(100_000, 7);
        fs::write(&jpg, &data).unwrap();
        let (mime, bytes) = serve(&jpg.to_string_lossy(), |_| true).unwrap();
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
                serve(&p.to_string_lossy(), |_| true).unwrap_err(),
                StatusCode::FORBIDDEN,
                "{name}"
            );
        }
    }

    #[test]
    fn missing_climbing_and_out_of_scope() {
        let dir = tempdir().unwrap();
        // A picture missing behind a link is refused rather than missing,
        // and a Mac's temp folder is behind one (/var), so this looks from
        // where it really is. (Windows spells that \\?\C:\…, a device path.)
        let real = if cfg!(windows) {
            dir.path().to_path_buf()
        } else {
            dir.path().canonicalize().unwrap()
        };
        let gone = real.join("gone.png");
        assert_eq!(
            serve(&gone.to_string_lossy(), |_| true).unwrap_err(),
            StatusCode::NOT_FOUND
        );
        let up = format!("{}/../x.png", dir.path().to_string_lossy());
        assert_eq!(serve(&up, |_| true).unwrap_err(), StatusCode::FORBIDDEN);
        let png = dir.path().join("a.png");
        fs::write(&png, b"\x89PNG\r\n\x1a\n").unwrap();
        assert_eq!(
            serve(&png.to_string_lossy(), |_| false).unwrap_err(),
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
        assert!(!links_to_network(&link, &on_disk));
        assert!(serve(&link.to_string_lossy(), |_| true).is_ok());
    }

    // Only Windows reads \\host as a share; elsewhere those backslashes
    // are a file name.
    #[cfg(windows)]
    #[test]
    fn a_link_to_a_share_is_refused_without_following_it() {
        let dir = tempdir().unwrap();
        let link = dir.path().join("pixel.png");
        // .invalid never resolves, so a test that did follow it stays offline.
        if make_file_link(Path::new(r"\\attacker.invalid\s\pixel.png"), &link).is_err() {
            return;
        }
        assert!(links_to_network(&link, &on_disk));
        assert_eq!(
            serve(&link.to_string_lossy(), |_| true).unwrap_err(),
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
        assert!(!links_to_network(&png, &on_disk));
        assert_eq!(
            serve(&png.to_string_lossy(), |_| true).unwrap().0,
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

    // A disk made of a list: each path is a plain file or folder (None) or
    // a link (Some(target)); anything else is missing. Paths are written
    // with forward slashes, which every OS reads the same way.
    fn fake_disk<'a>(entries: &'a [(&'a str, Option<&'a str>)]) -> impl Fn(&Path) -> Entry + 'a {
        move |at| match entries.iter().find(|(p, _)| Path::new(p) == at) {
            None => Entry::Missing,
            Some((_, None)) => Entry::Plain,
            Some((_, Some(target))) => Entry::Link(Some(PathBuf::from(target))),
        }
    }

    #[test]
    fn a_relative_link_behind_a_junction_climbs_from_where_it_really_is() {
        // /doc/link is a junction to /doc/a/b, and /doc/a/b/sub links to
        // ../evil: Windows opens /doc/a/evil, not /doc/evil.
        let disk = fake_disk(&[
            ("/doc", None),
            ("/doc/a", None),
            ("/doc/a/b", None),
            ("/doc/link", Some("/doc/a/b")),
            ("/doc/a/b/sub", Some("../evil")),
            // The same link, as a lookup through the junction shows it.
            ("/doc/link/sub", Some("../evil")),
            ("/doc/a/evil", Some("//attacker.invalid/s")),
        ]);
        assert!(links_to_network(Path::new("/doc/link/sub/x.png"), &disk));
    }

    #[test]
    fn a_chain_of_local_links_is_fine() {
        let disk = fake_disk(&[
            ("/doc", None),
            ("/doc/a", None),
            ("/doc/a/b", None),
            ("/doc/a/c", None),
            ("/doc/a/c/x.png", None),
            ("/doc/link", Some("/doc/a/b")),
            ("/doc/a/b/sub", Some("../c")),
        ]);
        assert!(!links_to_network(Path::new("/doc/link/sub/x.png"), &disk));
    }

    #[test]
    fn a_path_that_goes_missing_after_a_link_is_refused() {
        // Missing as we read it but maybe not as Windows does: refuse. A
        // missing picture with no link on the way is just missing.
        let disk = fake_disk(&[
            ("/doc", None),
            ("/doc/real", None),
            ("/doc/link", Some("/doc/real")),
        ]);
        assert!(links_to_network(Path::new("/doc/link/gone.png"), &disk));
        assert!(!links_to_network(Path::new("/doc/gone.png"), &disk));
    }

    #[test]
    fn a_link_into_an_automounted_folder_is_refused_without_looking_there() {
        // A cloned repo keeps its symlinks on macOS and Linux. Looking in
        // /net/<host> is what mounts it, so the walk stops before that.
        let disk = fake_disk(&[
            ("/home", None),
            ("/home/me", None),
            ("/home/me/repo", None),
            (
                "/home/me/repo/img.png",
                Some("/net/attacker.invalid/export/x.png"),
            ),
            (
                "/home/me/repo/up.png",
                Some("../../../net/attacker.invalid/x.png"),
            ),
            (
                "/home/me/repo/mac",
                Some("/Network/Servers/attacker.invalid"),
            ),
            ("/net", None),
            ("/net/attacker.invalid", None),
            ("/net/attacker.invalid/x.png", None),
            ("/net/attacker.invalid/export", None),
            ("/net/attacker.invalid/export/x.png", None),
            ("/Network", None),
            ("/Network/Servers", None),
            ("/Network/Servers/attacker.invalid", None),
            ("/Network/Servers/attacker.invalid/x.png", None),
        ]);
        let looked = std::cell::RefCell::new(Vec::new());
        let look = |at: &Path| {
            looked.borrow_mut().push(at.to_path_buf());
            disk(at)
        };
        for p in [
            "/home/me/repo/img.png",
            "/home/me/repo/up.png",
            "/home/me/repo/mac/x.png",
        ] {
            assert!(links_to_network(Path::new(p), &look), "{p}");
        }
        for at in looked.borrow().iter() {
            assert!(
                !is_automount_path(&at.to_string_lossy()),
                "looked at {at:?}"
            );
        }
    }

    #[test]
    fn a_link_loop_is_refused() {
        let disk = fake_disk(&[
            ("/doc", None),
            ("/doc/a", Some("/doc/b")),
            ("/doc/b", Some("a")),
        ]);
        assert!(links_to_network(Path::new("/doc/a/x.png"), &disk));
    }
}
