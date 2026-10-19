// ER diagram parser: checked against mermaid's own ErDB over the
// corpus (the oracle), plus targeted syntax examples.
import { describe, it, expect } from 'vitest';
import { parseEr, parseErSource, ER_STARTER, type ErModel } from '../../../src/lib/editor/mermaid/er-parser';
import { parseGenericTypes } from '../../../src/lib/editor/mermaid/class-parser';
import { corpusBlocks, mermaidDb, mermaidAccepts } from './mermaid-test-utils';

const FILES = ['mermaid-corpus.md', 'mermaid-corpus-class-er.md'];
const erBlocks = () => corpusBlocks((b) => /^\s*(%%.*\n|---[\s\S]*?---\n|\s*\n)*\s*erDiagram/.test(b.source), FILES);

function shown(s: string | undefined): string {
  if (!s) return '';
  const ta = document.createElement('textarea');
  ta.innerHTML = s.replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';');
  return ta.value;
}

const CARD: Record<string, string> = {
  ZERO_OR_ONE: 'zero-or-one',
  ZERO_OR_MORE: 'zero-or-more',
  ONE_OR_MORE: 'one-or-more',
  ONLY_ONE: 'exactly-one',
  MD_PARENT: 'md-parent',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromDb(db: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities = [...db.getEntities().entries()] as Array<[string, any]>;
  const byDomId = new Map(entities.map(([name, e]) => [e.id, name]));
  return {
    direction: db.getDirection(),
    entities: entities.map(([name, e]) => ({
      id: name,
      alias: shown(e.alias),
      label: shown(e.alias || name),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attributes: e.attributes.map((a: any) => ({
        type: shown(parseGenericTypes(a.type)),
        name: shown(parseGenericTypes(a.name)),
        keys: a.keys.map((k: string) => k.toUpperCase()),
        comment: shown(parseGenericTypes(a.comment)),
      })),
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    relationships: db.getRelationships().map((r: any) => ({
      from: byDomId.get(r.entityA),
      to: byDomId.get(r.entityB),
      fromCardinality: CARD[r.relSpec.cardB],
      toCardinality: CARD[r.relSpec.cardA],
      identifying: r.relSpec.relType === 'IDENTIFYING',
      label: shown(r.roleA),
    })),
  };
}

function fromModel(m: ErModel) {
  return { direction: m.direction, entities: [...m.entities.values()], relationships: m.relationships };
}

describe('ER parser: oracle (mermaid ErDB) over the corpus', () => {
  const blocks = erBlocks();
  it('has an ER corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(10);
  });
  for (const b of blocks) {
    it(`${b.heading}: model matches mermaid's db`, async () => {
      expect(await mermaidAccepts(b.source)).toBe(true);
      const r = parseErSource(b.source);
      if (!r.ok) throw new Error(r.reason);
      const { db } = await mermaidDb(b.source);
      expect(fromModel(r.model)).toEqual(fromDb(db));
    });
  }
});

const SNIPPETS = [
  'erDiagram\n',
  'erDiagram\n  A\n  B C\n',
  'erDiagram\n  A||--o{B : x\n',
  'erDiagram\n  A ||--o{ B : x C ||--|| D : y\n',
  'erDiagram\n  A ||--o{ B : ""\n',
  'erDiagram\n  A ||--o{ B : "a % b"\n',
  'erDiagram\n  A ||--o{ B : one\n',
  'erDiagram\n  "A b" ||--o{ "C d" : x\n',
  'erDiagram\n  A.b ||--o{ c-d : x\n',
  'erDiagram\n  1 ||--o{ 2.5 : x\n',
  'erDiagram\n  A 1--1 B : x\n',
  'erDiagram\n  A 1 to 1 B : x\n',
  'erDiagram\n  A u--o{ B : x\n',
  'erDiagram\n  A |o..o| B : x\n  A o|--|o B : y\n',
  'erDiagram\n  A }o--}| B : x\n  A |{--o{ B : y\n',
  'erDiagram\n  A zero or more to one or many B : x\n',
  'erDiagram\n  A one or zero optionally to only one B : x\n',
  'erDiagram\n  A many(0) -. many(1) B : x\n',
  'erDiagram\n  A many .. many B : x\n',
  'erDiagram\n  A:::c ||--o{ B:::d : x\n',
  'erDiagram\n  A:::c,d\n  B:::e {\n    int x\n  }\n',
  'erDiagram\n  A["al"]:::c\n  B[b]:::d {\n    int x\n  }\n',
  'erDiagram\n  A["a"]\n  A["b"]\n  A[c]\n',
  'erDiagram\n  A {\n    int a PK, FK, UK "c"\n    int b pk\n  }\n',
  'erDiagram\n  A {\n    int a PK FK\n  }\n',
  'erDiagram\n  A {\n    int a "c" "d"\n  }\n',
  'erDiagram\n  A {\n    int\n  }\n',
  'erDiagram\n  A { int a string b }\n',
  'erDiagram\n  A {\n    Map~K, V~ m\n    List~int~ l "x"\n  }\n',
  'erDiagram\n  A {\n    int(10) a-b\n    *x y*\n  }\n',
  'erDiagram\n  A {\n    Ünï cödé\n  }\n',
  'erDiagram\n  A {\n    int pk_id\n    int PKG\n  }\n',
  'erDiagram\n  A {\n    int PK\n  }\n',
  'erDiagram\n  A {\n    int a\n',
  'erDiagram\n  direction LR\n  A\n',
  'erDiagram\n  DIRECTION lr\n  A\n',
  'erDiagram\n  classDef foo fill:#f00\n  class A,B foo\n  A\n',
  'erDiagram\n  A\n  style A fill:#f00;\n',
  'erDiagram\n  accTitle: t\n  accDescr: d\n  A\n',
  'erDiagram\n  A ||--o{ B\n',
  'erDiagram\n  A[A1] ||--o{ B : x\n',
  'erDiagram\n  A ||--o{ B : x y\n',
  '---\ntitle: T\n---\nerDiagram\n  A\n',
  '%%{init: {}}%%\nerDiagram\n  %% c\n  A\n',
  'ERDIAGRAM\n  A\n',
];

describe('ER parser: accepts exactly what mermaid accepts', () => {
  for (const src of SNIPPETS) {
    it(JSON.stringify(src), async () => {
      const accepted = (await mermaidAccepts(src)) === true;
      const r = parseErSource(src);
      expect(r.ok, r.ok ? 'parser accepted' : r.reason).toBe(accepted);
      if (r.ok && accepted) {
        const { db } = await mermaidDb(src);
        expect(fromModel(r.model)).toEqual(fromDb(db));
      }
    });
  }
});

describe('ER parser: syntax', () => {
  const model = (src: string) => {
    const r = parseEr(src);
    if (!r.ok) throw new Error(r.reason);
    return r.model;
  };

  it('parses the starter', async () => {
    expect(await mermaidAccepts(ER_STARTER)).toBe(true);
    expect([...model(ER_STARTER).entities.keys()]).toEqual(['CUSTOMER', 'ORDER', 'LINE_ITEM']);
  });

  it('reads both cardinalities, word forms and the line kind', () => {
    const m = model('erDiagram\n  A one or more optionally to zero or one B : r\n  C }o--|{ D : "s t"\n');
    expect(m.relationships).toEqual([
      { from: 'A', to: 'B', fromCardinality: 'one-or-more', toCardinality: 'zero-or-one', identifying: false, label: 'r' },
      { from: 'C', to: 'D', fromCardinality: 'zero-or-more', toCardinality: 'one-or-more', identifying: true, label: 's t' },
    ]);
  });

  it('the first alias wins; aliases show instead of the id', () => {
    const m = model('erDiagram\n  A["First"]\n  A["Second"]\n  B[bare]\n');
    expect(m.entities.get('A')).toMatchObject({ alias: 'First', label: 'First' });
    expect(m.entities.get('B')).toMatchObject({ alias: 'bare', label: 'bare' });
  });

  it('maps the parts edits rewrite', () => {
    const src = 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER {\n    int id PK, FK "the id"\n  }\n';
    const r = parseErSource(src);
    if (!r.ok) throw new Error(r.reason);
    const t = r.map.text;
    const rel = r.map.relationships[0];
    expect([rel.from, rel.fromCardinality, rel.line, rel.toCardinality, rel.to, rel.label].map((s) => t.slice(s.start, s.end))).toEqual([
      'CUSTOMER', '||', '--', 'o{', 'ORDER', 'places',
    ]);
    const a = r.map.attributes.get('ORDER')![0];
    expect([a.span, a.type, a.name, a.keys!, a.comment!].map((s) => t.slice(s.start, s.end))).toEqual([
      'int id PK, FK "the id"', 'int', 'id', 'PK, FK', '"the id"',
    ]);
  });

  it('rejects what mermaid rejects', async () => {
    for (const src of [
      'erDiagram\n  A ||--o{ B\n',
      'erDiagram\n  A["al %"]\n',
      'erDiagram\n  A {\n    string name "c" PK\n  }\n',
      "erDiagram\n  A ||--o{ B : 'single'\n",
      'erDiagram\n  A[A1] ||--o{ B : x\n',
    ]) {
      expect(parseEr(src).ok, src).toBe(false);
      expect(await mermaidAccepts(src), src).not.toBe(true);
    }
  });

  it('an empty ER diagram is valid', async () => {
    expect(await mermaidAccepts('erDiagram\n')).toBe(true);
    expect(model('erDiagram\n').entities.size).toBe(0);
  });
});
