// Parser for mermaid `kanban` boards (mermaid 11.14), with a source
// map for the source-preserving edits in kanban-edit.ts.
//
//   kanban
//     todo[To do]                     ← a column (any node at the
//       id1[Write the docs]             first node's indentation)
//       [Review]@{ assigned: 'Sam', ticket: MC-12, priority: 'High' }
//       ::icon(fa fa-book)            ← decorates the card above
//     Done                            ← bare text works too
//
// The syntax is mindmap's (same node scanner, see mindmap-parser.ts)
// plus `@{…}` metadata glued to a node. The structure is mermaid's
// (kanbanDb.ts):
//   - the first node's indentation is the column level; every node at
//     exactly that level is a column, every deeper node a card of the
//     column above it — cards don't nest, whatever their indentation
//   - a node indented less than the first is an error (we bail)
//   - a node's id is its explicit id, else its text; mermaid files
//     cards under their column BY ID, so two columns with one id would
//     share their cards — we bail on such boards (and the edit engine
//     never creates one)
//   - shapes (`[x]`, `(x)`, …) are accepted but all draw the same
//
// Metadata is YAML (mermaid wraps a one-line `@{…}` in braces, a
// multi-line one is a block mapping). We read the subset the edit
// engine can rewrite in place — `key: value` entries with plain,
// 'single' or "double" quoted scalars — and bail on anything else
// (nested values, anchors, ambiguous numbers), since a value we
// misread would show the wrong thing. Like mermaid: `label` replaces
// the text, `icon` sets the icon, `assigned` / `ticket` / `priority`
// are shown, falsy values (0, false, null, '') are ignored, and an
// uppercase or snake_case `shape` is an error.
import { decodeMermaidEntities } from '../mermaid-parser';
import { findPreamble, isBlankOrComment, splitLines } from './source-text';
import { scanStatement, type NodeToken, type Pos } from './mindmap-parser';

export type KanbanPriority = 'Very High' | 'High' | 'Low' | 'Very Low';
export const KANBAN_PRIORITIES: readonly KanbanPriority[] = ['Very High', 'High', 'Low', 'Very Low'];

export interface KanbanCard {
  // Position among all cards in source order (= mermaid's drawing order).
  index: number;
  column: number;
  // Position within its column.
  position: number;
  // The label as mermaid shows it (entity codes decoded; a metadata
  // `label` wins over the text).
  text: string;
  markdown: boolean;
  // mermaid's id: the explicit id, else the text as written.
  id: string;
  explicitId: boolean;
  assigned: string | null;
  ticket: string | null;
  // Usually one of KANBAN_PRIORITIES; mermaid accepts any value.
  priority: string | null;
  icon: string | null;
  classes: string[];
}

export interface KanbanColumn {
  index: number;
  text: string;
  markdown: boolean;
  id: string;
  explicitId: boolean;
  icon: string | null;
  classes: string[];
  cards: KanbanCard[];
}

export interface KanbanModel {
  // Frontmatter `title:`, null when none.
  title: string | null;
  columns: KanbanColumn[];
}

export type MetaValue = string | number | boolean | null;

export interface MetaEntry {
  key: string;
  value: MetaValue;
  // The whole `key: value` and just its value (both [start, end)).
  entry: { start: Pos; end: Pos };
  valueSpan: { start: Pos; end: Pos };
}

export interface KanbanMeta {
  // `@{` … `}` as written.
  span: { start: Pos; end: Pos };
  // A multi-line block mapping (one entry per line) rather than a
  // one-line `@{ a: 1, b: 2 }`.
  block: boolean;
  entries: MetaEntry[];
}

export interface KanbanItemSource extends Omit<NodeToken, 'meta'> {
  meta: KanbanMeta | null;
  // The id as written (explicit, else the text as written) — what
  // mermaid compares.
  rawId: string;
}

export interface KanbanColumnSource extends KanbanItemSource {
  cards: KanbanItemSource[];
  // Last statement line of the column and its cards.
  lastLine: number;
}

export interface KanbanSourceMap {
  lines: string[];
  eol: string;
  headerLine: number;
  columns: KanbanColumnSource[];
  // The file's indentation step, for inserted lines ('  ' by default).
  unit: string;
}

export type KanbanSourceParseResult =
  | { ok: true; model: KanbanModel; map: KanbanSourceMap }
  | { ok: false; reason: string };

export type KanbanParseResult = { ok: true; model: KanbanModel } | { ok: false; reason: string };

export const KANBAN_STARTER = [
  'kanban',
  '  todo[To do]',
  '    t1[Plan the week]',
  "    t2[Book the venue]@{ assigned: 'Sam', priority: 'High' }",
  '  doing[In progress]',
  '    t3[Write the invitations]',
  '  done[Done]',
  '    t4[Pick a date]',
  '',
].join('\n');

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

// ── Metadata ─────────────────────────────────────────────────────────

// js-yaml (JSON schema) number forms beyond the plain ints / decimals
// we resolve ourselves: any of these and we bail rather than guess.
const NUMBERISH = /^[-+]?(\.?[0-9])|^[-+]?\.(inf|Inf|INF)$|^\.(nan|NaN|NAN)$/;

// One YAML scalar as js-yaml's JSON schema reads it; undefined when
// it's outside the subset.
function scalar(text: string, flow: boolean): MetaValue | undefined {
  if (text === '') return null;
  if (text[0] === '"') {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) return undefined;
    try {
      return JSON.parse(text) as string;
    } catch {
      return undefined;
    }
  }
  if (text[0] === "'") {
    const m = /^'((?:[^']|'')*)'$/.exec(text);
    return m ? m[1].replace(/''/g, "'") : undefined;
  }
  // Plain scalars: nothing YAML could read as structure or a comment.
  if (/^[[\]{},#&*!|>%@`]/.test(text) || /^[-?:](\s|$)/.test(text)) return undefined;
  if (/:(\s|$)|\s#/.test(text) || (flow && /[[\]{}]/.test(text))) return undefined;
  if (/^(~|null|Null|NULL)$/.test(text)) return null;
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) return Number(text);
  if (NUMBERISH.test(text)) return undefined;
  return text;
}

// Parse the raw text between `@{` and `}` (which starts at `origin`).
function parseMeta(raw: string, origin: Pos, end: Pos): KanbanMeta | string {
  // Offsets in `raw` → source positions.
  const posAt = (off: number): Pos => {
    const before = raw.slice(0, off).split('\n');
    return before.length === 1
      ? { line: origin.line, col: origin.col + off }
      : { line: origin.line + before.length - 1, col: before[before.length - 1].length };
  };
  const span = { start: { line: origin.line, col: origin.col - 2 }, end };
  const entries: MetaEntry[] = [];
  const add = (from: number, text: string, flow: boolean): string | null => {
    const lead = text.length - text.trimStart().length;
    const body = text.trim();
    if (!body) return flow ? 'empty metadata entry' : null;
    const m = /^([A-Za-z_][\w-]*)\s*:(?:\s+|$)(.*)$/s.exec(body);
    if (!m) return 'unsupported metadata';
    const value = scalar(m[2], flow);
    if (value === undefined) return `unsupported metadata value for ${m[1]}`;
    if (entries.some((e) => e.key === m[1])) return `duplicate metadata key ${m[1]}`;
    const start = from + lead;
    const vStart = start + body.length - m[2].length;
    entries.push({
      key: m[1],
      value,
      entry: { start: posAt(start), end: posAt(start + body.length) },
      valueSpan: { start: posAt(vStart), end: posAt(start + body.length) },
    });
    return null;
  };

  if (!raw.includes('\n')) {
    // `@{ a: 1, b: 'x, y' }`: split on commas outside quotes.
    if (!raw.trim()) return { span, block: false, entries };
    let from = 0;
    let quote: string | null = null;
    for (let i = 0; i <= raw.length; i++) {
      const ch = raw[i];
      if (quote) {
        if (ch === '\\' && quote === '"') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ',' || i === raw.length) {
        const err = add(from, raw.slice(from, i), true);
        if (err) return err;
        from = i + 1;
      }
    }
    return { span, block: false, entries };
  }

  // Block mapping: one `key: value` per line, all at one indentation.
  let off = 0;
  let indent: number | null = null;
  for (const line of raw.split('\n')) {
    if (line.trim()) {
      const ind = line.length - line.trimStart().length;
      if (indent !== null && ind !== indent) return 'unsupported metadata layout';
      indent = ind;
      const err = add(off, line, false);
      if (err) return err;
    }
    off += line.length + 1;
  }
  return { span, block: true, entries };
}

// What mermaid does with the metadata values it knows.
interface MetaEffect {
  label?: string;
  icon?: string;
  assigned?: string;
  ticket?: string;
  priority?: string;
}

function effectOf(meta: KanbanMeta | null): MetaEffect | string {
  const out: MetaEffect = {};
  for (const e of meta?.entries ?? []) {
    const v = e.value;
    if (e.key === 'shape' && v && (typeof v !== 'string' || v !== v.toLowerCase() || v.includes('_'))) {
      return `no such shape: ${String(v)}`;
    }
    if (!v) continue;
    if (e.key === 'label' || e.key === 'icon' || e.key === 'assigned' || e.key === 'ticket' || e.key === 'priority') {
      // mermaid decodes entity codes everywhere in the source.
      out[e.key] = decodeMermaidEntities(String(v));
    }
  }
  return out;
}

// ── Board ────────────────────────────────────────────────────────────

export function parseKanbanSource(source: string): KanbanSourceParseResult {
  const { lines, eol } = splitLines(source);
  const { frontmatter, headerLine } = findPreamble(lines);
  if (headerLine < 0 || lines[headerLine].trim() !== 'kanban') return fail('not a kanban board');

  const columns: KanbanColumn[] = [];
  const srcs: KanbanColumnSource[] = [];
  let level = -1;
  let cardCount = 0;
  // The last node (column or card) — what decorations apply to.
  let last: { src: KanbanItemSource; item: KanbanColumn | KanbanCard } | null = null;

  for (let k = headerLine + 1; k < lines.length; k++) {
    if (isBlankOrComment(lines[k])) continue;
    const st = scanStatement(lines, k, 'kanban');
    if (typeof st === 'string') return fail(`line ${k + 1}: ${st}`);
    if (st.kind !== 'node') {
      if (!last) return fail(`line ${k + 1}: a decoration before the first column`);
      if (st.kind === 'icon') {
        if (st.value) last.item.icon = st.value;
        last.src.iconLines.push(k);
      } else {
        if (st.value) last.item.classes = st.value.split(/\s+/).filter(Boolean);
        last.src.classLines.push(k);
      }
      last.src.ownLast = k;
      continue;
    }

    const { token, raw, id } = st.node;
    let meta: KanbanMeta | null = null;
    if (token.meta) {
      const parsed = parseMeta(token.meta.raw, { line: token.meta.start.line, col: token.meta.start.col + 2 }, token.meta.end);
      if (typeof parsed === 'string') return fail(`line ${k + 1}: ${parsed}`);
      meta = parsed;
    }
    const effect = effectOf(meta);
    if (typeof effect === 'string') return fail(`line ${k + 1}: ${effect}`);
    const src: KanbanItemSource = { ...token, meta, rawId: id ?? raw };
    const common = {
      text: effect.label ?? decodeMermaidEntities(raw),
      markdown: token.form === 'markdown',
      id: decodeMermaidEntities(id ?? raw),
      explicitId: id !== null,
      icon: effect.icon ?? null,
      classes: [] as string[],
    };

    const nodeLevel = token.indent.end;
    if (level < 0) level = nodeLevel;
    if (nodeLevel < level) return fail(`line ${k + 1}: a card outside any column`);
    if (nodeLevel === level) {
      if (srcs.some((c) => c.rawId === src.rawId)) return fail(`line ${k + 1}: two columns with the id ${src.rawId}`);
      const column: KanbanColumn = { index: columns.length, ...common, cards: [] };
      columns.push(column);
      srcs.push({ ...src, cards: [], lastLine: src.ownLast });
      last = { src: srcs[srcs.length - 1], item: column };
    } else {
      const col = columns[columns.length - 1];
      const card: KanbanCard = {
        index: cardCount++,
        column: col.index,
        position: col.cards.length,
        ...common,
        assigned: effect.assigned ?? null,
        ticket: effect.ticket ?? null,
        priority: effect.priority ?? null,
      };
      col.cards.push(card);
      srcs[srcs.length - 1].cards.push(src);
      last = { src, item: card };
    }
    k = token.endLine;
  }

  for (const c of srcs) c.lastLine = c.cards.length ? c.cards[c.cards.length - 1].ownLast : c.ownLast;

  return {
    ok: true,
    model: { title: frontmatter?.title?.value ?? null, columns },
    map: { lines, eol, headerLine, columns: srcs, unit: inferUnit(lines, srcs) },
  };
}

// Card indentation minus column indentation, when it extends it; '\t'
// for a tab-indented board, else two spaces.
function inferUnit(lines: string[], srcs: KanbanColumnSource[]): string {
  for (const c of srcs) {
    const mine = lines[c.line].slice(0, c.indent.end);
    for (const card of c.cards) {
      const theirs = lines[card.line].slice(0, card.indent.end);
      if (theirs.startsWith(mine) && theirs.length > mine.length) return theirs.slice(mine.length);
    }
  }
  return srcs.some((c) => lines[c.line].slice(0, c.indent.end).includes('\t')) ? '\t' : '  ';
}

export function parseKanban(source: string): KanbanParseResult {
  const r = parseKanbanSource(source);
  return r.ok ? { ok: true, model: r.model } : r;
}
