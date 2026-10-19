// Parser for mermaid 11.14 class diagrams (`classDiagram`,
// `classDiagram-v2`) — the full syntax, not a subset.
//
// It runs mermaid's own lexer rules (class-lexer.ts) over the source
// after the same preprocessing mermaid does (entity-text.ts), then
// walks the token stream with the grammar of classDiagram.jison and
// replays what mermaid's ClassDB does with each statement (creation
// order, last label wins, lollipop interfaces, member parsing …). So a
// source parses here exactly when mermaid accepts it, into the model
// mermaid would render; tests check that against mermaid's own db.
//
// Text in the model is what mermaid DISPLAYS: entity codes (`#59;`,
// `#quot;`) decoded, `List~int~` generics shown as `List<int>`.
//
// parseClassSource also returns a source map (offsets of every
// statement and of the parts edits rewrite) for the source-preserving
// visual edits in class-edit.ts.
import { lexClass, type Tok } from './class-lexer';
import { decodePlaceholders, encodePlaceholders, prepareSource, type PreparedSource } from './entity-text';
import { splitLines } from './source-text';
import { decodeMermaidEntities } from '../mermaid-parser';

// ── Model ────────────────────────────────────────────────────────────

export type ClassDirection = 'TB' | 'BT' | 'LR' | 'RL';
// `+` public, `-` private, `#` protected, `~` package, none.
export type ClassVisibility = 'public' | 'private' | 'protected' | 'package' | 'none';
// `$` static (shown underlined), `*` abstract (shown in italics).
export type ClassClassifier = 'none' | 'static' | 'abstract';

export interface ClassMember {
  kind: 'field' | 'method';
  visibility: ClassVisibility;
  classifier: ClassClassifier;
  // Field: the last word ("name" of "+String name", or of "name: Type"
  // written that way); method: the method name.
  name: string;
  // Field: everything before the name ("String"), '' if none; method:
  // the return type, '' if none. Generics as shown: "List<int>".
  type: string;
  // Method parameters as written between the parentheses; '' for fields.
  parameters: string;
  // The row exactly as mermaid shows it: "+makeSound(int a) : void".
  display: string;
}

export interface ClassNode {
  id: string;
  // Title as shown, without the generic part: `class Dog["My Dog"]` →
  // "My Dog"; the id when there is no label.
  label: string;
  // Generic parameter (`class Shape~T~` → "T", title "Shape<T>"); ''.
  generic: string;
  // Every `<<annotation>>`, in order. mermaid shows only the first.
  annotations: string[];
  // Members in source order. mermaid shows fields first, then methods.
  members: ClassMember[];
  // Namespace the class is declared in, or null.
  namespace: string | null;
}

// What is drawn at one end of a relationship line.
//   inheritance  hollow triangle (`<|`, `|>`)
//   composition  filled diamond (`*`)
//   aggregation  hollow diamond (`o`)
//   arrow        open arrow head (`<`, `>`)
//   lollipop     interface circle (`()`)
export type ClassEndMarker = 'none' | 'inheritance' | 'composition' | 'aggregation' | 'arrow' | 'lollipop';

export interface ClassRelation {
  // Class ids as written left / right of the arrow (for a lollipop end,
  // the interface name — there is no class of that name).
  from: string;
  to: string;
  fromMarker: ClassEndMarker;
  toMarker: ClassEndMarker;
  line: 'solid' | 'dashed';
  // Multiplicity text at each end (`"1" --> "*"`), '' when none.
  fromCardinality: string;
  toCardinality: string;
  label: string;
}

export interface ClassNote {
  text: string;
  // `note for X "…"` → X; a free-standing `note "…"` → null.
  classId: string | null;
  namespace: string | null;
}

export interface ClassNamespace {
  id: string;
  classIds: string[];
}

export interface ClassModel {
  direction: ClassDirection;
  // Insertion order = mermaid's creation order (= layout input order).
  classes: Map<string, ClassNode>;
  relations: ClassRelation[];
  notes: ClassNote[];
  namespaces: ClassNamespace[];
}

// ── Source map ───────────────────────────────────────────────────────

export interface Span {
  start: number;
  end: number;
}

export type StatementKind =
  | 'class'
  | 'member'
  | 'relation'
  | 'annotation'
  | 'note'
  | 'namespace'
  | 'direction'
  | 'style'
  | 'cssClass'
  | 'classDef'
  | 'click'
  | 'acc'
  | 'bare';

// All offsets index ClassSourceMap.text (the source, lines joined
// with '\n').
export interface StatementSource {
  kind: StatementKind;
  span: Span;
  // Index into map.namespaces of the namespace block holding it.
  namespace: number | null;
  // Class ids the statement names (style / click / cssClass … targets,
  // relation ends, the member's / annotation's / note's class).
  refs: string[];
}

export interface MemberSource {
  // 'body': a line inside `class X { … }`; 'line': an `X : member`
  // statement.
  form: 'body' | 'line';
  // The member text (trimmed) — what mermaid parses as the member.
  span: Span;
  // Statement it belongs to (the class statement for 'body').
  stmt: number;
}

export interface AnnotationSource {
  // 'body': `<<x>>` line in a body; 'inline': `class X <<x>>`;
  // 'statement': `<<x>> X`.
  form: 'body' | 'inline' | 'statement';
  // The whole `<<x>>` (body: the trimmed member text).
  span: Span;
  // Just the annotation word(s) between the brackets.
  inner: Span;
  stmt: number;
}

export interface ClassDeclSource {
  stmt: number;
  // From `class` through the class name (generic included).
  head: Span;
  // Text between the label's quotes, when it has `["…"]`.
  label: Span | null;
  // The `{ … }` body: offset of `{` and of `}`.
  body: { open: number; close: number } | null;
}

export interface RelationSource {
  stmt: number;
  from: Span;
  to: Span;
  // The arrow (markers + line), e.g. `<|--`.
  arrow: Span;
  // Whole `"…"` cardinality strings (quotes included).
  fromCardinality: Span | null;
  toCardinality: Span | null;
  // The `: label` part, colon included.
  label: Span | null;
}

export interface NoteSource {
  stmt: number;
  // Text between the quotes.
  text: Span;
}

export interface NamespaceSource {
  stmt: number;
  id: string;
  open: number;
  close: number;
}

export interface ClassSourceMap {
  lines: string[];
  eol: string;
  text: string;
  headerLine: number;
  // The header statement (`classDiagram`) span.
  header: Span;
  statements: StatementSource[];
  decls: Map<string, ClassDeclSource[]>;
  // Parallel to model.classes.get(id).members.
  members: Map<string, MemberSource[]>;
  annotations: Map<string, AnnotationSource[]>;
  // Parallel to model.relations / model.notes.
  relations: RelationSource[];
  notes: NoteSource[];
  namespaces: NamespaceSource[];
  // Statement where each class came into being.
  created: Map<string, number>;
  // `direction XX` statements: the two-letter direction word.
  directions: Span[];
}

export type ClassSourceParseResult =
  | { ok: true; model: ClassModel; map: ClassSourceMap }
  | { ok: false; reason: string };

export type ClassParseResult = { ok: true; model: ClassModel } | { ok: false; reason: string };

export const CLASS_STARTER = [
  'classDiagram',
  '    class Animal {',
  '        +String name',
  '        +int age',
  '        +makeSound() void',
  '    }',
  '    class Dog {',
  '        +fetch() void',
  '    }',
  '    class Cat {',
  '        -bool indoor',
  '    }',
  '    Animal <|-- Dog',
  '    Animal <|-- Cat',
  '',
].join('\n');

// ── Mermaid helpers (ports) ──────────────────────────────────────────

// mermaid's parseGenericTypes: `List~int~` → `List<int>`.
export function parseGenericTypes(input: string): string {
  const sets = input.split(/(,)/);
  const out: string[] = [];
  for (let i = 0; i < sets.length; i++) {
    let s = sets[i];
    if (s === ',' && i > 0 && i + 1 < sets.length) {
      const prev = sets[i - 1];
      const next = sets[i + 1];
      if (count(prev, '~') === 1 && count(next, '~') === 1) {
        s = prev + ',' + next;
        i++;
        out.pop();
      }
    }
    out.push(processSet(s));
  }
  return out.join('');
}

function count(s: string, sub: string): number {
  return Math.max(0, s.split(sub).length - 1);
}

function processSet(input: string): string {
  const tildes = count(input, '~');
  let startingTilde = false;
  if (tildes <= 1) return input;
  if (tildes % 2 !== 0 && input.startsWith('~')) {
    input = input.substring(1);
    startingTilde = true;
  }
  const chars = [...input];
  let first = chars.indexOf('~');
  let last = chars.lastIndexOf('~');
  while (first !== -1 && last !== -1 && first !== last) {
    chars[first] = '<';
    chars[last] = '>';
    first = chars.indexOf('~');
    last = chars.lastIndexOf('~');
  }
  if (startingTilde) chars.unshift('~');
  return chars.join('');
}

const VISIBILITY: Record<string, ClassVisibility> = {
  '+': 'public',
  '-': 'private',
  '#': 'protected',
  '~': 'package',
  '': 'none',
};
export const VISIBILITY_CHAR: Record<ClassVisibility, string> = {
  public: '+',
  private: '-',
  protected: '#',
  package: '~',
  none: '',
};
const CLASSIFIER: Record<string, ClassClassifier> = { $: 'static', '*': 'abstract', '': 'none' };
export const CLASSIFIER_CHAR: Record<ClassClassifier, string> = { static: '$', abstract: '*', none: '' };

// Placeholder / entity-code text → what mermaid displays.
const show = (raw: string) => decodeMermaidEntities(decodePlaceholders(raw));

// A member string the way mermaid's ClassMember parses it. `raw` is
// source text (entity codes still encoded); returns null for what
// addMember ignores (empty) — annotations are handled by the caller.
export function parseMemberText(raw: string): ClassMember | null {
  // mermaid sees entity codes as placeholders (so `#32;` is no `#`).
  const input = encodePlaceholders(raw.trim());
  if (!input) return null;
  if (input.indexOf(')') > 0) {
    const m = /([#+~-])?(.+)\((.*)\)([\s$*])?(.*)([$*])?/.exec(input);
    let visibility = '';
    let id = '';
    let params = '';
    let classifier = '';
    let ret = '';
    if (m) {
      const v = m[1] ? m[1].trim() : '';
      if (v in VISIBILITY) visibility = v;
      id = m[2];
      params = m[3] ? m[3].trim() : '';
      classifier = m[4] ? m[4].trim() : '';
      ret = m[5] ? m[5].trim() : '';
      if (classifier === '') {
        const lastChar = ret.substring(ret.length - 1);
        if (/[$*]/.test(lastChar)) {
          classifier = lastChar;
          ret = ret.substring(0, ret.length - 1);
        }
      }
    }
    id = id.startsWith(' ') ? ' ' + id.trim() : id.trim();
    let display = visibility + parseGenericTypes(id) + `(${parseGenericTypes(params)})`;
    if (ret) display += ' : ' + parseGenericTypes(ret);
    return {
      kind: 'method',
      visibility: VISIBILITY[visibility],
      classifier: CLASSIFIER[classifier] ?? 'none',
      name: blankToEmpty(show(id.trim())),
      type: show(parseGenericTypes(ret)),
      parameters: show(parseGenericTypes(params)),
      display: show(display.trim()),
    };
  }
  const first = input.substring(0, 1);
  const last = input.substring(input.length - 1);
  const visibility = first in VISIBILITY && first !== '' ? first : '';
  const classifier = /[$*]/.test(last) ? last : '';
  let id = input.substring(visibility === '' ? 0 : 1, classifier === '' ? input.length : input.length - 1);
  id = id.startsWith(' ') ? ' ' + id.trim() : id.trim();
  const { name, type } = splitField(id.trim());
  return {
    kind: 'field',
    visibility: VISIBILITY[visibility],
    classifier: CLASSIFIER[classifier],
    name,
    type,
    parameters: '',
    display: show((visibility + parseGenericTypes(id)).trim()),
  };
}

// A name written as nothing but (encoded) whitespace — `#32;`, which
// the edit engine writes for an empty name — is the empty name.
function blankToEmpty(s: string): string {
  return s.trim() === '' ? '' : s;
}

// "String name" → type "String", name "name" (split at the last raw
// space); "name: Type" → name "name", type "Type"; "name" → name only.
export function fieldStyle(id: string): 'typeFirst' | 'colon' | 'nameOnly' {
  if (/^[^\s:]+\s*:\s*\S/.test(id)) return 'colon';
  return /\s/.test(id) ? 'typeFirst' : 'nameOnly';
}

function splitField(id: string): { name: string; type: string } {
  const style = fieldStyle(id);
  if (style === 'colon') {
    const m = /^([^\s:]+)\s*:\s*(.*)$/.exec(id)!;
    return { name: blankToEmpty(show(m[1])), type: show(parseGenericTypes(m[2].trim())) };
  }
  if (style === 'typeFirst') {
    const m = /^(.*\S)\s+(\S+)$/.exec(id)!;
    return { name: blankToEmpty(show(m[2])), type: show(parseGenericTypes(m[1])) };
  }
  return { name: blankToEmpty(show(id)), type: '' };
}

// ── Parser ───────────────────────────────────────────────────────────

class ParseError extends Error {}

const ALNUM = new Set(['UNICODE_TEXT', 'NUM', 'ALPHA', 'MINUS']);
const REL_TYPES: Record<string, ClassEndMarker> = {
  AGGREGATION: 'aggregation',
  EXTENSION: 'inheritance',
  COMPOSITION: 'composition',
  DEPENDENCY: 'arrow',
  LOLLIPOP: 'lollipop',
};
const STYLE_COMPONENT = new Set(['LABEL', 'SPACE', 'ALPHA', 'STYLE', 'NUM', 'COLON', 'UNIT', 'BRKT', 'PCT']);

// STR tokens: mermaid's `"` rules emit nothing; ours emit STR_START /
// STR_END so the quotes' positions are known. Fold them into one STR
// token spanning the quotes (with `inner` = the text). An empty `""`
// yields no token at all, as in mermaid.
interface PTok extends Tok {
  inner?: Span;
}

function foldStrings(tokens: Tok[]): PTok[] {
  const out: PTok[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'STR_START') {
      out.push(t);
      continue;
    }
    const body = tokens[i + 1]?.type === 'STR' ? tokens[i + 1] : null;
    const endIdx = body ? i + 2 : i + 1;
    const end = tokens[endIdx]?.type === 'STR_END' ? tokens[endIdx] : null;
    if (body) {
      out.push({ type: 'STR', text: body.text, start: t.start, end: end ? end.end : body.end, inner: { start: body.start, end: body.end } });
    }
    i = end ? endIdx : endIdx - 1;
  }
  return out;
}

interface ClassName {
  // mermaid's className value (`Shape~T~`, `a.b.C`, `My-Class`).
  value: string;
  // The class it names (generic part stripped).
  id: string;
  generic: string;
  start: number;
  end: number;
}

interface NodeState extends ClassNode {
  labelSet: boolean;
}

export function parseClassSource(source: string): ClassSourceParseResult {
  const src = splitLines(source);
  const prepared = prepareSource(src.lines);
  const { preamble } = prepared;
  if (preamble.headerLine < 0) return { ok: false, reason: 'empty source' };
  const header = src.lines[preamble.headerLine].trim();
  if (!/^classDiagram(-v2)?\b/.test(header)) return { ok: false, reason: `not a classDiagram: ${header}` };
  // mermaid appends a newline before lexing.
  const lexed = lexClass(prepared.lexText + '\n', prepared.lexStart);
  if (!lexed.ok) return { ok: false, reason: `lexical error at offset ${prepared.origin[lexed.at] ?? lexed.at}` };
  try {
    return new ClassParser(prepared, foldStrings(lexed.tokens), src).run();
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, reason: e.message };
    throw e;
  }
}

export function parseClass(source: string): ClassParseResult {
  const r = parseClassSource(source);
  return r.ok ? { ok: true, model: r.model } : r;
}

class ClassParser {
  private pos = 0;
  private classes = new Map<string, NodeState>();
  private relations: ClassRelation[] = [];
  private notes: ClassNote[] = [];
  private namespaces = new Map<string, ClassNamespace>();
  private direction: ClassDirection = 'TB';
  private map: ClassSourceMap;
  private currentNs: number | null = null;

  constructor(
    private p: PreparedSource,
    private toks: PTok[],
    src: { lines: string[]; eol: string },
  ) {
    this.map = {
      lines: src.lines,
      eol: src.eol,
      text: p.text,
      headerLine: p.preamble.headerLine,
      header: { start: 0, end: 0 },
      statements: [],
      decls: new Map(),
      members: new Map(),
      annotations: new Map(),
      relations: [],
      notes: [],
      namespaces: [],
      created: new Map(),
      directions: [],
    };
  }

  // Lexer offset → source offset (start / end of a token range).
  private o(lexOff: number): number {
    return this.p.origin[lexOff];
  }
  private oEnd(lexEnd: number): number {
    return this.p.origin[lexEnd - 1] + 1;
  }
  private span(start: number, end: number): Span {
    return { start: this.o(start), end: end > start ? this.oEnd(end) : this.o(start) };
  }
  private raw(s: Span): string {
    return this.p.text.slice(s.start, s.end);
  }

  private peek(k = 0): PTok {
    return this.toks[Math.min(this.pos + k, this.toks.length - 1)];
  }
  private next(): PTok {
    return this.toks[this.pos++];
  }
  private expect(type: string): PTok {
    const t = this.peek();
    if (t.type !== type) throw new ParseError(`expected ${type}, got ${t.type} "${t.text}"`);
    return this.next();
  }

  run(): ClassSourceParseResult {
    const head = this.expect('CLASS_DIAGRAM');
    this.map.header = this.span(head.start, head.end);
    this.expect('NEWLINE');
    // statements: at least one.
    this.statement();
    for (;;) {
      const t = this.peek();
      if (t.type === 'EOF') break;
      this.expect('NEWLINE');
      if (this.peek().type === 'EOF') break;
      this.statement();
    }
    const model: ClassModel = {
      direction: this.direction,
      classes: new Map(
        [...this.classes].map(([id, c]) => [
          id,
          { id: c.id, label: c.label, generic: c.generic, annotations: c.annotations, members: c.members, namespace: c.namespace },
        ]),
      ),
      relations: this.relations,
      notes: this.notes,
      namespaces: [...this.namespaces.values()],
    };
    return { ok: true, model, map: this.map };
  }

  // ── db replay ──

  private addClass(name: ClassName, stmt: number): NodeState {
    let c = this.classes.get(name.id);
    if (!c) {
      c = {
        id: name.id,
        label: show(name.id),
        generic: show(name.generic),
        annotations: [],
        members: [],
        namespace: null,
        labelSet: false,
      };
      this.classes.set(name.id, c);
      this.map.created.set(name.id, stmt);
      this.map.members.set(name.id, []);
      this.map.annotations.set(name.id, []);
    }
    return c;
  }

  private getClass(id: string): NodeState {
    const c = this.classes.get(id);
    // mermaid throws (a TypeError) here, so the diagram doesn't render.
    if (!c) throw new ParseError(`unknown class ${id}`);
    return c;
  }

  // ClassDB.addMember for one member string at `span` (source offsets).
  private addMember(c: NodeState, span: Span, form: 'body' | 'line', stmt: number): void {
    const raw = this.raw(span);
    const trimmed = raw.trim();
    const lead = raw.length - raw.trimStart().length;
    const tspan = { start: span.start + lead, end: span.start + lead + trimmed.length };
    if (trimmed.startsWith('<<') && trimmed.endsWith('>>') && trimmed.length >= 4) {
      c.annotations.push(show(trimmed.slice(2, -2)));
      this.map.annotations.get(c.id)!.push({ form: 'body', span: tspan, inner: { start: tspan.start + 2, end: tspan.end - 2 }, stmt });
      return;
    }
    const m = parseMemberText(trimmed);
    if (!m) return;
    c.members.push(m);
    this.map.members.get(c.id)!.push({ form, span: tspan, stmt });
  }

  // ── grammar ──

  private stmtIndex(): number {
    return this.map.statements.length;
  }

  private pushStmt(kind: StatementKind, start: number, end: number, refs: string[]): number {
    this.map.statements.push({ kind, span: this.span(start, end), namespace: this.currentNs, refs });
    return this.map.statements.length - 1;
  }

  private isClassNameStart(t: PTok): boolean {
    return ALNUM.has(t.type) || t.type === 'BQUOTE_STR';
  }

  // className (see classDiagram.jison): alphaNum (DOT? className)* |
  // bquote, then an optional GENERICTYPE.
  private className(): ClassName {
    const first = this.peek();
    if (!this.isClassNameStart(first)) throw new ParseError(`expected a class name, got ${first.type} "${first.text}"`);
    let value = '';
    let start = first.start;
    let end = first.end;
    let generic = '';
    for (;;) {
      const t = this.peek();
      if (t.type === 'BQUOTE_STR') {
        this.next();
        value += t.text;
        // The backticks around it.
        if (value === t.text) start = t.start - 1;
        end = t.end + 1;
        break;
      }
      if (!ALNUM.has(t.type)) break;
      this.next();
      value += t.text;
      end = t.end;
      if (this.peek().type === 'DOT') {
        const dot = this.next();
        value += '.';
        end = dot.end;
        if (!this.isClassNameStart(this.peek())) throw new ParseError('expected a class name after "."');
        continue;
      }
      if (!this.isClassNameStart(this.peek())) break;
    }
    if (this.peek().type === 'GENERICTYPE') {
      const g = this.next();
      generic = g.text;
      value += '~' + g.text + '~';
      end = g.end + 1;
    }
    // splitClassNameAndType: the part before the first `~`.
    const tilde = value.indexOf('~');
    const id = tilde > 0 ? value.split('~')[0] : value;
    if (tilde > 0) generic = value.split('~')[1];
    return { value, id, generic, start, end };
  }

  private alphaNum(): PTok {
    const t = this.peek();
    if (!ALNUM.has(t.type)) throw new ParseError(`expected a word, got ${t.type} "${t.text}"`);
    return this.next();
  }

  private statement(): void {
    const t = this.peek();
    switch (t.type) {
      case 'direction_tb':
      case 'direction_bt':
      case 'direction_rl':
      case 'direction_lr': {
        this.next();
        this.direction = t.type.slice(-2).toUpperCase() as ClassDirection;
        // The token starts at the line's indentation.
        const lead = t.text.length - t.text.trimStart().length;
        this.pushStmt('direction', t.start + lead, t.start + t.text.trimEnd().length, []);
        // The two direction letters (first match of the rule's regex).
        const m = new RegExp(`direction\\s+${this.direction}`).exec(t.text)!;
        const at = t.start + m.index + m[0].length - 2;
        this.map.directions.push(this.span(at, at + 2));
        return;
      }
      case 'acc_title':
      case 'acc_descr': {
        this.next();
        const v = this.expect(t.type + '_value');
        this.pushStmt('acc', t.start, v.end, []);
        return;
      }
      case 'acc_descr_multiline_value':
        this.next();
        this.pushStmt('acc', t.start, t.end, []);
        return;
      case 'NAMESPACE':
        return this.namespaceStatement();
      case 'CLASS':
        return this.classStatement();
      case 'ANNOTATION_START': {
        this.next();
        const word = this.alphaNum();
        const close = this.expect('ANNOTATION_END');
        const name = this.className();
        const stmt = this.pushStmt('annotation', t.start, name.end, [name.id]);
        const c = this.getClass(name.id);
        c.annotations.push(show(word.text));
        this.map.annotations.get(c.id)!.push({
          form: 'statement',
          span: this.span(t.start, close.end),
          inner: this.span(word.start, word.end),
          stmt,
        });
        return;
      }
      case 'CALLBACK':
      case 'LINK':
      case 'CLICK':
        return this.clickStatement();
      case 'STYLE': {
        this.next();
        const id = this.expect('ALPHA');
        let end = this.stylesOpt(id.end);
        if (end === id.end) throw new ParseError('style without styles');
        end = Math.max(end, id.end);
        this.pushStmt('style', t.start, end, [id.text]);
        return;
      }
      case 'CSSCLASS': {
        this.next();
        const ids = this.expect('STR');
        const cls = this.alphaNum();
        this.pushStmt('cssClass', t.start, cls.end, ids.text.split(','));
        return;
      }
      case 'NOTE_FOR':
      case 'NOTE':
        return this.noteStatement();
      case 'CLASSDEF': {
        this.next();
        let end = this.expect('ALPHA').end;
        while (this.peek().type === 'COMMA' && this.peek(1).type === 'ALPHA') {
          this.next();
          end = this.next().end;
        }
        end = this.stylesOpt(end);
        this.pushStmt('classDef', t.start, end, []);
        return;
      }
      default:
        if (this.isClassNameStart(t)) return this.relationOrMember();
        throw new ParseError(`unexpected ${t.type} "${t.text}"`);
    }
  }

  // style (COMMA style)* where style = styleComponent+. Returns the end
  // of the last token consumed (or `end` when none).
  private stylesOpt(end: number): number {
    let any = false;
    for (;;) {
      const t = this.peek();
      if (STYLE_COMPONENT.has(t.type)) {
        any = true;
        end = this.next().end;
      } else if (t.type === 'COMMA' && any && STYLE_COMPONENT.has(this.peek(1).type)) {
        end = this.next().end;
      } else {
        return end;
      }
    }
  }

  private clickStatement(): void {
    const t = this.next();
    const name = this.className();
    let end = name.end;
    const take = (type: string) => {
      if (this.peek().type === type) {
        end = this.next().end;
        return true;
      }
      return false;
    };
    if (t.type === 'CALLBACK' || t.type === 'LINK') {
      if (!take('STR')) throw new ParseError(`${t.text} needs a string`);
      take('STR');
      if (t.type === 'LINK') take('LINK_TARGET');
    } else if (take('HREF')) {
      if (!take('STR')) throw new ParseError('href needs a string');
      take('STR');
      take('LINK_TARGET');
    } else if (take('CALLBACK_NAME')) {
      take('CALLBACK_ARGS');
      take('STR');
    } else {
      throw new ParseError('click needs href or call');
    }
    this.pushStmt('click', t.start, end, [name.id]);
  }

  private noteStatement(): void {
    const t = this.next();
    let classId: string | null = null;
    const refs: string[] = [];
    if (t.type === 'NOTE_FOR') {
      classId = this.className().id;
      refs.push(classId);
    }
    const str = this.expect('STR');
    const stmt = this.pushStmt('note', t.start, str.end, refs);
    this.notes.push({ text: show(this.raw(this.span(str.inner!.start, str.inner!.end))), classId, namespace: this.nsName() });
    this.map.notes.push({ stmt, text: this.span(str.inner!.start, str.inner!.end) });
  }

  private nsName(): string | null {
    return this.currentNs === null ? null : this.map.namespaces[this.currentNs].id;
  }

  private namespaceStatement(): void {
    const t = this.next();
    // namespaceName: like className, without generics.
    let id = '';
    for (;;) {
      const n = this.peek();
      if (n.type === 'BQUOTE_STR') {
        id += this.next().text;
        break;
      }
      if (!ALNUM.has(n.type)) break;
      id += this.next().text;
      if (this.peek().type === 'DOT') {
        this.next();
        id += '.';
      }
    }
    if (!id) throw new ParseError('namespace needs a name');
    const open = this.expect('STRUCT_START');
    if (!this.namespaces.has(id)) this.namespaces.set(id, { id, classIds: [] });
    const stmt = this.pushStmt('namespace', t.start, open.end, []);
    const nsIndex = this.map.namespaces.length;
    this.map.namespaces.push({ stmt, id, open: this.o(open.start), close: -1 });
    this.currentNs = nsIndex;
    if (this.peek().type === 'NEWLINE') this.next();
    // classStatements: (classStatement | noteStatement) separated by
    // NEWLINE; at least one.
    let first = true;
    for (;;) {
      const n = this.peek();
      if (n.type === 'STRUCT_STOP' && !first) break;
      if (n.type === 'CLASS') this.classStatement();
      else if (n.type === 'NOTE_FOR' || n.type === 'NOTE') this.noteStatement();
      else throw new ParseError(`unexpected ${n.type} "${n.text}" in namespace`);
      first = false;
      if (this.peek().type === 'NEWLINE') this.next();
    }
    const close = this.expect('STRUCT_STOP');
    this.currentNs = null;
    this.map.namespaces[nsIndex].close = this.o(close.start);
    this.map.statements[stmt].span = this.span(t.start, close.end);
    // addClassesToNamespace: every class / note statement inside.
    const ns = this.namespaces.get(id)!;
    for (let k = stmt + 1; k < this.map.statements.length; k++) {
      const s = this.map.statements[k];
      if (s.namespace !== nsIndex) continue;
      if (s.kind === 'class') {
        const cid = s.refs[0];
        const c = this.classes.get(cid)!;
        c.namespace = id;
        if (!ns.classIds.includes(cid)) ns.classIds.push(cid);
      }
    }
  }

  private classStatement(): void {
    const t = this.expect('CLASS');
    const name = this.className();
    const stmt = this.stmtIndex();
    this.pushStmt('class', t.start, name.end, [name.id]);
    const c = this.addClass(name, stmt);
    const decl: ClassDeclSource = { stmt, head: this.span(t.start, name.end), label: null, body: null };
    let end = name.end;
    if (this.peek().type === 'SQS') {
      this.next();
      const str = this.expect('STR');
      const sqe = this.expect('SQE');
      end = sqe.end;
      decl.label = this.span(str.inner!.start, str.inner!.end);
      c.label = show(this.raw(decl.label));
      c.labelSet = true;
    }
    let bodyAllowedEmpty = true;
    if (this.peek().type === 'STYLE_SEPARATOR') {
      this.next();
      end = this.alphaNum().end;
      bodyAllowedEmpty = false;
    } else if (this.peek().type === 'ANNOTATION_START') {
      const a = this.next();
      const word = this.alphaNum();
      const close = this.expect('ANNOTATION_END');
      end = close.end;
      c.annotations.push(show(word.text));
      this.map.annotations.get(c.id)!.push({
        form: 'inline',
        span: this.span(a.start, close.end),
        inner: this.span(word.start, word.end),
        stmt,
      });
    }
    if (this.peek().type === 'STRUCT_START') {
      const open = this.next();
      const members: PTok[] = [];
      while (this.peek().type === 'MEMBER') members.push(this.next());
      if (!members.length && !bodyAllowedEmpty) throw new ParseError('empty body after :::');
      const close = this.expect('STRUCT_STOP');
      end = close.end;
      decl.body = { open: this.o(open.start), close: this.o(close.start) };
      for (const m of members) this.addMember(c, this.span(m.start, m.end), 'body', stmt);
    }
    this.map.statements[stmt].span = this.span(t.start, end);
    const list = this.map.decls.get(c.id) ?? [];
    list.push(decl);
    this.map.decls.set(c.id, list);
  }

  private relationOrMember(): void {
    const first = this.className();
    const n = this.peek();
    if (n.type === 'LABEL') {
      this.next();
      const stmt = this.pushStmt('member', first.start, n.end, [first.id]);
      const c = this.addClass(first, stmt);
      // cleanupLabel: drop the leading ':'.
      this.addMember(c, this.span(n.start + 1, n.end), 'line', stmt);
      return;
    }
    if (n.type === 'NEWLINE' || n.type === 'EOF') {
      // A bare class name: mermaid parses it and does nothing.
      this.pushStmt('bare', first.start, first.end, []);
      return;
    }
    // relationStatement: className STR? relation STR? className LABEL?
    let card1: PTok | null = null;
    let card2: PTok | null = null;
    if (this.peek().type === 'STR') card1 = this.next();
    const arrowStart = this.peek();
    let type1: ClassEndMarker = 'none';
    let type2: ClassEndMarker = 'none';
    let arrowEnd: number;
    if (arrowStart.type in REL_TYPES) type1 = REL_TYPES[this.next().type];
    const lt = this.peek();
    if (lt.type !== 'LINE' && lt.type !== 'DOTTED_LINE') throw new ParseError(`expected a relation, got ${lt.type} "${lt.text}"`);
    this.next();
    arrowEnd = lt.end;
    if (this.peek().type in REL_TYPES) {
      const r = this.next();
      type2 = REL_TYPES[r.type];
      arrowEnd = r.end;
    }
    if (this.peek().type === 'STR') card2 = this.next();
    const second = this.className();
    let label: PTok | null = null;
    if (this.peek().type === 'LABEL') label = this.next();
    const end = label ? label.end : second.end;
    const stmt = this.pushStmt('relation', first.start, end, [first.id, second.id]);
    // Arrow tokens may include leading whitespace (`\s*<|`).
    const aStartTok = type1 !== 'none' ? arrowStart : lt;
    const lead = aStartTok.text.length - aStartTok.text.trimStart().length;
    // ClassDB.addRelation: a lollipop end names an interface, not a class.
    const invalid = new Set<ClassEndMarker>(['lollipop', 'aggregation', 'composition', 'arrow', 'inheritance']);
    if (type1 === 'lollipop' && !invalid.has(type2)) {
      this.addClass(second, stmt);
    } else if (type2 === 'lollipop' && !invalid.has(type1)) {
      this.addClass(first, stmt);
    } else {
      this.addClass(first, stmt);
      this.addClass(second, stmt);
    }
    const strText = (t: PTok | null) => (t ? show(this.raw(this.span(t.inner!.start, t.inner!.end)).trim()) : '');
    this.relations.push({
      from: first.id,
      to: second.id,
      fromMarker: type1,
      toMarker: type2,
      line: lt.type === 'LINE' ? 'solid' : 'dashed',
      fromCardinality: strText(card1),
      toCardinality: strText(card2),
      label: label ? show(this.raw(this.span(label.start + 1, label.end)).trim()) : '',
    });
    this.map.relations.push({
      stmt,
      from: this.span(first.start, first.end),
      to: this.span(second.start, second.end),
      arrow: this.span(aStartTok.start + lead, arrowEnd),
      fromCardinality: card1 ? this.span(card1.start, card1.end) : null,
      toCardinality: card2 ? this.span(card2.start, card2.end) : null,
      label: label ? this.span(label.start, label.end) : null,
    });
  }
}
