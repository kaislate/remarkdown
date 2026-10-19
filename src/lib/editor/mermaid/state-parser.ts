// Parser for mermaid state diagrams (`stateDiagram-v2` and the legacy
// `stateDiagram`, which mermaid 11 draws with the same renderer).
//
// State diagram syntax is full of lexer-level surprises, so instead of
// a line-regex subset (like the sequence parser) this is a faithful
// port of what mermaid 11.14 actually does:
//   1. the same preprocessing (frontmatter, `%%{init}%%` directives and
//      `%%` comment lines removed, entity codes hidden from the lexer),
//      with an offset map back to the original source
//   2. mermaid's jison LEXER, rule for rule (first match wins, same
//      start conditions) — e.g. any line containing `direction LR`
//      lexes as a direction statement, `;` and `::` end a label, a
//      `#` at a token start begins a comment
//   3. a recursive-descent parser for mermaid's grammar
//   4. mermaid's data walk (dataFetcher.ts), which decides what is
//      drawn: the first mention of a state picks its shape, every
//      truthy description is a line of text (the first one is the
//      title), a state sits in the LAST group it is mentioned in,
//      `[*]` is one start / one end node per group or concurrency
//      region, and one counter numbers both transitions and notes
//      (that number is the rendered edge id: `edge<N>`)
// Anything mermaid rejects comes back `{ ok: false }`; so does the one
// construct mermaid itself mishandles (`--` at the top level).
//
// Model text is what mermaid displays: trimmed, entity codes decoded.
// The source map (statement spans as offsets into the ORIGINAL source)
// drives the source-preserving edits in state-edit.ts.
import { decodeMermaidEntities } from '../mermaid-parser';
import { findPreamble, type Span } from './source-text';

export type StateDirection = 'TB' | 'BT' | 'LR' | 'RL';
export type StateKind = 'normal' | 'fork' | 'join' | 'choice';
export type NotePosition = 'left' | 'right';

// Where something is drawn: inside group `parent` (null = top level),
// in concurrency region `region` of it (0 when it has no `--`).
export interface StateScope {
  parent: string | null;
  region: number;
}

export interface StateNode {
  id: string;
  kind: StateKind;
  // Title mermaid shows: the first description, else the id.
  label: string;
  // Further description lines shown under the title.
  descriptions: string[];
  parent: string | null;
  region: number;
  // Set when the state is a group (composite) with a body.
  composite: { direction: StateDirection; regions: number } | null;
}

export type StateEndpoint =
  | { kind: 'state'; id: string }
  // `[*]`: the start (as a source) or end (as a target) of a scope.
  | { kind: 'start' | 'end'; scope: StateScope };

export interface StateTransition {
  from: StateEndpoint;
  to: StateEndpoint;
  label: string;
}

export interface StateNote {
  state: string;
  position: NotePosition;
  // Multi-line notes: lines trimmed, blank lines dropped, joined by \n.
  text: string;
}

// A start or end circle mermaid draws (one per scope that uses it).
export interface StateTerminal {
  kind: 'start' | 'end';
  scope: StateScope;
}

// mermaid's own ids for rendered items — what state-svg.ts matches the
// SVG against. Not part of the diagram's meaning: an edit elsewhere can
// renumber them.
export interface StateRenderIds {
  // data-id of transitions[i]'s path and label: `edge<N>`.
  transitions: string[];
  // Node id of notes[i]: `<state>----note-<N>`.
  notes: string[];
  // Groups with concurrency regions: the node id of each region. mermaid
  // gives the last region a random id per render — null here.
  regions: Map<string, Array<string | null>>;
}

export interface StateModel {
  version: 1 | 2;
  // Frontmatter `title:`.
  title: string | null;
  // Top-level layout direction (mermaid's default is TB).
  direction: StateDirection;
  // Every drawn state (groups included) in mermaid's node order.
  states: Map<string, StateNode>;
  // In source order — the order mermaid numbers them in.
  transitions: StateTransition[];
  notes: StateNote[];
  terminals: StateTerminal[];
  render: StateRenderIds;
}

// ── Source map ──────────────────────────────────────────────────────

// An id as written: `Foo`, `[*]`, optionally with `:::cls` after it.
export interface IdRef {
  id: string;
  star: boolean;
  span: Span;
  // End of the whole reference (past `:::cls` when present).
  end: number;
}

interface StmtBase {
  // Offsets into the original source: first token start, last token end.
  start: number;
  end: number;
  // Index of the block statement (group) this one sits directly in;
  // null at the top level.
  container: number | null;
  scope: StateScope;
}

// A group body: `{` … `}` and the statements directly inside.
export interface StateBody {
  open: number;
  close: number;
  stmts: number[];
}

export type StateStatement = StmtBase &
  (
    | { t: 'relation'; from: IdRef; to: IdRef; label: Span | null }
    // `X` / `X:::cls` on its own.
    | { t: 'id'; ref: IdRef }
    // `X : text`
    | { t: 'desc'; ref: IdRef; text: Span }
    // `state "text" as X`, optionally with a body.
    | { t: 'decl'; ref: IdRef; text: Span; body: StateBody | null }
    // `state X { … }`; body null for a bare `state X` (mermaid ignores it).
    | { t: 'block'; ref: IdRef; body: StateBody | null }
    // `state X <<fork>>` / `[[fork]]`; `kindSpan` covers the marker.
    | { t: 'special'; ref: IdRef; kind: Exclude<StateKind, 'normal'>; kindSpan: Span }
    | { t: 'divider' }
    // `note left of X : text` / multi-line `note … end note`.
    // `tail` runs from the end of the id through the end of the note.
    | { t: 'note'; ref: IdRef; position: NotePosition; positionSpan: Span; text: Span; multiline: boolean; tail: Span }
    | { t: 'direction'; value: StateDirection; valueSpan: Span }
    // `class A,B name` / `style A,B …`: the id list, each id's span.
    | { t: 'class' | 'style'; ids: Array<{ id: string; span: Span }>; idsSpan: Span }
    | { t: 'click'; ref: IdRef }
    // classDef, hide empty description, scale, accTitle/accDescr,
    // floating notes: nothing an edit needs to look inside.
    | { t: 'other' }
  );

export interface StateDescriptionSource {
  stmt: number;
  // The text as written (inside the quotes for `state "…" as X`).
  span: Span;
  quoted: boolean;
}

export interface StateSourceInfo {
  // Statements mermaid walks that mention the state, in source order.
  mentions: number[];
  // Every statement referring to the id (also class / style / click).
  refs: number[];
  // Descriptions in display order (the first one is the title).
  descriptions: StateDescriptionSource[];
  // Group bodies of the state (statements with a body).
  blocks: number[];
}

export interface StateSourceMap {
  source: string;
  eol: string;
  // The `stateDiagram` / `stateDiagram-v2` keyword.
  header: Span;
  // Every statement, in source order (group bodies included).
  statements: StateStatement[];
  // Top-level statements.
  root: number[];
  // model.transitions[i] / model.notes[i] ↔ statement index.
  transitions: number[];
  notes: number[];
  states: Map<string, StateSourceInfo>;
  // Top-level `direction` statements.
  directions: number[];
}

export type StateSourceParseResult =
  | { ok: true; model: StateModel; map: StateSourceMap }
  | { ok: false; reason: string };

export type StateParseResult = { ok: true; model: StateModel } | { ok: false; reason: string };

export const STATE_STARTER = [
  'stateDiagram-v2',
  '    [*] --> Draft',
  '    Draft --> Review : submit',
  '    Review --> Draft : changes requested',
  '    Review --> Published : approve',
  '    Published --> [*]',
  '',
].join('\n');

// ── 1. Preprocessing with an offset map ─────────────────────────────

// Text plus, for each char, its offset in the original source
// (map[text.length] = end). A replaced run maps its last char to the
// last original char, so a span's end maps back as map[end - 1] + 1.
interface Mapped {
  text: string;
  map: number[];
}

function dropRanges(m: Mapped, ranges: Array<[number, number]>): Mapped {
  if (!ranges.length) return m;
  let text = '';
  const map: number[] = [];
  let pos = 0;
  for (const [s, e] of ranges) {
    text += m.text.slice(pos, s);
    for (let i = pos; i < s; i++) map.push(m.map[i]);
    pos = e;
  }
  text += m.text.slice(pos);
  for (let i = pos; i <= m.text.length; i++) map.push(m.map[i]);
  return { text, map };
}

function matchRanges(text: string, re: RegExp): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const mm of text.matchAll(re)) out.push([mm.index!, mm.index! + mm[0].length]);
  return out;
}

// mermaid's preprocessDiagram + Diagram.fromText, in the same order.
function preprocess(source: string): Mapped {
  let m: Mapped = { text: source, map: Array.from({ length: source.length + 1 }, (_, i) => i) };
  // cleanupText: CRLF / CR → LF; `<tag a="x">` attribute quotes → '.
  m = dropRanges(m, matchRanges(m.text, /\r(?=\n)/g));
  let t = m.text.replace(/\r/g, '\n');
  t = t.replace(/<(\w+)([^>]*)>/g, (_s, tag: string, attrs: string) => '<' + tag + attrs.replace(/="([^"]*)"/g, "='$1'") + '>');
  m = { text: t, map: m.map };
  // Frontmatter.
  const fm = /^-{3}\s*[\n\r](.*?)[\n\r]-{3}\s*[\n\r]+/s.exec(m.text);
  if (fm) m = dropRanges(m, [[0, fm[0].length]]);
  // %%{…}%% directives (anywhere).
  m = dropRanges(m, matchRanges(m.text, /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi));
  // %% comment lines, then leading whitespace.
  m = dropRanges(m, matchRanges(m.text, /^\s*%%(?!{)[^\n]+\n?/gm));
  const lead = /^\s*/.exec(m.text)![0].length;
  if (lead) m = dropRanges(m, [[0, lead]]);
  // encodeEntities: a style / classDef line holding `#…;` loses its
  // last `;` (so `#f00;` isn't read as an entity) …
  for (const re of [/style.*:\S*#.*;/g, /classDef.*:\S*#.*;/g]) {
    m = dropRanges(m, matchRanges(m.text, re).map(([, e]) => [e - 1, e] as [number, number]));
  }
  // … and every `#name;` / `#123;` becomes a placeholder the lexer
  // can't see into (mermaid turns it back into an entity in the SVG).
  let text = '';
  const map: number[] = [];
  let pos = 0;
  for (const mm of m.text.matchAll(/#\w+;/g)) {
    const s = mm.index!;
    const e = s + mm[0].length;
    text += m.text.slice(pos, s);
    for (let i = pos; i < s; i++) map.push(m.map[i]);
    const inner = mm[0].slice(1, -1);
    const ph = (/^\+?\d+$/.test(inner) ? 'ﬂ\xB0\xB0' : 'ﬂ\xB0') + inner + '\xB6\xDF';
    text += ph;
    for (let k = 0; k < ph.length; k++) map.push(k === ph.length - 1 ? m.map[e - 1] : m.map[s]);
    pos = e;
  }
  text += m.text.slice(pos);
  for (let i = pos; i <= m.text.length; i++) map.push(m.map[i]);
  // Diagram.fromText appends a newline.
  const end = map[map.length - 1];
  return { text: text + '\n', map: [...map.slice(0, -1), end, end] };
}

// Placeholder text back to entity codes, then decoded for display.
function display(raw: string): string {
  const coded = raw.replace(/ﬂ\xB0\xB0?([^\xB6]*)\xB6\xDF/g, '#$1;');
  return decodeMermaidEntities(coded.trim()).trim();
}

// ── 2. mermaid's lexer (stateDiagram.jison), rule for rule ──────────

const RULE_SRC = [
  'click\\b', 'href\\b', '"[^"]*"', 'default\\b',
  '.*direction\\s+TB[^\\n]*', '.*direction\\s+BT[^\\n]*', '.*direction\\s+RL[^\\n]*', '.*direction\\s+LR[^\\n]*',
  '%%(?!\\{)[^\\n]*', '[^\\}]%%[^\\n]*', '[\\n]+', '[\\s]+', '((?!\\n)\\s)+', '#[^\\n]*', '%[^\\n]*',
  'scale\\s+', '\\d+', '\\s+width\\b', 'accTitle\\s*:\\s*', '(?!\\n||)*[^\\n]*', 'accDescr\\s*:\\s*',
  '(?!\\n||)*[^\\n]*', 'accDescr\\s*\\{\\s*', '[\\}]', '[^\\}]*', 'classDef\\s+', 'DEFAULT\\s+', '\\w+\\s+',
  '[^\\n]*', 'class\\s+', '(\\w+)+((,\\s*\\w+)*)', '[^\\n]*', 'style\\s+', '[\\w,]+\\s+', '[^\\n]*',
  'scale\\s+', '\\d+', '\\s+width\\b', 'state\\s+', '.*<<fork>>', '.*<<join>>', '.*<<choice>>',
  '.*\\[\\[fork\\]\\]', '.*\\[\\[join\\]\\]', '.*\\[\\[choice\\]\\]',
  '.*direction\\s+TB[^\\n]*', '.*direction\\s+BT[^\\n]*', '.*direction\\s+RL[^\\n]*', '.*direction\\s+LR[^\\n]*',
  '["]', '\\s*as\\s+', '[^\\n\\{]*', '["]', '[^"]*', '[^\\n\\s\\{]+', '\\n', '\\{', '%%(?!\\{)[^\\n]*', '\\}',
  '[\\n]', 'note\\s+', 'left of\\b', 'right of\\b', '"', '\\s*as\\s*', '["]', '[^"]*', '[^\\n]*',
  '\\s*[^:\\n\\s\\-]+', '\\s*:[^:\\n;]+', '[\\s\\S]*?end note\\b', 'stateDiagram\\s+', 'stateDiagram-v2\\s+',
  'hide empty description\\b', '\\[\\*\\]', '[^:\\n\\s\\-\\{]+', '\\s*:(?:[^:\\n;]|:[^:\\n;])+', '-->', '--',
  ':::', '$', '.',
];
const RULES = RULE_SRC.map((s) => new RegExp(`(?:${s})`, 'iy'));

const CONDITIONS: Record<string, number[]> = {
  INITIAL: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 18, 20, 22, 25, 29, 32, 35, 38, 56, 60, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81],
  struct: [12, 13, 25, 29, 32, 38, 45, 46, 47, 48, 57, 58, 59, 60, 74, 75, 76, 77, 78, 79],
  FLOATING_NOTE_ID: [67],
  FLOATING_NOTE: [64, 65, 66],
  NOTE_TEXT: [69, 70],
  NOTE_ID: [68],
  NOTE: [61, 62, 63],
  STYLEDEF_STYLES: [34],
  STYLE: [33],
  CLASS_STYLE: [31],
  CLASS: [30],
  CLASSDEFID: [28],
  CLASSDEF: [26, 27],
  acc_descr_multiline: [23, 24],
  acc_descr: [21],
  acc_title: [19],
  SCALE: [16, 17, 36, 37],
  STATE_ID: [51],
  STATE_STRING: [52, 53],
  STATE: [12, 13, 39, 40, 41, 42, 43, 44, 49, 50, 54, 55, 56],
};

interface Tok {
  type: string;
  // yytext after the rule's action (trimmed / sliced where mermaid does).
  text: string;
  // The whole match, in preprocessed-text offsets.
  start: number;
  end: number;
  raw: string;
  rule: number;
  // Start of a keyword the lexer skipped right before this token (the
  // `state ` of `state X {` / `state "…" as X`): where the statement starts.
  lead?: number;
}

const DIRS: StateDirection[] = ['TB', 'BT', 'RL', 'LR'];

function lex(text: string): Tok[] | string {
  const toks: Tok[] = [];
  const stack = ['INITIAL'];
  const push = (s: string) => stack.push(s);
  const pop = () => {
    if (stack.length > 1) stack.pop();
  };
  let pos = 0;
  let done = false;
  let lead: number | null = null;
  for (;;) {
    if (done) break;
    if (pos >= text.length) done = true;
    const rules = CONDITIONS[stack[stack.length - 1]];
    let idx = -1;
    let raw = '';
    for (const r of rules) {
      const re = RULES[r];
      re.lastIndex = pos;
      const mm = re.exec(text);
      if (mm) {
        idx = r;
        raw = mm[0];
        break;
      }
    }
    if (idx < 0) {
      if (pos >= text.length) break;
      return `lexical error at ${pos}`;
    }
    const start = pos;
    pos += raw.length;
    let type: string | null = null;
    let yt = raw;
    switch (idx) {
      case 0: type = 'CLICK'; break;
      case 1: type = 'HREF'; break;
      case 2: type = 'STRING'; break;
      case 3: type = 'DEFAULT'; break;
      case 4: case 5: case 6: case 7: type = `DIR_${DIRS[idx - 4]}`; break;
      case 10: type = 'NL'; break;
      case 15: case 35: push('SCALE'); type = 'scale'; break;
      case 16: case 36: type = 'WIDTH'; break;
      case 17: case 37: pop(); break;
      case 18: push('acc_title'); type = 'acc_title'; break;
      case 19: pop(); type = 'acc_title_value'; break;
      case 20: push('acc_descr'); type = 'acc_descr'; break;
      case 21: pop(); type = 'acc_descr_value'; break;
      case 22: push('acc_descr_multiline'); break;
      case 23: pop(); break;
      case 24: type = 'acc_descr_multiline_value'; break;
      case 25: push('CLASSDEF'); type = 'classDef'; break;
      case 26: pop(); push('CLASSDEFID'); type = 'DEFAULT_CLASSDEF_ID'; break;
      case 27: pop(); push('CLASSDEFID'); type = 'CLASSDEF_ID'; break;
      case 28: pop(); type = 'CLASSDEF_STYLEOPTS'; break;
      case 29: push('CLASS'); type = 'class'; break;
      case 30: pop(); push('CLASS_STYLE'); type = 'CLASSENTITY_IDS'; break;
      case 31: pop(); type = 'STYLECLASS'; break;
      case 32: push('STYLE'); type = 'style'; break;
      case 33: pop(); push('STYLEDEF_STYLES'); type = 'STYLE_IDS'; break;
      case 34: pop(); type = 'STYLEDEF_STYLEOPTS'; break;
      case 38: push('STATE'); lead = start; break;
      case 39: case 42: pop(); yt = raw.slice(0, -8).trim(); type = 'FORK'; break;
      case 40: case 43: pop(); yt = raw.slice(0, -8).trim(); type = 'JOIN'; break;
      case 41: case 44: pop(); yt = raw.slice(0, -10).trim(); type = 'CHOICE'; break;
      case 45: case 46: case 47: case 48: type = `DIR_${DIRS[idx - 45]}`; break;
      case 49: push('STATE_STRING'); break;
      case 50: push('STATE_ID'); type = 'AS'; break;
      case 51: pop(); type = 'ID'; break;
      case 52: pop(); break;
      case 53: type = 'STATE_DESCR'; break;
      case 54: type = 'COMPOSIT_STATE'; break;
      case 55: pop(); break;
      case 56: pop(); push('struct'); type = 'STRUCT_START'; break;
      case 58: pop(); type = 'STRUCT_STOP'; break;
      case 60: push('NOTE'); type = 'note'; break;
      case 61: pop(); push('NOTE_ID'); type = 'left_of'; break;
      case 62: pop(); push('NOTE_ID'); type = 'right_of'; break;
      case 63: pop(); push('FLOATING_NOTE'); break;
      case 64: pop(); push('FLOATING_NOTE_ID'); type = 'AS'; break;
      case 66: type = 'NOTE_TEXT'; break;
      case 67: pop(); type = 'ID'; break;
      case 68: pop(); push('NOTE_TEXT'); type = 'ID'; break;
      case 69: pop(); yt = raw.substr(2).trim(); type = 'NOTE_TEXT'; break;
      case 70: pop(); yt = raw.slice(0, -8).trim(); type = 'NOTE_TEXT'; break;
      case 71: case 72: type = 'SD'; break;
      case 73: type = 'HIDE_EMPTY'; break;
      case 74: type = 'EDGE_STATE'; break;
      case 75: type = 'ID'; break;
      case 76: yt = raw.trim(); type = 'DESCR'; break;
      case 77: type = '-->'; break;
      case 78: type = 'CONCURRENT'; break;
      case 79: type = 'STYLE_SEPARATOR'; break;
      case 80: type = 'NL'; break;
      case 81: type = 'INVALID'; break;
      default: break; // whitespace, comments
    }
    if (type) {
      toks.push({ type, text: yt, start, end: pos, raw, rule: idx, ...(lead !== null ? { lead } : {}) });
      lead = null;
    }
  }
  toks.push({ type: 'EOF', text: '', start: text.length, end: text.length, raw: '', rule: -1 });
  return toks;
}

// ── 3. Parser (stateDiagram.jison's grammar) ────────────────────────

// Parsed items, shaped like mermaid's so the walk below can follow
// dataFetcher.ts step by step.
interface Item {
  stmt: number;
  kind: 'relation' | 'state' | 'divider' | 'dir' | 'none';
  // state items
  id?: string;
  star?: boolean;
  type?: 'default' | 'fork' | 'join' | 'choice' | 'divider' | undefined;
  descriptions?: string[];
  doc?: Item[];
  note?: { position: NotePosition; text: string };
  // relation items
  state1?: Item;
  state2?: Item;
  label?: string;
  dir?: StateDirection;
  dividerId?: string;
}

class ParseError extends Error {}

function parse(source: string, m: Mapped, toks: Tok[]) {
  let p = 0;
  const statements: StateStatement[] = [];
  let dividers = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (type: string): Tok => {
    const t = toks[p];
    if (t.type !== type) throw new ParseError(`expected ${type}, got ${t.type} "${t.raw.trim()}"`);
    p++;
    return t;
  };
  // Original-source span of preprocessed [s, e).
  const orig = (s: number, e: number): Span => (e > s ? { start: m.map[s], end: m.map[e - 1] + 1 } : { start: m.map[s], end: m.map[s] });
  // Span of the trimmed part of tok.raw from offset `from` (in raw).
  const trimmedIn = (t: Tok, from = 0, to = t.raw.length): Span => {
    const seg = t.raw.slice(from, to);
    const lead = seg.length - seg.trimStart().length;
    const body = seg.trim();
    const s = t.start + from + lead;
    return orig(s, s + body.length);
  };

  const idRef = (): IdRef => {
    const t = next();
    if (t.type !== 'ID' && t.type !== 'EDGE_STATE') throw new ParseError(`expected a state, got "${t.raw.trim()}"`);
    const span = orig(t.start, t.end);
    let end = span.end;
    if (peek().type === 'STYLE_SEPARATOR') {
      next();
      const cls = expect('ID');
      end = orig(cls.start, cls.end).end;
    }
    return { id: t.text.trim(), star: t.type === 'EDGE_STATE', span, end };
  };

  const add = (s: StateStatement): number => {
    statements.push(s);
    return statements.length - 1;
  };

  // Placeholder fields filled once the statement's extent is known.
  const base = (startTok: Tok): StmtBase => ({
    start: m.map[startTok.lead ?? startTok.start],
    end: 0,
    container: null,
    scope: { parent: null, region: 0 },
  });
  const finish = (i: number) => {
    const last = toks[p - 1];
    statements[i].end = orig(last.start, last.end).end;
  };

  const document = (inStruct: boolean): Item[] => {
    const items: Item[] = [];
    for (;;) {
      const t = peek();
      if (t.type === 'EOF') {
        if (inStruct) throw new ParseError('missing } at the end');
        return items;
      }
      if (inStruct && t.type === 'STRUCT_STOP') return items;
      if (t.type === 'NL') {
        next();
        continue;
      }
      items.push(statement());
    }
  };

  const body = (owner: number): { body: StateBody; doc: Item[] } => {
    const open = expect('STRUCT_START');
    const firstStmt = statements.length;
    const doc = document(true);
    const close = expect('STRUCT_STOP');
    const stmts: number[] = [];
    for (let k = firstStmt; k < statements.length; k++) {
      if (statements[k].container === null && k !== owner) {
        statements[k].container = owner;
        stmts.push(k);
      }
    }
    return { body: { open: orig(open.start, open.end).start, close: orig(close.start, close.end).start, stmts }, doc };
  };

  const statement = (): Item => {
    const t = peek();
    switch (t.type) {
      case 'ID':
      case 'EDGE_STATE': {
        const b = base(t);
        const ref = idRef();
        if (peek().type === '-->') {
          next();
          const to = idRef();
          let label: Span | null = null;
          let text = '';
          if (peek().type === 'DESCR') {
            const d = next();
            // trimColon: drop the leading ':' and trim.
            const colon = d.raw.indexOf(':');
            label = trimmedIn(d, colon + 1);
            text = d.text.startsWith(':') ? d.text.slice(1).trim() : d.text.trim();
          }
          const i = add({ ...b, t: 'relation', from: ref, to, label });
          finish(i);
          return {
            stmt: i,
            kind: 'relation',
            state1: { stmt: i, kind: 'state', id: ref.id, star: ref.star, type: 'default', descriptions: [] },
            state2: { stmt: i, kind: 'state', id: to.id, star: to.star, type: 'default', descriptions: [] },
            label: display(text),
          };
        }
        if (peek().type === 'DESCR') {
          const d = next();
          const colon = d.raw.indexOf(':');
          const textSpan = trimmedIn(d, colon + 1);
          const text = d.text.startsWith(':') ? d.text.slice(1).trim() : d.text.trim();
          const i = add({ ...b, t: 'desc', ref, text: textSpan });
          finish(i);
          return { stmt: i, kind: 'state', id: ref.id, star: ref.star, type: 'default', descriptions: text ? [display(text)] : [] };
        }
        const i = add({ ...b, t: 'id', ref });
        finish(i);
        return { stmt: i, kind: 'state', id: ref.id, star: ref.star, type: 'default', descriptions: [] };
      }
      case 'COMPOSIT_STATE': {
        const b = base(t);
        next();
        const ref: IdRef = { id: t.text.trim(), star: false, span: orig(t.start, t.end), end: orig(t.start, t.end).end };
        const i = add({ ...b, t: 'block', ref, body: null });
        if (peek().type === 'STRUCT_START') {
          const { body: bd, doc } = body(i);
          (statements[i] as { body: StateBody | null }).body = bd;
          finish(i);
          return { stmt: i, kind: 'state', id: ref.id, type: 'default', descriptions: [], doc };
        }
        finish(i);
        // `state X` alone: the grammar yields a bare string mermaid's
        // walk skips — nothing is drawn.
        return { stmt: i, kind: 'none' };
      }
      case 'STATE_DESCR': {
        const b = base(t);
        next();
        const textSpan = trimmedIn(t);
        const descr = t.text;
        expect('AS');
        const idTok = expect('ID');
        // `as Id:extra` puts `extra` in as a second description.
        let idText = idTok.text;
        const descriptions: string[] = [];
        const colon = idText.indexOf(':');
        let idEnd = idTok.raw.length;
        if (colon >= 0) {
          idEnd = colon;
          const parts = idText.split(':');
          idText = parts[0];
          descriptions.push(display(descr), display(parts[1]));
        }
        const ref: IdRef = { id: idText.trim(), star: false, span: trimmedIn(idTok, 0, idEnd), end: trimmedIn(idTok, 0, idEnd).end };
        const i = add({ ...b, t: 'decl', ref, text: textSpan, body: null });
        if (peek().type === 'STRUCT_START') {
          const { body: bd, doc } = body(i);
          (statements[i] as { body: StateBody | null }).body = bd;
          finish(i);
          // The body form keeps the label untrimmed — still truthy when
          // it is all spaces.
          return { stmt: i, kind: 'state', id: ref.id, type: 'default', descriptions: descr ? [display(descr)] : [], doc };
        }
        finish(i);
        if (!descriptions.length && descr.trim()) descriptions.push(display(descr));
        return { stmt: i, kind: 'state', id: ref.id, type: 'default', descriptions };
      }
      case 'FORK':
      case 'JOIN':
      case 'CHOICE': {
        const b = base(t);
        next();
        const kind = t.type.toLowerCase() as 'fork' | 'join' | 'choice';
        const markLen = kind === 'choice' ? 10 : 8;
        const ref: IdRef = { id: t.text, star: false, span: trimmedIn(t, 0, t.raw.length - markLen), end: 0 };
        ref.end = ref.span.end;
        const i = add({ ...b, t: 'special', ref, kind, kindSpan: orig(t.end - markLen, t.end) });
        finish(i);
        return { stmt: i, kind: 'state', id: ref.id, type: kind, descriptions: [] };
      }
      case 'CONCURRENT': {
        const b = base(t);
        next();
        const i = add({ ...b, t: 'divider' });
        finish(i);
        dividers++;
        return { stmt: i, kind: 'divider', dividerId: `divider-id-${dividers}` };
      }
      case 'note': {
        const b = base(t);
        next();
        const pt = peek();
        if (pt.type === 'NOTE_TEXT') {
          // Floating note (`note "text" as N`): mermaid draws nothing.
          next();
          expect('AS');
          expect('ID');
          const i = add({ ...b, t: 'other' });
          finish(i);
          return { stmt: i, kind: 'none' };
        }
        if (pt.type !== 'left_of' && pt.type !== 'right_of') throw new ParseError('expected left of / right of');
        next();
        const idTok = expect('ID');
        const textTok = expect('NOTE_TEXT');
        const idSpan = trimmedIn(idTok);
        const ref: IdRef = { id: idTok.text.trim(), star: false, span: idSpan, end: idSpan.end };
        const multiline = textTok.rule === 70;
        const text = multiline ? trimmedIn(textTok, 0, textTok.raw.length - 8) : trimmedIn(textTok, Math.min(2, textTok.raw.length));
        // mermaid compares the position text case-sensitively.
        const position: NotePosition = pt.raw === 'left of' ? 'left' : 'right';
        const i = add({
          ...b,
          t: 'note',
          ref,
          position,
          positionSpan: orig(pt.start, pt.end),
          text,
          multiline,
          tail: { start: idSpan.end, end: orig(textTok.start, textTok.end).end },
        });
        finish(i);
        const shownText = display(textTok.text)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .join('\n');
        return { stmt: i, kind: 'state', id: ref.id, type: undefined, descriptions: [], note: { position, text: shownText } };
      }
      case 'DIR_TB':
      case 'DIR_BT':
      case 'DIR_RL':
      case 'DIR_LR': {
        const b = base(t);
        next();
        const value = t.type.slice(4) as StateDirection;
        // The last `direction <value>` on the line is the one matched.
        const mm = new RegExp(`^([\\s\\S]*direction\\s+)${value}`, 'i').exec(t.raw)!;
        const s = t.start + mm[1].length;
        const i = add({ ...b, t: 'direction', value, valueSpan: orig(s, s + 2) });
        finish(i);
        return { stmt: i, kind: 'dir', dir: value };
      }
      case 'classDef': {
        const b = base(t);
        next();
        const id = next();
        if (id.type !== 'CLASSDEF_ID' && id.type !== 'DEFAULT') throw new ParseError('bad classDef');
        expect('CLASSDEF_STYLEOPTS');
        const i = add({ ...b, t: 'other' });
        finish(i);
        return { stmt: i, kind: 'none' };
      }
      case 'class':
      case 'style': {
        const b = base(t);
        next();
        const idsTok = expect(t.type === 'class' ? 'CLASSENTITY_IDS' : 'STYLE_IDS');
        expect(t.type === 'class' ? 'STYLECLASS' : 'STYLEDEF_STYLEOPTS');
        const ids: Array<{ id: string; span: Span }> = [];
        const listEnd = idsTok.raw.trimEnd().length;
        for (const mm of idsTok.raw.slice(0, listEnd).matchAll(/[^,\s]+/g)) {
          const s = idsTok.start + mm.index!;
          ids.push({ id: mm[0], span: orig(s, s + mm[0].length) });
        }
        const i = add({ ...b, t: t.type, ids, idsSpan: trimmedIn(idsTok, 0, listEnd) });
        finish(i);
        return { stmt: i, kind: 'none' };
      }
      case 'CLICK': {
        const b = base(t);
        next();
        const idTok = expect('ID');
        if (peek().type === 'HREF') next();
        expect('STRING');
        if (peek().type === 'STRING') next();
        const span = orig(idTok.start, idTok.end);
        const i = add({ ...b, t: 'click', ref: { id: idTok.text.trim(), star: false, span, end: span.end } });
        finish(i);
        return { stmt: i, kind: 'none' };
      }
      case 'HIDE_EMPTY':
      case 'acc_descr_multiline_value': {
        const b = base(t);
        next();
        const i = add({ ...b, t: 'other' });
        finish(i);
        return { stmt: i, kind: 'none' };
      }
      case 'scale':
      case 'acc_title':
      case 'acc_descr': {
        const b = base(t);
        next();
        expect(t.type === 'scale' ? 'WIDTH' : `${t.type}_value`);
        const i = add({ ...b, t: 'other' });
        finish(i);
        return { stmt: i, kind: 'none' };
      }
      default:
        throw new ParseError(`unexpected "${t.raw.trim() || t.type}"`);
    }
  };

  // start: NL* SD document
  while (peek().type === 'NL') next();
  const sd = expect('SD');
  const header = orig(sd.start, sd.start + sd.raw.trimEnd().length);
  const root = document(false);
  return { statements, root, header, version: (/-v2/i.test(sd.raw) ? 2 : 1) as 1 | 2, source };
}

// ── 4. mermaid's data walk ──────────────────────────────────────────

interface Region {
  items: Item[];
  // Region node id (`divider-id-N`; null for mermaid's random last one).
  id: string | null;
}

// docTranslator: a body with `--` separators becomes one region per
// section — but only when the last section isn't empty (mermaid keeps
// the body as written otherwise).
function regionsOf(doc: Item[]): Region[] {
  const regions: Region[] = [];
  let cur: Item[] = [];
  for (const it of doc) {
    if (it.kind === 'divider') {
      regions.push({ items: cur, id: it.dividerId! });
      cur = [];
    } else {
      cur.push(it);
    }
  }
  if (regions.length > 0 && cur.length > 0) {
    regions.push({ items: cur, id: null });
    return regions;
  }
  return [{ items: doc, id: null }];
}

interface NodeAcc {
  id: string;
  order: number;
  kind: StateKind;
  descriptions: string[];
  parent: StateScope | null;
  composite: { direction: StateDirection; regions: number } | null;
  regionIds: Array<string | null>;
}

function walk(root: Item[], statements: StateStatement[]) {
  const nodes = new Map<string, NodeAcc>();
  const terminals = new Map<string, StateTerminal & { order: number }>();
  const transitions: StateTransition[] = [];
  const transitionStmts: number[] = [];
  const notes: StateNote[] = [];
  const noteStmts: number[] = [];
  const renderTransitions: string[] = [];
  const renderNotes: string[] = [];
  const mentions = new Map<string, number[]>();
  const descSources = new Map<string, number[]>();
  const blocks = new Map<string, number[]>();
  let counter = 0;
  let order = 0;

  const scopeKey = (s: StateScope) => (s.parent === null ? 'root' : `${s.parent}#${s.region}`);
  const terminal = (kind: 'start' | 'end', scope: StateScope): StateEndpoint => {
    const key = `${scopeKey(scope)}_${kind}`;
    if (!terminals.has(key)) terminals.set(key, { kind, scope, order: order++ });
    return { kind, scope };
  };

  // dataFetcher for one state item mentioned in `scope`.
  const visit = (it: Item, scope: StateScope, first: boolean): StateEndpoint => {
    if (it.star) return terminal(first ? 'start' : 'end', scope);
    const id = it.id!;
    let n = nodes.get(id);
    if (!n) {
      const kind: StateKind = it.type === 'fork' || it.type === 'join' || it.type === 'choice' ? it.type : 'normal';
      n = { id, order: order++, kind, descriptions: [], parent: null, composite: null, regionIds: [] };
      nodes.set(id, n);
    }
    (mentions.get(id) ?? mentions.set(id, []).get(id)!).push(it.stmt);
    if (it.descriptions?.length) {
      n.descriptions.push(...it.descriptions);
      const src = descSources.get(id) ?? descSources.set(id, []).get(id)!;
      for (let k = 0; k < it.descriptions.length; k++) src.push(it.stmt);
    }
    if (scope.parent !== null) n.parent = scope;
    if (it.note) {
      notes.push({ state: id, position: it.note.position, text: it.note.text });
      noteStmts.push(it.stmt);
      renderNotes.push(`${id}----note-${counter}`);
      counter++;
    }
    if (it.doc) {
      (blocks.get(id) ?? blocks.set(id, []).get(id)!).push(it.stmt);
      const regions = regionsOf(it.doc);
      if (!n.composite) {
        let direction: StateDirection = 'TB';
        if (regions.length === 1) for (const d of it.doc) if (d.kind === 'dir') direction = d.dir!;
        n.composite = { direction, regions: regions.length };
        n.regionIds = regions.length > 1 ? regions.map((r) => r.id) : [];
      }
      regions.forEach((r, k) => doc(r.items, { parent: id, region: k }));
    }
    return { kind: 'state', id };
  };

  const doc = (items: Item[], scope: StateScope) => {
    for (const it of items) {
      statements[it.stmt].scope = scope;
      if (it.kind === 'state') visit(it, scope, true);
      else if (it.kind === 'relation') {
        const from = visit(it.state1!, scope, true);
        const to = visit(it.state2!, scope, false);
        transitions.push({ from, to, label: it.label! });
        transitionStmts.push(it.stmt);
        renderTransitions.push(`edge${counter}`);
        counter++;
      }
    }
  };

  doc(root, { parent: null, region: 0 });
  return { nodes, terminals, transitions, transitionStmts, notes, noteStmts, renderTransitions, renderNotes, mentions, descSources, blocks };
}

// ── Entry points ────────────────────────────────────────────────────

export function parseStateSource(source: string): StateSourceParseResult {
  const lines = source.split(/\r?\n/);
  const { headerLine } = findPreamble(lines);
  if (headerLine < 0) return { ok: false, reason: 'empty source' };
  if (!/^\s*stateDiagram(-v2)?\s*$/.test(lines[headerLine])) {
    return { ok: false, reason: `not a state diagram: ${lines[headerLine].trim()}` };
  }
  const m = preprocess(source);
  const toks = lex(m.text);
  if (typeof toks === 'string') return { ok: false, reason: toks };
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(source, m, toks);
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, reason: e.message };
    throw e;
  }
  const { statements, root, header, version } = parsed;
  const rootItems = root;
  // mermaid splits a top-level `--` into regions it then mishandles
  // (its `[*]`s are never resolved); leave such diagrams render-only.
  if (rootItems.some((it) => it.kind === 'divider')) return { ok: false, reason: 'concurrency separator at the top level' };

  const w = walk(rootItems, statements);
  const states = new Map<string, StateNode>();
  const regions = new Map<string, Array<string | null>>();
  for (const n of [...w.nodes.values()].sort((a, b) => a.order - b.order)) {
    // mermaid: "Group nodes can only have label".
    if (n.composite && n.descriptions.length > 1) return { ok: false, reason: `group ${n.id} has more than one description` };
    states.set(n.id, {
      id: n.id,
      kind: n.composite ? 'normal' : n.kind,
      label: n.descriptions.length ? n.descriptions[0] : n.id,
      descriptions: n.descriptions.slice(1),
      parent: n.parent?.parent ?? null,
      region: n.parent?.region ?? 0,
      composite: n.composite,
    });
    if (n.regionIds.length) regions.set(n.id, n.regionIds);
  }

  let direction: StateDirection = 'TB';
  const directions: number[] = [];
  for (const it of rootItems) {
    if (it.kind === 'dir') {
      direction = it.dir!;
      directions.push(it.stmt);
    }
  }

  // Source info per state: walked mentions plus class / style / click refs.
  const info = new Map<string, StateSourceInfo>();
  const get = (id: string) => {
    let i = info.get(id);
    if (!i) info.set(id, (i = { mentions: [], refs: [], descriptions: [], blocks: [] }));
    return i;
  };
  for (const id of states.keys()) {
    const i = get(id);
    i.mentions = [...new Set(w.mentions.get(id) ?? [])].sort((a, b) => a - b);
    i.blocks = w.blocks.get(id) ?? [];
    const descStmts = w.descSources.get(id) ?? [];
    let k = 0;
    for (const sIdx of descStmts) {
      const s = statements[sIdx];
      if (s.t === 'desc') i.descriptions.push({ stmt: sIdx, span: s.text, quoted: false });
      else if (s.t === 'decl') {
        // `as Id:extra`: the second entry has no span of its own to edit;
        // point it at the id so a rename never splices the wrong text.
        i.descriptions.push(k === 0 || descStmts[k - 1] !== sIdx ? { stmt: sIdx, span: s.text, quoted: true } : { stmt: sIdx, span: { start: s.ref.end, end: s.ref.end }, quoted: false });
      }
      k++;
    }
  }
  statements.forEach((s, idx) => {
    const ids: string[] = [];
    if (s.t === 'relation') ids.push(s.from.id, s.to.id);
    else if (s.t === 'class' || s.t === 'style') ids.push(...s.ids.map((x) => x.id));
    else if ('ref' in s) ids.push(s.ref.id);
    for (const id of new Set(ids)) get(id).refs.push(idx);
  });

  const preamble = findPreamble(lines);
  const model: StateModel = {
    version,
    title: preamble.frontmatter?.title?.value ?? null,
    direction,
    states,
    transitions: w.transitions,
    notes: w.notes,
    terminals: [...w.terminals.values()].sort((a, b) => a.order - b.order).map(({ kind, scope }) => ({ kind, scope })),
    render: { transitions: w.renderTransitions, notes: w.renderNotes, regions },
  };
  const map: StateSourceMap = {
    source,
    eol: source.includes('\r\n') ? '\r\n' : '\n',
    header,
    statements,
    root: rootItems.map((it) => it.stmt),
    transitions: w.transitionStmts,
    notes: w.noteStmts,
    states: info,
    directions,
  };
  return { ok: true, model, map };
}

export function parseState(source: string): StateParseResult {
  const r = parseStateSource(source);
  return r.ok ? { ok: true, model: r.model } : r;
}
