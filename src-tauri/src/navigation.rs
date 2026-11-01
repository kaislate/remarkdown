//! Keeps every window on the app's own pages. A document can hold any link
//! (and a diagram can declare one with `click X href`); followed in place, it
//! would swap the app for whatever page it names, in a frameless window with
//! no address bar to tell the two apart.
//!
//! The page stops every link click itself (lib/link-guard.ts, and
//! Viewer.svelte for the reader's links); this catches what else gets
//! through. It can't be the only guard: tauri-runtime-wry 2.12 asks it only
//! about URLs the url crate can parse and lets any other through
//! (`url.parse().map(..).unwrap_or(true)`), and Chromium follows some that
//! url refuses, such as a bad punycode host (http://xn--a.example/).

use tauri::webview::NewWindowResponse;
use tauri::{Manager, Runtime, Url, WebviewWindowBuilder};

/// Whether `url` is the app's own page: tauri://localhost/ on macOS and
/// Linux, http(s)://tauri.localhost/ on Windows (served over http by
/// default), or, in a debug build, anything on the dev server.
pub fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    is_app_page(url, dev_url, cfg!(any(windows, target_os = "android")))
}

/// is_app_url with the platform passed in, so both forms are tested here.
/// `windows`: Tauri serves the app from http(s)://tauri.localhost (Windows
/// and Android); elsewhere it's tauri://localhost, and tauri.localhost is
/// just a name that DNS on a hostile network may answer.
fn is_app_page(url: &Url, dev_url: Option<&Url>, windows: bool) -> bool {
    if dev_url.is_some_and(|dev| dev.origin() == url.origin()) {
        return true;
    }
    let origin = match url.scheme() {
        "tauri" => !windows && url.host_str() == Some("localhost"),
        "http" | "https" => windows && url.host_str() == Some("tauri.localhost"),
        _ => false,
    };
    // The app is one page. Any other path or a query is a relative link
    // from a document (`other.md`, `?a`), and Tauri answers a path it doesn't
    // know with index.html: the app would reload, losing edits and undo.
    // The fragment is the page's own business.
    origin && url.port().is_none() && url.query().is_none() && matches!(url.path(), "" | "/" | "/index.html")
}

/// The dev server's URL in a debug build; a release build never trusts it.
pub fn dev_url<R: Runtime, M: Manager<R>>(manager: &M) -> Option<Url> {
    if cfg!(debug_assertions) {
        manager.config().build.dev_url.clone()
    } else {
        None
    }
}

/// `builder`, refusing any top-level navigation away from the app and any
/// new window the page asks for (target=_blank, a shift/ctrl/middle click,
/// window.open). Every window the app makes goes through here.
pub fn lock_to_app<'a, R: Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
    dev_url: Option<Url>,
) -> WebviewWindowBuilder<'a, R, M> {
    builder
        .on_navigation(move |url| is_app_url(url, dev_url.as_ref()))
        // wry already refuses these when no handler is set; saying so here
        // keeps it that way whatever a later wry decides.
        .on_new_window(|_, _| NewWindowResponse::Deny)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    // Windows (and Android) serve the app from http(s)://tauri.localhost.
    #[test]
    fn the_app_page_is_allowed_on_windows() {
        for s in [
            "http://tauri.localhost",
            "http://tauri.localhost/",
            "http://tauri.localhost/index.html",
            "http://tauri.localhost/index.html#fn1",
            "https://tauri.localhost/index.html",
        ] {
            assert!(is_app_page(&url(s), None, true), "{s}");
        }
    }

    // macOS and Linux serve it from tauri://localhost.
    #[test]
    fn the_app_page_is_allowed_on_macos_and_linux() {
        for s in ["tauri://localhost", "tauri://localhost/", "tauri://localhost/index.html", "tauri://localhost/index.html#fn1"] {
            assert!(is_app_page(&url(s), None, false), "{s}");
        }
    }

    // There, tauri.localhost is a name like any other, which DNS on a
    // hostile network may answer; on Windows tauri:// is not the app.
    #[test]
    fn the_other_platform_form_is_refused() {
        for s in ["http://tauri.localhost/", "https://tauri.localhost/index.html"] {
            assert!(!is_app_page(&url(s), None, false), "{s}");
        }
        for s in ["tauri://localhost", "tauri://localhost/index.html"] {
            assert!(!is_app_page(&url(s), None, true), "{s}");
        }
    }

    // A relative link from a document lands on the app's origin, and Tauri
    // answers a path it doesn't know with index.html: the app would reload.
    #[test]
    fn other_paths_and_queries_on_the_app_origin_are_refused() {
        for windows in [true, false] {
            let origin = if windows { "http://tauri.localhost" } else { "tauri://localhost" };
            for rest in ["/other.md", "/CONTRIBUTING.md", "/sub/index.html", "/?a", "/index.html?x=1", "/?"] {
                let s = format!("{origin}{rest}");
                assert!(!is_app_page(&url(&s), None, windows), "{s}");
            }
        }
    }

    #[test]
    fn web_pages_are_refused() {
        for s in [
            "https://example.com/",
            "http://example.com/tauri.localhost",
            "https://tauri.localhost.example.com/",
            "http://localhost/",
            "https://evil.example/@tauri.localhost",
        ] {
            for windows in [true, false] {
                assert!(!is_app_page(&url(s), None, windows), "{s}");
            }
        }
    }

    // A page served from the asset protocol is a file from disk, not the app.
    #[test]
    fn asset_and_file_pages_are_refused() {
        for s in [
            "asset://localhost/C:/x/r.html",
            "http://asset.localhost/%5C%5Cevil%5Cs%5Cr.html",
            "https://asset.localhost/r.html",
            "file:///C:/Users/me/r.html",
            "ipc://localhost/write_document",
            "http://ipc.localhost/write_document",
        ] {
            for windows in [true, false] {
                assert!(!is_app_page(&url(s), None, windows), "{s}");
            }
        }
    }

    #[test]
    fn other_schemes_and_hosts_are_refused() {
        for s in [
            "javascript:alert(1)",
            "data:text/html,<p>hi</p>",
            "about:blank",
            "mailto:me@example.com",
            "tauri://evil/",
            "tauri://localhost:8080/",
            "http://tauri.localhost:8080/",
            "ftp://tauri.localhost/",
        ] {
            for windows in [true, false] {
                assert!(!is_app_page(&url(s), None, windows), "{s}");
            }
        }
    }

    // What this machine's build allows.
    #[test]
    fn is_app_url_uses_this_platforms_form() {
        let windows = cfg!(any(windows, target_os = "android"));
        assert_eq!(is_app_url(&url("http://tauri.localhost/"), None), windows);
        assert_eq!(is_app_url(&url("tauri://localhost/"), None), !windows);
    }

    #[test]
    fn the_dev_server_is_allowed_only_when_given() {
        let dev = url("http://localhost:1566");
        for windows in [true, false] {
            assert!(is_app_page(&url("http://localhost:1566/src/main.ts"), Some(&dev), windows));
            assert!(!is_app_page(&url("http://localhost:1566/"), None, windows));
            assert!(!is_app_page(&url("http://localhost:1567/"), Some(&dev), windows));
            assert!(!is_app_page(&url("https://localhost:1566/"), Some(&dev), windows));
            assert!(!is_app_page(&url("https://example.com/"), Some(&dev), windows));
        }
    }

    // The windows from tauri.conf.json are built in setup, through
    // lock_to_app; one Tauri made by itself would be left unguarded.
    #[test]
    fn config_windows_are_left_for_setup_to_build() {
        for conf in [include_str!("../tauri.conf.json"), include_str!("../tauri.macos.conf.json")] {
            let v: serde_json::Value = serde_json::from_str(conf).unwrap();
            for w in v["app"]["windows"].as_array().unwrap() {
                assert_eq!(w["create"], serde_json::Value::Bool(false), "{w}");
            }
        }
    }
}
