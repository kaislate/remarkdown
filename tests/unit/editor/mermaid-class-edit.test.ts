// Source-preserving visual edits on class diagrams. The invariant:
// after a visual edit, every source line the edit did not semantically
// touch is byte-identical; parsing the result gives exactly the
// intended model change; mermaid accepts the result.
import { describe, it, expect } from 'vitest';
import {
  applyClassEdit,
  memberFromInput,
  relationMarkers,
  classRelationType,
  type ClassEdit,
  type ClassMemberInput,
  type ClassRelationType,
} from '../../../src/lib/editor/mermaid/class-edit';
import { parseClass, parseClassSource, type ClassModel, type ClassSourceMap } from '../../../src/lib/editor/mermaid/class-parser';
import { moveItem } from '../../../src/lib/editor/mermaid/source-text';
import mermaid from 'mermaid';
import { corpusBlocks, mermaidAccepts, removedLines, FUZZ_INPUTS } from './mermaid-test-utils';

function edit(src: string, e: ClassEdit): string {
  const r = applyClassEdit(src, e);
  if (!r) throw new Error('edit refused');
  return r.source;
}

function model(src: string): ClassModel {
  const r = parseClass(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

const field = (name: string, type = '', visibility: ClassMemberInput['visibility'] = 'public'): ClassMemberInput => ({
  kind: 'field', visibility, classifier: 'none', name, type, parameters: '',
});
const method = (name: string, parameters = '', type = ''): ClassMemberInput => ({
  kind: 'method', visibility: 'public', classifier: 'none', name, type, parameters,
});

describe('class edits: targeted examples', () => {
  const SRC = [
    '%%{init: {"theme": "forest"}}%%',
    'classDiagram',
    '    %% a comment',
    '    class Animal {',
    '        +String name',
    '        +makeSound() void',
    '    }',
    '    Animal <|-- Dog',
    '    Dog : +fetch() void',
    '',
  ].join('\n');

  it('labels a declared class in place, an implicit one with a new line after its first statement', () => {
    expect(edit(SRC, { kind: 'setClassLabel', id: 'Animal', label: 'Any animal' })).toBe(
      SRC.replace('class Animal {', 'class Animal["Any animal"] {'),
    );
    expect(edit(SRC, { kind: 'setClassLabel', id: 'Dog', label: 'Good dog' })).toBe(
      SRC.replace('    Animal <|-- Dog\n', '    Animal <|-- Dog\n    class Dog["Good dog"]\n'),
    );
    const labeled = 'classDiagram\n  class A["Old"]\n  class A["Shown"]\n';
    expect(edit(labeled, { kind: 'setClassLabel', id: 'A', label: 'New' })).toBe('classDiagram\n  class A["Old"]\n  class A["New"]\n');
    expect(edit(labeled, { kind: 'setClassLabel', id: 'A', label: '' })).toBe('classDiagram\n  class A\n  class A\n');
  });

  it('keeps CRLF line endings', () => {
    const src = 'classDiagram\r\n    class A\r\n    %% c\r\n';
    expect(edit(src, { kind: 'setClassLabel', id: 'A', label: 'Ay' })).toBe('classDiagram\r\n    class A["Ay"]\r\n    %% c\r\n');
  });

  it('writes label text so mermaid shows it as typed', () => {
    const out = edit('classDiagram\n  class A\n', { kind: 'setClassLabel', id: 'A', label: 'a "q" #59; <b> *x* _y_ snake_case' });
    expect(out).toBe('classDiagram\n  class A["a #quot;q#quot; #35;59#59; #lt;b#gt; #42;x#42; #95;y#95; snake_case"]\n');
    expect(model(out).classes.get('A')!.label).toBe('a "q" #59; <b> *x* _y_ snake_case');
  });

  it('adds a class with a derived id, a label when they differ, and an optional relation', () => {
    const r = applyClassEdit(SRC, { kind: 'addClass', label: 'Pet owner', relation: { other: 'Dog', type: 'association', newIs: 'from' } })!;
    expect(r.id).toBe('PetOwner');
    expect(r.source).toBe(SRC.replace('    Dog : +fetch() void\n', '    Dog : +fetch() void\n    class PetOwner["Pet owner"]\n    PetOwner --> Dog\n'));
    const same = applyClassEdit(SRC, { kind: 'addClass', label: 'Animal' })!;
    expect(same.id).toBe('Animal1');
  });

  it('adds a class inside a namespace', () => {
    const src = 'classDiagram\n    namespace Shapes {\n        class Square\n    }\n    class Canvas\n';
    const r = applyClassEdit(src, { kind: 'addClass', label: 'Circle', namespace: 'Shapes' })!;
    expect(r.source).toBe('classDiagram\n    namespace Shapes {\n        class Square\n        class Circle\n    }\n    class Canvas\n');
    expect(model(r.source).classes.get('Circle')!.namespace).toBe('Shapes');
  });

  it('deleting a class takes its lines with it and keeps classes only it created', () => {
    expect(edit(SRC, { kind: 'deleteClass', id: 'Animal' })).toBe(
      ['%%{init: {"theme": "forest"}}%%', 'classDiagram', '    %% a comment', '    class Dog', '    Dog : +fetch() void', ''].join('\n'),
    );
    expect(edit(SRC, { kind: 'deleteClass', id: 'Dog' })).toBe(
      ['%%{init: {"theme": "forest"}}%%', 'classDiagram', '    %% a comment', '    class Animal {', '        +String name', '        +makeSound() void', '    }', ''].join('\n'),
    );
  });

  it('deleting a class cascades into namespaces, notes and styling', () => {
    const src = [
      'classDiagram',
      '    namespace N {',
      '        class A',
      '    }',
      '    class B',
      '    note for A "about A"',
      '    cssClass "A,B" hot',
      '    style A fill:#f00',
      '    click A href "https://x.test"',
      '    <<interface>> A',
      '',
    ].join('\n');
    expect(edit(src, { kind: 'deleteClass', id: 'A' })).toBe('classDiagram\n    class B\n    cssClass "B" hot\n');
  });

  it('refuses to empty the diagram', () => {
    expect(applyClassEdit('classDiagram\n  class A\n', { kind: 'deleteClass', id: 'A' })).toBeNull();
  });

  it('adds members in the form the class already uses', () => {
    expect(edit(SRC, { kind: 'addMember', classId: 'Animal', member: field('age', 'int') })).toBe(
      SRC.replace('        +makeSound() void\n', '        +makeSound() void\n        +int age\n'),
    );
    expect(edit(SRC, { kind: 'addMember', classId: 'Animal', member: method('eat', 'Food f'), index: 0 })).toBe(
      SRC.replace('        +String name\n', '        +eat(Food f)\n        +String name\n'),
    );
    expect(edit(SRC, { kind: 'addMember', classId: 'Dog', member: field('tricks', 'List<Trick>') })).toBe(
      SRC.replace('    Dog : +fetch() void\n', '    Dog : +fetch() void\n    Dog : +List~Trick~ tricks\n'),
    );
    // A declaration without a body gets one; a one-line body is opened.
    expect(edit('classDiagram\n  class A["x"]\n', { kind: 'addMember', classId: 'A', member: field('n') })).toBe(
      'classDiagram\n  class A["x"] {\n      +n\n  }\n',
    );
    expect(edit('classDiagram\n  class A {}\n', { kind: 'addMember', classId: 'A', member: field('n') })).toBe(
      'classDiagram\n  class A {\n      +n\n  }\n',
    );
    expect(edit('classDiagram\n  class A { +a }\n', { kind: 'addMember', classId: 'A', member: field('b') })).toBe(
      'classDiagram\n  class A { +a\n      +b }\n',
    );
  });

  it('edits only the parts of a member that changed', () => {
    const src = 'classDiagram\n  class A {\n    -List~int~  ids$\n    +run(int  a) void\n    total: int\n  }\n';
    expect(edit(src, { kind: 'setMember', classId: 'A', index: 0, member: { ...field('ids', 'List<int>', 'public'), classifier: 'static' } })).toBe(
      src.replace('-List~int~  ids$', '+List~int~ ids$'),
    );
    expect(edit(src, { kind: 'setMember', classId: 'A', index: 1, member: { ...method('run', 'int  a', 'bool') } })).toBe(
      src.replace('+run(int  a) void', '+run(int  a) bool'),
    );
    // `name: Type` fields keep that style.
    expect(edit(src, { kind: 'setMember', classId: 'A', index: 2, member: field('sum', 'long', 'none') })).toBe(src.replace('total: int', 'sum: long'));
  });

  it('removes and moves members', () => {
    expect(edit(SRC, { kind: 'removeMember', classId: 'Animal', index: 0 })).toBe(SRC.replace('        +String name\n', ''));
    expect(edit(SRC, { kind: 'moveMember', classId: 'Animal', from: 0, to: 1 })).toBe(
      SRC.replace('        +String name\n        +makeSound() void\n', '        +makeSound() void\n        +String name\n'),
    );
    // Removing the line that created a class keeps the class.
    expect(edit('classDiagram\n  A : +x\n  class B\n', { kind: 'removeMember', classId: 'A', index: 0 })).toBe('classDiagram\n  class A\n  class B\n');
  });

  it('sets and clears annotations', () => {
    expect(edit(SRC, { kind: 'setAnnotation', classId: 'Animal', annotation: 'abstract' })).toBe(
      SRC.replace('    class Animal {\n', '    class Animal {\n        <<abstract>>\n'),
    );
    expect(edit('classDiagram\n  class A\n', { kind: 'setAnnotation', classId: 'A', annotation: 'interface' })).toBe(
      'classDiagram\n  class A <<interface>>\n',
    );
    expect(edit('classDiagram\n  class A <<interface>>\n', { kind: 'setAnnotation', classId: 'A', annotation: 'Data store' })).toBe(
      'classDiagram\n  class A {\n      <<Data store>>\n  }\n',
    );
    expect(edit('classDiagram\n  class A {\n    <<interface>>\n    +x\n  }\n  <<service>> A\n', { kind: 'setAnnotation', classId: 'A', annotation: '' })).toBe(
      'classDiagram\n  class A {\n    +x\n  }\n',
    );
  });

  it('relation edits touch one part of one line', () => {
    const src = 'classDiagram\n    Dog "1" --> "*" Bone : chews\n    %% keep\n';
    expect(edit(src, { kind: 'setRelationType', index: 0, type: 'composition' })).toBe(src.replace('-->', '--*'));
    expect(edit(src, { kind: 'flipRelation', index: 0 })).toBe(src.replace('-->', '<--'));
    expect(edit(src, { kind: 'setRelationLabel', index: 0, label: 'eats: a lot' })).toBe(src.replace(': chews', ': eats#58; a lot'));
    expect(edit(src, { kind: 'setRelationLabel', index: 0, label: '' })).toBe(src.replace(' : chews', ''));
    expect(edit(src, { kind: 'setRelationCardinality', index: 0, from: '', to: '0..n' })).toBe(src.replace('"1" --> "*"', '--> "0..n"'));
    expect(edit('classDiagram\n  A --> B\n', { kind: 'setRelationCardinality', index: 0, from: '1', to: 'many' })).toBe(
      'classDiagram\n  A "1" --> "many" B\n',
    );
  });

  it('deleting a relation keeps the classes it created', () => {
    expect(edit('classDiagram\n  class A\n  A --> B\n  B --> C\n', { kind: 'deleteRelation', index: 0 })).toBe(
      'classDiagram\n  class A\n  class B\n  B --> C\n',
    );
  });

  it('adds relations with the user-level kinds', async () => {
    const kinds: ClassRelationType[] = ['inheritance', 'realization', 'composition', 'aggregation', 'association', 'dependency', 'link', 'dashedLink'];
    const arrows = ['--|>', '..|>', '*--', 'o--', '-->', '..>', '--', '..'];
    for (const [i, type] of kinds.entries()) {
      const out = edit('classDiagram\n  class A\n  class B\n', { kind: 'addRelation', from: 'A', to: 'B', type });
      expect(out).toBe(`classDiagram\n  class A\n  class B\n  A ${arrows[i]} B\n`);
      expect(classRelationType(model(out).relations[0])).toBe(type);
      expect(await mermaidAccepts(out)).toBe(true);
    }
  });

  it('notes and direction', () => {
    const src = 'classDiagram\n  class A\n  note for A "old"\n';
    expect(edit(src, { kind: 'setNoteText', index: 0, text: 'new "one"' })).toBe('classDiagram\n  class A\n  note for A "new #quot;one#quot;"\n');
    expect(edit(src, { kind: 'deleteNote', index: 0 })).toBe('classDiagram\n  class A\n');
    expect(edit(src, { kind: 'addNote', text: 'free' })).toBe(src + '  note "free"\n');
    expect(edit(src, { kind: 'setDirection', direction: 'LR' })).toBe('classDiagram\n  direction LR\n  class A\n  note for A "old"\n');
    expect(edit('classDiagram\n  direction RL\n  class A\n', { kind: 'setDirection', direction: 'BT' })).toBe('classDiagram\n  direction BT\n  class A\n');
  });

  it('moves classes into and out of namespaces', () => {
    const src = 'classDiagram\n  namespace N {\n    class A {\n      +x\n    }\n    class C\n  }\n  class B\n  A --> B\n';
    // In: a `class B` line joins the block; B's own declaration stays.
    expect(edit(src, { kind: 'setClassNamespace', id: 'B', namespace: 'N' })).toBe(src.replace('    class C\n', '    class C\n    class B\n'));
    // Out: the declaration (body and all) moves after the block.
    expect(edit(src, { kind: 'setClassNamespace', id: 'A', namespace: null })).toBe(
      'classDiagram\n  namespace N {\n    class C\n  }\n  class A {\n    +x\n  }\n  class B\n  A --> B\n',
    );
    // Into a new namespace; an emptied one goes.
    const one = 'classDiagram\n  namespace N {\n    class A\n  }\n  class B\n';
    expect(edit(one, { kind: 'setClassNamespace', id: 'A', namespace: 'Other space' })).toBe(
      'classDiagram\n  class B\n  namespace `Other space` {\n      class A\n  }\n',
    );
    expect(edit(one, { kind: 'setClassNamespace', id: 'A', namespace: null })).toBe('classDiagram\n  class A\n  class B\n');
    expect(model(edit(one, { kind: 'setClassNamespace', id: 'B', namespace: 'N' })).namespaces).toEqual([{ id: 'N', classIds: ['A', 'B'] }]);
  });

  it('refuses edits naming things that do not exist', () => {
    expect(applyClassEdit(SRC, { kind: 'setClassLabel', id: 'Nope', label: 'x' })).toBeNull();
    expect(applyClassEdit(SRC, { kind: 'removeMember', classId: 'Animal', index: 9 })).toBeNull();
    expect(applyClassEdit(SRC, { kind: 'deleteRelation', index: 9 })).toBeNull();
    expect(applyClassEdit('flowchart TD\n A', { kind: 'deleteRelation', index: 0 })).toBeNull();
  });
});

// ── User text fuzz ───────────────────────────────────────────────────

// jsdom has no SVG layout; mermaid.render needs these two.
(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(SVGElement.prototype as unknown as Record<string, unknown>).getComputedTextLength = () => 10;

let renders = 0;
async function rendered(src: string): Promise<Document> {
  const { svg } = await mermaid.render(`cfz${renders++}`, src);
  return new DOMParser().parseFromString(svg, 'text/html');
}
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('class edits: user text fuzz (mermaid accepts it and shows it as typed)', () => {
  const BASE = 'classDiagram\n  class A\n  A --> B\n';

  it('class labels', async () => {
    for (const t of FUZZ_INPUTS) {
      const out = edit(BASE, { kind: 'setClassLabel', id: 'A', label: t });
      const want = t.trim() || 'A';
      expect.soft(await mermaidAccepts(out), `${JSON.stringify(t)}:\n${out}`).toBe(true);
      expect.soft(model(out).classes.get('A')!.label, JSON.stringify(t)).toBe(want);
      const d = await rendered(out);
      const title = [...d.querySelectorAll('g.node')].find((g) => /classId-A-/.test(g.id))?.querySelector('.label-group');
      expect.soft(squash(title?.textContent), `shown label for ${JSON.stringify(t)}:\n${out}`).toBe(squash(want));
    }
  }, 60_000);

  it('member names, types and parameters', async () => {
    for (const t of FUZZ_INPUTS) {
      const f = field(t, t);
      const m = { ...method(t, t, t), visibility: 'private' as const };
      let out = edit(BASE, { kind: 'addMember', classId: 'A', member: f });
      out = edit(out, { kind: 'addMember', classId: 'A', member: m });
      expect.soft(await mermaidAccepts(out), `${JSON.stringify(t)}:\n${out}`).toBe(true);
      const back = model(out).classes.get('A')!.members;
      expect.soft(back.map((x) => [x.kind, x.name, x.type, x.parameters]), JSON.stringify(t)).toEqual([
        ['field', t.trim(), t.trim(), ''],
        ['method', t.trim(), t.trim(), t.trim()],
      ]);
      const d = await rendered(out);
      const node = [...d.querySelectorAll('g.node')].find((g) => /classId-A-/.test(g.id))!;
      const rows = [...node.querySelectorAll('.members-group .label, .methods-group .label')].map((r) => squash(r.textContent));
      const tt = t.trim();
      // An empty name is written as one encoded space (mermaid drops an
      // empty member, and `-()` would read as a method named "-"), so
      // an empty method shows as "- ()".
      expect.soft(rows, `shown rows for ${JSON.stringify(t)}:\n${out}`).toEqual([
        squash(`+${tt}${tt ? ' ' : ''}${tt}`),
        squash(`-${tt || ' '}(${tt})${tt ? ' : ' + tt : ''}`),
      ]);
    }
  }, 60_000);

  it('relation labels and cardinalities', async () => {
    for (const t of FUZZ_INPUTS) {
      let out = edit(BASE, { kind: 'setRelationLabel', index: 0, label: t });
      out = edit(out, { kind: 'setRelationCardinality', index: 0, from: t, to: t });
      expect.soft(await mermaidAccepts(out), `${JSON.stringify(t)}:\n${out}`).toBe(true);
      const rel = model(out).relations[0];
      expect.soft([rel.label, rel.fromCardinality, rel.toCardinality], JSON.stringify(t)).toEqual([t.trim(), t.trim(), t.trim()]);
      const d = await rendered(out);
      const label = [...d.querySelectorAll('.edgeLabel')].map((e) => squash(e.textContent)).find(Boolean) ?? '';
      expect.soft(label, `shown label for ${JSON.stringify(t)}:\n${out}`).toBe(squash(t));
      const terminals = [...d.querySelectorAll('.edgeTerminals')].map((e) => squash(e.textContent));
      expect.soft(terminals, `shown cardinalities for ${JSON.stringify(t)}:\n${out}`).toEqual(t.trim() ? [squash(t), squash(t)] : []);
    }
  }, 60_000);

  it('notes and annotations', async () => {
    for (const t of FUZZ_INPUTS) {
      let out = edit(BASE, { kind: 'addNote', text: t, classId: 'A' });
      out = edit(out, { kind: 'setAnnotation', classId: 'A', annotation: t });
      expect.soft(await mermaidAccepts(out), `${JSON.stringify(t)}:\n${out}`).toBe(true);
      const m = model(out);
      expect.soft(m.notes[0].text, JSON.stringify(t)).toBe(t.trim());
      expect.soft(m.classes.get('A')!.annotations, JSON.stringify(t)).toEqual(t.trim() ? [t.trim()] : []);
      const d = await rendered(out);
      const note = d.querySelector('.noteLabel');
      expect.soft(squash(note?.textContent), `shown note for ${JSON.stringify(t)}:\n${out}`).toBe(squash(t));
      const node = [...d.querySelectorAll('g.node')].find((g) => /classId-A-/.test(g.id))!;
      const ann = squash(node.querySelector('.annotation-group')?.textContent);
      expect.soft(ann, `shown annotation for ${JSON.stringify(t)}:\n${out}`).toBe(t.trim() ? `«${squash(t)}»` : '');
    }
  }, 60_000);
});

// ── Property test over the corpus ────────────────────────────────────

const FILES = ['mermaid-corpus.md', 'mermaid-corpus-class-er.md'];
const blocks = corpusBlocks((b) => parseClass(b.source).ok && /classDiagram/.test(b.source), FILES);

const TRICKY = 'Renamed "q" [x] #59; `b` ; | end: <i>';

type Expect = (m: ClassModel) => void;
interface Op {
  name: string;
  edit: ClassEdit;
  expected: Expect;
  // Original line numbers the edit may rewrite or remove.
  touches: Set<number>;
}

function lineSet(map: ClassSourceMap, spans: Array<{ start: number; end: number }>): Set<number> {
  const out = new Set<number>();
  const lineOf = (off: number) => map.text.slice(0, off).split('\n').length - 1;
  for (const s of spans) for (let l = lineOf(s.start); l <= lineOf(s.end); l++) out.add(l);
  return out;
}

// Every line belonging to class `id`: its declarations (bodies too),
// member / annotation lines, and the statement that created it.
function classLines(map: ClassSourceMap, id: string): Set<number> {
  const spans = map.statements.filter((s) => s.refs.includes(id) && s.kind !== 'relation').map((s) => s.span);
  spans.push(map.statements[map.created.get(id)!].span);
  return lineSet(map, spans);
}

function opsFor(m: ClassModel, map: ClassSourceMap): Op[] {
  const ops: Op[] = [];
  const none = new Set<number>();
  for (const [id, c] of m.classes) {
    const mine = classLines(map, id);
    ops.push({ name: `label ${id}`, edit: { kind: 'setClassLabel', id, label: TRICKY }, expected: (x) => void (x.classes.get(id)!.label = TRICKY), touches: mine });
    ops.push({ name: `unlabel ${id}`, edit: { kind: 'setClassLabel', id, label: '' }, expected: (x) => void (x.classes.get(id)!.label = id), touches: mine });
    const add = field('added', 'Map<K, V>');
    ops.push({ name: `add field ${id}`, edit: { kind: 'addMember', classId: id, member: add }, expected: (x) => void x.classes.get(id)!.members.push(memberFromInput(add)), touches: mine });
    const meth = { ...method(TRICKY, 'a: int, b', 'List<T>'), classifier: 'abstract' as const };
    ops.push({ name: `add method ${id}`, edit: { kind: 'addMember', classId: id, member: meth, index: 0 }, expected: (x) => void x.classes.get(id)!.members.unshift(memberFromInput(meth)), touches: mine });
    c.members.forEach((mem, i) => {
      const changed: ClassMemberInput = { kind: mem.kind, visibility: 'private', classifier: 'static', name: mem.name || 'n', type: mem.type, parameters: mem.parameters };
      ops.push({ name: `set member ${id}.${i}`, edit: { kind: 'setMember', classId: id, index: i, member: changed }, expected: (x) => void (x.classes.get(id)!.members[i] = memberFromInput(changed)), touches: mine });
      const renamed: ClassMemberInput = { ...changed, name: TRICKY, type: 'a b' };
      ops.push({ name: `rename member ${id}.${i}`, edit: { kind: 'setMember', classId: id, index: i, member: renamed }, expected: (x) => void (x.classes.get(id)!.members[i] = memberFromInput(renamed)), touches: mine });
      ops.push({ name: `remove member ${id}.${i}`, edit: { kind: 'removeMember', classId: id, index: i }, expected: (x) => void x.classes.get(id)!.members.splice(i, 1), touches: mine });
    });
    if (c.members.length >= 2) {
      const n = c.members.length;
      ops.push({ name: `move member ${id} 0→last`, edit: { kind: 'moveMember', classId: id, from: 0, to: n - 1 }, expected: (x) => void (x.classes.get(id)!.members = moveItem(x.classes.get(id)!.members, 0, n - 1)), touches: mine });
      ops.push({ name: `move member ${id} last→0`, edit: { kind: 'moveMember', classId: id, from: n - 1, to: 0 }, expected: (x) => void (x.classes.get(id)!.members = moveItem(x.classes.get(id)!.members, n - 1, 0)), touches: mine });
    }
    for (const ann of ['interface', 'Data store', '']) {
      ops.push({
        name: `annotation ${id} "${ann}"`,
        edit: { kind: 'setAnnotation', classId: id, annotation: ann },
        expected: (x) => {
          const k = x.classes.get(id)!;
          if (!ann) k.annotations = [];
          else if (k.annotations.length) k.annotations[0] = ann;
          else k.annotations = [ann];
        },
        touches: mine,
      });
    }
    // Delete: everything of the class, every relation / note touching
    // it, a namespace it empties.
    const rels = m.relations.map((r, i) => ({ r, i })).filter(({ r }) => r.from === id || r.to === id);
    const spans = [...rels.map(({ i }) => map.statements[map.relations[i].stmt].span)];
    const drop = new Set(map.statements.map((s, k) => (s.refs.includes(id) ? k : -1)).filter((k) => k >= 0));
    map.namespaces.forEach((ns, i) => {
      const kids = map.statements.map((s, k) => ({ s, k })).filter((x) => x.s.namespace === i);
      if (kids.every((x) => drop.has(x.k) || (x.s.kind === 'class' && x.s.refs[0] === id))) spans.push(map.statements[ns.stmt].span);
    });
    const del = new Set([...mine, ...lineSet(map, spans)]);
    ops.push({
      name: `delete ${id}`,
      edit: { kind: 'deleteClass', id },
      expected: (x) => {
        x.classes.delete(id);
        x.relations = x.relations.filter((r) => r.from !== id && r.to !== id);
        x.notes = x.notes.filter((n) => n.classId !== id);
        x.namespaces = x.namespaces
          .map((n) => ({ ...n, classIds: n.classIds.filter((k) => k !== id) }))
          .filter((n) => n.classIds.length || x.notes.some((no) => no.namespace === n.id));
      },
      touches: del,
    });
  }
  const ids = [...m.classes.keys()];
  ops.push({
    name: 'add class',
    edit: { kind: 'addClass', label: TRICKY },
    expected: (x) => {
      x.classes.set('RenamedQX59BEndI', { id: 'RenamedQX59BEndI', label: TRICKY, generic: '', annotations: [], members: [], namespace: null });
    },
    touches: none,
  });
  m.relations.forEach((rel, i) => {
    const line = lineSet(map, [map.statements[map.relations[i].stmt].span]);
    const lollipop = rel.fromMarker === 'lollipop' || rel.toMarker === 'lollipop';
    if (!lollipop) {
      for (const type of ['inheritance', 'composition', 'dependency', 'dashedLink'] as ClassRelationType[]) {
        ops.push({ name: `rel ${i} type ${type}`, edit: { kind: 'setRelationType', index: i, type }, expected: (x) => void Object.assign(x.relations[i], relationMarkers(type, rel)), touches: line });
      }
      ops.push({ name: `rel ${i} flip`, edit: { kind: 'flipRelation', index: i }, expected: (x) => void Object.assign(x.relations[i], { fromMarker: rel.toMarker, toMarker: rel.fromMarker }), touches: line });
    }
    ops.push({ name: `rel ${i} label`, edit: { kind: 'setRelationLabel', index: i, label: TRICKY }, expected: (x) => void (x.relations[i].label = TRICKY), touches: line });
    ops.push({ name: `rel ${i} unlabel`, edit: { kind: 'setRelationLabel', index: i, label: '' }, expected: (x) => void (x.relations[i].label = ''), touches: line });
    ops.push({
      name: `rel ${i} cardinality`,
      edit: { kind: 'setRelationCardinality', index: i, from: '0..1', to: TRICKY },
      expected: (x) => void Object.assign(x.relations[i], { fromCardinality: '0..1', toCardinality: TRICKY }),
      touches: line,
    });
    ops.push({
      name: `rel ${i} no cardinality`,
      edit: { kind: 'setRelationCardinality', index: i, from: '', to: '' },
      expected: (x) => void Object.assign(x.relations[i], { fromCardinality: '', toCardinality: '' }),
      touches: line,
    });
    ops.push({ name: `rel ${i} delete`, edit: { kind: 'deleteRelation', index: i }, expected: (x) => void x.relations.splice(i, 1), touches: line });
  });
  if (ids.length) {
    ops.push({
      name: 'add relation',
      edit: { kind: 'addRelation', from: ids[0], to: ids[ids.length - 1], type: 'aggregation', label: TRICKY },
      expected: (x) =>
        void x.relations.push({ from: ids[0], to: ids[ids.length - 1], ...relationMarkers('aggregation'), fromCardinality: '', toCardinality: '', label: TRICKY }),
      touches: none,
    });
    ops.push({
      name: 'add note',
      edit: { kind: 'addNote', text: TRICKY, classId: ids[0] },
      expected: (x) => void x.notes.push({ text: TRICKY, classId: ids[0], namespace: null }),
      touches: none,
    });
  }
  m.notes.forEach((_n, i) => {
    const line = lineSet(map, [map.statements[map.notes[i].stmt].span]);
    ops.push({ name: `note ${i} text`, edit: { kind: 'setNoteText', index: i, text: TRICKY }, expected: (x) => void (x.notes[i].text = TRICKY), touches: line });
    ops.push({ name: `note ${i} delete`, edit: { kind: 'deleteNote', index: i }, expected: (x) => void x.notes.splice(i, 1), touches: line });
  });
  const dir = m.direction === 'LR' ? 'BT' : 'LR';
  ops.push({ name: `direction ${dir}`, edit: { kind: 'setDirection', direction: dir }, expected: (x) => void (x.direction = dir), touches: lineSet(map, map.directions) });
  return ops;
}

function clone(m: ClassModel): ClassModel {
  return structuredClone(m);
}

function shape(m: ClassModel) {
  return { ...m, classes: [...m.classes.values()] };
}

describe('class edits: namespace moves over the corpus', () => {
  for (const block of blocks) {
    it(`${block.heading}: every class into every namespace, a new one, and out`, async () => {
      const parsed = parseClassSource(block.source);
      if (!parsed.ok) throw new Error(parsed.reason);
      const { model: before, map } = parsed;
      const lines = block.source.split('\n');
      const targets: Array<string | null> = [...before.namespaces.map((n) => n.id), null, 'Moved.Here'];
      // Namespace headers and closing braces may change too.
      const nsLines = lineSet(map, map.namespaces.flatMap((n) => [{ start: map.statements[n.stmt].span.start, end: map.statements[n.stmt].span.start }, { start: n.close, end: n.close }]));
      for (const [id, c] of before.classes) {
        const decls = lineSet(map, map.statements.filter((s) => s.kind === 'class' && s.refs[0] === id).map((s) => s.span));
        for (const ns of targets) {
          if (c.namespace === ns) continue;
          const name = `${id} → ${ns}`;
          const res = applyClassEdit(block.source, { kind: 'setClassNamespace', id, namespace: ns });
          expect(res, name).not.toBeNull();
          const back = parseClass(res!.source);
          expect(back.ok, `${name}:\n${res!.source}`).toBe(true);
          if (!back.ok) continue;
          const after = back.model;
          expect(after.classes.get(id)?.namespace, `${name}:\n${res!.source}`).toBe(ns);
          expect({ ...after.classes.get(id)!, namespace: c.namespace }, name).toEqual(c);
          for (const [k, v] of before.classes) if (k !== id) expect(after.classes.get(k), `${name}: ${k}`).toEqual(v);
          expect(after.relations, name).toEqual(before.relations);
          expect(after.notes, name).toEqual(before.notes);
          const allowed = new Set([...decls, ...nsLines].map((l) => lines[l]));
          for (const line of removedLines(block.source, res!.source)) {
            expect(allowed.has(line), `${name} changed an unrelated line ${JSON.stringify(line)}:\n${res!.source}`).toBe(true);
          }
          expect(await mermaidAccepts(res!.source), `${name}:\n${res!.source}`).toBe(true);
        }
      }
    }, 120_000);
  }
});

// Every op × item on `source`: (a) exact model change, (b) only the
// touched lines change, (c) mermaid accepts the result.
async function checkAllOps(source: string): Promise<void> {
      const block = { source };
      const parsed = parseClassSource(block.source);
      if (!parsed.ok) throw new Error(parsed.reason);
      const lines = block.source.split(/\r?\n/);
      for (const op of opsFor(parsed.model, parsed.map)) {
        const res = applyClassEdit(block.source, op.edit);
        // Deleting the only class of a diagram is refused.
        if (!res && op.edit.kind === 'deleteClass' && parsed.model.classes.size === 1) continue;
        expect(res, op.name).not.toBeNull();
        const out = res!.source;

        // (a) Semantically exactly the requested change.
        const back = parseClass(out);
        expect(back.ok, `${op.name}: own output unparseable:\n${out}`).toBe(true);
        if (!back.ok) continue;
        const want = clone(parsed.model);
        op.expected(want);
        expect(shape(back.model), `${op.name}:\n${out}`).toEqual(shape(want));

        // (b) Untouched lines are byte-identical.
        const allowed = new Set([...op.touches].map((l) => lines[l]));
        for (const line of removedLines(block.source, out)) {
          expect(allowed.has(line), `${op.name} changed an unrelated line ${JSON.stringify(line)}:\n${out}`).toBe(true);
        }

        // (c) mermaid accepts it.
        expect(await mermaidAccepts(out), `${op.name}:\n${out}`).toBe(true);
      }
}

describe('class edits: corpus property', () => {
  it('finds class diagrams in the corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(15);
  });

  for (const block of blocks) {
    it(`${block.heading}: every visual edit is exact, minimal and valid`, () => checkAllOps(block.source), 120_000);
  }
});

// Valid but unusual ways of writing things.
const ODD = [
  'classDiagram\nclass A\nclass B\n',
  'classDiagram\n  A-->B\n  C<|--D:label\n',
  'classDiagram\n  A "1"-->"2" B\n',
  'classDiagram\n  class A { +x }\n  class B{\n  +y\n  }\n',
  'classDiagram\n  namespace N { class X }\n  class Y\n',
  'classDiagram\n  class X <<interface>> {\n    +a\n  }\n  class Z <<service>>\n',
  'classDiagram\n  class `A B`["c"]\n  `A B` --> C\n',
  'classDiagram\n  class A~T~\n  A~T~ --> B~U~\n',
  'classDiagram\n  A ()-- B\n  C --() D\n',
  'classDiagram\n  class X:::a\n  class Y:::b {\n    +z\n  }\n',
  'classDiagram\n  direction RL\n  class X\n  X : +a\n  X : +b()\n',
  'classDiagram\n  accTitle: Hello\n  class X\n',
  'classDiagram\r\n  class A {\r\n    +x\r\n  }\r\n  A --> B : x\r\n  %% c\r\n',
];

describe('class edits: property on unusual sources', () => {
  for (const src of ODD) {
    it(JSON.stringify(src), async () => {
      expect(await mermaidAccepts(src)).toBe(true);
      await checkAllOps(src);
    }, 120_000);
  }
});
