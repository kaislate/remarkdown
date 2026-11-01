//! Keeps every window on the app's own pages. A document can hold any link
//! (and a diagram can declare one with `click X href`); followed in place, it
//! would swap the app for whatever page it names, in a frameless window with
//! no address bar to tell the two apart. The page handles the links it
//! means to follow (Viewer.svelte); this is the backstop for everything else.

use tauri::webview::NewWindowResponse;
use tauri::{Manager, Runtime, Url, WebviewWindowBuilder};

/// Whether `url` is one of the app's own pages: tauri://localhost (macOS,
/// Linux), http(s)://tauri.localhost (Windows serves the app over http by
/// default), or, in a debug build, the dev server. Only the origin counts;
/// the path and fragment are the app's business.
pub fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    let own = match url.scheme() {
        "tauri" => url.host_str() == Some("localhost") && url.port().is_none(),
        "http" | "https" => url.host_str() == Some("tauri.localhost") && url.port().is_none(),
        _ => false,
    };
    own || dev_url.is_some_and(|dev| dev.origin() == url.origin())
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

    #[test]
    fn the_app_origin_is_allowed_on_every_platform() {
        for s in [
            "tauri://localhost",
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "http://tauri.localhost/index.html#fn1",
            "https://tauri.localhost/index.html?x=1",
        ] {
            assert!(is_app_url(&url(s), None), "{s}");
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
            assert!(!is_app_url(&url(s), None), "{s}");
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
            assert!(!is_app_url(&url(s), None), "{s}");
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
            assert!(!is_app_url(&url(s), None), "{s}");
        }
    }

    #[test]
    fn the_dev_server_is_allowed_only_when_given() {
        let dev = url("http://localhost:1566");
        assert!(is_app_url(&url("http://localhost:1566/src/main.ts"), Some(&dev)));
        assert!(!is_app_url(&url("http://localhost:1566/"), None));
        assert!(!is_app_url(&url("http://localhost:1567/"), Some(&dev)));
        assert!(!is_app_url(&url("https://localhost:1566/"), Some(&dev)));
        assert!(!is_app_url(&url("https://example.com/"), Some(&dev)));
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
