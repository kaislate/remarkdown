// Source-preserving visual edits for state diagrams — the state
// counterpart of mermaid-flowchart-edit.ts / mermaid-sequence-edit.ts
// (see there for the why).
//
// Every edit re-parses the source (state-parser.ts) and splices only
// the text it is about; lines it doesn't touch stay byte-identical.
//   - text edits replace just the text (a label, a note body); the
//     syntax around it is kept as written
//   - deletes remove whole statements; a statement that shares its line
//     with others is cut out of the line, and a line left empty goes
//   - additions go after the last statement of the scope (top level,
//     or the group / concurrency region) they belong to, with its
//     indentation
// User text is written so mermaid accepts it AND shows exactly what was
// typed (encodeStateText): characters with meaning to mermaid's lexer
// or to the markdown its labels go through become entity codes.
//
// mermaid's own rules shape several edits (state-parser.ts explains
// them): a state is drawn in the LAST group it is mentioned in, its
// first mention picks its shape, `[*]` belongs to the scope it is
// written in, and an empty group cannot be drawn at all. So:
//   - a transition between states of different groups is written at
//     the top level (a mention there never moves a state); one between
//     two states of the same group goes into that group
//   - removing a statement that held a surviving state's first mention,
//     or the mention that put it in its group, leaves a bare `State`
//     line in its place, so the state keeps its shape, order and group
//   - a group an edit would leave empty becomes a plain state with the
//     group's label (deleting or moving out its last member)
// Edits whose outcome depends on more of those rules (moving a state
// between groups, ungrouping) re-parse their own result and return
// null rather than a diagram that isn't what was asked for.
import {
  parseStateSource,
  type IdRef,
  type NotePosition,
  type StateBody,
  type StateDirection,
  type StateEndpoint,
  type StateKind,
  type StateModel,
  type StateScope,
  type StateSourceMap,
  type StateStatement,
  type StateTerminal,
} from './state-parser';
import { DEFAULT_INDENT, nextFreeId, setFrontmatterTitle } from './source-text';
import { decodeMermaidEntities } from '../mermaid-parser';

export type StateEdit =
  // The title shown for a state or a group. Writes into the description
  // that is the title already (`state "…" as Id` / `Id : …`), else adds
  // `state "…" as Id` next to the state's first mention (a group's
  // `state Id {` becomes `state "…" as Id {`). Refused for fork / join /
  // choice, which show no text. An empty label shows a blank title.
  //
  // `markdown`: the text is markdown from the bold / italic field (see
  // encodeStateText) — also on the transition / note text edits.
  | { kind: 'setStateLabel'; id: string; label: string; markdown?: boolean }
  // A new state at the end of `parent` (top level when omitted / null;
  // a group's last concurrency region), optionally with a transition
  // from `connectFrom` (a state, or the start of the new state's scope).
  // The id is derived from the label (`Idle`, `WaitingForPayment`, …,
  // `fork1` for special states) and returned as `id`.
  | {
      kind: 'addState';
      label: string;
      stateKind?: StateKind;
      parent?: string | null;
      connectFrom?: StateEndpoint;
      transitionLabel?: string;
    }
  // Removes the state with everything that refers to it: transitions,
  // notes, descriptions, class / style / click references. A group goes
  // with its whole body (the states inside it too).
  | { kind: 'deleteState'; id: string }
  // Removes a group's box but keeps what is inside it, one level up.
  // The group's own start / end connections, concurrency separators and
  // `direction` go (they would change the outer scope), and so does
  // everything referring to the group itself (transitions, notes).
  | { kind: 'ungroup'; id: string }
  // A new group with label `label` drawn around state `id` (where the
  // state is now); returns the group's id as `id`.
  | { kind: 'wrapInComposite'; id: string; label: string }
  // Moves a state (or group) into group `into`, or to the top level
  // (null). Transitions keep their meaning: one that would hold the
  // state back in its old group is moved to the top level; a start /
  // end connection of the old group that would do so is removed.
  | { kind: 'moveState'; id: string; into: string | null }
  // normal ↔ fork / join / choice. Refused for groups, and for states
  // with a title or description (mermaid draws those as a box anyway).
  | { kind: 'setStateKind'; id: string; stateKind: StateKind }
  // Endpoints are states or the start (`from`) / end (`to`) of a scope.
  // A start / end of a group connects only to states in that group.
  // Returns the new transition's index.
  | { kind: 'addTransition'; from: StateEndpoint; to: StateEndpoint; label?: string }
  // `[*] --> id` / `id --> [*]` in the state's own scope.
  | { kind: 'addStart'; id: string }
  | { kind: 'addEnd'; id: string }
  // An empty label removes the label.
  | { kind: 'setTransitionLabel'; index: number; label: string; markdown?: boolean }
  | { kind: 'deleteTransition'; index: number }
  // A start or end circle with all of its transitions.
  | { kind: 'deleteTerminal'; terminal: StateTerminal }
  // Note text: single line → `note right of X : text`; with line
  // breaks → `note right of X` … `end note`. Empty text is refused
  // (delete the note instead). Returns the new note's index.
  | { kind: 'addNote'; state: string; position: NotePosition; text: string; markdown?: boolean }
  | { kind: 'setNoteText'; index: number; text: string; markdown?: boolean }
  | { kind: 'setNotePosition'; index: number; position: NotePosition }
  | { kind: 'deleteNote'; index: number }
  // Top-level layout direction / a group's own direction (refused for
  // groups with concurrency regions — mermaid ignores it there).
  | { kind: 'setDirection'; direction: StateDirection }
  | { kind: 'setCompositeDirection'; id: string; direction: StateDirection }
  // Frontmatter `title:`; empty removes it.
  | { kind: 'setTitle'; title: string };

export interface StateEditResult {
  source: string;
  // Id of the state / group an addState / wrapInComposite created.
  id?: string;
  // Index of the transition / note an add edit created.
  index?: number;
}

// ── Writing user text ───────────────────────────────────────────────

// Where text goes:
//   'label'  after a colon: `A --> B : text`, `Id : text`
//   'quoted' inside `state "text" as Id`
//   'note'   single-line note text: `note left of A : text`
//   'body'   one line of a multi-line note body
export type StateTextContext = 'label' | 'quoted' | 'note' | 'body';

// Entity codes mermaid decodes back for display (it hides `#…;` from
// its lexer before parsing, so they are opaque there).
const ENTITY: Record<string, string> = {
  // the lexer: `;` ends a statement, `#` / `%` start comments, `"`
  // ends a quoted name, `:` ends a note text / doubled ends a label
  '#': '#35;',
  ';': '#59;',
  '"': '#quot;',
  ':': '#58;',
  // `&` / `<` could start an entity or markup in the label HTML
  '&': '#amp;',
  '<': '#lt;',
  // labels are markdown: `*` / `_` would emphasise, `\` escape
  '*': '#42;',
  '_': '#95;',
  '\\': '#92;',
};

// A backslash-escaped marker of markdown text → what shows it literally.
const ESCAPED: Record<string, string> = { '*': '#42;', '_': '#95;', '\\': '#92;', '`': '`' };

// User text → mermaid source text for `ctx`. Newlines become spaces
// (except in note bodies, which the caller splits into lines) and the
// text is trimmed — mermaid trims it anyway.
//
// mermaid draws state diagram text as markdown. Plain text (the
// default) has every `*` / `_` / `\` written as an entity code, so it
// shows as typed. `markdown` text (from the bold / italic field, see
// rich-text.ts) keeps its `**` / `*` markers as formatting and writes
// its escaped markers (`\*`) as entity codes.
export function encodeStateText(text: string, ctx: StateTextContext, markdown = false): string {
  const src = text.replace(/\r\n|\r|\n/g, ' ').trim();
  let t = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (markdown && c === '\\' && i + 1 < src.length && src[i + 1] in ESCAPED) {
      t += ESCAPED[src[++i]];
    } else if ('#;&<'.includes(c) || (!markdown && '*_\\'.includes(c))) {
      t += ENTITY[c];
    } else {
      t += c;
    }
  }
  if (ctx === 'quoted') t = t.replace(/"/g, ENTITY['"']);
  // mermaid's entity pre-pass mangles a line holding `style…:…#…;` /
  // `classDef…:…#…;`; with no raw `:` after the word it can't match.
  const styleLike = /style|classDef/.test(t);
  if (ctx === 'note' || styleLike) t = t.replace(/:/g, ENTITY[':']);
  // A label can't hold `::` or end in `:`.
  else if (ctx === 'label') t = t.replace(/:(?=:|$)/g, ENTITY[':']);
  // `%%` would start a comment or an `%%{init}%%` directive.
  t = t.replace(/%(?=%)/g, '#37;');
  // Any line containing `direction <dir>` lexes as a direction
  // statement; `[[fork]]` inside a name lexes as a fork; `end note`
  // closes a note body.
  t = t.replace(/(direction)\s+(?=(?:tb|bt|rl|lr))/gi, '$1#32;');
  if (ctx === 'quoted') t = t.replace(/\[(?=\[(?:fork|join|choice)\]\])/gi, '#91;');
  if (ctx === 'body') t = t.replace(/(end)\s+(?=note)/gi, '$1#32;');
  return t;
}

// An item's text as markdown (the inverse of encodeStateText with
// `markdown`), for the bold / italic field: entity codes are decoded,
// except the ones that make a marker literal, which come back
// backslash-escaped (`#42;` → `\*`); raw markers are formatting, as
// mermaid draws them. A state without a title reads as its id.
export function stateTextMarkdown(
  source: string,
  item: { kind: 'state'; id: string } | { kind: 'transition' | 'note'; index: number },
): string {
  const parsed = parseStateSource(source);
  if (!parsed.ok) return '';
  const { map } = parsed;
  const escape = (s: string) => s.replace(/[\\*_`]/g, (c) => `\\${c}`);
  let raw: string | null = null;
  if (item.kind === 'state') {
    const d = map.states.get(item.id)?.descriptions[0];
    if (!d) return parsed.model.states.has(item.id) ? escape(item.id) : '';
    raw = source.slice(d.span.start, d.span.end);
  } else {
    const i = (item.kind === 'transition' ? map.transitions : map.notes)[item.index];
    const s = i === undefined ? undefined : map.statements[i];
    const span = s?.t === 'relation' ? s.label : s?.t === 'note' ? s.text : null;
    raw = span ? source.slice(span.start, span.end) : '';
  }
  return raw
    .split(/\r?\n/)
    .map((line) =>
      decodeMermaidEntities(line.replace(/#(42|95|92);/g, (_m, n: string) => `\\${String.fromCharCode(Number(n))}`)).trim(),
    )
    .filter(Boolean)
    .join('\n');
}

// A blank title must still be written as something: `state "" as X` is
// a parse error and `X :` adds nothing.
const BLANK = '#32;';

// ── Ids ─────────────────────────────────────────────────────────────

// Words mermaid's lexer reads as keywords where a transition's end
// stands (`A --> note` lexes `note ` as a note).
const KEYWORDS = new Set(['click', 'href', 'default', 'scale', 'state', 'note', 'class', 'classdef', 'style', 'statediagram']);
// Also kept out of NEW ids: words that read as keywords elsewhere, and
// mermaid's own node ids (`root`, `<scope>_start`, `divider-id-N`).
const RESERVED = new Set([...KEYWORDS, 'hide', 'acctitle', 'accdescr', 'root', 'end']);

function reservedId(id: string): boolean {
  return RESERVED.has(id.toLowerCase()) || /direction/i.test(id) || /_(start|end)$/.test(id) || /^divider/i.test(id);
}

// Can an existing `id` be written as a transition end? (Any line with
// `direction <dir>` in it is a direction statement to mermaid.)
function writableId(id: string): boolean {
  return /^[^\s:\-{}"#%;]+$/.test(id) && !KEYWORDS.has(id.toLowerCase()) && !/direction/i.test(id);
}

// An id for a new state: the label itself when it is a plain word,
// else its words run together (`Waiting for payment` →
// `WaitingForPayment`); special states get fork1 / join1 / choice1.
function newStateId(label: string, kind: StateKind, taken: (id: string) => boolean): { id: string; plain: boolean } {
  const isTaken = (id: string) => taken(id) || reservedId(id);
  if (kind !== 'normal') return { id: nextFreeId(isTaken, kind), plain: false };
  const t = label.trim();
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(t) && !isTaken(t)) return { id: t, plain: true };
  const words = t.normalize('NFKD').match(/[A-Za-z0-9]+/g) ?? [];
  let base = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('').slice(0, 24);
  if (base && !/^[A-Za-z]/.test(base)) base = `S${base}`;
  // Make the base itself usable (else no numbered variant would be).
  base = base.replace(/direction/gi, 'Dir');
  if (/^divider/i.test(base)) base = `S${base}`;
  if (RESERVED.has(base.toLowerCase())) base = `${base}State`;
  if (!base || reservedId(base)) return { id: nextFreeId(isTaken, 'S'), plain: false };
  return { id: isTaken(base) ? nextFreeId(isTaken, base) : base, plain: false };
}

// ── Splicing ────────────────────────────────────────────────────────

interface Splice {
  start: number;
  end: number;
  text: string;
}

class OverlapError extends Error {}

const sameScope = (a: StateScope, b: StateScope) => a.parent === b.parent && a.region === b.region;

const ROOT: StateScope = { parent: null, region: 0 };

class Editor {
  readonly src: string;
  readonly map: StateSourceMap;
  readonly model: StateModel;
  readonly eol: string;
  splices: Splice[] = [];
  // Statements this edit removes (so insertions never anchor on them).
  removed = new Set<number>();

  constructor(map: StateSourceMap, model: StateModel) {
    this.src = map.source;
    this.map = map;
    this.model = model;
    this.eol = map.eol;
  }

  stmt(i: number): StateStatement {
    return this.map.statements[i];
  }

  lineStart(off: number): number {
    return this.src.lastIndexOf('\n', off - 1) + 1;
  }

  // Offset of the line break ending the line holding `off` (or the end).
  lineEnd(off: number): number {
    const nl = this.src.indexOf('\n', off);
    if (nl < 0) return this.src.length;
    return nl > 0 && this.src[nl - 1] === '\r' ? nl - 1 : nl;
  }

  indentAt(off: number): string {
    const ls = this.lineStart(off);
    return /^[ \t]*/.exec(this.src.slice(ls))![0];
  }

  // Is the rest of the line after `off` empty or a comment?
  restIsBlank(off: number): boolean {
    const rest = this.src.slice(off, this.lineEnd(off)).trim();
    return rest === '' || rest.startsWith('%%') || rest.startsWith('#');
  }

  // Does statement `i` start its line?
  startsLine(i: number): boolean {
    const s = this.stmt(i);
    return this.src.slice(this.lineStart(s.start), s.start).trim() === '';
  }

  // Indentation for a statement placed next to statement `i`.
  indentNear(i: number): string {
    const s = this.stmt(i);
    if (this.startsLine(i)) return this.indentAt(s.start);
    const c = s.container;
    return c === null ? DEFAULT_INDENT : this.indentAt(this.stmt(c).start) + DEFAULT_INDENT;
  }

  // Insert statement lines right after statement `i`.
  insertAfter(i: number, texts: string[]): void {
    const s = this.stmt(i);
    const indent = this.indentNear(i);
    const body = texts.map((t) => this.eol + indent + t).join('');
    if (this.restIsBlank(s.end)) {
      // After the line (and a trailing comment on it).
      const at = this.lineEnd(s.end);
      this.splices.push({ start: at, end: at, text: body });
    } else {
      // Something follows on the same line (a one-line group's `}`, the
      // next statement): give it a line of its own too — `state "…" as
      // X` would otherwise read the rest of the line as part of the id.
      this.splices.push({ start: s.end, end: s.end, text: body + this.eol + indent });
    }
  }

  // Insert a statement line right before statement `i`.
  insertBefore(i: number, text: string): void {
    const s = this.stmt(i);
    if (this.startsLine(i)) {
      const ls = this.lineStart(s.start);
      this.splices.push({ start: ls, end: ls, text: this.indentAt(s.start) + text + this.eol });
    } else {
      this.splices.push({ start: s.start, end: s.start, text: text + this.eol + this.indentNear(i) });
    }
  }

  // Insert statement lines at the end of `scope` (after its last
  // statement this edit keeps).
  appendToScope(scope: StateScope, texts: string[]): void {
    const candidates = this.scopeStatements(scope).filter((i) => !this.removed.has(i));
    const last = candidates[candidates.length - 1];
    if (last !== undefined) {
      this.insertAfter(last, texts);
      return;
    }
    if (scope.parent === null) {
      // Empty diagram: right after the header.
      const first = this.map.statements.findIndex((_, i) => !this.removed.has(i));
      const indent = first >= 0 ? this.indentNear(first) : DEFAULT_INDENT;
      const at = this.lineEnd(this.map.header.end);
      this.splices.push({ start: at, end: at, text: texts.map((t) => this.eol + indent + t).join('') });
      return;
    }
    // An empty region: after its `--` (or the group's `{`).
    const block = this.lastBlock(scope.parent);
    const body = (this.stmt(block) as { body: { open: number; close: number; stmts: number[] } }).body;
    const dividers = body.stmts.filter((i) => this.stmt(i).t === 'divider');
    if (scope.region > 0 && dividers[scope.region - 1] !== undefined) {
      this.insertAfter(dividers[scope.region - 1], texts);
      return;
    }
    const openerIndent = this.indentAt(this.stmt(block).start);
    const indent = openerIndent + DEFAULT_INDENT;
    const lines = texts.map((t) => this.eol + indent + t).join('');
    if (this.restIsBlank(body.open + 1)) {
      const at = this.lineEnd(body.open);
      this.splices.push({ start: at, end: at, text: lines });
    } else {
      this.splices.push({ start: body.open + 1, end: body.open + 1, text: lines + this.eol + openerIndent });
    }
  }

  // Statements written directly in `scope`, in source order.
  scopeStatements(scope: StateScope): number[] {
    if (scope.parent === null) return this.map.root;
    const blocks = this.map.states.get(scope.parent)?.blocks ?? [];
    const out: number[] = [];
    for (const b of blocks) {
      const body = (this.stmt(b) as { body: { stmts: number[] } | null }).body;
      for (const i of body?.stmts ?? []) {
        const s = this.stmt(i);
        if (s.t !== 'divider' && sameScope(s.scope, scope)) out.push(i);
      }
    }
    return out;
  }

  lastBlock(id: string): number {
    const blocks = this.map.states.get(id)!.blocks;
    return blocks[blocks.length - 1];
  }

  // Remove [start, end); the whole line(s) when nothing but whitespace
  // (or a trailing comment) would be left on them.
  removeRange(start: number, end: number): void {
    const ls = this.lineStart(start);
    const le = this.lineEnd(end);
    const before = this.src.slice(ls, start);
    if (before.trim() === '' && this.restIsBlank(end)) {
      if (le < this.src.length) {
        const brk = this.src[le] === '\r' ? 2 : 1;
        this.splices.push({ start: ls, end: le + brk, text: '' });
      } else if (ls > 0) {
        const brk = ls >= 2 && this.src[ls - 2] === '\r' ? 2 : 1;
        this.splices.push({ start: ls - brk, end: le, text: '' });
      } else {
        this.splices.push({ start: ls, end: le, text: '' });
      }
      return;
    }
    this.splices.push({ start, end, text: '' });
  }

  // Remove whole statements. A surviving state whose first mention, or
  // the mention that puts it in its group, sits in a removed statement
  // keeps a bare `Id` there instead. Statements inside a removed group
  // body go with it.
  removeStatements(idxs: Iterable<number>): void {
    const set = new Set(idxs);
    for (const i of set) this.removed.add(i);
    const insideRemoved = (i: number): boolean => {
      for (let c = this.stmt(i).container; c !== null; c = this.stmt(c).container) if (set.has(c)) return true;
      return false;
    };
    // Bare references to keep, per removed statement.
    const keep = new Map<number, string[]>();
    const gone = (m: number) => set.has(m) || insideRemoved(m);
    for (const [id, info] of this.map.states) {
      if (!this.model.states.has(id) || this.managed.has(id) || !info.mentions.some(gone)) continue;
      const first = info.mentions[0];
      const nonRoot = info.mentions.filter((m) => this.stmt(m).scope.parent !== null);
      const lastNonRoot = nonRoot[nonRoot.length - 1];
      const remainingNonRoot = nonRoot.filter((m) => !gone(m));
      const newLast = remainingNonRoot[remainingNonRoot.length - 1];
      const anchors = new Set<number>();
      if (gone(first)) anchors.add(first);
      if (lastNonRoot !== undefined && gone(lastNonRoot) && (newLast === undefined || !sameScope(this.stmt(newLast).scope, this.stmt(lastNonRoot).scope))) {
        anchors.add(lastNonRoot);
      }
      for (const a of anchors) {
        if (insideRemoved(a)) continue;
        const s = this.stmt(a);
        const ref = s.t === 'relation' ? (s.from.id === id ? s.from : s.to) : 'ref' in s ? s.ref : null;
        if (!ref) continue;
        const list = keep.get(a) ?? [];
        list.push(this.src.slice(ref.span.start, ref.span.end));
        keep.set(a, list);
      }
    }
    for (const i of set) {
      if (insideRemoved(i)) continue;
      const s = this.stmt(i);
      const bare = keep.get(i);
      if (bare?.length) {
        const indent = this.startsLine(i) ? this.indentAt(s.start) : this.indentNear(i);
        this.splices.push({ start: s.start, end: s.end, text: bare.join(this.eol + indent) });
      } else {
        this.removeRange(s.start, s.end);
      }
    }
  }

  // States whose mentions this edit handles itself (deleted, or moved):
  // removeStatements keeps no bare reference for them.
  managed = new Set<string>();

  // Drop `id` from a `class` / `style` id list (the whole statement
  // when it is the only one).
  removeFromList(i: number, id: string): void {
    const s = this.stmt(i);
    if (s.t !== 'class' && s.t !== 'style') return;
    const keep = s.ids.filter((x) => x.id !== id);
    if (!keep.length) {
      this.removed.add(i);
      this.removeRange(s.start, s.end);
      return;
    }
    for (const x of s.ids) {
      if (x.id !== id) continue;
      // The id and one adjacent comma (with the spaces around it).
      const after = /^\s*,\s*/.exec(this.src.slice(x.span.end, s.idsSpan.end));
      if (after) {
        this.splices.push({ start: x.span.start, end: x.span.end + after[0].length, text: '' });
      } else {
        const before = /\s*,\s*$/.exec(this.src.slice(s.idsSpan.start, x.span.start))!;
        this.splices.push({ start: x.span.start - before[0].length, end: x.span.end, text: '' });
      }
    }
  }

  // A statement's text (to paste it elsewhere), its continuation lines
  // (a group's body, a note's) re-indented from the statement's own
  // indentation to `toIndent`.
  reindented(i: number, toIndent: string): string {
    const s = this.stmt(i);
    const from = this.indentAt(s.start);
    return this.src
      .slice(s.start, s.end)
      .split(/\r?\n/)
      .map((l, k) => (k > 0 && l.startsWith(from) ? toIndent + l.slice(from.length) : l))
      .join(this.eol);
  }

  // The indentation statements appended to `scope` get.
  scopeIndent(scope: StateScope): string {
    const last = this.scopeStatements(scope).filter((i) => !this.removed.has(i)).pop();
    if (last !== undefined) return this.indentNear(last);
    if (scope.parent === null) {
      const first = this.map.statements.findIndex((_, i) => !this.removed.has(i));
      return first >= 0 ? this.indentNear(first) : DEFAULT_INDENT;
    }
    return this.indentAt(this.stmt(this.lastBlock(scope.parent)).start) + DEFAULT_INDENT;
  }

  result(): string {
    // Whole-line removals of neighbouring lines can share a line break
    // (the last line has none of its own): merge removals that overlap.
    const asc = [...this.splices].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: Splice[] = [];
    for (const s of asc) {
      const prev = merged[merged.length - 1];
      if (prev && prev.text === '' && s.text === '' && s.start < prev.end) prev.end = Math.max(prev.end, s.end);
      else merged.push({ ...s });
    }
    const sorted = merged.sort((a, b) => b.start - a.start || b.end - a.end);
    let out = this.src;
    let limit = Infinity;
    for (const s of sorted) {
      // Overlapping splices would corrupt the text; callers never make
      // them, but refuse rather than guess.
      if (s.end > limit) throw new OverlapError();
      out = out.slice(0, s.start) + s.text + out.slice(s.end);
      limit = s.start;
    }
    return out;
  }
}

// ── Helpers on the model ────────────────────────────────────────────

function scopeOf(model: StateModel, id: string): StateScope {
  const s = model.states.get(id)!;
  return { parent: s.parent, region: s.region };
}

function validScope(model: StateModel, scope: StateScope): boolean {
  if (scope.parent === null) return scope.region === 0;
  const g = model.states.get(scope.parent)?.composite;
  return !!g && scope.region >= 0 && scope.region < g.regions;
}

function lastRegion(model: StateModel, parent: string | null): StateScope {
  if (parent === null) return ROOT;
  return { parent, region: model.states.get(parent)!.composite!.regions - 1 };
}

// States inside group `id`, at any depth.
function descendants(model: StateModel, id: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    for (const s of model.states.values()) {
      if (s.parent === p) {
        out.push(s.id);
        walk(s.id);
      }
    }
  };
  walk(id);
  return out;
}

function endpointText(e: StateEndpoint): string {
  return e.kind === 'state' ? e.id : '[*]';
}

function noteLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
}

// A note statement: one line, or `note … of X` / body / `end note`
// (body lines one indent deeper than the note).
function noteStatement(id: string, position: NotePosition, lines: string[], markdown = false): string[] {
  const head = `note ${position} of ${id}`;
  if (lines.length === 1) return [`${head} : ${encodeStateText(lines[0], 'note', markdown)}`];
  return [head, ...lines.map((l) => DEFAULT_INDENT + encodeStateText(l, 'body', markdown)), 'end note'];
}

// Transitions as an order-insensitive multiset.
function transitionKeys(transitions: StateModel['transitions']): string[] {
  return transitions.map((t) => JSON.stringify(t)).sort();
}

// Index of the item an add edit inserted: the first position where the
// new list differs from the old one (the end when it was appended).
function insertedIndex<T>(before: T[], after: T[]): number {
  let k = 0;
  while (k < before.length && JSON.stringify(before[k]) === JSON.stringify(after[k])) k++;
  return k;
}

// Every state still drawn where it was, with the same title and shape.
function statesUnchanged(before: StateModel, after: StateModel, except: (id: string) => boolean = () => false): boolean {
  for (const [k, s] of before.states) {
    if (except(k)) continue;
    const a = after.states.get(k);
    if (!a || a.parent !== s.parent || a.region !== s.region || a.label !== s.label || a.kind !== s.kind) return false;
  }
  return true;
}

// ── The edits ───────────────────────────────────────────────────────

// Apply one visual edit to state diagram `source`. Returns null when
// the source can't be parsed or the edit names something that doesn't
// exist / can't be done.
export function applyStateEdit(source: string, edit: StateEdit): StateEditResult | null {
  const parsed = parseStateSource(source);
  if (!parsed.ok) return null;
  try {
    return apply(new Editor(parsed.map, parsed.model), edit);
  } catch (e) {
    if (e instanceof OverlapError) return null;
    throw e;
  }
}

function apply(ed: Editor, edit: StateEdit): StateEditResult | null {
  const { model, map } = ed;
  const source = map.source;

  switch (edit.kind) {
    case 'setTitle':
      return { source: setFrontmatterTitle(source, edit.title) };

    case 'setStateLabel': {
      const st = model.states.get(edit.id);
      const info = map.states.get(edit.id);
      if (!st || !info) return null;
      if (!st.composite && st.kind !== 'normal') return null;
      const label = edit.label.trim();
      const d = info.descriptions[0];
      if (d) {
        // The description that is the title already: rewrite its text.
        const text = label ? encodeStateText(label, d.quoted ? 'quoted' : 'label', edit.markdown) : BLANK;
        ed.splices.push({ start: d.span.start, end: d.span.end, text });
        return { source: ed.result() };
      }
      if (label === edit.id) return { source };
      const quoted = `"${label ? encodeStateText(label, 'quoted', edit.markdown) : BLANK}"`;
      const block = info.blocks.find((b) => ed.stmt(b).t === 'block');
      if (st.composite && block !== undefined) {
        // `state G {` → `state "Label" as G {`
        const ref = (ed.stmt(block) as { ref: IdRef }).ref;
        ed.splices.push({ start: ref.span.start, end: ref.span.end, text: `${quoted} as ${edit.id}` });
        return { source: ed.result() };
      }
      if (!writableId(edit.id)) return null;
      // Right after the first mention, in the same scope: it neither
      // becomes the first mention (shape) nor the last one in a group.
      ed.insertAfter(info.mentions[0], [`state ${quoted} as ${edit.id}`]);
      return finish(ed, {}, (after) => (edit.markdown || after.states.get(edit.id)?.label === label) && statesUnchanged(model, after, (k) => k === edit.id));
    }

    case 'addState': {
      const kind = edit.stateKind ?? 'normal';
      const parent = edit.parent ?? null;
      if (parent !== null && !model.states.get(parent)?.composite) return null;
      const scope = lastRegion(model, parent);
      const label = edit.label.trim();
      const { id, plain } = newStateId(label, kind, (x) => map.states.has(x) || model.states.has(x));
      const lines: string[] = [];
      if (kind !== 'normal') lines.push(`state ${id} <<${kind}>>`);
      else if (!plain) lines.push(`state "${label ? encodeStateText(label, 'quoted') : BLANK}" as ${id}`);
      let rootLine: string | null = null;
      if (edit.connectFrom) {
        const from = edit.connectFrom;
        if (from.kind === 'end') return null;
        if (from.kind === 'state' && (!model.states.has(from.id) || !writableId(from.id))) return null;
        const tail = edit.transitionLabel?.trim() ? ` : ${encodeStateText(edit.transitionLabel, 'label')}` : '';
        const text = `${endpointText(from)} --> ${id}${tail}`;
        if (from.kind !== 'state') {
          if (!sameScope(from.scope, scope)) return null;
          lines.push(text);
        } else if (sameScope(scopeOf(model, from.id), scope)) {
          lines.push(text);
        } else {
          // Across groups: at the top level, where a mention moves nothing.
          rootLine = text;
        }
      }
      // A plain-word state with nothing else to say still needs a line.
      if (!lines.length) lines.push(id);
      ed.appendToScope(scope, lines);
      if (rootLine) ed.appendToScope(ROOT, [rootLine]);
      return finish(ed, { id }, (after) => {
        const s = after.states.get(id);
        return !!s && s.parent === parent && s.kind === kind && (kind !== 'normal' || s.label === label) && statesUnchanged(model, after);
      });
    }

    case 'deleteState': {
      const st = model.states.get(edit.id);
      if (!st) return null;
      const gone = [edit.id, ...(st.composite ? descendants(model, edit.id) : [])];
      for (const g of gone) ed.managed.add(g);
      const stmts = new Set<number>();
      for (const g of gone) {
        const info = map.states.get(g)!;
        for (const r of info.refs) {
          const s = ed.stmt(r);
          if (s.t === 'class' || s.t === 'style') ed.removeFromList(r, g);
          else stmts.add(r);
        }
        for (const b of info.blocks) stmts.add(b);
      }
      ed.removeStatements(stmts);
      return finish(ed, {}, (after) => gone.every((g) => !after.states.has(g)) && statesUnchanged(model, after, (k) => gone.includes(k) || emptiedGroup(model, after, k)));
    }

    case 'ungroup': {
      const st = model.states.get(edit.id);
      const info = map.states.get(edit.id);
      if (!st?.composite || !info) return null;
      ed.managed.add(edit.id);
      const stmts = new Set<number>();
      for (const r of info.refs) {
        if (info.blocks.includes(r)) continue;
        const s = ed.stmt(r);
        if (s.t === 'class' || s.t === 'style') ed.removeFromList(r, edit.id);
        else stmts.add(r);
      }
      for (const b of info.blocks) {
        const s = ed.stmt(b) as StateStatement & { body: StateBody };
        for (const i of s.body.stmts) {
          const inner = ed.stmt(i);
          // The group's own [*], `--` and `direction` would change the
          // scope its contents land in.
          const ownTerminal = inner.t === 'relation' && (inner.from.star || inner.to.star);
          if (ownTerminal || inner.t === 'divider' || inner.t === 'direction') stmts.add(i);
        }
        // The opener (`state X {` / `state "…" as X {`) and the `}`.
        ed.removeRange(s.start, s.body.open + 1);
        ed.removeRange(s.body.close, s.body.close + 1);
      }
      ed.removeStatements(stmts);
      const inner = [...model.states.values()].filter((s) => s.parent === edit.id).map((s) => s.id);
      return finish(ed, {}, (after) => {
        if (after.states.has(edit.id)) return false;
        if (!inner.every((i) => after.states.get(i)?.parent === st.parent && after.states.get(i)?.region === st.region)) return false;
        return statesUnchanged(model, after, (k) => k === edit.id || inner.includes(k));
      });
    }

    case 'wrapInComposite': {
      const st = model.states.get(edit.id);
      if (!st || !writableId(edit.id)) return null;
      const scope = scopeOf(model, edit.id);
      const label = edit.label.trim();
      const { id, plain } = newStateId(label || 'Group', 'normal', (x) => map.states.has(x) || model.states.has(x));
      const opener = plain && label ? `state ${id} {` : `state "${label ? encodeStateText(label, 'quoted') : BLANK}" as ${id} {`;
      // At the end of the state's scope: no later mention can sit in a
      // group (else the state would be drawn there), so the one inside
      // the new group is its last — mermaid draws it inside.
      const mention = st.kind === 'normal' ? edit.id : `state ${edit.id} <<${st.kind}>>`;
      ed.appendToScope(scope, [opener, `${DEFAULT_INDENT}${mention}`, '}']);
      return finish(ed, { id }, (after) => {
        const g = after.states.get(id);
        return after.states.get(edit.id)?.parent === id && !!g && g.parent === scope.parent && g.region === scope.region && statesUnchanged(model, after, (k) => k === edit.id);
      });
    }

    case 'moveState':
      return moveState(ed, edit.id, edit.into);

    case 'setStateKind': {
      const st = model.states.get(edit.id);
      const info = map.states.get(edit.id);
      if (!st || !info || st.composite) return null;
      if (st.kind === edit.stateKind) return { source };
      // mermaid draws any state with a title / description as a box.
      if (edit.stateKind !== 'normal' && info.descriptions.length) return null;
      const first = info.mentions[0];
      const fs = ed.stmt(first);
      if (fs.t === 'special') {
        if (edit.stateKind === 'normal') {
          // `state X <<fork>>` → `X`: keeps the first mention in place.
          ed.splices.push({ start: fs.start, end: fs.end, text: source.slice(fs.ref.span.start, fs.ref.span.end) });
        } else {
          const brackets = source[fs.kindSpan.start] === '[';
          ed.splices.push({ start: fs.kindSpan.start, end: fs.kindSpan.end, text: brackets ? `[[${edit.stateKind}]]` : `<<${edit.stateKind}>>` });
        }
      } else {
        if (!writableId(edit.id)) return null;
        // The first mention decides the shape: declare it right before.
        ed.insertBefore(first, `state ${edit.id} <<${edit.stateKind}>>`);
      }
      return finish(ed, {}, (after) => after.states.get(edit.id)?.kind === edit.stateKind && statesUnchanged(model, after, (k) => k === edit.id));
    }

    case 'addStart':
    case 'addEnd': {
      if (!model.states.has(edit.id)) return null;
      const scope = scopeOf(model, edit.id);
      const terminal: StateEndpoint = { kind: edit.kind === 'addStart' ? 'start' : 'end', scope };
      const state: StateEndpoint = { kind: 'state', id: edit.id };
      return apply(ed, edit.kind === 'addStart' ? { kind: 'addTransition', from: terminal, to: state } : { kind: 'addTransition', from: state, to: terminal });
    }

    case 'addTransition': {
      const { from, to } = edit;
      if (from.kind === 'end' || to.kind === 'start') return null;
      for (const e of [from, to]) {
        if (e.kind === 'state' && (!model.states.has(e.id) || !writableId(e.id))) return null;
        if (e.kind !== 'state' && !validScope(model, e.scope)) return null;
      }
      let scope: StateScope = ROOT;
      const terminalScopes = [from, to].filter((e) => e.kind !== 'state').map((e) => (e as { scope: StateScope }).scope);
      if (terminalScopes.length) {
        scope = terminalScopes[0];
        if (terminalScopes.some((s) => !sameScope(s, scope))) return null;
        // A group's start / end only connects inside that group: the
        // mention would otherwise pull the state into it.
        if (scope.parent !== null) {
          for (const e of [from, to]) if (e.kind === 'state' && !sameScope(scopeOf(model, e.id), scope)) return null;
        }
      } else if (from.kind === 'state' && to.kind === 'state') {
        const a = scopeOf(model, from.id);
        if (a.parent !== null && sameScope(a, scopeOf(model, to.id))) scope = a;
      }
      const tail = edit.label?.trim() ? ` : ${encodeStateText(edit.label, 'label')}` : '';
      ed.appendToScope(scope, [`${endpointText(from)} --> ${endpointText(to)}${tail}`]);
      return finish(
        ed,
        {},
        (after) => after.transitions.length === model.transitions.length + 1 && statesUnchanged(model, after),
        (after) => ({ index: insertedIndex(model.transitions, after.transitions) }),
      );
    }

    case 'setTransitionLabel': {
      const i = map.transitions[edit.index];
      if (i === undefined) return null;
      const s = ed.stmt(i);
      if (s.t !== 'relation') return null;
      const label = edit.label.trim();
      if (!label) {
        if (!s.label) return { source };
        ed.splices.push({ start: s.to.end, end: s.end, text: '' });
      } else if (s.label) {
        ed.splices.push({ start: s.label.start, end: s.label.end, text: encodeStateText(label, 'label', edit.markdown) });
      } else {
        ed.splices.push({ start: s.to.end, end: s.to.end, text: ` : ${encodeStateText(label, 'label', edit.markdown)}` });
      }
      return { source: ed.result() };
    }

    case 'deleteTransition': {
      const i = map.transitions[edit.index];
      if (i === undefined) return null;
      ed.removeStatements([i]);
      return finish(ed, {}, (after) => after.transitions.length === model.transitions.length - 1 && statesUnchanged(model, after, (k) => emptiedGroup(model, after, k)));
    }

    case 'deleteTerminal': {
      const t = edit.terminal;
      const idxs: number[] = [];
      model.transitions.forEach((tr, k) => {
        const e = t.kind === 'start' ? tr.from : tr.to;
        if (e.kind === t.kind && sameScope(e.scope, t.scope)) idxs.push(map.transitions[k]);
      });
      if (!idxs.length) return null;
      ed.removeStatements(idxs);
      return finish(ed, {}, (after) => !after.terminals.some((x) => x.kind === t.kind && sameScope(x.scope, t.scope)) && statesUnchanged(model, after, (k) => emptiedGroup(model, after, k)));
    }

    case 'addNote': {
      const st = model.states.get(edit.state);
      if (!st || !writableId(edit.state)) return null;
      const lines = noteLines(edit.text);
      if (!lines.length) return null;
      // In the state's own scope (a note on a group sits beside it), at
      // the end — so never before the state's first mention, which
      // mermaid can't draw.
      ed.appendToScope(scopeOf(model, edit.state), noteStatement(edit.state, edit.position, lines, edit.markdown));
      return finish(
        ed,
        {},
        (after) => after.notes.length === model.notes.length + 1 && statesUnchanged(model, after),
        (after) => ({ index: insertedIndex(model.notes, after.notes) }),
      );
    }

    case 'setNotePosition': {
      const i = map.notes[edit.index];
      if (i === undefined) return null;
      const s = ed.stmt(i);
      if (s.t !== 'note') return null;
      ed.splices.push({ start: s.positionSpan.start, end: s.positionSpan.end, text: `${edit.position} of` });
      return { source: ed.result() };
    }

    case 'setNoteText': {
      const i = map.notes[edit.index];
      if (i === undefined) return null;
      const s = ed.stmt(i);
      if (s.t !== 'note') return null;
      const lines = noteLines(edit.text);
      if (!lines.length) return null;
      if (!s.multiline && lines.length === 1) {
        // Rewrite from the id on: mermaid reads `X:text` with a quirk
        // (it drops the first letter), so the old spacing isn't kept.
        ed.splices.push({ start: s.tail.start, end: s.tail.end, text: ` : ${encodeStateText(lines[0], 'note', edit.markdown)}` });
        return { source: ed.result() };
      }
      // Multi-line form (kept once a note has it): replace the body,
      // keeping the body's and `end note`'s indentation.
      const openerIndent = ed.indentAt(s.start);
      let bodyIndent = openerIndent + DEFAULT_INDENT;
      let endIndent = openerIndent;
      let endStart = s.tail.end;
      if (s.multiline) {
        endStart = s.tail.end - 'end note'.length;
        const ls = ed.lineStart(s.text.start);
        if (ls > ed.lineStart(s.start) && source.slice(ls, s.text.start).trim() === '') bodyIndent = source.slice(ls, s.text.start);
        const els = ed.lineStart(endStart);
        if (source.slice(els, endStart).trim() === '') endIndent = source.slice(els, endStart);
      }
      const body = lines.map((l) => ed.eol + bodyIndent + encodeStateText(l, 'body', edit.markdown)).join('');
      ed.splices.push({ start: s.tail.start, end: endStart, text: body + ed.eol + endIndent + (s.multiline ? '' : 'end note') });
      return { source: ed.result() };
    }

    case 'deleteNote': {
      const i = map.notes[edit.index];
      if (i === undefined) return null;
      ed.removeStatements([i]);
      return finish(ed, {}, (after) => after.notes.length === model.notes.length - 1 && statesUnchanged(model, after));
    }

    case 'setDirection': {
      if (model.direction === edit.direction) return { source };
      const last = map.directions[map.directions.length - 1];
      if (last !== undefined) {
        // mermaid uses the last top-level `direction`.
        const s = ed.stmt(last) as { valueSpan: { start: number; end: number } };
        ed.splices.push({ start: s.valueSpan.start, end: s.valueSpan.end, text: edit.direction });
      } else {
        const indent = map.root.length ? ed.indentNear(map.root[0]) : DEFAULT_INDENT;
        const at = ed.lineEnd(map.header.end);
        ed.splices.push({ start: at, end: at, text: `${ed.eol}${indent}direction ${edit.direction}` });
      }
      return { source: ed.result() };
    }

    case 'setCompositeDirection': {
      const st = model.states.get(edit.id);
      if (!st?.composite || st.composite.regions > 1) return null;
      if (st.composite.direction === edit.direction) return { source };
      // mermaid reads the last `direction` of the group's first body.
      const block = map.states.get(edit.id)!.blocks[0];
      const body = (ed.stmt(block) as { body: StateBody }).body;
      const dirs = body.stmts.filter((i) => ed.stmt(i).t === 'direction');
      const last = dirs[dirs.length - 1];
      if (last !== undefined) {
        const s = ed.stmt(last) as { valueSpan: { start: number; end: number } };
        ed.splices.push({ start: s.valueSpan.start, end: s.valueSpan.end, text: edit.direction });
      } else {
        // First thing in the body, on a line of its own.
        const indent = body.stmts.length ? ed.indentNear(body.stmts[0]) : ed.indentAt(ed.stmt(block).start) + DEFAULT_INDENT;
        const text = `${ed.eol}${indent}direction ${edit.direction}`;
        if (ed.restIsBlank(body.open + 1)) {
          const at = ed.lineEnd(body.open);
          ed.splices.push({ start: at, end: at, text });
        } else {
          ed.splices.push({ start: body.open + 1, end: body.open + 1, text: text + ed.eol + indent });
        }
      }
      return finish(ed, {}, (after) => after.states.get(edit.id)?.composite?.direction === edit.direction);
    }
  }
}

// A group that had members and has none after the edit — it was turned
// into a plain state (fillEmptyGroups).
function emptiedGroup(before: StateModel, after: StateModel, id: string): boolean {
  return !!before.states.get(id)?.composite && !after.states.get(id)?.composite;
}

// Finish an edit whose result has to be checked: turn groups the edit
// left empty into plain states, re-parse, and refuse (null) when `ok`
// doesn't hold.
function finish(
  ed: Editor,
  extra: Pick<StateEditResult, 'id' | 'index'>,
  ok: (after: StateModel) => boolean,
  more?: (after: StateModel) => Pick<StateEditResult, 'id' | 'index'>,
): StateEditResult | null {
  let out = ed.result();
  let parsed = parseStateSource(out);
  if (!parsed.ok) return null;
  const filled = fillEmptyGroups(ed.model, parsed.model, parsed.map);
  if (filled !== out) {
    out = filled;
    parsed = parseStateSource(out);
    if (!parsed.ok) return null;
  }
  // Never hand back something mermaid parses but can't draw.
  if (parsed.map.undrawable.some((p) => !ed.map.undrawable.includes(p))) return null;
  if (!ok(parsed.model)) return null;
  return { source: out, ...extra, ...(more ? more(parsed.model) : {}) };
}

// mermaid can't draw a group with nothing inside it. A group that lost
// its last member in this edit becomes a plain state that keeps the
// group's label: `state G {…}` → `G`, `state "…" as G {…}` → `state "…" as G`.
function fillEmptyGroups(before: StateModel, model: StateModel, map: StateSourceMap): string {
  const hasMembers = (m: StateModel, id: string) =>
    [...m.states.values()].some((s) => s.parent === id) || m.terminals.some((t) => t.scope.parent === id);
  const empty = [...model.states.values()].filter((g) => g.composite && !hasMembers(model, g.id) && hasMembers(before, g.id));
  if (!empty.length) return map.source;
  const ed = new Editor(map, model);
  for (const g of empty) {
    for (const b of map.states.get(g.id)!.blocks) {
      const s = ed.stmt(b);
      if (s.t === 'block') ed.splices.push({ start: s.start, end: s.end, text: map.source.slice(s.ref.span.start, s.ref.span.end) });
      else if (s.t === 'decl' && s.body) ed.splices.push({ start: s.ref.end, end: s.end, text: '' });
    }
  }
  return ed.result();
}

// ── moveState ───────────────────────────────────────────────────────

// Move a state into group `into` (null: the top level). mermaid draws a
// state in the group of its LAST mention inside any group, so:
//   - the state gets a mention at the end of the destination (its own
//     statements from a group they'd no longer belong to move there, or
//     a bare `Id` line)
//   - a mention in another group written after that point would win:
//     a transition with another state moves to the top level (where a
//     mention moves nothing); a start / end connection of that group is
//     removed (it can't follow the state out); the state's own
//     statements (description, note, its body when it is a group) move
//     along to the destination
// Mentions at the top level, or before the destination's end, stay.
function moveState(ed: Editor, id: string, into: string | null): StateEditResult | null {
  const { model, map } = ed;
  const st = model.states.get(id);
  const info = map.states.get(id);
  if (!st || !info || !writableId(id)) return null;
  const inner = descendants(model, id);
  if (into !== null && (!model.states.get(into)?.composite || into === id || inner.includes(into))) return null;
  if (st.parent === into) return { source: map.source };
  const dest = lastRegion(model, into);

  // Where the state's new mention goes: the end of the destination.
  const destStmts = ed.scopeStatements(dest);
  const lastDest = destStmts[destStmts.length - 1];
  const point =
    into === null
      ? map.source.length
      : lastDest !== undefined
        ? ed.stmt(lastDest).end
        : (ed.stmt(ed.lastBlock(into)) as { body: StateBody }).body.open;

  const toDest: number[] = [];
  const toRoot: number[] = [];
  const drop: number[] = [];
  for (const m of info.mentions) {
    const s = ed.stmt(m);
    if (s.scope.parent === null || (into !== null && s.scope.parent === into)) continue;
    if (into !== null && s.end <= point) continue;
    if (s.t === 'relation') {
      if (s.from.star || s.to.star) drop.push(m);
      else toRoot.push(m);
    } else {
      toDest.push(m);
    }
  }
  ed.managed.add(id);
  const isNote = (m: number) => ed.stmt(m).t === 'note';
  const ownTexts = toDest.filter((m) => !isNote(m)).map((m) => ed.reindented(m, ed.scopeIndent(dest)));
  const noteTexts = toDest.filter(isNote).map((m) => ed.reindented(m, ed.scopeIndent(dest)));
  const rootTexts = toRoot.map((m) => ed.reindented(m, ed.scopeIndent(ROOT)));
  ed.removeStatements([...toDest, ...toRoot, ...drop]);
  // The new mention may end up being the state's first one, which picks
  // its shape: a fork / join / choice is mentioned by its declaration.
  // A note never goes first (mermaid can't draw a state introduced by
  // a note).
  const mention = st.kind === 'normal' ? id : `state ${id} <<${st.kind}>>`;
  const left = info.mentions.filter((m) => !toDest.includes(m) && !toRoot.includes(m) && !drop.includes(m));
  const needsMention =
    into !== null
      ? !ownTexts.length && (noteTexts.length > 0 || !left.some((m) => ed.stmt(m).scope.parent === into))
      : !ownTexts.length && !rootTexts.length && (noteTexts.length > 0 || !left.length);
  if (needsMention) ownTexts.unshift(mention);
  if (into === null) {
    ed.appendToScope(ROOT, [...ownTexts, ...rootTexts, ...noteTexts]);
  } else {
    ed.appendToScope(dest, [...ownTexts, ...noteTexts]);
    if (rootTexts.length) ed.appendToScope(ROOT, rootTexts);
  }

  const dropped = new Set(drop.map((d) => map.transitions.indexOf(d)));
  const kept = transitionKeys(model.transitions.filter((_, k) => !dropped.has(k)));
  return finish(ed, {}, (after) => {
    const s2 = after.states.get(id);
    if (!s2 || s2.parent !== into || s2.label !== st.label || s2.kind !== st.kind) return false;
    if (!statesUnchanged(model, after, (k) => k === id || inner.includes(k) || emptiedGroup(model, after, k))) return false;
    return JSON.stringify(transitionKeys(after.transitions)) === JSON.stringify(kept);
  });
}
