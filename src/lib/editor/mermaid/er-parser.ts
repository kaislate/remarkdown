// Parser for mermaid 11.14 ER diagrams (`erDiagram`) — the full syntax.
//
// Same approach as class-parser.ts: mermaid's own lexer rules
// (er-lexer.ts) over mermaid-preprocessed text, the grammar of
// erDiagram.jison, and a replay of what mermaid's ErDB does (entity
// creation order, first alias wins, attribute order …). Checked against
// mermaid's db over the corpus.
//
// Text in the model is what mermaid DISPLAYS: entity codes decoded,
// `~T~` generics shown as `<T>` (mermaid does that for every attribute
// cell), an entity shown by its alias when it has one.
import { lexEr } from './er-lexer';
import type { Tok } from './class-lexer';
import { prepareSource, decodePlaceholders, type PreparedSource } from './entity-text';
import { splitLines } from './source-text';
import { parseGenericTypes, type Span } from './class-parser';
import { decodeMermaidEntities } from '../mermaid-parser';

export type { Span };

// ── Model ────────────────────────────────────────────────────────────

export type ErDirection = 'TB' | 'BT' | 'LR' | 'RL';
// `md-parent` (`u`, only on the left, glued to the line) is mermaid's
// "MD parent" marker; it is read but not offered for editing.
export type ErCardinality = 'zero-or-one' | 'exactly-one' | 'zero-or-more' | 'one-or-more' | 'md-parent';
export type ErKey = 'PK' | 'FK' | 'UK';

export interface ErAttribute {
  type: string;
  name: string;
  keys: ErKey[];
  comment: string;
}

export interface ErEntity {
  id: string;
  // `CUSTOMER["Customer"]` → "Customer"; '' when none.
  alias: string;
  // What the box shows: the alias, else the id.
  label: string;
  attributes: ErAttribute[];
}

export interface ErRelationship {
  // Entity ids left / right of the relationship.
  from: string;
  to: string;
  // Cardinality at each end: `A ||--o{ B` → from exactly-one, to
  // zero-or-more.
  fromCardinality: ErCardinality;
  toCardinality: ErCardinality;
  // `--` (solid line) vs `..` (dashed).
  identifying: boolean;
  label: string;
}

export interface ErModel {
  direction: ErDirection;
  // Insertion order = mermaid's creation order.
  entities: Map<string, ErEntity>;
  relationships: ErRelationship[];
}

// ── Source map ───────────────────────────────────────────────────────

export type ErStatementKind = 'entity' | 'relationship' | 'direction' | 'classDef' | 'class' | 'style' | 'acc';

export interface ErStatementSource {
  kind: ErStatementKind;
  span: Span;
  // Entities the statement names.
  refs: string[];
  // For class / style statements: the span of the entity id list.
  idList?: Span;
}

export interface ErEntityDeclSource {
  stmt: number;
  // The entity name token (quotes included).
  name: Span;
  // The alias token inside the brackets (quotes included) and the
  // whole `[…]`.
  alias: Span | null;
  aliasBox: Span | null;
  // `{` and `}` offsets.
  block: { open: number; close: number } | null;
}

export interface ErAttributeSource {
  stmt: number;
  // From the type through the last part (keys / comment).
  span: Span;
  type: Span;
  name: Span;
  // First key through last key (`PK, FK`).
  keys: Span | null;
  // The `"comment"` (quotes included).
  comment: Span | null;
}

export interface ErRelationshipSource {
  stmt: number;
  from: Span;
  to: Span;
  fromCardinality: Span;
  line: Span;
  toCardinality: Span;
  // The role token (quotes included).
  label: Span;
}

export interface ErSourceMap {
  lines: string[];
  eol: string;
  text: string;
  headerLine: number;
  header: Span;
  statements: ErStatementSource[];
  decls: Map<string, ErEntityDeclSource[]>;
  // Parallel to model.entities.get(id).attributes.
  attributes: Map<string, ErAttributeSource[]>;
  // Parallel to model.relationships.
  relationships: ErRelationshipSource[];
  // Statement where each entity came into being.
  created: Map<string, number>;
  directions: Span[];
}

export type ErSourceParseResult = { ok: true; model: ErModel; map: ErSourceMap } | { ok: false; reason: string };
export type ErParseResult = { ok: true; model: ErModel } | { ok: false; reason: string };

export const ER_STARTER = [
  'erDiagram',
  '    CUSTOMER ||--o{ ORDER : places',
  '    ORDER ||--|{ LINE_ITEM : contains',
  '    CUSTOMER {',
  '        string name',
  '        string email PK',
  '    }',
  '    ORDER {',
  '        int id PK',
  '        int customerId FK',
  '        date created',
  '    }',
  '    LINE_ITEM {',
  '        int quantity',
  '        decimal price',
  '    }',
  '',
].join('\n');

// ── Parser ───────────────────────────────────────────────────────────

class ParseError extends Error {}

const CARDINALITY: Record<string, ErCardinality> = {
  ZERO_OR_ONE: 'zero-or-one',
  ZERO_OR_MORE: 'zero-or-more',
  ONE_OR_MORE: 'one-or-more',
  ONLY_ONE: 'exactly-one',
  MD_PARENT: 'md-parent',
};
const ENTITY_NAME = new Set(['ENTITY_NAME', 'UNICODE_TEXT', 'NUM', 'DECIMAL_NUM', 'ENTITY_ONE']);
const STYLE_COMPONENT = new Set(['STYLE_TEXT', 'NUM', 'COLON', 'BRKT']);

const show = (raw: string) => decodeMermaidEntities(decodePlaceholders(raw));
// What an attribute cell shows (mermaid runs parseGenericTypes on all
// four cells).
const cell = (raw: string) => show(parseGenericTypes(raw));
const unquote = (s: string) => s.replace(/"/g, '');

export function parseErSource(source: string): ErSourceParseResult {
  const src = splitLines(source);
  const prepared = prepareSource(src.lines);
  if (prepared.preamble.headerLine < 0) return { ok: false, reason: 'empty source' };
  const header = src.lines[prepared.preamble.headerLine].trim();
  if (!/^erDiagram\b/i.test(header)) return { ok: false, reason: `not an erDiagram: ${header}` };
  const lexed = lexEr(prepared.lexText + '\n', prepared.lexStart);
  if (!lexed.ok) return { ok: false, reason: `lexical error at offset ${prepared.origin[lexed.at] ?? lexed.at}` };
  try {
    return new ErParser(prepared, lexed.tokens, src).run();
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, reason: e.message };
    throw e;
  }
}

export function parseEr(source: string): ErParseResult {
  const r = parseErSource(source);
  return r.ok ? { ok: true, model: r.model } : r;
}

class ErParser {
  private pos = 0;
  private entities = new Map<string, ErEntity>();
  private relationships: ErRelationship[] = [];
  private direction: ErDirection = 'TB';
  private map: ErSourceMap;

  constructor(
    private p: PreparedSource,
    private toks: Tok[],
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
      attributes: new Map(),
      relationships: [],
      created: new Map(),
      directions: [],
    };
  }

  private span(start: number, end: number): Span {
    return { start: this.p.origin[start], end: end > start ? this.p.origin[end - 1] + 1 : this.p.origin[start] };
  }
  private raw(s: Span): string {
    return this.p.text.slice(s.start, s.end);
  }
  private peek(k = 0): Tok {
    return this.toks[Math.min(this.pos + k, this.toks.length - 1)];
  }
  private next(): Tok {
    return this.toks[this.pos++];
  }
  private expect(type: string): Tok {
    const t = this.peek();
    if (t.type !== type) throw new ParseError(`expected ${type}, got ${t.type} "${t.text}"`);
    return this.next();
  }

  run(): ErSourceParseResult {
    const head = this.expect('ER_DIAGRAM');
    this.map.header = this.span(head.start, head.end);
    for (;;) {
      const t = this.peek();
      if (t.type === 'EOF') break;
      if (t.type === 'NEWLINE' || t.type === 'SPACE') {
        this.next();
        continue;
      }
      this.statement();
    }
    return { ok: true, model: { direction: this.direction, entities: this.entities, relationships: this.relationships }, map: this.map };
  }

  // ErDB.addEntity: create on first sight; the first alias sticks.
  private addEntity(name: string, stmt: number, alias = ''): ErEntity {
    let e = this.entities.get(name);
    if (!e) {
      e = { id: name, alias: show(alias), label: show(alias || name), attributes: [] };
      this.entities.set(name, e);
      this.map.created.set(name, stmt);
      this.map.attributes.set(name, []);
      this.map.decls.set(name, []);
    } else if (!e.alias && alias) {
      e.alias = show(alias);
      e.label = e.alias;
    }
    return e;
  }

  private pushStmt(kind: ErStatementKind, start: number, end: number, refs: string[], idList?: Span): number {
    this.map.statements.push({ kind, span: this.span(start, end), refs, ...(idList ? { idList } : {}) });
    return this.map.statements.length - 1;
  }

  private entityName(): { value: string; tok: Tok } {
    const t = this.peek();
    if (!ENTITY_NAME.has(t.type)) throw new ParseError(`expected an entity name, got ${t.type} "${t.text}"`);
    this.next();
    // As written in the source (entity codes encoded, quotes dropped).
    const raw = this.raw(this.span(t.start, t.end));
    return { value: t.type === 'ENTITY_NAME' ? unquote(raw) : raw, tok: t };
  }

  // idList: (UNICODE_TEXT | STYLE_TEXT) (COMMA …)*
  private idList(): { ids: string[]; start: number; end: number } {
    const first = this.peek();
    if (first.type !== 'UNICODE_TEXT' && first.type !== 'STYLE_TEXT') throw new ParseError(`expected a name, got ${first.type}`);
    const ids = [this.next().text];
    let end = first.end;
    while (this.peek().type === 'COMMA' && ['UNICODE_TEXT', 'STYLE_TEXT'].includes(this.peek(1).type)) {
      this.next();
      const t = this.next();
      ids.push(t.text);
      end = t.end;
    }
    return { ids, start: first.start, end };
  }

  // stylesOpt separator — returns the end of the statement.
  private stylesThenSeparator(): number {
    let end = this.peek().start;
    let any = false;
    for (;;) {
      const t = this.peek();
      if (STYLE_COMPONENT.has(t.type)) {
        any = true;
        end = this.next().end;
      } else if (t.type === 'COMMA' && any) {
        end = this.next().end;
      } else break;
    }
    if (!any) throw new ParseError('expected styles');
    const sep = this.peek();
    if (sep.type === 'NEWLINE' || sep.type === 'SEMI') this.next();
    else if (sep.type !== 'EOF') throw new ParseError(`expected end of styles, got ${sep.type} "${sep.text}"`);
    return end;
  }

  private statement(): void {
    const t = this.peek();
    switch (t.type) {
      case 'direction_tb':
      case 'direction_bt':
      case 'direction_rl':
      case 'direction_lr': {
        this.next();
        this.direction = t.type.slice(-2).toUpperCase() as ErDirection;
        const lead = t.text.length - t.text.trimStart().length;
        this.pushStmt('direction', t.start + lead, t.start + t.text.trimEnd().length, []);
        const m = new RegExp(`direction\\s+${this.direction}`, 'i').exec(t.text)!;
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
      case 'CLASSDEF': {
        this.next();
        this.idList();
        const end = this.stylesThenSeparator();
        this.pushStmt('classDef', t.start, end, []);
        return;
      }
      case 'CLASS': {
        this.next();
        const ids = this.idList();
        const cls = this.idList();
        this.pushStmt('class', t.start, cls.end, ids.ids, this.span(ids.start, ids.end));
        return;
      }
      case 'STYLE': {
        this.next();
        const ids = this.idList();
        const end = this.stylesThenSeparator();
        this.pushStmt('style', t.start, end, ids.ids, this.span(ids.start, ids.end));
        return;
      }
      default:
        if (ENTITY_NAME.has(t.type)) return this.entityStatement();
        throw new ParseError(`unexpected ${t.type} "${t.text}"`);
    }
  }

  private isCardinality(t: Tok): boolean {
    return t.type in CARDINALITY;
  }

  private entityStatement(): void {
    const a = this.entityName();
    const stmt = this.map.statements.length;
    this.pushStmt('entity', a.tok.start, a.tok.end, [a.value]);
    let end = a.tok.end;
    const decl: ErEntityDeclSource = { stmt, name: this.span(a.tok.start, a.tok.end), alias: null, aliasBox: null, block: null };

    if (this.peek().type === 'SQS') {
      // entityName [ alias ] (:::classes)? ({ attributes })?
      const sqs = this.next();
      const alias = this.entityName();
      const sqe = this.expect('SQE');
      end = sqe.end;
      decl.alias = this.span(alias.tok.start, alias.tok.end);
      decl.aliasBox = this.span(sqs.start, sqe.end);
      this.addEntity(a.value, stmt, alias.value);
      if (this.peek().type === 'STYLE_SEPARATOR') {
        this.next();
        end = this.idList().end;
      }
      if (this.peek().type === 'BLOCK_START') end = this.block(a.value, stmt, decl);
      this.finishDecl(a.value, stmt, decl, a.tok.start, end);
      return;
    }

    let classed = false;
    if (this.peek().type === 'STYLE_SEPARATOR') {
      this.next();
      end = this.idList().end;
      classed = true;
    }
    if (this.isCardinality(this.peek())) {
      this.relationship(a, stmt);
      return;
    }
    this.addEntity(a.value, stmt);
    if (this.peek().type === 'BLOCK_START') end = this.block(a.value, stmt, decl);
    void classed;
    this.finishDecl(a.value, stmt, decl, a.tok.start, end);
  }

  private finishDecl(id: string, stmt: number, decl: ErEntityDeclSource, start: number, end: number): void {
    this.map.statements[stmt].span = this.span(start, end);
    this.map.decls.get(id)!.push(decl);
  }

  private block(id: string, stmt: number, decl: ErEntityDeclSource): number {
    const open = this.expect('BLOCK_START');
    const e = this.entities.get(id)!;
    const attrs: Array<{ attr: ErAttribute; src: ErAttributeSource }> = [];
    while (this.peek().type === 'ATTRIBUTE_WORD') {
      const type = this.next();
      const name = this.expect('ATTRIBUTE_WORD');
      let end = name.end;
      const keys: ErKey[] = [];
      let keySpan: Span | null = null;
      if (this.peek().type === 'ATTRIBUTE_KEY') {
        const k0 = this.next();
        keys.push(k0.text.toUpperCase() as ErKey);
        let kEnd = k0.end;
        while (this.peek().type === ',' && this.peek(1).type === 'ATTRIBUTE_KEY') {
          this.next();
          const k = this.next();
          keys.push(k.text.toUpperCase() as ErKey);
          kEnd = k.end;
        }
        keySpan = this.span(k0.start, kEnd);
        end = kEnd;
      }
      let comment = '';
      let commentSpan: Span | null = null;
      if (this.peek().type === 'COMMENT') {
        const c = this.next();
        comment = cell(this.raw(this.span(c.start + 1, c.end - 1)));
        commentSpan = this.span(c.start, c.end);
        end = c.end;
      }
      attrs.push({
        attr: { type: cell(this.raw(this.span(type.start, type.end))), name: cell(this.raw(this.span(name.start, name.end))), keys, comment },
        src: { stmt, span: this.span(type.start, end), type: this.span(type.start, type.end), name: this.span(name.start, name.end), keys: keySpan, comment: commentSpan },
      });
    }
    const close = this.expect('BLOCK_STOP');
    decl.block = { open: this.span(open.start, open.end).start, close: this.span(close.start, close.end).start };
    for (const { attr, src } of attrs) {
      e.attributes.push(attr);
      this.map.attributes.get(id)!.push(src);
    }
    return close.end;
  }

  private relationship(a: { value: string; tok: Tok }, stmt: number): void {
    const c1 = this.next();
    const line = this.peek();
    if (line.type !== 'IDENTIFYING' && line.type !== 'NON_IDENTIFYING') throw new ParseError(`expected a relationship line, got ${line.type} "${line.text}"`);
    this.next();
    const c2 = this.peek();
    if (!this.isCardinality(c2)) throw new ParseError(`expected a cardinality, got ${c2.type} "${c2.text}"`);
    this.next();
    const b = this.entityName();
    if (this.peek().type === 'STYLE_SEPARATOR') {
      this.next();
      this.idList();
    }
    this.expect('COLON');
    const role = this.peek();
    if (role.type !== 'WORD' && role.type !== 'ENTITY_NAME' && role.type !== 'UNICODE_TEXT') throw new ParseError(`expected a label, got ${role.type} "${role.text}"`);
    this.next();
    this.addEntity(a.value, stmt);
    this.addEntity(b.value, stmt);
    const st = this.map.statements[stmt];
    st.kind = 'relationship';
    st.refs = [a.value, b.value];
    st.span = this.span(a.tok.start, role.end);
    const labelRaw = role.type === 'UNICODE_TEXT' ? this.raw(this.span(role.start, role.end)) : unquote(this.raw(this.span(role.start, role.end)));
    this.relationships.push({
      from: a.value,
      to: b.value,
      // relSpec: cardB is the left one, cardA the right one.
      fromCardinality: CARDINALITY[c1.type],
      toCardinality: CARDINALITY[c2.type],
      identifying: line.type === 'IDENTIFYING',
      label: show(labelRaw),
    });
    this.map.relationships.push({
      stmt,
      from: this.span(a.tok.start, a.tok.end),
      to: this.span(b.tok.start, b.tok.end),
      fromCardinality: this.span(c1.start, c1.end),
      line: this.span(line.start, line.end),
      toCardinality: this.span(c2.start, c2.end),
      label: this.span(role.start, role.end),
    });
  }
}
