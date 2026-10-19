// Oracle helpers for the pie / gantt / timeline tests, on top of
// mermaid-test-utils:
//   - oracleDb: mermaid's db for a source the way render() builds it —
//     including the frontmatter title render() passes in (mermaidDb's
//     getDiagramFromText drops it)
//   - oracleText: a db string as the reader sees it. render() turns
//     `#59;` into a placeholder before parsing and the placeholder into
//     an HTML entity after drawing; the svg then collapses whitespace.
//   - renderText: the real thing — render in jsdom and read the svg
import mermaid from 'mermaid';
import { mermaidDb } from './mermaid-test-utils';
import { findPreamble } from '../../../src/lib/editor/mermaid/source-text';

export const EXTRA_CORPUS = 'mermaid-corpus-pie-gantt-timeline.md';

// jsdom has no svg layout; mermaid's renderers need these.
const proto = SVGElement.prototype as unknown as Record<string, unknown>;
proto.getBBox ??= () => ({ x: 0, y: 0, width: 10, height: 10 });
proto.getComputedTextLength ??= () => 10;

function decodeHtmlEntity(name: string): string {
  const el = document.createElement('textarea');
  el.innerHTML = `&${name};`;
  return el.value;
}

export function oracleText(dbText: string): string {
  return String(dbText ?? '')
    .replace(/ﬂ°°(\d+)¶ß/g, (_, n: string) => decodeHtmlEntity(`#${n}`))
    .replace(/ﬂ°(\w+)¶ß/g, (_, n: string) => decodeHtmlEntity(n))
    .replace(/[ \t\n\r\f]+/g, ' ')
    .trim();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function oracleDb(source: string): Promise<{ db: any; title: string }> {
  const fm = findPreamble(source.split(/\r?\n/)).frontmatter?.title?.value;
  const { db } = await mermaidDb(source);
  if (fm) {
    // getDiagramFromText(text, { title }) is what render() calls; replay
    // it so a frontmatter title is set before the body is parsed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = await (mermaid as any).mermaidAPI.getDiagramFromText(source, { title: fm });
    return { db: d.db, title: oracleText(titleOf(d.db)) };
  }
  return { db, title: oracleText(titleOf(db)) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function titleOf(db: any): string {
  return db.getDiagramTitle?.() ?? db.getCommonDb?.().getDiagramTitle() ?? '';
}

let renderCount = 0;

// Render `source` in jsdom (strict security, as the app does) and parse
// the svg the way the app inserts it.
export async function renderSvg(source: string): Promise<SVGSVGElement> {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  const id = `oracle${renderCount++}`;
  const { svg } = await mermaid.render(id, source);
  const host = document.createElement('div');
  host.innerHTML = svg;
  return host.querySelector('svg')!;
}

// Displayed text of an svg element: wrapped lines (tspans) read as one
// line, whitespace collapsed.
export function shownText(el: Element | null | undefined): string {
  if (!el) return '';
  const spans = Array.from(el.querySelectorAll('tspan'));
  const raw = spans.length ? spans.map((t) => t.textContent ?? '').join(' ') : el.textContent ?? '';
  return raw.replace(/[ \t\n\r\f]+/g, ' ').trim();
}
