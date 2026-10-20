// Line-level helpers shared by the per-diagram-type parsers and edit
// engines (src/lib/editor/mermaid/*-parser.ts / *-edit.ts).
//
// Every visual edit follows the rule set by mermaid-flowchart-edit.ts:
// change ONLY the source text the edit is about. Lines an edit does not
// semantically touch — `%%` comments, `%%{init}%%` directives, YAML
// frontmatter, blank lines, ordering, indentation, spelling — stay
// byte-identical. These helpers give each engine the same view of a
// source: its lines, its line separator, where the frontmatter ends and
// where the diagram's header (`pie`, `gantt`, `stateDiagram-v2`, …) is.

// Column range [start, end) within one source line.
export interface Span {
  start: number;
  end: number;
}

export interface SourceLines {
  lines: string[];
  // Line separator of the source ('\n' or '\r\n'), reused on output.
  eol: string;
}

export function splitLines(source: string): SourceLines {
  return { lines: source.split(/\r?\n/), eol: source.includes('\r\n') ? '\r\n' : '\n' };
}

export function joinLines(src: SourceLines, lines: string[] = src.lines): string {
  return lines.join(src.eol);
}

export function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

// `%% comment` and `%%{init: …}%%` directive lines. Both are invisible
// to every diagram type and are never rewritten by an edit.
export function isComment(line: string): boolean {
  return line.trim().startsWith('%%');
}

export function isBlankOrComment(line: string): boolean {
  return isBlank(line) || isComment(line);
}

export function indentOf(line: string): string {
  return /^\s*/.exec(line)![0];
}

export function replaceSpan(line: string, span: Span, text: string): string {
  return line.slice(0, span.start) + text + line.slice(span.end);
}

// YAML frontmatter (`---` … `---`) at the very top of a diagram. Only
// `title:` is understood (and editable); every other key is kept as is.
export interface Frontmatter {
  startLine: number;
  endLine: number;
  // The `title:` line and the span of its value, when there is one.
  title: { line: number; span: Span; value: string } | null;
}

export interface DiagramPreamble {
  frontmatter: Frontmatter | null;
  // First line that is not frontmatter, blank or a comment — the
  // diagram's header (`pie showData`, `gantt`, …). -1 for an empty source.
  headerLine: number;
}

function unquoteYaml(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t[0] === '"' && t.endsWith('"')) {
    try {
      return String(JSON.parse(t));
    } catch {
      return t.slice(1, -1);
    }
  }
  if (t.length >= 2 && t[0] === "'" && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

export function findPreamble(lines: string[]): DiagramPreamble {
  let i = 0;
  let frontmatter: Frontmatter | null = null;
  // mermaid only accepts frontmatter as the first thing in the source.
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === '---');
    if (end > 0) {
      let title: Frontmatter['title'] = null;
      for (let k = 1; k < end; k++) {
        const m = /^(\s*title\s*:\s*)(.*?)\s*$/.exec(lines[k]);
        if (m) {
          title = { line: k, span: { start: m[1].length, end: m[1].length + m[2].length }, value: unquoteYaml(m[2]) };
        }
      }
      frontmatter = { startLine: 0, endLine: end, title };
      i = end + 1;
    }
  }
  while (i < lines.length && isBlankOrComment(lines[i])) i++;
  return { frontmatter, headerLine: i < lines.length ? i : -1 };
}

// A frontmatter title value, quoted so YAML reads it back verbatim.
export function emitYamlString(text: string): string {
  const flat = text.replace(/\r\n|\r|\n/g, ' ');
  // Plain scalars only for text that starts with a letter/digit and
  // holds nothing YAML gives meaning to; everything else is quoted.
  return /^[\p{L}\p{N}][\p{L}\p{N} ()&,.!?'-]*$/u.test(flat) && flat.trim() === flat
    ? flat
    : JSON.stringify(flat);
}

// Set (or add, or remove when `title` is empty) the frontmatter title.
// Works for every diagram type: the frontmatter is the same everywhere.
export function setFrontmatterTitle(source: string, title: string): string {
  const src = splitLines(source);
  const lines = [...src.lines];
  const { frontmatter } = findPreamble(lines);
  if (frontmatter?.title) {
    const t = frontmatter.title;
    if (title === '') {
      lines.splice(t.line, 1);
      // An empty frontmatter block goes with its only key.
      if (frontmatter.endLine - frontmatter.startLine === 2) lines.splice(frontmatter.startLine, 2);
    } else {
      lines[t.line] = replaceSpan(lines[t.line], t.span, emitYamlString(title));
    }
  } else if (title !== '') {
    if (frontmatter) lines.splice(frontmatter.startLine + 1, 0, `title: ${emitYamlString(title)}`);
    else lines.unshift('---', `title: ${emitYamlString(title)}`, '---');
  }
  return joinLines(src, lines);
}

// Indentation for a statement inserted after `line`: copy it from the
// nearest statement line at or above it, else use the default.
export const DEFAULT_INDENT = '    ';

export function indentFor(lines: string[], line: number, headerLine: number): string {
  for (let k = line; k > headerLine; k--) {
    if (!isBlankOrComment(lines[k])) return indentOf(lines[k]);
  }
  for (let k = headerLine + 1; k < lines.length; k++) {
    if (!isBlankOrComment(lines[k])) return indentOf(lines[k]);
  }
  return DEFAULT_INDENT;
}

// Last non-blank, non-comment line at or after `from` (the header when
// the body is empty) — where appended statements go, so trailing
// comments stay trailing.
export function lastStatementLine(lines: string[], headerLine: number): number {
  for (let k = lines.length - 1; k > headerLine; k--) {
    if (!isBlankOrComment(lines[k])) return k;
  }
  return headerLine;
}

// Next free id of the form prefix + 1, 2, 3 … (or A, B … AA when
// prefix is ''), never one already in `taken`.
export function nextFreeId(taken: (id: string) => boolean, prefix = ''): string {
  if (prefix) {
    for (let i = 1; ; i++) if (!taken(`${prefix}${i}`)) return `${prefix}${i}`;
  }
  for (let i = 0; ; i++) {
    let s = '';
    let n = i;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    if (!taken(s)) return s;
  }
}

// Move element `from` of `arr` to index `to` (both clamped), returning
// a new array.
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = [...arr];
  if (from < 0 || from >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
  return out;
}
