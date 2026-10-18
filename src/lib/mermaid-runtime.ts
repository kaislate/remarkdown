// The one place that talks to mermaid. Both the reader
// (MermaidRenderer.svelte) and the editor (mermaid-node-view.ts) render
// through here.
//
// Why a shared module: mermaid keeps ONE global config, and
// `initialize()` resets every key it isn't given. When the reader and
// the editor each initialized it their own way (the editor hard-coded
// theme 'dark' and no font), whichever rendered last decided how the
// other's next diagram looked. Now every render:
//   1. runs through a single promise queue — initialize + render is an
//      atomic pair, so a render can never pick up a config another
//      caller set halfway through;
//   2. re-applies the full config (theme + font + strict security +
//      suppressed error rendering) right before rendering.
//
// Results are cached in memory by (theme, font, source). Re-inserting
// the same document (doc reloads, the edit-mode round-trip, and the
// upcoming tabs work) then paints diagrams synchronously from the cache
// instead of flashing empty placeholders while mermaid re-lays-out.
import { get } from 'svelte/store';
import { settings } from '../stores/settings';

type Mermaid = typeof import('mermaid').default;

export type AppTheme = 'dark' | 'light';

export interface MermaidRenderContext {
  theme: AppTheme;
  // CSS font-family list the diagram text is measured AND drawn with.
  // Pass the font of the surface the diagram sits in (the article or
  // the editor) so labels match the surrounding text.
  fontFamily: string;
}

export type MermaidRenderOutcome =
  | { ok: true; svg: string }
  | { ok: false; error: string };

// Mirrors --font-serif in theme.css. Only used when no element is
// available to read the computed font from (e.g. tests without CSS).
const FALLBACK_FONT = "Charter, Georgia, serif";

// Below this fraction of its natural width a diagram's text gets too
// small to read (wide gantt/timeline/C4 charts used to shrink to ~6px
// text). Past that point the block scrolls horizontally instead.
export const MIN_DIAGRAM_SCALE = 0.75;

const CACHE_LIMIT = 300;

interface CacheEntry {
  outcome: MermaidRenderOutcome;
  // The svg id the cached markup was rendered with. Every reference
  // inside the svg (its own id, `#id` in the inline <style>, marker and
  // edge ids) contains it, so a cache hit can re-key the whole svg to a
  // fresh id with one string replace.
  id: string;
}

let mermaidPromise: Promise<Mermaid> | null = null;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, CacheEntry>();
let idCounter = 0;

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
    // A failed import (offline dev server, chunk load error) must not
    // poison every later attempt.
    mermaidPromise.catch(() => {
      mermaidPromise = null;
    });
  }
  return mermaidPromise;
}

// Ids end in a letter so one id is never a prefix of another
// (`rmd-mermaid-1x` vs `rmd-mermaid-11x`) — that is what makes the
// plain string replace in rekey() safe.
function nextId(): string {
  idCounter += 1;
  return `rmd-mermaid-${idCounter}x`;
}

function cacheKey(source: string, ctx: MermaidRenderContext): string {
  return `${ctx.theme}\u0001${ctx.fontFamily}\u0001${source}`;
}

export function mermaidThemeFor(theme: AppTheme): 'dark' | 'default' {
  return theme === 'dark' ? 'dark' : 'default';
}

// Stable identifier of the visual context, used by callers to know
// whether an element's current svg is up to date.
export function renderContextKey(ctx: MermaidRenderContext): string {
  return `${ctx.theme}|${ctx.fontFamily}`;
}

export function resolveDiagramFont(el?: Element | null): string {
  for (const candidate of [el, typeof document !== 'undefined' ? document.body : null]) {
    if (!candidate) continue;
    try {
      const f = getComputedStyle(candidate).fontFamily;
      if (f && f.trim()) return f;
    } catch {
      // Detached / non-element — try the next candidate.
    }
  }
  return FALLBACK_FONT;
}

// Context for a diagram hosted inside `host`: the app's theme setting
// plus the host's font.
export function currentRenderContext(host?: Element | null): MermaidRenderContext {
  return { theme: get(settings).theme, fontFamily: resolveDiagramFont(host) };
}

function rekey(entry: CacheEntry): MermaidRenderOutcome {
  if (!entry.outcome.ok) return entry.outcome;
  const id = nextId();
  return { ok: true, svg: entry.outcome.svg.split(entry.id).join(id) };
}

function remember(key: string, entry: CacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// Synchronous cache lookup. Callers use it to paint a known diagram in
// the same frame the placeholder appears (no empty-block flicker).
export function peekMermaidRender(
  source: string,
  ctx: MermaidRenderContext,
): MermaidRenderOutcome | null {
  const key = cacheKey(source, ctx);
  const entry = cache.get(key);
  if (!entry) return null;
  // Refresh LRU position.
  remember(key, entry);
  return rekey(entry);
}

// mermaid.render() parks a temp `<div id="d<id>">` (and, for sandboxed
// renders, an `<iframe id="i<id>">`) on <body>. It cleans up after a
// successful render, but historically left the error "bomb" svg behind
// on failure — one leaked node per broken diagram per reopen.
// suppressErrorRendering stops mermaid drawing it; this is the belt to
// that pair of braces.
function removeLeftovers(id: string): void {
  if (typeof document === 'undefined') return;
  for (const leftover of [`d${id}`, `i${id}`]) {
    document.getElementById(leftover)?.remove();
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

async function renderNow(
  source: string,
  ctx: MermaidRenderContext,
  key: string,
): Promise<MermaidRenderOutcome> {
  // A job queued behind an identical one finds the result already here.
  const cached = cache.get(key);
  if (cached) return rekey(cached);

  let m: Mermaid;
  try {
    m = await loadMermaid();
  } catch (err) {
    // Not cached: the diagram isn't broken, mermaid just didn't load.
    return { ok: false, error: errorMessage(err) };
  }
  const id = nextId();
  let entry: CacheEntry;
  try {
    m.initialize({
      startOnLoad: false,
      theme: mermaidThemeFor(ctx.theme),
      fontFamily: ctx.fontFamily,
      // Opening a .md file must never run its diagram's HTML or click
      // handlers — strict disables HTML labels and click bindings.
      securityLevel: 'strict',
      // Throw instead of drawing mermaid's own error svg; we show a
      // friendly message (buildDiagramError) in the diagram's place.
      suppressErrorRendering: true,
    });
    const { svg } = await m.render(id, source);
    entry = { outcome: { ok: true, svg }, id };
  } catch (err) {
    entry = { outcome: { ok: false, error: errorMessage(err) }, id };
  } finally {
    removeLeftovers(id);
  }
  remember(key, entry);
  return entry.outcome;
}

// Render `source` as an svg string for the given context. Never
// rejects: failures resolve to `{ ok: false, error }`.
export function renderMermaid(
  source: string,
  ctx: MermaidRenderContext,
): Promise<MermaidRenderOutcome> {
  const key = cacheKey(source, ctx);
  const hit = cache.get(key);
  if (hit) {
    remember(key, hit);
    return Promise.resolve(rekey(hit));
  }
  const job = queue.then(() => renderNow(source, ctx, key));
  queue = job.catch(() => {});
  return job;
}

// Pay mermaid's dynamic import (and the flowchart + sequence diagram
// modules it lazy-loads) up front. Used by tests whose first render
// would otherwise race the default timeout under parallel load.
export async function warmMermaidRuntime(): Promise<void> {
  const m = await loadMermaid();
  for (const src of ['flowchart TD\nA', 'sequenceDiagram\nA->>B: x']) {
    try {
      await m.parse(src);
    } catch {
      // Warm-up only — a parse failure here is irrelevant.
    }
  }
}

export function resetMermaidRuntimeForTests(): void {
  cache.clear();
  queue = Promise.resolve();
}

// Natural (unscaled) width of a mermaid svg: the viewBox width, else
// the max-width mermaid writes inline, else an absolute width attr.
function naturalWidth(svg: SVGSVGElement): number | null {
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0) return vb[2];
  const mw = /max-width:\s*([\d.]+)px/.exec(svg.getAttribute('style') ?? '');
  if (mw && Number(mw[1]) > 0) return Number(mw[1]);
  const w = svg.getAttribute('width') ?? '';
  if (/^[\d.]+(px)?$/.test(w) && parseFloat(w) > 0) return parseFloat(w);
  return null;
}

// Size a freshly inserted diagram: fluid up to its natural width, but
// never narrower than MIN_DIAGRAM_SCALE of it. When even that doesn't
// fit the column, the svg overflows its block, which scrolls
// horizontally (.mermaid-block / .mermaid-rendered have overflow-x).
export function applyDiagramSizing(svg: SVGSVGElement): void {
  const natural = naturalWidth(svg);
  if (!natural) return;
  svg.style.minWidth = `${Math.round(natural * MIN_DIAGRAM_SCALE)}px`;
  if (!svg.style.maxWidth) svg.style.maxWidth = `${Math.round(natural * 1000) / 1000}px`;
}

function undoShortcut(): string {
  const platform =
    typeof navigator !== 'undefined' ? navigator.platform || navigator.userAgent : '';
  return /Mac|iPhone|iPad/i.test(platform) ? '⌘+Z' : 'Ctrl+Z';
}

// What a reader sees in place of a diagram mermaid can't draw: plain
// words up front, mermaid's parser output tucked into a collapsed
// <details> for whoever wants it.
export function buildDiagramError(
  technical: string,
  opts: { undoHint?: boolean } = {},
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'mermaid-error';
  box.setAttribute('role', 'note');

  const title = document.createElement('p');
  title.className = 'mermaid-error-title';
  title.textContent = "This diagram couldn't be displayed.";
  box.appendChild(title);

  if (opts.undoHint) {
    const hint = document.createElement('p');
    hint.className = 'mermaid-error-hint';
    hint.textContent = `Press ${undoShortcut()} to undo the last change.`;
    box.appendChild(hint);
  }

  const details = document.createElement('details');
  details.className = 'mermaid-error-details';
  const summary = document.createElement('summary');
  summary.textContent = 'Technical details';
  const pre = document.createElement('pre');
  pre.textContent = technical;
  details.appendChild(summary);
  details.appendChild(pre);
  box.appendChild(details);
  return box;
}
