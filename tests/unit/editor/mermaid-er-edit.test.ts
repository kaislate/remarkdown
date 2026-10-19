// Source-preserving visual edits on ER diagrams. Same invariant as the
// flowchart / class engines: untouched lines byte-identical, the result
// parses to exactly the intended model, mermaid accepts it.
import { describe, it, expect } from 'vitest';
import mermaid from 'mermaid';
import {
  applyErEdit,
  attributeFromInput,
  sanitizeErWord,
  erWordDisplay,
  type ErAttributeInput,
  type ErCardinalityInput,
  type ErEdit,
} from '../../../src/lib/editor/mermaid/er-edit';
import { parseEr, parseErSource, type ErModel, type ErSourceMap } from '../../../src/lib/editor/mermaid/er-parser';
import { moveItem } from '../../../src/lib/editor/mermaid/source-text';
import { corpusBlocks, mermaidAccepts, removedLines, FUZZ_INPUTS } from './mermaid-test-utils';

function edit(src: string, e: ErEdit): string {
  const r = applyErEdit(src, e);
  if (!r) throw new Error('edit refused');
  return r.source;
}

function model(src: string): ErModel {
  const r = parseEr(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

const attr = (type: string, name: string, keys: ErAttributeInput['keys'] = [], comment = ''): ErAttributeInput => ({ type, name, keys, comment });

describe('ER edits: targeted examples', () => {
  const SRC = [
    '---',
    'title: Shop',
    '---',
    'erDiagram',
    '    %% customers',
    '    CUSTOMER ||--o{ ORDER : places',
    '    CUSTOMER {',
    '        string name "full name"',
    '        string email PK',
    '    }',
    '',
  ].join('\n');

  it('renames through the alias, never the id', () => {
    expect(edit(SRC, { kind: 'setEntityLabel', id: 'CUSTOMER', label: 'Customer' })).toBe(SRC.replace('    CUSTOMER {', '    CUSTOMER["Customer"] {'));
    expect(edit(SRC, { kind: 'setEntityLabel', id: 'ORDER', label: 'Order "x"' })).toBe(
      SRC.replace('places\n', 'places\n    ORDER["Order #quot;x#quot;"]\n'),
    );
    const aliased = 'erDiagram\n  A["One"]\n  A["Two"]\n';
    expect(edit(aliased, { kind: 'setEntityLabel', id: 'A', label: 'New' })).toBe('erDiagram\n  A["New"]\n  A["Two"]\n');
    expect(edit(aliased, { kind: 'setEntityLabel', id: 'A', label: '' })).toBe('erDiagram\n  A\n  A\n');
  });

  it('keeps CRLF line endings', () => {
    expect(edit('erDiagram\r\n  A ||--|| B : r\r\n', { kind: 'setRelationshipLabel', index: 0, label: 'owns' })).toBe('erDiagram\r\n  A ||--|| B : owns\r\n');
  });

  it('adds entities with a derived id and an optional relationship', () => {
    const r = applyErEdit(SRC, { kind: 'addEntity', label: 'Line item', relation: { other: 'ORDER', newIs: 'to', toCardinality: 'one-or-more' } })!;
    expect(r.id).toBe('Line_item');
    expect(r.source).toBe(SRC.replace('    }\n', '    }\n    Line_item["Line item"]\n    ORDER ||--|{ Line_item : ""\n'));
    expect(applyErEdit(SRC, { kind: 'addEntity', label: 'ORDER' })!.id).toBe('ORDER1');
    expect(edit('erDiagram\n', { kind: 'addEntity', label: 'X' })).toBe('erDiagram\n    X\n');
  });

  it('deleting an entity takes its statements and keeps entities only its relationships created', () => {
    expect(edit(SRC, { kind: 'deleteEntity', id: 'CUSTOMER' })).toBe(['---', 'title: Shop', '---', 'erDiagram', '    %% customers', '    ORDER', ''].join('\n'));
    const styled = 'erDiagram\n  A ||--|| B : r\n  class A,B hot\n  style A fill:#f00\n  B:::hot\n';
    expect(edit(styled, { kind: 'deleteEntity', id: 'A' })).toBe('erDiagram\n  B\n  class B hot\n  B:::hot\n');
  });

  it('attribute rows: add, edit (only the changed parts), remove, move', () => {
    expect(edit(SRC, { kind: 'addAttribute', entityId: 'CUSTOMER', attribute: attr('int', 'age') })).toBe(
      SRC.replace('        string email PK\n', '        string email PK\n        int age\n'),
    );
    expect(edit(SRC, { kind: 'addAttribute', entityId: 'CUSTOMER', attribute: attr('List<string>', 'tags', ['UK'], 'many'), index: 0 })).toBe(
      SRC.replace('        string name', '        List~string~ tags UK "many"\n        string name'),
    );
    expect(edit(SRC, { kind: 'setAttribute', entityId: 'CUSTOMER', index: 1, attribute: attr('string', 'email', ['PK', 'FK']) })).toBe(
      SRC.replace('string email PK', 'string email PK, FK'),
    );
    expect(edit(SRC, { kind: 'setAttribute', entityId: 'CUSTOMER', index: 0, attribute: attr('string', 'full name', [], 'full name') })).toBe(
      SRC.replace('string name "full name"', 'string full_name "full name"'),
    );
    expect(edit(SRC, { kind: 'removeAttribute', entityId: 'CUSTOMER', index: 0 })).toBe(SRC.replace('        string name "full name"\n', ''));
    expect(edit(SRC, { kind: 'moveAttribute', entityId: 'CUSTOMER', from: 1, to: 0 })).toBe(
      SRC.replace('        string name "full name"\n        string email PK\n', '        string email PK\n        string name "full name"\n'),
    );
    // No block yet: one is opened.
    expect(edit(SRC, { kind: 'addAttribute', entityId: 'ORDER', attribute: attr('int', 'id', ['PK']) })).toBe(
      SRC.replace('    }\n', '    }\n    ORDER {\n        int id PK\n    }\n'),
    );
    expect(edit('erDiagram\n  A["x"]\n', { kind: 'addAttribute', entityId: 'A', attribute: attr('int', 'n') })).toBe('erDiagram\n  A["x"] {\n      int n\n  }\n');
    expect(edit('erDiagram\n  A {}\n', { kind: 'addAttribute', entityId: 'A', attribute: attr('int', 'n') })).toBe('erDiagram\n  A {\n      int n\n  }\n');
  });

  it('sanitises attribute words to what mermaid can hold', () => {
    expect(sanitizeErWord('unsigned int')).toBe('unsigned_int');
    expect(sanitizeErWord('Map<K, V>', { generic: true })).toBe('Map~K, V~');
    expect(sanitizeErWord('Map<K, V>')).toBe('Map_K__V_');
    expect(sanitizeErWord('2nd')).toBe('_2nd');
    expect(sanitizeErWord('PK-ref')).toBe('_PK-ref');
    expect(sanitizeErWord('varchar(255)')).toBe('varchar(255)');
    expect(sanitizeErWord('')).toBe('_');
    expect(attributeFromInput(attr('Map<K, V>', 'x y'))).toEqual({ type: 'Map<K, V>', name: 'x_y', keys: [], comment: '' });
  });

  it('relationship edits touch one token, keeping how it is written', () => {
    const src = 'erDiagram\n  A ||--o{ B : places\n  C one or more optionally to zero or one D : "has many"\n';
    expect(edit(src, { kind: 'setRelationshipCardinality', index: 0, from: 'zero-or-one' })).toBe(src.replace('||--o{', '|o--o{'));
    expect(edit(src, { kind: 'setRelationshipCardinality', index: 0, to: 'one-or-more' })).toBe(src.replace('||--o{', '||--|{'));
    expect(edit(src, { kind: 'setRelationshipCardinality', index: 1, from: 'exactly-one', to: 'zero-or-more' })).toBe(
      src.replace('one or more optionally to zero or one', 'only one optionally to zero or more'),
    );
    expect(edit(src, { kind: 'setRelationshipIdentifying', index: 0, identifying: false })).toBe(src.replace('||--o{', '||..o{'));
    expect(edit(src, { kind: 'setRelationshipIdentifying', index: 1, identifying: true })).toBe(src.replace('optionally to', 'to'));
    expect(edit(src, { kind: 'setRelationshipLabel', index: 0, label: 'buys' })).toBe(src.replace(': places', ': buys'));
    expect(edit(src, { kind: 'setRelationshipLabel', index: 0, label: 'buys a lot' })).toBe(src.replace(': places', ': "buys a lot"'));
    expect(edit(src, { kind: 'setRelationshipLabel', index: 1, label: '' })).toBe(src.replace('"has many"', '""'));
    expect(edit(src, { kind: 'deleteRelationship', index: 0 })).toBe('erDiagram\n  A\n  B\n  C one or more optionally to zero or one D : "has many"\n');
  });

  it('adds relationships with cardinalities', async () => {
    const cards: ErCardinalityInput[] = ['zero-or-one', 'exactly-one', 'zero-or-more', 'one-or-more'];
    for (const from of cards) {
      for (const to of cards) {
        const out = edit('erDiagram\n  A\n  B\n', { kind: 'addRelationship', from: 'A', to: 'B', fromCardinality: from, toCardinality: to, identifying: false, label: 'r' });
        expect(model(out).relationships[0]).toEqual({ from: 'A', to: 'B', fromCardinality: from, toCardinality: to, identifying: false, label: 'r' });
        expect(await mermaidAccepts(out)).toBe(true);
      }
    }
  });

  it('direction', () => {
    expect(edit('erDiagram\n  A\n', { kind: 'setDirection', direction: 'LR' })).toBe('erDiagram\n  direction LR\n  A\n');
    expect(edit('erDiagram\n  direction RL\n  A\n', { kind: 'setDirection', direction: 'TB' })).toBe('erDiagram\n  direction TB\n  A\n');
  });

  it('refuses edits naming things that do not exist', () => {
    expect(applyErEdit(SRC, { kind: 'setEntityLabel', id: 'NOPE', label: 'x' })).toBeNull();
    expect(applyErEdit(SRC, { kind: 'removeAttribute', entityId: 'CUSTOMER', index: 5 })).toBeNull();
    expect(applyErEdit(SRC, { kind: 'addRelationship', from: 'CUSTOMER', to: 'NOPE' })).toBeNull();
  });
});

// ── User text fuzz ───────────────────────────────────────────────────

(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(SVGElement.prototype as unknown as Record<string, unknown>).getComputedTextLength = () => 10;

let renders = 0;
async function rendered(src: string): Promise<Document> {
  const { svg } = await mermaid.render(`efz${renders++}`, src);
  return new DOMParser().parseFromString(svg, 'text/html');
}
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('ER edits: user text fuzz (mermaid accepts it and shows it as typed, or as documented)', () => {
  const BASE = 'erDiagram\n  A ||--o{ B : r\n  A {\n    int id\n  }\n';

  it('entity aliases and relationship labels', async () => {
    for (const t of FUZZ_INPUTS) {
      let out = edit(BASE, { kind: 'setEntityLabel', id: 'A', label: t });
      out = edit(out, { kind: 'setRelationshipLabel', index: 0, label: t });
      expect.soft(await mermaidAccepts(out), `${JSON.stringify(t)}:\n${out}`).toBe(true);
      const m = model(out);
      expect.soft(m.entities.get('A')!.label, JSON.stringify(t)).toBe(t.trim() || 'A');
      expect.soft(m.relationships[0].label, JSON.stringify(t)).toBe(t.trim());
      const d = await rendered(out);
      const node = [...d.querySelectorAll('g.node')].find((g) => /entity-A-/.test(g.id))!;
      expect.soft(squash(node.querySelector('.label.name, .label')?.textContent), `shown alias ${JSON.stringify(t)}:\n${out}`).toBe(squash(t) || 'A');
      const label = [...d.querySelectorAll('.edgeLabel')].map((e) => squash(e.textContent)).find(Boolean) ?? '';
      expect.soft(label, `shown label ${JSON.stringify(t)}:\n${out}`).toBe(squash(t));
    }
  }, 60_000);

  it('attribute type, name (sanitised) and comment (as typed)', async () => {
    for (const t of FUZZ_INPUTS) {
      const out = edit(BASE, { kind: 'addAttribute', entityId: 'A', attribute: attr(t, t, ['PK'], t) });
      expect.soft(await mermaidAccepts(out), `${JSON.stringify(t)}:\n${out}`).toBe(true);
      const back = model(out).entities.get('A')!.attributes[1];
      const want = { type: erWordDisplay(sanitizeErWord(t, { generic: true })), name: sanitizeErWord(t), keys: ['PK'], comment: t.trim() };
      expect.soft(back, JSON.stringify(t)).toEqual(want);
      const d = await rendered(out);
      const cells = (cls: string) => [...d.querySelectorAll(`.attribute-${cls}`)].map((e) => squash(e.textContent));
      expect.soft(cells('type')[1], `shown type ${JSON.stringify(t)}`).toBe(squash(back.type));
      expect.soft(cells('name')[1], `shown name ${JSON.stringify(t)}`).toBe(sanitizeErWord(t));
      expect.soft(cells('comment')[1], `shown comment ${JSON.stringify(t)}:\n${out}`).toBe(squash(t));
    }
  }, 60_000);
});

// ── Property test over the corpus ────────────────────────────────────

const FILES = ['mermaid-corpus.md', 'mermaid-corpus-class-er.md'];
const blocks = corpusBlocks((b) => /erDiagram/.test(b.source) && parseEr(b.source).ok, FILES);
const TRICKY = 'Renamed "q" [x] #59; `b` ; | end: <i> direction LR';

interface Op {
  name: string;
  edit: ErEdit;
  expected: (m: ErModel) => void;
  touches: Set<number>;
}

function lineSet(map: ErSourceMap, spans: Array<{ start: number; end: number }>): Set<number> {
  const out = new Set<number>();
  const lineOf = (off: number) => map.text.slice(0, off).split('\n').length - 1;
  for (const s of spans) for (let l = lineOf(s.start); l <= lineOf(s.end); l++) out.add(l);
  return out;
}

function opsFor(m: ErModel, map: ErSourceMap): Op[] {
  const ops: Op[] = [];
  const none = new Set<number>();
  const ids = [...m.entities.keys()];
  for (const [id, e] of m.entities) {
    // Lines of the entity's own statements, plus the one creating it.
    const mine = lineSet(map, [
      ...map.statements.filter((s) => s.refs.includes(id) && s.kind === 'entity').map((s) => s.span),
      map.statements[map.created.get(id)!].span,
    ]);
    ops.push({ name: `label ${id}`, edit: { kind: 'setEntityLabel', id, label: TRICKY }, expected: (x) => void Object.assign(x.entities.get(id)!, aliasOf(x, id, TRICKY)), touches: mine });
    ops.push({ name: `unlabel ${id}`, edit: { kind: 'setEntityLabel', id, label: '' }, expected: (x) => void Object.assign(x.entities.get(id)!, { alias: '', label: id }), touches: mine });
    const a = attr('List<int>', TRICKY, ['PK', 'FK'], TRICKY);
    ops.push({ name: `add attr ${id}`, edit: { kind: 'addAttribute', entityId: id, attribute: a }, expected: (x) => void x.entities.get(id)!.attributes.push(attributeFromInput(a)), touches: mine });
    ops.push({ name: `add attr ${id} @0`, edit: { kind: 'addAttribute', entityId: id, attribute: a, index: 0 }, expected: (x) => void x.entities.get(id)!.attributes.unshift(attributeFromInput(a)), touches: mine });
    e.attributes.forEach((at, i) => {
      const keys: ErAttributeInput['keys'] = at.keys.includes('UK') ? [] : ['UK'];
      const changed = attr(at.type, at.name, keys, at.comment);
      ops.push({ name: `keys ${id}.${i}`, edit: { kind: 'setAttribute', entityId: id, index: i, attribute: changed }, expected: (x) => void (x.entities.get(id)!.attributes[i] = { ...at, keys }), touches: mine });
      const renamed = attr(TRICKY, TRICKY, at.keys, TRICKY);
      ops.push({ name: `rename attr ${id}.${i}`, edit: { kind: 'setAttribute', entityId: id, index: i, attribute: renamed }, expected: (x) => void (x.entities.get(id)!.attributes[i] = attributeFromInput(renamed)), touches: mine });
      ops.push({ name: `remove attr ${id}.${i}`, edit: { kind: 'removeAttribute', entityId: id, index: i }, expected: (x) => void x.entities.get(id)!.attributes.splice(i, 1), touches: mine });
    });
    if (e.attributes.length >= 2) {
      const n = e.attributes.length;
      ops.push({ name: `move attr ${id}`, edit: { kind: 'moveAttribute', entityId: id, from: n - 1, to: 0 }, expected: (x) => void (x.entities.get(id)!.attributes = moveItem(x.entities.get(id)!.attributes, n - 1, 0)), touches: mine });
    }
    const del = lineSet(map, map.statements.filter((s) => s.refs.includes(id)).map((s) => s.span));
    ops.push({
      name: `delete ${id}`,
      edit: { kind: 'deleteEntity', id },
      expected: (x) => {
        x.entities.delete(id);
        x.relationships = x.relationships.filter((r) => r.from !== id && r.to !== id);
      },
      touches: del,
    });
  }
  ops.push({
    name: 'add entity',
    edit: { kind: 'addEntity', label: TRICKY },
    expected: (x) => void x.entities.set('Renamed_q_x_59_b_end_i_direction_LR', { id: 'Renamed_q_x_59_b_end_i_direction_LR', alias: TRICKY, label: TRICKY, attributes: [] }),
    touches: none,
  });
  m.relationships.forEach((rel, i) => {
    const line = lineSet(map, [map.statements[map.relationships[i].stmt].span]);
    const flipCard = (c: string): ErCardinalityInput => (c === 'one-or-more' ? 'zero-or-one' : 'one-or-more');
    ops.push({
      name: `rel ${i} cards`,
      edit: { kind: 'setRelationshipCardinality', index: i, from: flipCard(rel.fromCardinality), to: flipCard(rel.toCardinality) },
      expected: (x) => void Object.assign(x.relationships[i], { fromCardinality: flipCard(rel.fromCardinality), toCardinality: flipCard(rel.toCardinality) }),
      touches: line,
    });
    ops.push({ name: `rel ${i} identifying`, edit: { kind: 'setRelationshipIdentifying', index: i, identifying: !rel.identifying }, expected: (x) => void (x.relationships[i].identifying = !rel.identifying), touches: line });
    ops.push({ name: `rel ${i} label`, edit: { kind: 'setRelationshipLabel', index: i, label: TRICKY }, expected: (x) => void (x.relationships[i].label = TRICKY), touches: line });
    ops.push({ name: `rel ${i} delete`, edit: { kind: 'deleteRelationship', index: i }, expected: (x) => void x.relationships.splice(i, 1), touches: line });
  });
  if (ids.length) {
    ops.push({
      name: 'add relationship',
      edit: { kind: 'addRelationship', from: ids[ids.length - 1], to: ids[0], fromCardinality: 'zero-or-one', toCardinality: 'one-or-more', identifying: false, label: TRICKY },
      expected: (x) =>
        void x.relationships.push({ from: ids[ids.length - 1], to: ids[0], fromCardinality: 'zero-or-one', toCardinality: 'one-or-more', identifying: false, label: TRICKY }),
      touches: none,
    });
  }
  const dir = m.direction === 'LR' ? 'BT' : 'LR';
  ops.push({ name: `direction ${dir}`, edit: { kind: 'setDirection', direction: dir }, expected: (x) => void (x.direction = dir), touches: lineSet(map, map.directions) });
  return ops;
}

function aliasOf(_x: ErModel, _id: string, label: string) {
  return { alias: label, label };
}

function shape(m: ErModel) {
  return { ...m, entities: [...m.entities.values()] };
}

describe('ER edits: corpus property', () => {
  it('finds ER diagrams in the corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(10);
  });

  for (const block of blocks) {
    it(`${block.heading}: every visual edit is exact, minimal and valid`, async () => {
      const parsed = parseErSource(block.source);
      if (!parsed.ok) throw new Error(parsed.reason);
      const lines = block.source.split('\n');
      for (const op of opsFor(parsed.model, parsed.map)) {
        const res = applyErEdit(block.source, op.edit);
        expect(res, op.name).not.toBeNull();
        const out = res!.source;
        const back = parseEr(out);
        expect(back.ok, `${op.name}: own output unparseable:\n${out}`).toBe(true);
        if (!back.ok) continue;
        const want = structuredClone(parsed.model);
        op.expected(want);
        expect(shape(back.model), `${op.name}:\n${out}`).toEqual(shape(want));
        const allowed = new Set([...op.touches].map((l) => lines[l]));
        for (const line of removedLines(block.source, out)) {
          expect(allowed.has(line), `${op.name} changed an unrelated line ${JSON.stringify(line)}:\n${out}`).toBe(true);
        }
        expect(await mermaidAccepts(out), `${op.name}:\n${out}`).toBe(true);
      }
    }, 120_000);
  }
});
