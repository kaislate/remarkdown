// Class diagram parser: checked against mermaid's own ClassDB over the
// corpus (the oracle), plus targeted syntax examples.
import { describe, it, expect } from 'vitest';
import {
  parseClass,
  parseClassSource,
  parseMemberText,
  parseGenericTypes,
  CLASS_STARTER,
  type ClassEndMarker,
  type ClassModel,
} from '../../../src/lib/editor/mermaid/class-parser';
import { corpusBlocks, mermaidDb, mermaidAccepts } from './mermaid-test-utils';

const FILES = ['mermaid-corpus.md', 'mermaid-corpus-class-er.md'];
export const classBlocks = () => corpusBlocks((b) => /^\s*(%%.*\n|---[\s\S]*?---\n|\s*\n)*\s*classDiagram/.test(b.source), FILES);

// What mermaid's db stores → what it displays: placeholders back to
// characters, the markdown escape before the visibility dropped.
function shown(s: string | undefined): string {
  if (!s) return '';
  const html = s.replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';');
  const ta = document.createElement('textarea');
  ta.innerHTML = html;
  return ta.value;
}

const MARKER: Record<string, ClassEndMarker> = { none: 'none', 0: 'aggregation', 1: 'inheritance', 2: 'composition', 3: 'arrow', 4: 'lollipop' };
const VIS: Record<string, string> = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package', '': 'none' };
const CLS: Record<string, string> = { $: 'static', '*': 'abstract', '': 'none' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromDb(db: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iface = (id: string) => (/^interface\d+$/.test(id) ? db.interfaces.find((i: any) => i.id === id)?.label ?? id : id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const member = (m: any) => ({
    visibility: VIS[m.visibility],
    classifier: CLS[m.classifier],
    display: shown(m.text.replace(/^\\/, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')),
    ...(m.memberType === 'method'
      ? { name: shown(m.id).trim() === '' ? '' : shown(m.id.trim()), parameters: shown(parseGenericTypes(m.parameters)), type: shown(parseGenericTypes(m.returnType)) }
      : {}),
  });
  return {
    direction: db.getDirection(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    classes: [...db.getClasses().values()].map((c: any) => ({
      id: c.id,
      label: shown(c.label),
      generic: shown(c.type),
      annotations: c.annotations.map(shown),
      fields: c.members.map(member),
      methods: c.methods.map(member),
      namespace: c.parent ?? null,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    relations: db.getRelations().map((r: any) => ({
      from: iface(r.id1),
      to: iface(r.id2),
      fromMarker: MARKER[r.relation.type1],
      toMarker: MARKER[r.relation.type2],
      line: r.relation.lineType === 1 ? 'dashed' : 'solid',
      fromCardinality: r.relationTitle1 === 'none' ? '' : shown(r.relationTitle1),
      toCardinality: r.relationTitle2 === 'none' ? '' : shown(r.relationTitle2),
      label: shown(r.title),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    notes: [...db.getNotes().values()].map((n: any) => ({ text: shown(n.text), classId: n.class ?? null, namespace: n.parent ?? null })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    namespaces: [...db.getNamespaces().values()].map((n: any) => ({ id: n.id, classIds: [...n.classes.keys()] })),
  };
}

function fromModel(m: ClassModel) {
  const member = (x: ClassModel['classes'] extends Map<string, infer C> ? C extends { members: (infer M)[] } ? M : never : never) => ({
    visibility: x.visibility,
    classifier: x.classifier,
    display: x.display,
    ...(x.kind === 'method' ? { name: x.name, parameters: x.parameters, type: x.type } : {}),
  });
  return {
    direction: m.direction,
    classes: [...m.classes.values()].map((c) => ({
      id: c.id,
      label: c.label,
      generic: c.generic,
      annotations: c.annotations,
      fields: c.members.filter((x) => x.kind === 'field').map(member),
      methods: c.members.filter((x) => x.kind === 'method').map(member),
      namespace: c.namespace,
    })),
    relations: m.relations,
    notes: m.notes,
    namespaces: m.namespaces,
  };
}

describe('class parser: oracle (mermaid ClassDB) over the corpus', () => {
  const blocks = classBlocks();
  it('has a class corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(15);
  });
  for (const b of blocks) {
    it(`${b.heading}: model matches mermaid's db`, async () => {
      expect(await mermaidAccepts(b.source)).toBe(true);
      const r = parseClassSource(b.source);
      if (!r.ok) throw new Error(r.reason);
      const { db } = await mermaidDb(b.source);
      expect(fromModel(r.model)).toEqual(fromDb(db));
    });
  }
});

// Odd corners of the syntax: the parser must accept exactly what
// mermaid accepts, and read it the way mermaid's db does.
const SNIPPETS = [
  'classDiagram\nclass A\n',
  'classDiagram-v2\n  class A\n',
  'classDiagram\n  class A {\n  }\n  class B{\n  +x\n  }\n',
  'classDiagram\n  class Foo Bar\n',
  'classDiagram\n  A-->B\n  C<|--D:label\n',
  'classDiagram\n  A "1"-->"2" B\n',
  'classDiagram\n  A --> B : a : b\n',
  'classDiagram\n  A --> B :\n',
  'classDiagram\n  A : \n',
  'classDiagram\n  A : +x\n  A : -y()\n  A : #z$\n  A : ~w*\n',
  'classDiagram\n  class A {\n    +method(a, (b)) int\n    field)\n  }\n',
  'classDiagram\n  class A~T~\n  class A~U~\n',
  'classDiagram\n  class A\n  class A~T~\n',
  'classDiagram\n  A~T~ --> B~U~\n',
  'classDiagram\n  class `A B`["c"]\n  `A B` --> C\n',
  'classDiagram\n  class a.b.c\n  a.b.c --> d.e\n',
  'classDiagram\n  class A-B-C\n  A-B-C --> D\n',
  'classDiagram\n  class 123\n  class 1abc\n',
  'classDiagram\n  class Ünïcode\n  Ünïcode --> B\n',
  'classDiagram\n  note "a"\n  note "b"\n  note for A "c"\n  class A\n',
  'classDiagram\n  note for Missing "x"\n',
  'classDiagram\n  namespace A.B {\n    class X\n  }\n',
  'classDiagram\n  namespace N { class X }\n',
  'classDiagram\n  namespace N {\n    note "only a note"\n  }\n',
  'classDiagram\n  namespace N {\n    class X\n    note for X "n"\n  }\n',
  'classDiagram\n  namespace N {\n    X --> Y\n  }\n',
  'classDiagram\n  class X:::a\n  class Y:::b {\n    +z\n  }\n',
  'classDiagram\n  class X <<interface>>\n  <<abstract>> X\n',
  'classDiagram\n  class X <<interface>> {\n    +a\n  }\n',
  'classDiagram\n  class X {\n    <<a>>\n    <<b c>>\n  }\n',
  'classDiagram\n  direction RL\n  direction BT\n',
  'classDiagram\n  direction TB\n  class X\n',
  'classDiagram\n  accTitle: Hello\n  accDescr: world\n  class X\n',
  'classDiagram\n  accDescr {\n    multi\n    line\n  }\n  class X\n',
  'classDiagram\n  class X\n  style X fill:#f00,stroke:#333\n',
  'classDiagram\n  class X\n  classDef a,b fill:#f00\n',
  'classDiagram\n  class X\n  cssClass "X" foo\n',
  'classDiagram\n  class X\n  click X call cb()\n  click X call cb(1, "2") "tip"\n',
  'classDiagram\n  class X\n  click X href "http://a" "tip" _blank\n',
  'classDiagram\n  class X\n  link X "http://a" _self\n',
  'classDiagram\n  A ()-- B\n  C --() D\n  E ()--() F\n',
  'classDiagram\n  A <|..|> B\n  C *..* D\n  E o..o F\n  G <.. H\n',
  'classDiagram\n  A --o B\n  A o-- B\n',
  'classDiagram\n  A -- B\n  A .. B\n',
  'classDiagram\n  A ---> B\n',
  'classDiagram\n  A <-- B : "q"\n',
  'classDiagram\n  %% comment\n  class X %% trailing?\n',
  'classDiagram\n  class X["a"]\n  class X["b"]\n',
  'classDiagram\n  class X[""]\n',
  'classDiagram\n  class X {\n    +a\n  }\n  class X {\n    +b\n  }\n',
  'classDiagram\n  class X {\n',
  'classDiagram\n  class X }\n',
  'classDiagram\n  A --> B\n  A -->\n',
  'classDiagram\n  class X\n  X : +#59;a\n  X : #35;b\n  X : +#126;t#126;\n',
  'classDiagram\n  class X\n  X : +f(#40;x#41;) #123;y#125;\n',
  'classDiagram\n  A "none" --> "x" B\n',
  'classDiagram\n  class `note`\n  class o1\n',
  '---\ntitle: T\n---\nclassDiagram\n  class X\n',
  '%%{init: {"theme":"dark"}}%%\nclassDiagram\n  class X\n',
  'classDiagram\n\n\n  class X\n\n',
];

describe('class parser: accepts exactly what mermaid accepts', () => {
  for (const src of SNIPPETS) {
    it(JSON.stringify(src), async () => {
      const accepted = (await mermaidAccepts(src)) === true;
      const r = parseClassSource(src);
      expect(r.ok, r.ok ? 'parser accepted' : r.reason).toBe(accepted);
      if (r.ok && accepted) {
        const { db } = await mermaidDb(src);
        expect(fromModel(r.model)).toEqual(fromDb(db));
      }
    });
  }
});

describe('class parser: syntax', () => {
  const model = (src: string) => {
    const r = parseClass(src);
    if (!r.ok) throw new Error(r.reason);
    return r.model;
  };

  it('parses the starter', async () => {
    expect(await mermaidAccepts(CLASS_STARTER)).toBe(true);
    expect([...model(CLASS_STARTER).classes.keys()]).toEqual(['Animal', 'Dog', 'Cat']);
  });

  it('splits fields into type and name, both styles', () => {
    expect(parseMemberText('+String name')).toMatchObject({ kind: 'field', visibility: 'public', type: 'String', name: 'name', display: '+String name' });
    expect(parseMemberText('-List~int~ ids$')).toMatchObject({ visibility: 'private', classifier: 'static', type: 'List<int>', name: 'ids', display: '-List<int> ids' });
    expect(parseMemberText('id: int')).toMatchObject({ visibility: 'none', type: 'int', name: 'id', display: 'id: int' });
    expect(parseMemberText('RED')).toMatchObject({ type: '', name: 'RED' });
    expect(parseMemberText('+x#32;y')).toMatchObject({ name: 'x y', type: '' });
  });

  it('parses methods the way ClassMember does', () => {
    expect(parseMemberText('+makeSound(int a, b)$ void')).toMatchObject({
      kind: 'method', visibility: 'public', classifier: 'static', name: 'makeSound', parameters: 'int a, b', type: 'void',
      display: '+makeSound(int a, b) : void',
    });
    expect(parseMemberText('+h() int$')).toMatchObject({ classifier: 'static', type: 'int' });
    expect(parseMemberText('~pkg() bool*')).toMatchObject({ visibility: 'package', classifier: 'abstract', type: 'bool' });
    expect(parseMemberText('#32;()')).toMatchObject({ kind: 'method', name: '', display: ' ()' });
  });

  it('a bare class name statement creates nothing (like mermaid)', () => {
    expect([...model('classDiagram\n    Cat\n    class Dog\n').classes.keys()]).toEqual(['Dog']);
  });

  it('`direction XX` anywhere on a line swallows the line (mermaid lexer rule)', async () => {
    const src = 'classDiagram\n    A --> B : direction LR inside\n    class C\n';
    const m = model(src);
    expect(m.direction).toBe('LR');
    expect([...m.classes.keys()]).toEqual(['C']);
    const { db } = await mermaidDb(src);
    expect(db.getDirection()).toBe('LR');
  });

  it('rejects what mermaid rejects', async () => {
    for (const src of [
      'classDiagram\n',
      'classDiagram\n    %% only a comment\n',
      'classDiagram\n    Animal : +a; b\n',
      'classDiagram\n    X : +name: string\n',
      'classDiagram\n    class C:::foo["x"]\n',
      'classDiagram\n    namespace N {\n    }\n',
      'classDiagram\n    <<interface>> Nope\n',
    ]) {
      expect(parseClass(src).ok, src).toBe(false);
      expect(await mermaidAccepts(src), src).not.toBe(true);
    }
  });

  it('maps relation arrows and the parts edits rewrite', () => {
    const src = 'classDiagram\n    Dog "1" --> "*" Bone : chews\n';
    const r = parseClassSource(src);
    if (!r.ok) throw new Error(r.reason);
    const rel = r.map.relations[0];
    const t = r.map.text;
    expect(t.slice(rel.from.start, rel.from.end)).toBe('Dog');
    expect(t.slice(rel.arrow.start, rel.arrow.end)).toBe('-->');
    expect(t.slice(rel.fromCardinality!.start, rel.fromCardinality!.end)).toBe('"1"');
    expect(t.slice(rel.toCardinality!.start, rel.toCardinality!.end)).toBe('"*"');
    expect(t.slice(rel.label!.start, rel.label!.end)).toBe(': chews');
    expect(t.slice(rel.to.start, rel.to.end)).toBe('Bone');
  });

  it('maps member spans in both forms, through entity codes', () => {
    const src = 'classDiagram\n  class A {\n    +a #59; b\n  }\n  A : +c()\n';
    const r = parseClassSource(src);
    if (!r.ok) throw new Error(r.reason);
    const ms = r.map.members.get('A')!;
    expect(ms.map((m) => [m.form, r.map.text.slice(m.span.start, m.span.end)])).toEqual([
      ['body', '+a #59; b'],
      ['line', '+c()'],
    ]);
    expect(r.model.classes.get('A')!.members[0].display).toBe('+a ; b');
  });
});
