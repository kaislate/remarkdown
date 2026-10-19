// Parser for mermaid pie charts — the full syntax mermaid 11 accepts
// (its langium grammar, @mermaid-js/parser pie.langium):
//
//   pie [showData] [title …]
//     title …                       (TITLE: up to a `%%`, spaces collapsed)
//     accTitle: … / accDescr: … / accDescr { … }
//     "Label" : 42.5                (STRING: "…" or '…' with \-escapes)
//   plus blank lines, `%%` comments, `%%{init}%%` directives, frontmatter.
//
// Model text is what mermaid displays: escapes and `#name;` entity
// codes decoded, whitespace collapsed. mermaid keeps one slice per label
// (the first; later ones with the same label are ignored), so the model
// does too; the map remembers the ignored lines as `duplicates` so edits
// keep them in step with their slice.
//
// Bails (ok:false) on what mermaid rejects (negative values, `01`, bare
// labels …) and on one valid-but-odd layout: a slice on the header line.
import { findPreamble, isBlank, type Span } from './source-text';
import { displayText } from './display-text';
import { frontmatterTitleText, type TitleStatement } from './title-edit';

export interface PieSlice {
  label: string;
  value: number;
}

export interface PieModel {
  // '' when the chart has none.
  title: string;
  // `pie showData`: values are shown next to the legend labels.
  showData: boolean;
  // In source (= drawing) order. mermaid does not sort slices.
  slices: PieSlice[];
}

export interface PieSliceSource {
  line: number;
  // The quoted label, quotes included.
  label: Span;
  value: Span;
  // Lines of later slices with the same label (ignored by mermaid).
  duplicates: number[];
}

export interface PieSourceMap {
  lines: string[];
  eol: string;
  headerLine: number;
  // Column just past `pie` (where ` showData` goes).
  pieEnd: number;
  // ` showData` (with the whitespace before it) on the header line.
  showData: Span | null;
  // Body title statements in order (the last one is shown).
  titles: TitleStatement[];
  slices: PieSliceSource[];
}

export type PieSourceParseResult =
  | { ok: true; model: PieModel; map: PieSourceMap }
  | { ok: false; reason: string };

export type PieParseResult = { ok: true; model: PieModel } | { ok: false; reason: string };

export const PIE_STARTER = ['pie', '    title Favourite fruit', '    "Apples" : 42', '    "Bananas" : 30', '    "Cherries" : 18', ''].join('\n');

// The grammar's terminals, anchored at a position.
const STRING_SRC = `"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'`;
const NUMBER_SRC = '-?(?:[0-9]+\\.[0-9]+(?!\\.)|(?:0|[1-9][0-9]*)(?!\\.))';
// Groups: 1 indent, 2 label, 3 value.
const SLICE_RE = new RegExp(`^([\\t ]*)(${STRING_SRC})[\\t ]*:[\\t ]*(${NUMBER_SRC})[\\t ]*(?:%%.*)?$`);
// TITLE: `title` then text up to a `%%` (or the line end), or nothing.
// Groups: 1 lead-in through `title`, 2 text.
const TITLE_RE = /^([\t ]*title)(?:[\t ]((?:(?!%%)[^\n\r])*)|(?=%%|[\t ]*$))/;
const HEADER_RE = /^([\t ]*pie)(?:([\t ]+)(showData))?(?=[\t ]|%%|$)/;
const COMMENT_TAIL = /^[\t ]*(?:%%.*)?$/;

// langium's STRING value converter: strip the quotes, resolve escapes.
const ESCAPES: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '0': '\0' };
function unquote(token: string): string {
  let out = '';
  for (let i = 1; i < token.length - 1; i++) {
    const c = token[i];
    if (c === '\\') {
      const n = token[++i];
      out += ESCAPES[n] ?? n;
    } else out += c;
  }
  return out;
}

// A title statement at the start of `rest` (an offset into a line).
function readTitle(line: string, from: number): { stmt: TitleStatement; text: string } | null {
  const m = TITLE_RE.exec(line.slice(from));
  if (!m) return null;
  const valueStart = from + m[1].length + (m[2] !== undefined ? 1 : 0);
  const raw = m[2] ?? '';
  const end = from + m[0].length;
  if (!COMMENT_TAIL.test(line.slice(end))) return null;
  // The span covers the text up to a `%%` comment, trailing spaces excluded.
  const value = { start: valueStart, end: valueStart + raw.trimEnd().length };
  return { stmt: { line: -1, value, cut: null }, text: displayText(raw) };
}

export function parsePieSource(source: string): PieSourceParseResult {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const { frontmatter, headerLine } = findPreamble(lines);
  if (headerLine < 0) return { ok: false, reason: 'empty source' };
  const header = HEADER_RE.exec(lines[headerLine]);
  if (!header) return { ok: false, reason: `not a pie chart: ${lines[headerLine].trim()}` };

  let title = frontmatter?.title ? frontmatterTitleText(frontmatter.title.value) : '';
  const titles: TitleStatement[] = [];
  const pieEnd = header[1].length;
  const showData = header[3] ? { start: pieEnd, end: header[0].length } : null;

  // The rest of the header line: nothing, a comment, or a title.
  const tailStart = header[0].length;
  const tail = lines[headerLine].slice(tailStart);
  if (!COMMENT_TAIL.test(tail)) {
    const lead = /^[\t ]*/.exec(tail)![0].length;
    const t = readTitle(lines[headerLine], tailStart + lead);
    if (!t) return { ok: false, reason: `unsupported header: ${lines[headerLine].trim()}` };
    titles.push({ line: headerLine, value: t.stmt.value, cut: { start: tailStart, end: t.stmt.value.end } });
    title = t.text;
  }

  const slices: PieSlice[] = [];
  const sliceMap: PieSliceSource[] = [];
  const byKey = new Map<string, number>();

  for (let i = headerLine + 1; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (isBlank(line)) continue;
    if (t.startsWith('%%{') && !t.includes('}%%')) {
      // A multi-line init directive: skip to its end.
      while (i < lines.length && !lines[i].includes('}%%')) i++;
      continue;
    }
    if (t.startsWith('%%')) continue;
    if (/^accTitle[\t ]*:/.test(t)) continue;
    if (/^accDescr[\t ]*:/.test(t)) continue;
    if (/^accDescr\s*\{/.test(t)) {
      while (i < lines.length && !lines[i].includes('}')) i++;
      if (i >= lines.length) return { ok: false, reason: 'unterminated accDescr' };
      continue;
    }
    const tm = readTitle(line, 0);
    if (tm) {
      titles.push({ ...tm.stmt, line: i });
      title = tm.text;
      continue;
    }
    const sm = SLICE_RE.exec(line);
    if (sm) {
      const value = Number(sm[3]);
      if (value < 0) return { ok: false, reason: `negative value: ${t}` };
      const key = unquote(sm[2]);
      const labelStart = sm[1].length;
      const valueStart = line.indexOf(sm[3], labelStart + sm[2].length);
      const seen = byKey.get(key);
      if (seen !== undefined) {
        sliceMap[seen].duplicates.push(i);
        continue;
      }
      byKey.set(key, slices.length);
      slices.push({ label: displayText(key), value });
      sliceMap.push({
        line: i,
        label: { start: labelStart, end: labelStart + sm[2].length },
        value: { start: valueStart, end: valueStart + sm[3].length },
        duplicates: [],
      });
      continue;
    }
    return { ok: false, reason: `unparseable line: ${t}` };
  }

  return {
    ok: true,
    model: { title, showData: !!showData, slices },
    map: { lines, eol, headerLine, pieEnd, showData, titles, slices: sliceMap },
  };
}

export function parsePie(source: string): PieParseResult {
  const r = parsePieSource(source);
  return r.ok ? { ok: true, model: r.model } : r;
}
