// Shared pieces for the "data" diagram types — journey, quadrant, XY
// chart, Sankey, packet, radar — whose content is a list of rows: one
// statement per line, edited in a table (data-controller.ts). Like every
// diagram edit (see source-text.ts) an edit rewrites only the lines it is
// about; comments, directives, blank lines and the rest stay as written.

import { splitLines, joinLines, findPreamble, isBlankOrComment, indentOf, DEFAULT_INDENT } from './source-text';

// A source's lines, edited one change at a time.
export class LineEditor {
  private readonly src: ReturnType<typeof splitLines>;
  readonly lines: string[];
  constructor(source: string) {
    this.src = splitLines(source);
    this.lines = [...this.src.lines];
  }
  set(i: number, text: string): this {
    this.lines[i] = text;
    return this;
  }
  insert(i: number, ...texts: string[]): this {
    this.lines.splice(i, 0, ...texts);
    return this;
  }
  remove(i: number, count = 1): this {
    this.lines.splice(i, count);
    return this;
  }
  // Swaps two lines' statements, each line keeping its indentation.
  swap(a: number, b: number): this {
    const ta = this.lines[a].trim();
    this.lines[a] = indentOf(this.lines[a]) + this.lines[b].trim();
    this.lines[b] = indentOf(this.lines[b]) + ta;
    return this;
  }
  toString(): string {
    return joinLines(this.src, this.lines);
  }
}

// The diagram's statements after its header: [line index, trimmed text],
// skipping blank lines and comments. null when there's no header.
export function statements(source: string, header: RegExp): { header: number; lines: string[]; items: Array<[number, string]> } | null {
  const lines = splitLines(source).lines;
  const { headerLine } = findPreamble(lines);
  if (headerLine < 0 || !header.test(lines[headerLine].trim())) return null;
  const items: Array<[number, string]> = [];
  for (let i = headerLine + 1; i < lines.length; i++) {
    if (!isBlankOrComment(lines[i])) items.push([i, lines[i].trim()]);
  }
  return { header: headerLine, lines, items };
}

// Indentation for a new statement line: the nearest statement's, else
// the default.
export function indentNear(lines: string[], line: number, header: number): string {
  for (let i = line; i > header; i--) {
    if (lines[i] !== undefined && !isBlankOrComment(lines[i])) return indentOf(lines[i]);
  }
  return DEFAULT_INDENT;
}

// Where a statement goes when it's added after `after` (a line index):
// right after it, or after the header when there's nothing.
export function lineAfter(after: number | null, header: number): number {
  return (after ?? header) + 1;
}

// Splits `a, "b, c", d` on top-level commas, unquoting "…" items; null
// when the quoting doesn't make sense.
export function splitList(text: string): string[] | null {
  if (!text.trim()) return [];
  const out: string[] = [];
  const n = text.length;
  let i = 0;
  const skipSpace = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };
  for (;;) {
    skipSpace();
    if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) return null;
      out.push(text.slice(i + 1, end));
      i = end + 1;
      skipSpace();
    } else {
      const comma = text.indexOf(',', i);
      const stop = comma < 0 ? n : comma;
      const item = text.slice(i, stop).trim();
      if (item.includes('"')) return null;
      out.push(item);
      i = stop;
    }
    if (i >= n) return out;
    if (text[i] !== ',') return null;
    i++;
  }
}

// A label as a list item: bare when it's a plain word, else quoted (a
// double quote inside becomes a single one — the diagram can't hold it).
export function listItem(label: string): string {
  const t = label.replace(/\r?\n/g, ' ').trim();
  return /^[\p{L}\p{N}_.-]+$/u.test(t) ? t : `"${t.replace(/"/g, "'")}"`;
}

export function numberList(values: number[]): string {
  return values.map((v) => formatNumber(v)).join(', ');
}

export function formatNumber(v: number): string {
  return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '0';
}

export function parseNumber(t: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(t.trim())) return null;
  return Number(t);
}

// Moves item `from` to `to` in a copy of `items`.
export function moved<T>(items: T[], from: number, to: number): T[] {
  const copy = [...items];
  const [it] = copy.splice(from, 1);
  copy.splice(to, 0, it);
  return copy;
}

// A free name like "Task 3" that isn't in `taken`.
export function freeName(base: string, taken: string[]): string {
  const set = new Set(taken.map((t) => t.toLowerCase()));
  for (let n = taken.length + 1; ; n++) if (!set.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}
