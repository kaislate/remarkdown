// An opt-in startup trace for measuring how long a double-clicked document
// takes to reach the screen. Set REMARKDOWN_STARTUP_TRACE to a file path and
// each launch appends one JSON line there: milestones in ms since main()
// started, from both Rust and the page. With the variable unset, every mark
// is a check of a OnceLock and the page's one `startup_trace` call at idle
// returns straight away.

use std::ffi::OsString;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const ENV_VAR: &str = "REMARKDOWN_STARTUP_TRACE";

struct Trace {
    path: PathBuf,
    start: Instant,
    start_epoch_ms: f64,
    marks: Mutex<Vec<Mark>>,
    written: AtomicBool,
}

static TRACE: OnceLock<Option<Trace>> = OnceLock::new();

/// One milestone in the written trace.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Mark {
    pub name: String,
    /// ms since main() started.
    pub ms: f64,
    /// "rust" or "web".
    pub src: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// A milestone from the page, timed by its own clock (wall-clock epoch ms:
/// performance.timeOrigin + performance.now()).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebMark {
    pub name: String,
    pub epoch_ms: f64,
    pub detail: Option<String>,
}

/// Time the page spent in one kind of work across startup, summed.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct WebSpan {
    pub name: String,
    pub ms: f64,
    pub count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Line<'a> {
    pid: u32,
    start_epoch_ms: f64,
    marks: &'a [Mark],
    spans: &'a [WebSpan],
}

/// The trace file named by the environment, if any. An empty value is off.
pub fn trace_path(var: Option<OsString>) -> Option<PathBuf> {
    var.filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// Turns the page's marks into ms since `start_epoch_ms` and merges them
/// with Rust's, in time order.
pub fn merge_marks(rust: &[Mark], web: &[WebMark], start_epoch_ms: f64) -> Vec<Mark> {
    let mut all: Vec<Mark> = rust.to_vec();
    all.extend(web.iter().map(|m| Mark {
        name: m.name.clone(),
        ms: round2(m.epoch_ms - start_epoch_ms),
        src: "web",
        detail: m.detail.clone(),
    }));
    all.sort_by(|a, b| a.ms.total_cmp(&b.ms));
    all
}

/// One launch as a single JSON line (with its trailing newline).
pub fn render_line(pid: u32, start_epoch_ms: f64, marks: &[Mark], spans: &[WebSpan]) -> String {
    let line = Line { pid, start_epoch_ms, marks, spans };
    let mut s = serde_json::to_string(&line).unwrap_or_default();
    s.push('\n');
    s
}

fn round2(ms: f64) -> f64 {
    (ms * 100.0).round() / 100.0
}

fn epoch_ms_now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn trace() -> Option<&'static Trace> {
    TRACE.get().and_then(|t| t.as_ref())
}

/// Call first thing in main(). Reads the environment once.
pub fn init() {
    TRACE.get_or_init(|| {
        let path = trace_path(std::env::var_os(ENV_VAR))?;
        Some(Trace {
            path,
            start: Instant::now(),
            start_epoch_ms: epoch_ms_now(),
            marks: Mutex::new(vec![Mark { name: "process-start".into(), ms: 0.0, src: "rust", detail: None }]),
            written: AtomicBool::new(false),
        })
    });
}

/// Records a Rust-side milestone. Only the first mark of each name counts.
pub fn mark(name: &str) {
    let Some(t) = trace() else { return };
    let ms = round2(t.start.elapsed().as_secs_f64() * 1000.0);
    let mut marks = t.marks.lock().unwrap();
    if !marks.iter().any(|m| m.name == name) {
        marks.push(Mark { name: name.into(), ms, src: "rust", detail: None });
    }
}

/// The page hands over its milestones once it's idle; the first window to
/// do so writes the launch's line. A no-op unless tracing is on.
#[tauri::command]
pub async fn startup_trace(marks: Vec<WebMark>, spans: Vec<WebSpan>) {
    let Some(t) = trace() else { return };
    if t.written.swap(true, Ordering::SeqCst) {
        return;
    }
    mark("trace-received");
    let rust = t.marks.lock().unwrap().clone();
    let merged = merge_marks(&rust, &marks, t.start_epoch_ms);
    let line = render_line(std::process::id(), t.start_epoch_ms, &merged, &spans);
    let written = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&t.path)
        .and_then(|mut f| f.write_all(line.as_bytes()));
    if let Err(e) = written {
        eprintln!("[remarkdown] could not write the startup trace to {}: {e}", t.path.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rust_mark(name: &str, ms: f64) -> Mark {
        Mark { name: name.into(), ms, src: "rust", detail: None }
    }

    #[test]
    fn unset_or_empty_variable_means_off() {
        assert_eq!(trace_path(None), None);
        assert_eq!(trace_path(Some(OsString::new())), None);
        assert_eq!(trace_path(Some("C:/t/trace.jsonl".into())), Some(PathBuf::from("C:/t/trace.jsonl")));
    }

    #[test]
    fn web_marks_become_ms_since_start_and_merge_in_time_order() {
        let rust = vec![rust_mark("process-start", 0.0), rust_mark("setup-end", 120.0)];
        let web = vec![
            WebMark { name: "script-start".into(), epoch_ms: 1_000_300.456, detail: None },
            WebMark { name: "nav-start".into(), epoch_ms: 1_000_100.0, detail: Some("x".into()) },
        ];
        let merged = merge_marks(&rust, &web, 1_000_000.0);
        let names: Vec<&str> = merged.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["process-start", "nav-start", "setup-end", "script-start"]);
        assert_eq!(merged[1].ms, 100.0);
        assert_eq!(merged[1].src, "web");
        assert_eq!(merged[1].detail.as_deref(), Some("x"));
        assert_eq!(merged[3].ms, 300.46);
    }

    #[test]
    fn a_launch_is_one_json_line() {
        let marks = vec![rust_mark("process-start", 0.0)];
        let spans = vec![WebSpan { name: "render".into(), ms: 12.5, count: 3 }];
        let line = render_line(42, 1.5, &marks, &spans);
        assert!(line.ends_with('\n'));
        assert_eq!(line.matches('\n').count(), 1);
        let v: serde_json::Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(v["pid"], 42);
        assert_eq!(v["startEpochMs"], 1.5);
        assert_eq!(v["marks"][0]["name"], "process-start");
        assert_eq!(v["marks"][0]["src"], "rust");
        assert!(v["marks"][0].get("detail").is_none());
        assert_eq!(v["spans"][0]["count"], 3);
    }

    #[test]
    fn marks_are_no_ops_when_tracing_is_off() {
        // Only meaningful when whoever runs the tests hasn't turned it on.
        if std::env::var_os(ENV_VAR).is_some_and(|v| !v.is_empty()) {
            return;
        }
        init();
        assert!(trace().is_none());
        mark("anything");
        assert!(trace().is_none());
    }
}
