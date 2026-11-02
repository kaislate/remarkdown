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
import { formatShortcut } from './shortcuts';
import { detectDiagramType, type MermaidDiagramType } from './editor/mermaid-detect';

type Mermaid = typeof import('mermaid').default;

export type AppTheme = 'dark' | 'light';

export interface MermaidRenderContext {
  theme: AppTheme;
  // CSS font-family list the diagram text is measured AND drawn with.
  // Pass the font of the surface the diagram sits in (the article or
  // the editor) so labels match the surrounding text.
  fontFamily: string;
}

// `transient` marks failures that say nothing about the diagram itself
// (mermaid didn't load, the render timed out): they aren't cached, and
// callers should try again on their next pass.
export type MermaidRenderOutcome =
  | { ok: true; svg: string }
  | { ok: false; error: string; transient?: true };

// A render that hasn't settled after this long is abandoned so it can't
// stall every other diagram in the app (renders are serialized).
const RENDER_TIMEOUT_MS = 20_000;
let renderTimeoutMs = RENDER_TIMEOUT_MS;

class RenderTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RenderTimeout(`Drawing the diagram took longer than ${ms / 1000}s.`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

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

// Before it lexes anything, mermaid's encodeEntities runs
// /style.*:\S*#.*;/g and the same with classDef over the source. Where
// it can't match, that regex tries every keyword × `:` × `#` on the
// line: one crafted 2 KB line held the UI thread for seconds, and no
// timeout stops synchronous work. This bounds, in one pass per line,
// the steps it would take (measured: a million or more per ms), so a
// render that would hang is turned away before mermaid sees it. Lines
// people write come out far below the limit. The lines are summed, as
// mermaid runs the regex over all of them: a hundred lines each under
// the limit took seconds together.
const STYLE_WORK_LIMIT = 1e8;

export function styleRegexWork(source: string): number {
  let work = 0;
  for (const line of source.split(/[\n\r\u2028\u2029]/)) {
    const len = line.length;
    for (const keyword of ['style', 'classDef']) {
      const first = line.indexOf(keyword);
      if (first < 0) continue;
      const semi = line.lastIndexOf(';');
      let starts = 0;
      let startsAfterSemi = 0;
      for (let i = first; i >= 0; i = line.indexOf(keyword, i + 1)) {
        starts++;
        if (i > semi) startsAfterSemi++;
      }
      // From the end of the line, as the regex backtracks: each `:`
      // costs its run of non-spaces, plus a scan to the end of the line
      // for each `#` in that run, until one whose run holds a `#`
      // before the last `;` (where the match succeeds). That one still
      // tries the `#`s after the `;` first, each scanning to the end.
      let perStart = len;
      let tail = 0;
      let runEnd = len;
      let hashes = 0;
      let hashesAfterSemi = 0;
      let firstHash = Infinity;
      let matched = false;
      for (let p = len - 1; p >= first + keyword.length; p--) {
        const c = line[p];
        if (p === semi) tail = perStart - len;
        if (c === ':') {
          if (firstHash < semi) {
            perStart += runEnd - p + hashesAfterSemi * len;
            matched = true;
            break;
          }
          perStart += runEnd - p + hashes * len;
        }
        if (/\s/.test(c)) {
          runEnd = p;
          hashes = 0;
          hashesAfterSemi = 0;
          firstHash = Infinity;
        } else if (c === '#') {
          hashes++;
          if (p > semi) hashesAfterSemi++;
          firstHash = p;
        }
      }
      if (semi < first + keyword.length) tail = perStart - len;
      // A match ends at the last `;`; every keyword after it fails
      // against what follows. Without a match every keyword fails.
      work += matched ? perStart + startsAfterSemi * tail : starts * perStart;
    }
  }
  return work;
}

// Two more of mermaid's passes run on every source, before its size
// limit, and can be made just as slow (measured: 40 KB took 5 to 30 s):
//   - cleanupText's /<(\w+)([^>]*)>/g splits a `<word` that has no `>`
//     anywhere after it between `\w+` and `[^>]*` every way, each split
//     scanning to the end (a `<word` before some `>` matches at once);
//   - cleanupComments' /^\s*%%(?!{)[^\n]+\n?/gm, from every line start
//     in a run of blank lines that doesn't end in a comment, scans to
//     the end of the run and back.
// The limits are set from the slowest rates measured (about ten
// thousand steps per ms for indented blank lines), so neither pass runs
// much past half a second; a diagram needs a thousand blank lines in a
// row, or a `<word` thousands of characters long, to come near them.
const TAG_WORK_LIMIT = 5e7;
const COMMENT_WORK_LIMIT = 5e6;

export function tagRegexWork(source: string): number {
  let work = 0;
  const word = /<(\w+)/g;
  word.lastIndex = source.lastIndexOf('>') + 1;
  for (let m = word.exec(source); m; m = word.exec(source)) work += m[1].length * (source.length - m.index);
  return work;
}

export function commentRegexWork(source: string): number {
  let work = 0;
  for (const run of source.matchAll(/\s+/g)) {
    const start = run.index!;
    const end = start + run[0].length;
    // Line starts inside the run: its start (at the top of the source),
    // and the character after each line break in it.
    if (start === 0) work += 2 * end;
    for (let i = start; i < end; i++) {
      if ('\n\r\u2028\u2029'.includes(source[i])) work += 2 * (end - i - 1);
    }
  }
  return work;
}

// And two more in class diagrams, once mermaid reads the members:
//   - each member holding a `)` goes through
//     /([#+~-])?(.+)\((.*)\)([\s$*])?(.*)([$*])?/, which isn't anchored:
//     where it can't match, it runs `.+` to the end of the line and back
//     from every start, and `(.*)` from every `(` (2 KB took seconds);
//   - parseGenericTypes turns `~` pairs into `<…>`, looking for the
//     first and last `~` from scratch for each pair (it also runs on ER
//     entity names; 40 KB of `~` took seconds).
// Both are weighed per line, as if the whole line were one member (no
// member is longer, and none costs more), and summed. A line piece with
// a `(` after its first character and before its last `)` matches from
// its first start, after `.+` backs up past the `(`s that follow that
// `)` (twice: with and without the leading visibility mark), so it costs
// that much and not the full failure: long notes with parentheses in
// them are drawn as fast as any other text. Rates
// measured: about 150,000 steps per ms for the first, 500,000 for the
// second, so neither runs past about a third of a second.
const METHOD_WORK_LIMIT = 5e7;
const GENERIC_WORK_LIMIT = 1e8;

export function methodRegexWork(source: string): number {
  if (detectDiagramType(source) !== 'class') return 0;
  let work = 0;
  for (const line of source.split('\n')) {
    if (!line.includes(')')) continue;
    for (const piece of line.split(/[\r\u2028\u2029]/)) {
      const len = piece.length;
      const close = piece.lastIndexOf(')');
      const open = piece.indexOf('(', 1);
      if (open >= 0 && open < close) {
        let tries = len;
        for (let p = piece.indexOf('(', close); p >= 0; p = piece.indexOf('(', p + 1)) tries += len - p;
        work += 2 * tries;
        continue;
      }
      work += (len * (len + 1)) / 2;
      for (let p = piece.indexOf('('); p >= 0; p = piece.indexOf('(', p + 1)) work += p * (len - p);
    }
  }
  return work;
}

// And one in mermaid's lexers: the flowchart one, and the
// /\s*%%.*\n/gm detectType runs for every diagram, read a run of
// whitespace again from each character in it (measured: 8,000 spaces in
// a row took the flowchart parser 2 s, about 30,000 steps per ms). The
// limit lets through runs of a few thousand, far more than any
// indentation or blank space a diagram has.
const WHITESPACE_WORK_LIMIT = 1e7;

export function whitespaceWork(source: string): number {
  let work = 0;
  for (const run of source.matchAll(/\s+/g)) work += run[0].length ** 2;
  return work;
}

export function genericTypesWork(source: string): number {
  let work = 0;
  for (const line of source.split('\n')) {
    const tildes = line.split('~').length - 1;
    if (tildes > 1) work += tildes * line.length;
  }
  return work;
}

// The passes above, except the tag one, run on the source after
// mermaid's preprocessDiagram has turned CRLF into LF, cut off the
// frontmatter and dropped every `%%{…}%%` directive. A directive can
// hold a newline, so dropping it joins the lines around it: short style
// lines split by directives reached the style regex as one 1.8 KB line
// (2.3 s). So they are weighed on that text, made with mermaid's own
// regexes (mermaid 11.14, src/diagram-api/regexes.ts). Its last step,
// dropping `%%` comment lines, takes out whole lines and joins none, so
// it is left out: a comment line is only weighed as if it stayed.
//
// The frontmatter regex is slow itself where `---` is followed by many
// line breaks and no closing `---`: it reads the rest of the source once
// for each of them (measured: about three million steps per ms). mermaid
// runs it on every source, before its size limit, so such a source is
// turned away before either of us runs it.
const FRONT_MATTER_WORK_LIMIT = 1e9;

export function frontMatterWork(source: string): number {
  if (!source.startsWith('---')) return 0;
  let breaks = 0;
  for (let i = 3; i < source.length && /\s/.test(source[i]); i++) {
    if (source[i] === '\n' || source[i] === '\r') breaks++;
  }
  return breaks * source.length;
}

const frontMatterRegex = /^-{3}\s*[\n\r](.*?)[\n\r]-{3}\s*[\n\r]+/s;
const directiveRegex = /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;

export function textMermaidSees(source: string): string {
  return source.replace(/\r\n?/g, '\n').replace(frontMatterRegex, '').replace(directiveRegex, '');
}

// Before the directives are dropped (and before the size limit),
// mermaid's detectDirective strips `%%` comments with a regex whose
// lookahead reads a directive's body from each `%%{word`: on to the
// next `}%%`, or to the end of the source when there is none (measured:
// 80 KB of unclosed `%%{a` took 4.5 s, about 150,000 steps per ms).
// Closed directives, the only kind people write, cost their own length.
const DIRECTIVE_WORK_LIMIT = 5e7;

export function directiveWork(source: string): number {
  let work = 0;
  let close = -1;
  for (const m of source.matchAll(/%%\{\s*\w/g)) {
    if (close !== Infinity && close < m.index!) {
      const next = source.indexOf('}%%', m.index!);
      close = next < 0 ? Infinity : next;
    }
    work += Math.min(close, source.length) - m.index!;
  }
  return work;
}

// mermaid's lexers and parsers have more slow spots than the regexes
// weighed above, too many to weigh one by one, so the shape of the text
// is weighed too, three ways (rates measured on mermaid 11.14):
//   - each run of non-spaces, squared: the flowchart lexer, among
//     others, reads the rest of the run again for each token in it
//     (20,000 `#` took 5.8 s; the slowest rate, about 40,000 steps per
//     ms, was a block diagram's);
//   - each line's tokens times its length, in the diagrams whose lexers
//     read the rest of the line again for each token (16 KB of `a ` in
//     a block diagram took 5 s; about 40,000 per ms);
//   - all the tokens times all the lines, in the diagrams whose parsers
//     copy their whole stack at each step, a stack one or two entries
//     deeper for each line not yet reduced (8,000 lines of `a` took a
//     class diagram 16 s; about 10,000 per ms near the limit), and in
//     the two (kanban, mindmap) that, linear or not, spend a third of a
//     millisecond on each line (10,000 items took 3 s).
// A quoted string counts as one token, as the lexers read it. Diagram
// types not listed for the last two, and found linear there, are not
// weighed by them: a sequence diagram's message is read as one token,
// however many words it has. A diagram near any limit is far bigger
// than people write: hundreds of classes, or a word thousands of
// characters long. Each limit holds mermaid's parse to well under a
// second.
const RUN_WORK_LIMIT = 2e7;
const LINE_TOKEN_WORK_LIMIT = 2e7;
const STACK_WORK_LIMIT = 8e6;
const UNKNOWN: MermaidDiagramType = 'unsupported';
const LINE_TOKEN_TYPES = new Set<MermaidDiagramType>(['class', 'state', 'er', 'block', 'architecture', 'pie', UNKNOWN]);
const STACK_TYPES = new Set<MermaidDiagramType>(['class', 'state', 'block', 'architecture', 'radar', 'packet', 'pie', 'gitgraph', 'requirement', 'kanban', 'mindmap', UNKNOWN]);

export function runWork(source: string): number {
  let work = 0;
  for (const run of source.matchAll(/\S+/g)) work += run[0].length ** 2;
  return work;
}

// Tokens per line, and each line's length.
function lineTokens(source: string): Array<[number, number]> {
  const lines: Array<[number, number]> = [];
  let tokens = 0;
  let start = 0;
  for (const m of source.matchAll(/"[^"\n]*"|\w+|[^\w\s]|\n/g)) {
    tokens++;
    if (m[0] === '\n') {
      lines.push([tokens, m.index! - start]);
      tokens = 0;
      start = m.index! + 1;
    }
  }
  lines.push([tokens, source.length - start]);
  return lines;
}

export function lineTokenWork(source: string): number {
  if (!LINE_TOKEN_TYPES.has(detectDiagramType(source))) return 0;
  let work = 0;
  for (const [tokens, len] of lineTokens(source)) work += tokens * len;
  return work;
}

export function stackWork(source: string): number {
  if (!STACK_TYPES.has(detectDiagramType(source))) return 0;
  const lines = lineTokens(source);
  let tokens = 0;
  for (const [t] of lines) tokens += t;
  return tokens * lines.length;
}

// mermaid draws its own "too big" notice instead of any text longer
// than this (it can't be raised from inside a diagram), once comments
// are dropped too, so what it would do with such text isn't weighed.
const MAX_TEXT_SIZE = 50_000;
// And a source many times that size is turned away outright: every pass
// mermaid makes before that limit reads all of it.
const MAX_SOURCE_SIZE = 200_000;

// Why mermaid would hang on `source`, if it would.
function tooSlowToRead(source: string): string | null {
  const tangled = 'This diagram is too long and tangled to read.';
  if (source.length > MAX_SOURCE_SIZE) return 'This diagram is too long to read.';
  if (frontMatterWork(source) > FRONT_MATTER_WORK_LIMIT) return tangled;
  const directives = source.replace(/\r\n?/g, '\n').replace(frontMatterRegex, '');
  if (directiveWork(directives) > DIRECTIVE_WORK_LIMIT) return tangled;
  const seen = textMermaidSees(source);
  if (styleRegexWork(seen) > STYLE_WORK_LIMIT) return 'A style line in this diagram is too long and tangled to read.';
  if (
    tagRegexWork(source) > TAG_WORK_LIMIT ||
    commentRegexWork(seen) > COMMENT_WORK_LIMIT ||
    whitespaceWork(seen) > WHITESPACE_WORK_LIMIT ||
    methodRegexWork(seen) > METHOD_WORK_LIMIT ||
    genericTypesWork(seen) > GENERIC_WORK_LIMIT
  ) return tangled;
  // mermaid's cleanupComments, safe to run once commentRegexWork passed.
  const code = seen.replace(/^\s*%%(?!{)[^\n]+\n?/gm, '').trimStart();
  if (code.length > MAX_TEXT_SIZE) return null;
  return runWork(code) > RUN_WORK_LIMIT ||
    lineTokenWork(code) > LINE_TOKEN_WORK_LIMIT ||
    stackWork(code) > STACK_WORK_LIMIT
    ? tangled
    : null;
}

async function renderNow(
  source: string,
  ctx: MermaidRenderContext,
  key: string,
): Promise<MermaidRenderOutcome> {
  // A job queued behind an identical one finds the result already here.
  const cached = cache.get(key);
  if (cached) return rekey(cached);

  const tooSlow = tooSlowToRead(source);
  if (tooSlow) {
    const entry: CacheEntry = { outcome: { ok: false, error: tooSlow }, id: nextId() };
    remember(key, entry);
    return entry.outcome;
  }

  let m: Mermaid;
  try {
    m = await loadMermaid();
  } catch (err) {
    // Not cached: the diagram isn't broken, mermaid just didn't load.
    return { ok: false, error: errorMessage(err), transient: true };
  }
  const id = nextId();
  let entry: CacheEntry;
  // mermaid.render() funnels every call through mermaid's own execution
  // queue, and a call that never settles blocks that queue for good —
  // every later render would hang too, timeout or not. Renders are
  // already serialized here, so go to mermaidAPI.render directly (the
  // same function mermaid.render queues).
  const api = (m as unknown as { mermaidAPI?: { render?: Mermaid['render'] } }).mermaidAPI;
  const render: Mermaid['render'] = api?.render ? api.render.bind(api) : m.render.bind(m);
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
    const { svg } = await withTimeout(render(id, source), renderTimeoutMs);
    entry = { outcome: { ok: true, svg }, id };
  } catch (err) {
    // Not cached (`finally` still cleans up): a timeout says nothing
    // about the diagram.
    if (err instanceof RenderTimeout) return { ok: false, error: err.message, transient: true };
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

// null restores the default.
export function setMermaidRenderTimeoutForTests(ms: number | null): void {
  renderTimeoutMs = ms ?? RENDER_TIMEOUT_MS;
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
    hint.textContent = `Press ${formatShortcut('Ctrl+Z')} to undo the last change.`;
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
