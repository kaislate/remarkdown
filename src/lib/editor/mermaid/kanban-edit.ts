// Source-preserving visual edits for kanban boards — the kanban
// counterpart of mermaid-flowchart-edit.ts (see there for the why).
//
// Columns: add / rename / delete / reorder. Cards: add / rename /
// delete / move (within a column or to another) and set the three
// metadata fields mermaid draws on them (assigned, ticket, priority).
// Edits take user-level values and write mermaid syntax that shows
// exactly that:
//   - renames splice the node's text (`id[Old]` → `id[New]`); when the
//     metadata has a `label` — which is what mermaid shows — that value
//     changes instead
//   - a column's id is what mermaid files cards under, so a column is
//     never given an id another column has (`col1[Todo]` instead)
//   - moves cut and paste whole lines, card and decoration lines byte
//     for byte (any card indentation deeper than the columns is valid
//     in any column); comments and blank lines between blocks stay put
//   - metadata edits rewrite only that card's `@{…}`
// Lines an edit doesn't touch — comments, blank lines, the init
// directive, frontmatter, other columns and cards — are never
// re-emitted.
import {
  parseKanbanSource,
  type KanbanPriority,
  type KanbanItemSource,
  type KanbanMeta,
  type KanbanSourceMap,
} from './kanban-parser';
import { decodeMermaidEntities } from '../mermaid-parser';
import type { Pos } from './mindmap-parser';
import { bareSafe, emitBody, escapeText, moveBlock, nonEmpty } from './mindmap-edit';
import { moveItem, nextFreeId, setFrontmatterTitle } from './source-text';

export type KanbanEdit =
  // New column after column `after` (default: at the end).
  | { kind: 'addColumn'; text: string; after?: number }
  // `markdown`: as for MindmapEdit's rename — `text` is markdown whose
  // bold / italic mermaid renders.
  | { kind: 'renameColumn'; column: number; text: string; markdown?: boolean }
  // Removes the column and its cards.
  | { kind: 'deleteColumn'; column: number }
  // Column `column` ends up at position `to`.
  | { kind: 'moveColumn'; column: number; to: number }
  // New card at `position` in the column (default: last).
  | { kind: 'addCard'; column: number; text: string; position?: number }
  | { kind: 'renameCard'; column: number; card: number; text: string; markdown?: boolean }
  | { kind: 'deleteCard'; column: number; card: number }
  // The card ends up at `toPosition` in column `toColumn` (positions
  // counted without the moved card).
  | { kind: 'moveCard'; column: number; card: number; toColumn: number; toPosition: number }
  // Each field: undefined leaves it, '' removes it, else sets it.
  | { kind: 'setCardMeta'; column: number; card: number; assigned?: string; ticket?: string; priority?: KanbanPriority | '' }
  // Frontmatter title; '' removes it.
  | { kind: 'setTitle'; title: string };

export interface KanbanEditResult {
  source: string;
  // Where the column / card the edit created, renamed or moved is now.
  column?: number;
  card?: number;
}

// ── Writing ──────────────────────────────────────────────────────────

const RESERVED_YAML = /^(~|null|true|false|yes|no|on|off|y|n)$/i;

// A metadata value: escaped like a label (mermaid draws it as one),
// then a plain YAML scalar when that's unambiguous, else a double-
// quoted one. The escaping leaves no `"` or `\` inside, which keeps
// mermaid's own `@{…}` lexer (it tracks quotes, not escapes) happy.
function emitMetaValue(value: string, formatted = false): string {
  const w = escapeText(value.replace(/[\r\n]+/g, ' '), false, formatted);
  if (/^[A-Za-z]([A-Za-z0-9 .-]*[A-Za-z0-9.])?$/.test(w) && !RESERVED_YAML.test(w)) return w;
  return JSON.stringify(w);
}

// mermaid's id for a node written without one: its text as written.
function rawIdOf(inner: string): string {
  if (inner.startsWith('"`')) return inner.slice(2, -2);
  if (inner.startsWith('"')) return inner.slice(1, -1);
  return inner;
}

// ── Source helpers ───────────────────────────────────────────────────

// Where a node's text ends (before any metadata).
function textEnd(s: KanbanItemSource): Pos {
  return s.close ? { line: s.body.end.line, col: s.close.end } : s.body.end;
}

// Replace [start, end) with `text` (which may hold newlines).
function splice(lines: string[], start: Pos, end: Pos, text: string): void {
  const out = (lines[start.line].slice(0, start.col) + text + lines[end.line].slice(end.col)).split('\n');
  lines.splice(start.line, end.line - start.line + 1, ...out);
}

function slice(lines: string[], start: Pos, end: Pos): string {
  if (start.line === end.line) return lines[start.line].slice(start.col, end.col);
  return [lines[start.line].slice(start.col), ...lines.slice(start.line + 1, end.line), lines[end.line].slice(0, end.col)].join('\n');
}

// The `@{…}` text after applying `changes` (null value = remove the
// key); '' when nothing is left. Untouched entries keep their bytes.
function rebuildMeta(lines: string[], meta: KanbanMeta | null, changes: Array<[string, string | null]>, indent: string): string {
  const items: string[] = [];
  const done = new Set<string>();
  for (const e of meta?.entries ?? []) {
    const ch = changes.find(([k]) => k === e.key);
    if (!ch) items.push(slice(lines, e.entry.start, e.entry.end));
    else {
      done.add(e.key);
      if (ch[1] !== null) items.push(`${e.key}: ${ch[1]}`);
    }
  }
  for (const [k, v] of changes) if (!done.has(k) && v !== null) items.push(`${k}: ${v}`);
  if (!items.length) return '';
  if (!meta?.block) return `@{ ${items.join(', ')} }`;
  // Block form: one entry per line at the entries' indentation, the
  // closing brace where it was.
  const first = meta.entries[0];
  const entryIndent = first ? lines[first.entry.start.line].slice(0, first.entry.start.col) : indent;
  const closeLine = lines[meta.span.end.line].slice(0, meta.span.end.col - 1);
  const closeIndent = /^\s*$/.test(closeLine) ? closeLine : '';
  return `@{\n${items.map((i) => entryIndent + i).join('\n')}\n${closeIndent}}`;
}

// Set `changes` on node `s`'s metadata (adding `@{…}` when it has none).
function setMeta(lines: string[], s: KanbanItemSource, changes: Array<[string, string | null]>, unit: string): void {
  const indent = lines[s.line].slice(0, s.indent.end) + unit;
  const text = rebuildMeta(lines, s.meta, changes, indent);
  if (s.meta) splice(lines, s.meta.span.start, s.meta.span.end, text);
  else if (text) splice(lines, textEnd(s), textEnd(s), text);
}

interface Board {
  map: KanbanSourceMap;
  // Raw ids of every column, and of every node (for fresh ids).
  columnIds: string[];
  allIds: Set<string>;
}

function columnIdTaken(b: Board, raw: string, except: number): boolean {
  const d = decodeMermaidEntities(raw);
  return b.columnIds.some((c, i) => i !== except && (c === raw || decodeMermaidEntities(c) === d));
}

function freshColumnId(b: Board): string {
  return nextFreeId((id) => b.allIds.has(id) || b.columnIds.includes(id), 'col');
}

// A new column token for typed text, with an id no other column has.
function emitColumn(b: Board, text: string): string {
  const t = nonEmpty(text);
  const w = escapeText(t, false);
  if (bareSafe(w, 'kanban') && !columnIdTaken(b, w, -1)) return w;
  const body = emitBody(t, 'plain');
  return columnIdTaken(b, rawIdOf(body), -1) ? `${freshColumnId(b)}[${body}]` : `[${body}]`;
}

// Rename column / card `s`; `column` is the column's index when `s` is
// a column (its id must stay unique), else -1.
function rename(lines: string[], b: Board, s: KanbanItemSource, text: string, column: number, formatted: boolean): void {
  const t = nonEmpty(text);
  if (s.meta?.entries.some((e) => e.key === 'label' && e.value)) {
    setMeta(lines, s, [['label', emitMetaValue(t, formatted)]], b.map.unit);
    return;
  }
  const id = s.id ? lines[s.line].slice(s.id.start, s.id.end) : '';
  let open = s.openText;
  let close = s.closeText;
  let inner: string;
  if (s.form === 'bare') {
    inner = escapeText(t, false, formatted);
    if (!bareSafe(inner, 'kanban')) {
      // Shapes don't show on a board: brackets are as good as bare.
      open = '[';
      close = ']';
      inner = emitBody(t, 'plain', formatted);
    }
  } else {
    // `(-…-)` needs a quoted text: unquoted, mermaid would swallow the
    // `-` of `-)`.
    const dashed = open === '(-' || open === '-)';
    inner = emitBody(t, s.form === 'markdown' ? 'markdown' : s.form === 'plain' && !dashed ? 'plain' : 'quoted', formatted);
  }
  let token = id + open + inner + close;
  if (column >= 0 && !id && columnIdTaken(b, rawIdOf(inner), column)) {
    token = `${freshColumnId(b)}${open || '['}${open ? inner : emitBody(t, 'plain', formatted)}${close || ']'}`;
  }
  splice(lines, { line: s.line, col: s.indent.end }, textEnd(s), token);
}

// Indentation for a new card in column `ci`: its cards', else any
// card's, else the column's plus the file's step.
function cardIndent(map: KanbanSourceMap, ci: number): string {
  const col = map.columns[ci];
  const any = col.cards[0] ?? map.columns.find((c) => c.cards.length)?.cards[0];
  return any ? map.lines[any.line].slice(0, any.indent.end) : map.lines[col.line].slice(0, col.indent.end) + map.unit;
}

// Apply one visual edit to kanban `source`. Returns null when the
// source isn't a board we can read or the edit names a column / card
// that doesn't exist.
export function applyKanbanEdit(source: string, edit: KanbanEdit): KanbanEditResult | null {
  const parsed = parseKanbanSource(source);
  if (!parsed.ok) return null;
  const { map } = parsed;
  const join = (lines: string[]): string => lines.join(map.eol);
  const b: Board = {
    map,
    columnIds: map.columns.map((c) => c.rawId),
    allIds: new Set(map.columns.flatMap((c) => [c.rawId, ...c.cards.map((k) => k.rawId)])),
  };
  const cols = map.columns;

  if (edit.kind === 'setTitle') return { source: setFrontmatterTitle(source, edit.title) };
  if (edit.kind === 'addColumn') {
    const lines = [...map.lines];
    const at = edit.after ?? cols.length - 1;
    if (cols.length && !cols[at]) return null;
    const indent = cols.length ? map.lines[cols[0].line].slice(0, cols[0].indent.end) : map.unit;
    lines.splice(cols.length ? cols[at].lastLine + 1 : map.headerLine + 1, 0, indent + emitColumn(b, edit.text));
    return { source: join(lines), column: cols.length ? at + 1 : 0 };
  }

  const col = cols[edit.column];
  if (!col) return null;
  const ci = edit.column;

  switch (edit.kind) {
    case 'renameColumn': {
      const lines = [...map.lines];
      rename(lines, b, col, edit.text, ci, edit.markdown === true);
      return { source: join(lines), column: ci };
    }
    case 'deleteColumn': {
      const lines = [...map.lines];
      lines.splice(col.line, col.lastLine - col.line + 1);
      // mermaid rejects a bare `kanban` with no line break after it.
      if (lines.length === map.headerLine + 1) lines.push('');
      return { source: join(lines) };
    }
    case 'moveColumn': {
      const to = Math.max(0, Math.min(cols.length - 1, edit.to));
      if (to === ci) return { source, column: ci };
      // Blocks move; whatever lies between blocks (comments, blank
      // lines) stays in its slot.
      const L = map.lines;
      const blocks = cols.map((c) => L.slice(c.line, c.lastLine + 1));
      const gaps = cols.map((c, i) => L.slice(c.lastLine + 1, i + 1 < cols.length ? cols[i + 1].line : L.length));
      const order = moveItem(blocks, ci, to);
      const lines = [...L.slice(0, cols[0].line), ...order.flatMap((blk, i) => [...blk, ...gaps[i]])];
      return { source: join(lines), column: to };
    }
    case 'addCard': {
      const n = col.cards.length;
      const pos = Math.max(0, Math.min(n, edit.position ?? n));
      const after = pos === 0 ? col.ownLast : col.cards[pos - 1].ownLast;
      const lines = [...map.lines];
      lines.splice(after + 1, 0, `${cardIndent(map, ci)}[${emitBody(nonEmpty(edit.text), 'plain')}]`);
      return { source: join(lines), column: ci, card: pos };
    }
  }

  const card = col.cards[edit.card];
  if (!card) return null;
  const ki = edit.card;

  switch (edit.kind) {
    case 'renameCard': {
      const lines = [...map.lines];
      rename(lines, b, card, edit.text, -1, edit.markdown === true);
      return { source: join(lines), column: ci, card: ki };
    }
    case 'deleteCard': {
      const lines = [...map.lines];
      lines.splice(card.line, card.ownLast - card.line + 1);
      return { source: join(lines) };
    }
    case 'moveCard': {
      const target = cols[edit.toColumn];
      if (!target) return null;
      const others = target.cards.filter((k) => k !== card);
      const pos = Math.max(0, Math.min(others.length, edit.toPosition));
      if (edit.toColumn === ci && pos === ki) return { source, column: ci, card: ki };
      const after = pos === 0 ? target.ownLast : others[pos - 1].ownLast;
      return { source: join(moveBlock(map.lines, card.line, card.ownLast, after)), column: edit.toColumn, card: pos };
    }
    case 'setCardMeta': {
      const changes: Array<[string, string | null]> = [];
      for (const key of ['assigned', 'ticket', 'priority'] as const) {
        const v = edit[key];
        if (v !== undefined) changes.push([key, v === '' ? null : emitMetaValue(v)]);
      }
      const lines = [...map.lines];
      setMeta(lines, card, changes, map.unit);
      return { source: join(lines), column: ci, card: ki };
    }
  }
  return null;
}
