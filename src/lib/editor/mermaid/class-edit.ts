// Source-preserving visual edits for class diagrams — the class
// counterpart of mermaid-flowchart-edit.ts (see there for the why).
//
// Edits take user-level values (plain text, enum choices, ids of
// existing items) and change only the source text they are about,
// located through class-parser.ts's source map:
//   - text edits splice one span: the label between `["` and `"]`, one
//     member's text, a relation's arrow / `"cardinality"` / `: label`
//   - deletes remove whole statement lines (a class takes its
//     declarations, `X : member` lines, relations, notes, annotation /
//     style / click lines with it; an emptied namespace goes too)
//   - additions insert lines after the last statement (or member) of
//     their kind, with its indentation
// Lines an edit doesn't touch — comments, blank lines, other statements
// — are never re-emitted.
//
// Renaming a class sets its LABEL (`class X["New name"]`), never its
// id: the id is how every relation, member line, note and style line
// refers to the class, so renaming it would rewrite all of them. A new
// class gets an id derived from its name (`Customer order` →
// `CustomerOrder`) plus a label when the two differ.
//
// User text is written so mermaid accepts it AND shows it as typed:
// characters mermaid's lexer or its markdown/HTML labels would act on
// become entity codes (`#59;`, `#quot;` …), which mermaid decodes for
// display — see encodeText. Newlines become spaces and outer spaces
// are trimmed (mermaid trims every label). Generics typed in a member
// type (`List<int>`) are written mermaid's way (`List~int~`).
import {
  parseClassSource,
  parseGenericTypes,
  parseMemberText,
  VISIBILITY_CHAR,
  CLASSIFIER_CHAR,
  type ClassClassifier,
  type ClassDirection,
  type ClassEndMarker,
  type ClassMember,
  type ClassModel,
  type ClassRelation,
  type ClassSourceMap,
  type ClassVisibility,
} from './class-parser';
import { breakDirection, encodeChars, encodeText, entity, flatten, encodePlaceholders, decodePlaceholders } from './entity-text';
import { Splicer } from './splice';
import { DEFAULT_INDENT, indentOf, joinLines, nextFreeId, splitLines } from './source-text';

// The relationship kinds a user picks from. Each is a marker + line:
//   inheritance  `from --|> to`  (to is the parent)
//   realization  `from ..|> to`  (to is the interface)
//   composition  `from *-- to`   (from is the whole)
//   aggregation  `from o-- to`   (from is the whole)
//   association  `from --> to`
//   dependency   `from ..> to`   (from depends on to)
//   link         `from -- to`
//   dashedLink   `from .. to`
export type ClassRelationType =
  | 'inheritance'
  | 'realization'
  | 'composition'
  | 'aggregation'
  | 'association'
  | 'dependency'
  | 'link'
  | 'dashedLink';

// A member as a user edits it in a form.
export interface ClassMemberInput {
  kind: 'field' | 'method';
  visibility: ClassVisibility;
  classifier: ClassClassifier;
  name: string;
  // Field type / method return type ('' for none).
  type: string;
  // Method parameters as plain text ('' for fields).
  parameters: string;
}

export type ClassEdit =
  // Display name. '' (or the id itself) removes the label: the class
  // then shows its id.
  | { kind: 'setClassLabel'; id: string; label: string }
  // New class (id derived from `label`), optionally in an existing
  // namespace and/or related to an existing class.
  | {
      kind: 'addClass';
      label: string;
      namespace?: string;
      relation?: { other: string; type: ClassRelationType; newIs: 'from' | 'to' };
    }
  | { kind: 'deleteClass'; id: string }
  // Insert at member index `index` (default: last).
  | { kind: 'addMember'; classId: string; member: ClassMemberInput; index?: number }
  | { kind: 'setMember'; classId: string; index: number; member: ClassMemberInput }
  | { kind: 'removeMember'; classId: string; index: number }
  // Move member `from` so it ends up at index `to`.
  | { kind: 'moveMember'; classId: string; from: number; to: number }
  // Sets the first `<<annotation>>` (the one mermaid shows); '' clears
  // them all.
  | { kind: 'setAnnotation'; classId: string; annotation: string }
  | { kind: 'addRelation'; from: string; to: string; type: ClassRelationType; label?: string }
  | { kind: 'setRelationType'; index: number; type: ClassRelationType }
  // Moves the end markers to the other end (`A <|-- B` → `A --|> B`).
  | { kind: 'flipRelation'; index: number }
  | { kind: 'setRelationCardinality'; index: number; from: string; to: string }
  | { kind: 'setRelationLabel'; index: number; label: string }
  | { kind: 'deleteRelation'; index: number }
  | { kind: 'addNote'; text: string; classId?: string }
  | { kind: 'setNoteText'; index: number; text: string }
  | { kind: 'deleteNote'; index: number }
  | { kind: 'setDirection'; direction: ClassDirection };

export interface ClassEditResult {
  source: string;
  // Id of the class an addClass edit created.
  id?: string;
  // Index of the relation / note / member an add edit created.
  index?: number;
}

// ── Relation kinds ───────────────────────────────────────────────────

const KIND_MARKER: Record<ClassRelationType, { marker: ClassEndMarker; line: 'solid' | 'dashed'; end: 'from' | 'to' }> = {
  inheritance: { marker: 'inheritance', line: 'solid', end: 'to' },
  realization: { marker: 'inheritance', line: 'dashed', end: 'to' },
  composition: { marker: 'composition', line: 'solid', end: 'from' },
  aggregation: { marker: 'aggregation', line: 'solid', end: 'from' },
  association: { marker: 'arrow', line: 'solid', end: 'to' },
  dependency: { marker: 'arrow', line: 'dashed', end: 'to' },
  link: { marker: 'none', line: 'solid', end: 'to' },
  dashedLink: { marker: 'none', line: 'dashed', end: 'to' },
};

// The user-level kind of a relation, or null for combinations outside
// the eight (two-ended `<|--|>`, dashed composition, lollipops …).
export function classRelationType(rel: ClassRelation): ClassRelationType | null {
  const ends = [rel.fromMarker, rel.toMarker].filter((m) => m !== 'none');
  if (ends.length > 1) return null;
  const marker = ends[0] ?? 'none';
  for (const [k, v] of Object.entries(KIND_MARKER) as Array<[ClassRelationType, (typeof KIND_MARKER)[ClassRelationType]]>) {
    if (v.marker === marker && v.line === rel.line) return k;
  }
  return null;
}

const LEFT: Record<ClassEndMarker, string> = { none: '', inheritance: '<|', composition: '*', aggregation: 'o', arrow: '<', lollipop: '()' };
const RIGHT: Record<ClassEndMarker, string> = { none: '', inheritance: '|>', composition: '*', aggregation: 'o', arrow: '>', lollipop: '()' };

export function emitClassArrow(fromMarker: ClassEndMarker, line: 'solid' | 'dashed', toMarker: ClassEndMarker): string {
  return LEFT[fromMarker] + (line === 'solid' ? '--' : '..') + RIGHT[toMarker];
}

// Markers for `type`, keeping the marked end of `rel` when it has
// exactly one.
export function relationMarkers(type: ClassRelationType, rel?: ClassRelation): Pick<ClassRelation, 'fromMarker' | 'toMarker' | 'line'> {
  const k = KIND_MARKER[type];
  let end = k.end;
  if (rel) {
    const marked = [rel.fromMarker !== 'none', rel.toMarker !== 'none'];
    if (marked[0] !== marked[1]) end = marked[0] ? 'from' : 'to';
  }
  return {
    fromMarker: end === 'from' ? k.marker : 'none',
    toMarker: end === 'to' ? k.marker : 'none',
    line: k.line,
  };
}

// ── Writing text ─────────────────────────────────────────────────────


// One part of a member (name, type, parameters). Member text also
// can't hold `{ }` (body delimiters), `( )` (method syntax) or `$`
// (static marker). With `generic`, `<…>` that reads back the same as
// `~…~` is written that way.
function encodeMemberPart(text: string, opts: { generic: boolean; spaces: boolean }): string {
  let s = flatten(text);
  let generic = false;
  if (opts.generic && /[<>]/.test(s) && !s.includes('~')) {
    const tilde = s.replace(/[<>]/g, '~');
    if (parseGenericTypes(tilde) === s) generic = true;
  }
  if (generic) s = s.replace(/[<>]/g, '\u0001');
  s = encodeChars(s, /[{}()$]/);
  if (!opts.spaces) s = s.replace(/ /g, '#32;');
  if (generic) s = s.replace(/\u0001/g, '~');
  return breakDirection(s);
}

// A member input written as member text. `style` 'colon' keeps the
// `name: Type` way of writing a field (only valid inside a body).
function emitMember(m: ClassMemberInput, style: 'typeFirst' | 'colon' = 'typeFirst', raw?: RawMember): string {
  const vis = VISIBILITY_CHAR[m.visibility];
  const cls = CLASSIFIER_CHAR[m.classifier];
  const keep = (part: keyof RawMember['parts'], value: string, enc: () => string) =>
    raw && raw.kind === m.kind && raw.parts[part] !== undefined && raw.values[part] === value ? raw.parts[part]! : enc();
  const name = keep('name', m.name, () => encodeMemberPart(m.name, { generic: false, spaces: m.kind === 'method' }) || '#32;');
  let text: string;
  if (m.kind === 'method') {
    const params = keep('parameters', m.parameters, () => encodeMemberPart(m.parameters, { generic: true, spaces: true }));
    const ret = keep('type', m.type, () => encodeMemberPart(m.type, { generic: true, spaces: true }));
    text = `${vis}${name}(${params})${cls}${ret ? ' ' + ret : ''}`;
  } else {
    const type = keep('type', m.type, () => encodeMemberPart(m.type, { generic: true, spaces: true }));
    if (style === 'colon' && type) text = `${vis}${name}: ${type}${cls}`;
    else text = `${vis}${type}${type ? ' ' : ''}${name}${cls}`;
  }
  // Without a visibility, a leading + or - would read as one.
  if (!vis && /^[+-]/.test(text)) text = entity(text[0]) + text.slice(1);
  return text;
}

// The raw (as written) parts of an existing member, so an edit that
// leaves a part alone keeps its exact bytes.
interface RawMember {
  kind: 'field' | 'method';
  style: 'typeFirst' | 'colon' | 'nameOnly';
  parts: { name?: string; type?: string; parameters?: string };
  values: { name?: string; type?: string; parameters?: string };
}

function rawMember(raw: string, model: ClassMember): RawMember {
  // Run the regexes on placeholder text (as mermaid does), map back.
  const p = encodePlaceholders(raw.trim());
  const back = (s: string) => decodePlaceholders(s);
  if (model.kind === 'method') {
    const m = /([#+~-])?(.+)\((.*)\)([\s$*])?(.*)([$*])?/.exec(p);
    if (!m) return { kind: 'method', style: 'typeFirst', parts: {}, values: {} };
    let ret = (m[5] ?? '').trim();
    if (!(m[4] ?? '').trim() && /[$*]$/.test(ret)) ret = ret.slice(0, -1);
    return {
      kind: 'method',
      style: 'typeFirst',
      parts: { name: back(m[2].trim()), parameters: back((m[3] ?? '').trim()), type: back(ret) },
      values: { name: model.name, parameters: model.parameters, type: model.type },
    };
  }
  let body = p;
  if (/^[#+~-]/.test(body)) body = body.slice(1);
  if (/[$*]$/.test(body)) body = body.slice(0, -1);
  body = body.trim();
  const colon = /^([^\s:]+)\s*:\s*(.*)$/.exec(body);
  if (colon && /^[^\s:]+\s*:\s*\S/.test(body)) {
    return { kind: 'field', style: 'colon', parts: { name: back(colon[1]), type: back(colon[2]) }, values: { name: model.name, type: model.type } };
  }
  const tf = /^(.*\S)\s+(\S+)$/.exec(body);
  if (tf) return { kind: 'field', style: 'typeFirst', parts: { name: back(tf[2]), type: back(tf[1]) }, values: { name: model.name, type: model.type } };
  return { kind: 'field', style: 'nameOnly', parts: { name: back(body), type: '' }, values: { name: model.name, type: '' } };
}

// Can member text stand in this form? An `X : member` line ends at `:`
// / `;`; a body line can't hold braces or start with a quote.
function fitsForm(text: string, form: 'body' | 'line'): boolean {
  if (/direction\s+(TB|BT|RL|LR)/.test(text)) return false;
  return form === 'line' ? !/[:;\n]/.test(text) : !/[{}\n]/.test(text) && !text.startsWith('"');
}

function sameMember(a: ClassMember | null, b: ClassMemberInput): boolean {
  return (
    !!a &&
    a.kind === b.kind &&
    a.visibility === b.visibility &&
    a.classifier === b.classifier &&
    a.name === flatten(b.name) &&
    a.type === flatten(b.type) &&
    a.parameters === (b.kind === 'method' ? flatten(b.parameters) : '')
  );
}

// Member text for `m` in `form`, reusing `raw` parts where unchanged;
// falls back to a full re-encode if the reuse would read back wrong.
function memberText(m: ClassMemberInput, form: 'body' | 'line', raw?: RawMember): string {
  const style = form === 'body' && raw?.style === 'colon' ? 'colon' : 'typeFirst';
  const text = emitMember(m, style, raw);
  if (fitsForm(text, form) && sameMember(parseMemberText(text), m)) return text;
  return emitMember(m, 'typeFirst');
}

// What a member input reads back as (the model the edit produces).
export function memberFromInput(m: ClassMemberInput): ClassMember {
  return parseMemberText(emitMember(m))!;
}

// ── Class ids ────────────────────────────────────────────────────────

// Words mermaid's lexer reads as keywords at the start of a name.
const CLASS_KEYWORDS = new Set([
  'class', 'namespace', 'style', 'classDef', 'cssClass', 'callback', 'link', 'click', 'note', 'href',
  'call', 'o', 'direction', 'accTitle', 'accDescr', 'classDiagram', '_self', '_blank', '_parent', '_top',
]);

// How to write class `id` where a className is expected.
export function emitClassRef(id: string): string {
  if (/^\w+([.-]\w+)*$/.test(id) && !CLASS_KEYWORDS.has(id.split(/[.-]/)[0]) && !/^(call|note)\b/.test(id)) return id;
  return '`' + id.replace(/`/g, '') + '`';
}

// An id for a new class named `label`: its letters and digits, words
// capitalised and joined ("Customer order" → "CustomerOrder").
export function deriveClassId(label: string, taken: (id: string) => boolean): string {
  let base = flatten(label)
    .split(/[^A-Za-z0-9_]+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join('');
  if (!base) base = 'Class';
  if (/^[0-9]/.test(base)) base = 'C' + base;
  if (CLASS_KEYWORDS.has(base) || /^(note|interface)\d+$/.test(base)) base += 'Class';
  return taken(base) ? nextFreeId(taken, base) : base;
}


// ── The engine ───────────────────────────────────────────────────────

// Apply one visual edit to class diagram `source`. Returns null when
// the source doesn't parse, the edit names something that doesn't
// exist, or the result would be an empty diagram (mermaid rejects a
// class diagram without statements).
export function applyClassEdit(source: string, edit: ClassEdit): ClassEditResult | null {
  const parsed = parseClassSource(source);
  if (!parsed.ok) return null;
  const { model, map } = parsed;
  const sp = new Splicer(map.text);
  const extra: Pick<ClassEditResult, 'id' | 'index'> = {};
  const ok = run(model, map, sp, edit, extra);
  if (!ok) return null;
  if (ok === 'unchanged') return { source };
  const out = sp.apply();
  const src = splitLines(source);
  const result = joinLines(src, out.split('\n'));
  if (!hasStatements(result)) return null;
  return { source: result, ...extra };
}

function hasStatements(source: string): boolean {
  const r = parseClassSource(source);
  return r.ok;
}

// Last top-level statement (namespace blocks count as one), where new
// top-level lines go.
function lastTopLevel(map: ClassSourceMap): { at: number; indent: string } {
  const top = map.statements.filter((s) => s.namespace === null);
  const last = top[top.length - 1];
  if (!last) return { at: map.header.end, indent: DEFAULT_INDENT };
  return { at: last.span.end, indent: indentAtOff(map.text, last.span.start) };
}

function indentAtOff(text: string, off: number): string {
  const ls = text.lastIndexOf('\n', off - 1) + 1;
  return indentOf(text.slice(ls, off + 1));
}

function run(
  model: ClassModel,
  map: ClassSourceMap,
  sp: Splicer,
  edit: ClassEdit,
  extra: Pick<ClassEditResult, 'id' | 'index'>,
): boolean | 'unchanged' {
  const text = map.text;
  switch (edit.kind) {
    case 'setClassLabel': {
      const c = model.classes.get(edit.id);
      if (!c) return false;
      const label = flatten(edit.label);
      const decls = map.decls.get(edit.id) ?? [];
      const labeled = decls.filter((d) => d.label);
      if (label === '' || label === edit.id) {
        // Show the id: drop every `["…"]`.
        for (const d of labeled) sp.replace(d.labelBox!, '');
        return labeled.length ? true : 'unchanged';
      }
      const enc = encodeText(label);
      if (labeled.length) {
        // mermaid shows the last label set.
        sp.replace(labeled[labeled.length - 1].label!, enc);
      } else if (decls.length) {
        sp.insert(decls[0].head.end, `["${enc}"]`);
      } else {
        // Declared only implicitly: add a declaration right after the
        // statement that created it (so the class order stays).
        const stmt = map.statements[map.created.get(edit.id)!];
        sp.lineAfter(stmt.span.end, indentAtOff(text, stmt.span.start), `class ${emitClassRef(edit.id)}["${enc}"]`);
      }
      return true;
    }

    case 'addClass': {
      const label = flatten(edit.label);
      const taken = takenIds(model);
      const id = deriveClassId(label, (x) => taken.has(x));
      if (edit.relation && !model.classes.has(edit.relation.other)) return false;
      const decl = `class ${id}` + (label && label !== id ? `["${encodeText(label)}"]` : '');
      let where = lastTopLevel(map);
      if (edit.namespace !== undefined) {
        const nsIndex = map.namespaces.findIndex((n) => n.id === edit.namespace);
        if (nsIndex < 0) return false;
        const kids = map.statements.filter((s) => s.namespace === nsIndex);
        const last = kids[kids.length - 1];
        where = { at: last.span.end, indent: indentAtOff(text, last.span.start) };
        sp.lineAfter(where.at, where.indent, decl);
        where = lastTopLevel(map);
      } else {
        sp.lineAfter(where.at, where.indent, decl);
      }
      if (edit.relation) {
        const { other, type, newIs } = edit.relation;
        const [from, to] = newIs === 'from' ? [id, other] : [other, id];
        const mk = relationMarkers(type);
        sp.lineAfter(where.at, where.indent, `${emitClassRef(from)} ${emitClassArrow(mk.fromMarker, mk.line, mk.toMarker)} ${emitClassRef(to)}`);
        extra.index = model.relations.length;
      }
      extra.id = id;
      return true;
    }

    case 'deleteClass': {
      if (!model.classes.has(edit.id)) return false;
      deleteClass(model, map, sp, edit.id);
      return true;
    }

    case 'addMember': {
      const c = model.classes.get(edit.classId);
      if (!c) return false;
      const index = edit.index ?? c.members.length;
      if (index < 0 || index > c.members.length) return false;
      insertMember(map, sp, edit.classId, index, edit.member);
      extra.index = index;
      return true;
    }

    case 'setMember': {
      const c = model.classes.get(edit.classId);
      const src = map.members.get(edit.classId)?.[edit.index];
      if (!c || !src) return false;
      const raw = rawMember(text.slice(src.span.start, src.span.end), c.members[edit.index]);
      sp.replace(src.span, memberText(edit.member, src.form, raw));
      return true;
    }

    case 'removeMember': {
      const c = model.classes.get(edit.classId);
      const src = map.members.get(edit.classId)?.[edit.index];
      if (!c || !src) return false;
      removeMember(map, sp, edit.classId, edit.index);
      return true;
    }

    case 'moveMember': {
      const c = model.classes.get(edit.classId);
      const srcs = map.members.get(edit.classId);
      if (!c || !srcs?.[edit.from]) return false;
      const to = Math.max(0, Math.min(c.members.length - 1, edit.to));
      if (to === edit.from) return 'unchanged';
      const m = c.members[edit.from];
      const src = srcs[edit.from];
      const raw = rawMember(text.slice(src.span.start, src.span.end), m);
      removeMember(map, sp, edit.classId, edit.from);
      // Index among the members that remain.
      insertMember(map, sp, edit.classId, to, inputOf(m), raw, edit.from);
      return true;
    }

    case 'setAnnotation':
      return setAnnotation(model, map, sp, edit.classId, flatten(edit.annotation));

    case 'addRelation': {
      if (!model.classes.has(edit.from) || !model.classes.has(edit.to)) return false;
      const mk = relationMarkers(edit.type);
      const label = edit.label ? flatten(edit.label) : '';
      const where = lastTopLevel(map);
      sp.lineAfter(
        where.at,
        where.indent,
        `${emitClassRef(edit.from)} ${emitClassArrow(mk.fromMarker, mk.line, mk.toMarker)} ${emitClassRef(edit.to)}` +
          (label ? ` : ${encodeText(label)}` : ''),
      );
      extra.index = model.relations.length;
      return true;
    }

    case 'setRelationType':
    case 'flipRelation': {
      const rel = model.relations[edit.index];
      const src = map.relations[edit.index];
      if (!rel || !src) return false;
      // A lollipop end is an interface, not a class: changing the kind
      // would conjure up a class. Not offered.
      if (rel.fromMarker === 'lollipop' || rel.toMarker === 'lollipop') return false;
      const mk =
        edit.kind === 'flipRelation'
          ? { fromMarker: rel.toMarker, toMarker: rel.fromMarker, line: rel.line }
          : relationMarkers(edit.type, rel);
      const arrow = emitClassArrow(mk.fromMarker, mk.line, mk.toMarker);
      if (text.slice(src.arrow.start, src.arrow.end) === arrow) return 'unchanged';
      sp.replace(src.arrow, arrow);
      return true;
    }

    case 'setRelationCardinality': {
      const src = map.relations[edit.index];
      if (!src) return false;
      const card = (v: string) => {
        const t = flatten(v);
        // mermaid shows nothing for a cardinality spelled "none".
        return t === 'none' ? `"#110;one"` : `"${encodeText(t)}"`;
      };
      const from = flatten(edit.from);
      const to = flatten(edit.to);
      if (src.fromCardinality) {
        if (from) sp.replace(src.fromCardinality, card(from));
        else sp.replace({ start: src.fromCardinality.start, end: src.arrow.start }, '');
      } else if (from) {
        sp.insert(src.arrow.start, `${card(from)} `);
      }
      if (src.toCardinality) {
        if (to) sp.replace(src.toCardinality, card(to));
        else sp.replace({ start: src.arrow.end, end: src.toCardinality.end }, '');
      } else if (to) {
        sp.insert(src.arrow.end, ` ${card(to)}`);
      }
      return true;
    }

    case 'setRelationLabel': {
      const src = map.relations[edit.index];
      if (!src) return false;
      const label = flatten(edit.label);
      if (src.label) {
        if (label) sp.replace(src.label, `: ${encodeText(label)}`);
        else sp.replace({ start: src.to.end, end: src.label.end }, '');
      } else if (label) {
        sp.insert(src.to.end, ` : ${encodeText(label)}`);
      } else {
        return 'unchanged';
      }
      return true;
    }

    case 'deleteRelation': {
      const src = map.relations[edit.index];
      if (!src) return false;
      removeCreating(model, map, sp, src.stmt, new Set());
      return true;
    }

    case 'addNote': {
      if (edit.classId !== undefined && !model.classes.has(edit.classId)) return false;
      const where = lastTopLevel(map);
      const head = edit.classId !== undefined ? `note for ${emitClassRef(edit.classId)}` : 'note';
      sp.lineAfter(where.at, where.indent, `${head} "${noteText(edit.text)}"`);
      extra.index = model.notes.length;
      return true;
    }

    case 'setNoteText': {
      const src = map.notes[edit.index];
      if (!src) return false;
      sp.replace(src.text, noteText(edit.text));
      return true;
    }

    case 'deleteNote': {
      const src = map.notes[edit.index];
      if (!src) return false;
      removeStatements(map, sp, new Set([src.stmt]));
      return true;
    }

    case 'setDirection': {
      if (model.direction === edit.direction) return 'unchanged';
      const last = map.directions[map.directions.length - 1];
      if (last) sp.replace(last, edit.direction);
      else sp.lineAfter(map.header.end, firstIndent(map), `direction ${edit.direction}`);
      return true;
    }
  }
}

// An empty note can't be written (`note ""` is a syntax error): it is
// stored as one encoded space, which reads back as ''.
function noteText(text: string): string {
  return encodeText(text) || '#32;';
}

function firstIndent(map: ClassSourceMap): string {
  const s = map.statements[0];
  return s ? indentAtOff(map.text, s.span.start) : DEFAULT_INDENT;
}

function takenIds(model: ClassModel): Set<string> {
  const taken = new Set<string>(model.classes.keys());
  for (const r of model.relations) taken.add(r.from).add(r.to);
  for (const n of model.namespaces) taken.add(n.id);
  return taken;
}

function inputOf(m: ClassMember): ClassMemberInput {
  return { kind: m.kind, visibility: m.visibility, classifier: m.classifier, name: m.name, type: m.type, parameters: m.parameters };
}

// Remove member `index` of class `id`. In the `X : m` form the whole
// line goes — unless it is what created the class (then it becomes
// `class X`, so the class and the class order survive).
function removeMember(map: ClassSourceMap, sp: Splicer, id: string, index: number): void {
  const src = map.members.get(id)![index];
  if (src.form === 'body') {
    sp.remove(src.span);
    return;
  }
  const stmt = map.statements[src.stmt];
  if (map.created.get(id) === src.stmt) sp.replace(stmt.span, `class ${emitClassRef(id)}`);
  else sp.remove(stmt.span);
}

// Insert member `m` so it becomes member `index` (counted among the
// current members, excluding `skip` — a member being moved away).
function insertMember(
  map: ClassSourceMap,
  sp: Splicer,
  id: string,
  index: number,
  m: ClassMemberInput,
  raw?: RawMember,
  skip?: number,
): void {
  const text = map.text;
  const srcs = map.members.get(id)!.map((s, i) => ({ s, i })).filter((x) => x.i !== skip);
  const ref = emitClassRef(id);
  const before = srcs[index];
  if (before) {
    // Insert before that member, in its form.
    const { s } = before;
    const body = memberText(m, s.form, raw);
    if (s.form === 'body') {
      const ls = sp.lineStart(s.span.start);
      if (!text.slice(ls, s.span.start).trim()) sp.lineBefore(s.span.start, sp.indentAt(s.span.start), body);
      else sp.insert(s.span.start, `${body}\n${sp.indentAt(s.span.start)}${DEFAULT_INDENT}`);
    } else {
      const st = map.statements[s.stmt];
      sp.lineBefore(st.span.start, indentAtOff(text, st.span.start), `${ref} : ${memberText(m, 'line', raw)}`);
    }
    return;
  }
  const last = srcs[srcs.length - 1];
  if (last) {
    // After the last member, in its form.
    const { s } = last;
    if (s.form === 'body') {
      const after = text.slice(s.span.end, sp.lineEnd(s.span.end));
      const ls = sp.lineStart(s.span.start);
      const indent = text.slice(ls, s.span.start).trim() ? sp.indentAt(s.span.start) + DEFAULT_INDENT : sp.indentAt(s.span.start);
      if (!after.trim()) sp.lineAfter(s.span.end, indent, memberText(m, 'body', raw));
      else sp.insert(s.span.end, `\n${indent}${memberText(m, 'body', raw)}`);
    } else {
      const st = map.statements[s.stmt];
      sp.lineAfter(st.span.end, indentAtOff(text, st.span.start), `${ref} : ${memberText(m, 'line', raw)}`);
    }
    return;
  }
  insertIntoBody(map, sp, id, memberText(m, 'body', raw), () => {
    // No declaration at all: an `X : member` line after the statement
    // that created the class.
    const st = map.statements[map.created.get(id)!];
    sp.lineAfter(st.span.end, indentAtOff(text, st.span.start), `${ref} : ${memberText(m, 'line', raw)}`);
  });
}

// Put body line `line` first into class `id`'s body — the first
// declaration with a body, else the first declaration gets one; calls
// `none` when the class has no declaration.
function insertIntoBody(map: ClassSourceMap, sp: Splicer, id: string, line: string, none: () => void): void {
  const text = map.text;
  const decls = map.decls.get(id) ?? [];
  const withBody = decls.find((d) => d.body);
  if (withBody) {
    const { open, close } = withBody.body!;
    const declIndent = indentAtOff(text, withBody.head.start);
    const indent = declIndent + DEFAULT_INDENT;
    const rest = text.slice(open + 1, sp.lineEnd(open + 1));
    if (sp.lineOf(open) === sp.lineOf(close)) {
      // `class X {}` / `class X { … }` on one line.
      sp.insert(open + 1, `\n${indent}${line}\n${declIndent}`);
    } else if (!rest.trim()) {
      sp.lineAfter(open, indent, line);
    } else {
      sp.insert(open + 1, `\n${indent}${line}\n${indent}`);
    }
    return;
  }
  const decl = decls[0];
  if (decl) {
    const st = map.statements[decl.stmt];
    const declIndent = indentAtOff(text, st.span.start);
    sp.insert(st.span.end, ` {\n${declIndent}${DEFAULT_INDENT}${line}\n${declIndent}}`);
    return;
  }
  none();
}

function setAnnotation(model: ClassModel, map: ClassSourceMap, sp: Splicer, id: string, annotation: string): boolean | 'unchanged' {
  const c = model.classes.get(id);
  if (!c) return false;
  const srcs = map.annotations.get(id) ?? [];
  const removeAnn = (a: (typeof srcs)[number]) => {
    if (a.form === 'body') sp.remove(a.span);
    else if (a.form === 'inline') sp.replace({ start: a.span.start - (/\s$/.test(map.text.slice(0, a.span.start)) ? 1 : 0), end: a.span.end }, '');
    else sp.remove(map.statements[a.stmt].span);
  };
  if (!annotation) {
    if (!srcs.length) return 'unchanged';
    srcs.forEach(removeAnn);
    return true;
  }
  const word = /^\w+$/.test(annotation);
  const bodyText = `<<${breakDirection(encodeChars(annotation, /[{}]/))}>>`;
  const first = srcs[0];
  if (first && (first.form === 'body' || word)) {
    sp.replace(first.inner, first.form === 'body' ? bodyText.slice(2, -2) : annotation);
    return true;
  }
  if (first) removeAnn(first);
  const decls = map.decls.get(id) ?? [];
  if (word && !first && !decls.some((d) => d.body)) {
    // `class X <<word>>` on a plain declaration (one with `:::style`
    // can't take one), else `<<word>> X` after the statement that
    // created the class (never inside a namespace: always top level).
    const plain = decls.find((d) => map.statements[d.stmt].span.end === (d.labelBox ?? d.head).end);
    if (plain) {
      sp.insert(map.statements[plain.stmt].span.end, ` <<${annotation}>>`);
      return true;
    }
    if (!decls.length) {
      const st = map.statements[map.created.get(id)!];
      sp.lineAfter(st.span.end, indentAtOff(map.text, st.span.start), `<<${annotation}>> ${emitClassRef(id)}`);
      return true;
    }
  }
  insertIntoBody(map, sp, id, bodyText, () => {
    const st = map.statements[map.created.get(id)!];
    sp.lineAfter(st.span.end, indentAtOff(map.text, st.span.start), `class ${emitClassRef(id)} {`);
    sp.lineAfter(st.span.end, indentAtOff(map.text, st.span.start) + DEFAULT_INDENT, bodyText);
    sp.lineAfter(st.span.end, indentAtOff(map.text, st.span.start), '}');
  });
  return true;
}

// Remove statement `stmt` (a relation or an `X : m` line). Classes it
// created that must survive (not in `dying`) get a `class X` line in
// its place, so they — and the class order — stay.
function removeCreating(model: ClassModel, map: ClassSourceMap, sp: Splicer, stmt: number, dying: Set<string>): void {
  const st = map.statements[stmt];
  const keep = [...model.classes.keys()].filter((id) => map.created.get(id) === stmt && !dying.has(id));
  if (!keep.length) {
    removeStatements(map, sp, new Set([stmt]));
    return;
  }
  const indent = indentAtOff(map.text, st.span.start);
  sp.replace(st.span, keep.map((id) => `class ${emitClassRef(id)}`).join(`\n${indent}`));
}

// Remove statements; a namespace left with no statements goes too.
function removeStatements(map: ClassSourceMap, sp: Splicer, drop: Set<number>): void {
  map.namespaces.forEach((ns, i) => {
    const kids = map.statements.map((s, k) => ({ s, k })).filter((x) => x.s.namespace === i);
    if (kids.length && kids.every((x) => drop.has(x.k))) drop.add(ns.stmt);
  });
  for (const k of drop) {
    const s = map.statements[k];
    if (s.namespace !== null && drop.has(map.namespaces[s.namespace].stmt)) continue;
    sp.remove(s.span);
  }
}

function deleteClass(model: ClassModel, map: ClassSourceMap, sp: Splicer, id: string): void {
  const drop = new Set<number>();
  const dying = new Set([id]);
  map.statements.forEach((s, k) => {
    switch (s.kind) {
      case 'class':
      case 'member':
      case 'annotation':
      case 'note':
      case 'style':
      case 'click':
        if (s.refs.includes(id)) drop.add(k);
        break;
      case 'cssClass': {
        if (!s.refs.includes(id)) break;
        const rest = s.refs.filter((r) => r !== id);
        if (!rest.length) {
          drop.add(k);
          break;
        }
        // Rewrite just the id list inside the quotes.
        const raw = map.text.slice(s.span.start, s.span.end);
        const q1 = raw.indexOf('"');
        const q2 = raw.indexOf('"', q1 + 1);
        sp.replace({ start: s.span.start + q1 + 1, end: s.span.start + q2 }, rest.join(','));
        break;
      }
      default:
        break;
    }
  });
  map.relations.forEach((r, i) => {
    const rel = model.relations[i];
    if (rel.from === id || rel.to === id) {
      // Ends it created that live on get a `class X` line instead.
      const keep = [...model.classes.keys()].filter((c) => c !== id && map.created.get(c) === r.stmt);
      if (keep.length) removeCreating(model, map, sp, r.stmt, dying);
      else drop.add(r.stmt);
    }
  });
  removeStatements(map, sp, drop);
}
