// Source-preserving visual edits for ER diagrams — the ER counterpart
// of mermaid-flowchart-edit.ts / class-edit.ts (see there for the why).
//
// Edits take user-level values and change only the source they are
// about, located through er-parser.ts's source map:
//   - a cardinality / line-kind / label edit replaces one token of the
//     relationship line, keeping the way it is written (`||` stays a
//     symbol, `one or more` stays words)
//   - an attribute edit rewrites one attribute row (parts the edit
//     didn't change keep their bytes)
//   - deletes remove whole statements (an entity takes its blocks,
//     relationships and `class` / `style` mentions with it)
//   - additions insert lines after the last statement / attribute
//
// Renaming an entity sets its ALIAS (`CUSTOMER["Customer"]`), never its
// id: the id is how every relationship refers to the entity. mermaid
// shows the FIRST alias it sees, so that is the one edited. A new entity
// gets an id derived from its name plus an alias when the two differ.
//
// Text: labels and aliases are written with entity codes for the
// characters mermaid would act on (see encodeText in entity-text.ts).
// Attribute types and names are bare words in mermaid's grammar — no
// quoting, no entity codes — so they are SANITISED (sanitizeErWord):
// what the UI shows after an edit is the sanitised word.
import {
  parseErSource,
  type ErAttribute,
  type ErAttributeSource,
  type ErCardinality,
  type ErDirection,
  type ErKey,
  type ErModel,
  type ErSourceMap,
} from './er-parser';
import { parseGenericTypes } from './class-parser';
import { breakDirection, encodeChars, encodeText, flatten } from './entity-text';
import { Splicer } from './splice';
import { DEFAULT_INDENT, indentOf, joinLines, nextFreeId, splitLines } from './source-text';

// What a user can pick for a relationship end (`md-parent` is read,
// not offered).
export type ErCardinalityInput = Exclude<ErCardinality, 'md-parent'>;

export interface ErAttributeInput {
  type: string;
  name: string;
  keys: ErKey[];
  comment: string;
}

export type ErEdit =
  // Display name (alias). '' (or the id itself) removes the alias.
  | { kind: 'setEntityLabel'; id: string; label: string }
  // New entity (id derived from `label`), optionally related to an
  // existing one (defaults: exactly-one to zero-or-more, identifying).
  | {
      kind: 'addEntity';
      label: string;
      relation?: {
        other: string;
        newIs: 'from' | 'to';
        fromCardinality?: ErCardinalityInput;
        toCardinality?: ErCardinalityInput;
        identifying?: boolean;
        label?: string;
      };
    }
  | { kind: 'deleteEntity'; id: string }
  // Insert at attribute index `index` (default: last).
  | { kind: 'addAttribute'; entityId: string; attribute: ErAttributeInput; index?: number }
  | { kind: 'setAttribute'; entityId: string; index: number; attribute: ErAttributeInput }
  | { kind: 'removeAttribute'; entityId: string; index: number }
  // Move attribute `from` so it ends up at index `to`.
  | { kind: 'moveAttribute'; entityId: string; from: number; to: number }
  | {
      kind: 'addRelationship';
      from: string;
      to: string;
      fromCardinality?: ErCardinalityInput;
      toCardinality?: ErCardinalityInput;
      identifying?: boolean;
      label?: string;
    }
  // Either end or both.
  | { kind: 'setRelationshipCardinality'; index: number; from?: ErCardinalityInput; to?: ErCardinalityInput }
  | { kind: 'setRelationshipIdentifying'; index: number; identifying: boolean }
  | { kind: 'setRelationshipLabel'; index: number; label: string }
  | { kind: 'deleteRelationship'; index: number }
  | { kind: 'setDirection'; direction: ErDirection };

export interface ErEditResult {
  source: string;
  // Id of the entity an addEntity edit created.
  id?: string;
  // Index of the relationship / attribute an add edit created.
  index?: number;
}

// ── Writing ──────────────────────────────────────────────────────────

const LEFT: Record<ErCardinalityInput, string> = { 'zero-or-one': '|o', 'exactly-one': '||', 'zero-or-more': '}o', 'one-or-more': '}|' };
const RIGHT: Record<ErCardinalityInput, string> = { 'zero-or-one': 'o|', 'exactly-one': '||', 'zero-or-more': 'o{', 'one-or-more': '|{' };
const WORDS: Record<ErCardinalityInput, string> = {
  'zero-or-one': 'zero or one',
  'exactly-one': 'only one',
  'zero-or-more': 'zero or more',
  'one-or-more': 'one or more',
};

export function emitErRelationship(
  from: string,
  to: string,
  fromCardinality: ErCardinalityInput,
  toCardinality: ErCardinalityInput,
  identifying: boolean,
  label: string,
): string {
  return `${emitErRef(from)} ${LEFT[fromCardinality]}${identifying ? '--' : '..'}${RIGHT[toCardinality]} ${emitErRef(to)} : ${emitRole(label)}`;
}

function emitRole(label: string): string {
  return `"${encodeText(label, 'i')}"`;
}

// Words the ER lexer reads as keywords (case-insensitively) at the
// start of a name.
const ER_KEYWORD = /^(one|only|zero|many|to|optionally|class|classdef|style|erdiagram|acctitle|accdescr|direction)\b/i;

function bareSafe(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s) && !ER_KEYWORD.test(s) && !/^u[-.|]/i.test(s) && !/^o[|{]/i.test(s);
}

// How to write entity `id` where an entity name is expected.
export function emitErRef(id: string): string {
  return bareSafe(id) ? id : `"${id}"`;
}

// An id for a new entity named `label`: its letters, digits and `_`
// (other runs become `_`), e.g. "Customer order" → "Customer_order".
export function deriveErId(label: string, taken: (id: string) => boolean): string {
  let base = flatten(label).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) base = 'ENTITY';
  if (/^[0-9]/.test(base)) base = 'E_' + base;
  if (!bareSafe(base)) base += '_';
  return taken(base) ? nextFreeId(taken, base) : base;
}

// Attribute types and names are bare words in mermaid's ER grammar
// (`[*A-Za-z_À-￿][A-Za-z0-9-_[\]()À-￿*]*`): no
// spaces, quotes or entity codes. A typed word is made to fit:
//   - newlines / spaces and every other character outside that set → `_`
//   - a type written `Name<Inner>` becomes `Name~Inner~` (mermaid shows
//     it as `Name<Inner>`); in names `<` / `>` are just characters → `_`
//   - a word starting with a digit, `-`, `[`, `(` or with PK/FK/UK
//     (which mermaid would read as a key) gets a leading `_`
//   - an empty word becomes `_`
export function sanitizeErWord(text: string, opts: { generic?: boolean } = {}): string {
  let s = flatten(text);
  const word = (w: string) => w.replace(/[^A-Za-z0-9\-_[\]()À-￿*]/g, '_');
  const g = /^([^<>~]*)<([^<>~]*)>$/.exec(s);
  if (opts.generic && g && g[1].trim() && !/\s/.test(g[1])) {
    s = `${word(g[1])}~${g[2].split(',').map((x) => word(x.trim())).join(', ')}~`;
  } else {
    s = word(s);
  }
  if (!s) return '_';
  if (!/^[*A-Za-z_À-￿]/.test(s) || /^(pk|fk|uk)\b/i.test(s)) s = '_' + s;
  return s;
}

// What a sanitised word is shown as.
export function erWordDisplay(word: string): string {
  return parseGenericTypes(word);
}

// An attribute input as it reads back after an edit.
export function attributeFromInput(a: ErAttributeInput): ErAttribute {
  return {
    type: erWordDisplay(sanitizeErWord(a.type, { generic: true })),
    name: erWordDisplay(sanitizeErWord(a.name)),
    keys: uniqueKeys(a.keys),
    comment: flatten(a.comment),
  };
}

function uniqueKeys(keys: ErKey[]): ErKey[] {
  return keys.filter((k, i) => keys.indexOf(k) === i);
}

// Comments are shown through mermaid's generics pass too, so `~` is
// encoded with the rest.
function emitComment(comment: string): string {
  // An inline block (`A { int a "…" }`) shares its line with
  // statement-level text, where `direction XX` swallows the line.
  return `"${breakDirection(encodeChars(flatten(comment)), 'i')}"`;
}

function emitAttribute(a: ErAttributeInput, raw?: { type: string; name: string; keys: string | null; comment: string | null; was: ErAttribute }): string {
  const type = raw && raw.was.type === attributeFromInput(a).type ? raw.type : sanitizeErWord(a.type, { generic: true });
  const name = raw && raw.was.name === attributeFromInput(a).name ? raw.name : sanitizeErWord(a.name);
  const keys = uniqueKeys(a.keys);
  const keyText =
    raw && raw.keys !== null && raw.was.keys.join() === keys.join() ? raw.keys : keys.join(', ');
  const comment = flatten(a.comment);
  const commentText = raw && raw.comment !== null && raw.was.comment === comment ? raw.comment : emitComment(comment);
  return `${type} ${name}${keys.length ? ' ' + keyText : ''}${comment ? ' ' + commentText : ''}`;
}

// ── The engine ───────────────────────────────────────────────────────

// Apply one visual edit to ER diagram `source`. Returns null when the
// source doesn't parse or the edit names something that doesn't exist.
export function applyErEdit(source: string, edit: ErEdit): ErEditResult | null {
  const parsed = parseErSource(source);
  if (!parsed.ok) return null;
  const { model, map } = parsed;
  const sp = new Splicer(map.text);
  const extra: Pick<ErEditResult, 'id' | 'index'> = {};
  const ok = run(model, map, sp, edit, extra);
  if (!ok) return null;
  if (ok === 'unchanged') return { source };
  const result = joinLines(splitLines(source), sp.apply().split('\n'));
  if (!parseErSource(result).ok) return null;
  return { source: result, ...extra };
}

function indentAtOff(text: string, off: number): string {
  const ls = text.lastIndexOf('\n', off - 1) + 1;
  return indentOf(text.slice(ls, off + 1));
}

// Where new statement lines go: after the last statement.
function lastStatement(map: ErSourceMap): { at: number; indent: string } {
  const last = map.statements[map.statements.length - 1];
  if (!last) return { at: map.header.end, indent: DEFAULT_INDENT };
  return { at: last.span.end, indent: indentAtOff(map.text, last.span.start) };
}

function run(model: ErModel, map: ErSourceMap, sp: Splicer, edit: ErEdit, extra: Pick<ErEditResult, 'id' | 'index'>): boolean | 'unchanged' {
  const text = map.text;
  switch (edit.kind) {
    case 'setEntityLabel': {
      const e = model.entities.get(edit.id);
      if (!e) return false;
      const label = flatten(edit.label);
      const decls = map.decls.get(edit.id) ?? [];
      const aliased = decls.filter((d) => d.alias);
      if (!label || label === e.id) {
        for (const d of aliased) sp.replace(d.aliasBox!, '');
        return aliased.length ? true : 'unchanged';
      }
      const alias = emitRole(label);
      if (aliased.length) sp.replace(aliased[0].alias!, alias);
      else if (decls.length) sp.insert(decls[0].name.end, `[${alias}]`);
      else {
        // Only in relationships: declare it right after the statement
        // that created it.
        const st = map.statements[map.created.get(edit.id)!];
        sp.lineAfter(st.span.end, indentAtOff(text, st.span.start), `${emitErRef(edit.id)}[${alias}]`);
      }
      return true;
    }

    case 'addEntity': {
      const label = flatten(edit.label);
      const taken = new Set(model.entities.keys());
      const id = deriveErId(label, (x) => taken.has(x));
      if (edit.relation && !model.entities.has(edit.relation.other)) return false;
      const where = lastStatement(map);
      sp.lineAfter(where.at, where.indent, emitErRef(id) + (label && label !== id ? `[${emitRole(label)}]` : ''));
      if (edit.relation) {
        const r = edit.relation;
        const [from, to] = r.newIs === 'from' ? [id, r.other] : [r.other, id];
        sp.lineAfter(
          where.at,
          where.indent,
          emitErRelationship(from, to, r.fromCardinality ?? 'exactly-one', r.toCardinality ?? 'zero-or-more', r.identifying ?? true, r.label ?? ''),
        );
        extra.index = model.relationships.length;
      }
      extra.id = id;
      return true;
    }

    case 'deleteEntity': {
      if (!model.entities.has(edit.id)) return false;
      deleteEntity(model, map, sp, edit.id);
      return true;
    }

    case 'addAttribute': {
      const e = model.entities.get(edit.entityId);
      if (!e) return false;
      const index = edit.index ?? e.attributes.length;
      if (index < 0 || index > e.attributes.length) return false;
      insertAttribute(map, sp, edit.entityId, index, emitAttribute(edit.attribute));
      extra.index = index;
      return true;
    }

    case 'setAttribute': {
      const e = model.entities.get(edit.entityId);
      const src = map.attributes.get(edit.entityId)?.[edit.index];
      if (!e || !src) return false;
      sp.replace(src.span, emitAttribute(edit.attribute, rawAttribute(text, src, e.attributes[edit.index])));
      return true;
    }

    case 'removeAttribute': {
      const src = map.attributes.get(edit.entityId)?.[edit.index];
      if (!src) return false;
      sp.remove(src.span);
      return true;
    }

    case 'moveAttribute': {
      const e = model.entities.get(edit.entityId);
      const srcs = map.attributes.get(edit.entityId);
      if (!e || !srcs?.[edit.from]) return false;
      const to = Math.max(0, Math.min(e.attributes.length - 1, edit.to));
      if (to === edit.from) return 'unchanged';
      const src = srcs[edit.from];
      sp.remove(src.span);
      insertAttribute(map, sp, edit.entityId, to, text.slice(src.span.start, src.span.end), edit.from);
      return true;
    }

    case 'addRelationship': {
      if (!model.entities.has(edit.from) || !model.entities.has(edit.to)) return false;
      const where = lastStatement(map);
      sp.lineAfter(
        where.at,
        where.indent,
        emitErRelationship(edit.from, edit.to, edit.fromCardinality ?? 'exactly-one', edit.toCardinality ?? 'zero-or-more', edit.identifying ?? true, edit.label ?? ''),
      );
      extra.index = model.relationships.length;
      return true;
    }

    case 'setRelationshipCardinality': {
      const rel = model.relationships[edit.index];
      const src = map.relationships[edit.index];
      if (!rel || !src) return false;
      let changed = false;
      for (const side of ['from', 'to'] as const) {
        const want = edit[side];
        if (!want || rel[`${side}Cardinality`] === want) continue;
        const span = side === 'from' ? src.fromCardinality : src.toCardinality;
        const was = text.slice(span.start, span.end);
        // Keep the way it is written: words stay words.
        sp.replace(span, /^[a-z]{2}/i.test(was) ? WORDS[want] : (side === 'from' ? LEFT : RIGHT)[want]);
        changed = true;
      }
      return changed || 'unchanged';
    }

    case 'setRelationshipIdentifying': {
      const rel = model.relationships[edit.index];
      const src = map.relationships[edit.index];
      if (!rel || !src) return false;
      if (rel.identifying === edit.identifying) return 'unchanged';
      const was = text.slice(src.line.start, src.line.end);
      const word = /^[a-z]{2}/i.test(was);
      sp.replace(src.line, edit.identifying ? (word ? 'to' : '--') : word ? 'optionally to' : '..');
      return true;
    }

    case 'setRelationshipLabel': {
      const src = map.relationships[edit.index];
      if (!src) return false;
      const label = flatten(edit.label);
      const was = text.slice(src.label.start, src.label.end);
      // A bare word stays bare when the new label can be one.
      sp.replace(src.label, !was.startsWith('"') && bareSafe(label) ? label : emitRole(label));
      return true;
    }

    case 'deleteRelationship': {
      const src = map.relationships[edit.index];
      if (!src) return false;
      removeCreating(model, map, sp, src.stmt, new Set());
      return true;
    }

    case 'setDirection': {
      if (model.direction === edit.direction) return 'unchanged';
      const last = map.directions[map.directions.length - 1];
      if (last) sp.replace(last, edit.direction);
      else {
        const first = map.statements[0];
        sp.lineAfter(map.header.end, first ? indentAtOff(text, first.span.start) : DEFAULT_INDENT, `direction ${edit.direction}`);
      }
      return true;
    }
  }
}

// The attribute's parts as written, for emitAttribute to keep.
function rawAttribute(text: string, src: ErAttributeSource, was: ErAttribute) {
  const sl = (s: { start: number; end: number } | null) => (s ? text.slice(s.start, s.end) : null);
  return { type: sl(src.type)!, name: sl(src.name)!, keys: sl(src.keys), comment: sl(src.comment), was };
}

// Insert attribute row `row` so it becomes attribute `index` (counted
// among the current attributes, excluding `skip` — one being moved).
function insertAttribute(map: ErSourceMap, sp: Splicer, id: string, index: number, row: string, skip?: number): void {
  const text = map.text;
  const srcs = map.attributes.get(id)!.filter((_, i) => i !== skip);
  const alone = (s: { start: number; end: number }) =>
    !text.slice(sp.lineStart(s.start), s.start).trim() && !text.slice(s.end, sp.lineEnd(s.end)).trim();
  const before = srcs[index];
  if (before) {
    if (alone(before.span)) sp.lineBefore(before.span.start, sp.indentAt(before.span.start), row);
    else sp.insert(before.span.start, `${row} `);
    return;
  }
  const last = srcs[srcs.length - 1];
  if (last) {
    if (alone(last.span)) sp.lineAfter(last.span.end, sp.indentAt(last.span.start), row);
    else sp.insert(last.span.end, ` ${row}`);
    return;
  }
  const decls = map.decls.get(id) ?? [];
  const withBlock = decls.find((d) => d.block);
  if (withBlock) {
    const { open, close } = withBlock.block!;
    const declIndent = indentAtOff(text, withBlock.name.start);
    const indent = declIndent + DEFAULT_INDENT;
    if (sp.lineOf(open) === sp.lineOf(close)) sp.insert(open + 1, `\n${indent}${row}\n${declIndent}`);
    else if (!text.slice(open + 1, sp.lineEnd(open)).trim()) sp.lineAfter(open, indent, row);
    else sp.insert(open + 1, `\n${indent}${row}\n${indent}`);
    return;
  }
  const decl = decls[0];
  if (decl) {
    // `X` / `X["alias"]` / `X:::cls` gets a block.
    const st = map.statements[decl.stmt];
    const indent = indentAtOff(text, st.span.start);
    sp.insert(st.span.end, ` {\n${indent}${DEFAULT_INDENT}${row}\n${indent}}`);
    return;
  }
  // Only in relationships: a new block after the last statement.
  const where = lastStatement(map);
  sp.lineAfter(where.at, where.indent, `${emitErRef(id)} {`);
  sp.lineAfter(where.at, where.indent + DEFAULT_INDENT, row);
  sp.lineAfter(where.at, where.indent, '}');
}

// Remove statement `stmt` (a relationship). Entities it created that
// must survive (not in `dying`) get a bare `X` line in its place, so
// they — and the entity order — stay.
function removeCreating(model: ErModel, map: ErSourceMap, sp: Splicer, stmt: number, dying: Set<string>): void {
  const st = map.statements[stmt];
  const keep = [...model.entities.keys()].filter((id) => map.created.get(id) === stmt && !dying.has(id));
  if (!keep.length) {
    sp.remove(st.span);
    return;
  }
  const indent = indentAtOff(map.text, st.span.start);
  sp.replace(st.span, keep.map((id) => emitErRef(id)).join(`\n${indent}`));
}

function deleteEntity(model: ErModel, map: ErSourceMap, sp: Splicer, id: string): void {
  const dying = new Set([id]);
  map.statements.forEach((s, k) => {
    if (!s.refs.includes(id)) return;
    if (s.kind === 'relationship') {
      removeCreating(model, map, sp, k, dying);
    } else if ((s.kind === 'class' || s.kind === 'style') && s.idList) {
      const rest = s.refs.filter((r) => r !== id);
      if (rest.length) sp.replace(s.idList, rest.join(','));
      else sp.remove(s.span);
    } else {
      sp.remove(s.span);
    }
  });
}
