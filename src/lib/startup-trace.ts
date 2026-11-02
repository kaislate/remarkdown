// The page's half of the opt-in startup trace (src-tauri/src/startup_trace.rs).
// Marks are kept in memory, a timestamp and a push each, and handed to Rust
// in one call once startup has gone idle. Rust writes them only when
// REMARKDOWN_STARTUP_TRACE names a file; otherwise that call does nothing.
//
// main.ts imports this module first, so its own evaluation is "script-start":
// the moment the entry chunk has been parsed and starts to run.

import { invoke } from '@tauri-apps/api/core';

export interface RawMark { name: string; t: number; detail?: string }
export interface TraceMark { name: string; epochMs: number; detail?: string }
export interface TraceSpan { name: string; ms: number; count: number }

// What the page's own timing APIs know about the load, in performance.now() ms.
export interface PageTimings {
  timeOrigin: number;
  nav?: { responseEnd: number; domInteractive: number; domContentLoadedEventStart: number };
  resources: Array<{ name: string; responseEnd: number }>;
}

const ENTRY_JS = /\/assets\/index-[^/]*\.js$/;
const ENTRY_CSS = /\/assets\/index-[^/]*\.css$/;

export function buildTraceMarks(raw: RawMark[], page: PageTimings): TraceMark[] {
  const at = (name: string, t: number, detail?: string): TraceMark =>
    detail === undefined ? { name, epochMs: page.timeOrigin + t } : { name, epochMs: page.timeOrigin + t, detail };
  // A timing the page never reached (or doesn't report) reads 0: leave it out.
  const timing = (name: string, t: number | undefined): TraceMark[] => (t && t > 0 ? [at(name, t)] : []);
  const find = (re: RegExp) => page.resources.find((r) => re.test(r.name))?.responseEnd;
  const out = [
    at('nav-start', 0),
    ...timing('html-received', page.nav?.responseEnd),
    ...timing('entry-css-received', find(ENTRY_CSS)),
    ...timing('entry-js-received', find(ENTRY_JS)),
    ...timing('dom-interactive', page.nav?.domInteractive),
    ...timing('dom-content-loaded', page.nav?.domContentLoadedEventStart),
    ...raw.map((m) => at(m.name, m.t, m.detail)),
  ];
  return out.sort((a, b) => a.epochMs - b.epochMs);
}

export function samePathLoose(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

export function createStartupTrace(
  now: () => number,
  nextFrame: (cb: () => void) => void = (cb) => { requestAnimationFrame(cb); },
) {
  const marks: RawMark[] = [];
  const spans = new Map<string, TraceSpan>();
  let launched: string[] = [];
  let done = false;

  function mark(name: string, detail?: string): void {
    if (done || marks.some((m) => m.name === name)) return;
    marks.push(detail === undefined ? { name, t: now() } : { name, t: now(), detail });
  }

  function span(name: string, ms: number): void {
    if (done) return;
    const s = spans.get(name);
    if (s) { s.ms += ms; s.count += 1; } else spans.set(name, { name, ms, count: 1 });
  }

  async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (done) return fn();
    const t0 = now();
    try {
      return await fn();
    } finally {
      span(name, now() - t0);
    }
  }

  // Marks the first frame on which isShown() holds: a rAF callback runs just
  // before its frame is painted, so this is when the content reaches the
  // screen (to within that frame).
  function markWhenShown(name: string, isShown: () => boolean, maxFrames = 600): void {
    let left = maxFrames;
    const check = () => {
      if (done || marks.some((m) => m.name === name)) return;
      if (isShown()) { mark(name); return; }
      if (--left > 0) nextFrame(check);
    };
    if (!done) nextFrame(check);
  }

  return {
    mark,
    span,
    timed,
    markWhenShown,
    noteLaunched(paths: string[]): void {
      if (!done && launched.length === 0) launched = [...paths];
    },
    isLaunched(path: string): boolean {
      return !done && launched.some((p) => samePathLoose(p, path));
    },
    snapshot() {
      return { marks: [...marks], spans: [...spans.values()].map((s) => ({ ...s })) };
    },
    async flush(page: PageTimings): Promise<void> {
      if (done) return;
      done = true;
      try {
        await invoke('startup_trace', {
          marks: buildTraceMarks(marks, page),
          spans: [...spans.values()].map((s) => ({ ...s, ms: Math.round(s.ms * 100) / 100 })),
        });
      } catch {
        // Not running under Tauri (tests, the e2e build): nothing to write.
      }
    },
  };
}

const trace = createStartupTrace(() => performance.now());
trace.mark('script-start');

export const startupMark = trace.mark;
export const startupTimed = trace.timed;
export const noteLaunchedPaths = trace.noteLaunched;
export const isLaunchedPath = trace.isLaunched;
export const startupMarkWhenShown = trace.markWhenShown;

function pageTimings(): PageTimings {
  const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
  const resources = (performance.getEntriesByType?.('resource') ?? []) as PerformanceResourceTiming[];
  return {
    timeOrigin: performance.timeOrigin,
    nav: nav && {
      responseEnd: nav.responseEnd,
      domInteractive: nav.domInteractive,
      domContentLoadedEventStart: nav.domContentLoadedEventStart,
    },
    resources: resources.map((r) => ({ name: r.name, responseEnd: r.responseEnd })),
  };
}

// After startup's opens: mark the first idle moment, then hand everything
// over a few seconds later so late work (diagrams) is in.
export function finishStartupTrace(): void {
  const idle = () =>
    new Promise<void>((r) => {
      const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback;
      if (ric) ric(() => r(), { timeout: 5000 });
      else setTimeout(r, 0);
    });
  void (async () => {
    await idle();
    trace.mark('idle');
    setTimeout(() => { void trace.flush(pageTimings()); }, 3000);
  })();
}
