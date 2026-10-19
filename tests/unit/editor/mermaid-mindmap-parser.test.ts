// Mindmap parser: the tree must be exactly the one mermaid builds (its
// own db is the oracle), and the source map must point at the bytes
// the edit engine rewrites.
import { describe, it, expect } from 'vitest';
import {
  parseMindmapSource,
  parseMindmap,
  MINDMAP_STARTER,
  type MindmapModel,
  type MindmapShape,
} from '../../../src/lib/editor/mermaid/mindmap-parser';
import { decodeMermaidEntities } from '../../../src/lib/editor/mermaid-parser';
import { corpusBlocks, mermaidDb, mermaidAccepts } from './mermaid-test-utils';

function model(src: string): MindmapModel {
  const r = parseMindmap(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

// Compact view: one entry per node, in index order.
function outline(m: MindmapModel): string[] {
  return m.nodes.map((n) => `${'  '.repeat(n.depth)}${n.shape}:${n.text}`);
}

describe('mindmap parser: targeted examples', () => {
  it('reads the corpus example as an indentation tree', () => {
    const m = model('mindmap\n  root((Mindmap))\n    Origins\n      Long history\n    Tools\n');
    expect(outline(m)).toEqual(['circle:Mindmap', '  default:Origins', '    default:Long history', '  default:Tools']);
    expect(m.nodes[0]).toMatchObject({ index: 0, id: 'root', parent: null, children: [1, 3], depth: 0 });
    expect(m.nodes[2]).toMatchObject({ index: 2, id: null, parent: 1, children: [] });
  });

  it('knows every shape (mermaid: `)x(` is a cloud and `))x((` a bang)', () => {
    const m = model('mindmap\n  r\n    a[sq]\n    b(rd)\n    c((ci))\n    d))ba((\n    e)cl(\n    f{{hx}}\n    (-df-)\n');
    const shapes: MindmapShape[] = ['default', 'square', 'rounded', 'circle', 'bang', 'cloud', 'hexagon', 'default'];
    expect(m.nodes.map((n) => n.shape)).toEqual(shapes);
    expect(m.nodes.map((n) => n.id)).toEqual([null, 'a', 'b', 'c', 'd', 'e', 'f', null]);
  });

  it('follows mermaid for inconsistent indentation: parent = last node indented less', () => {
    const m = model('mindmap\n  root\n      A\n    B\n   C\n      D\n');
    expect(m.nodes.map((n) => n.parent)).toEqual([null, 0, 0, 0, 3]);
  });

  it('counts a tab as one column, like mermaid', () => {
    const m = model('mindmap\n\troot\n\t\tA\n\t\t\tB\n\t\tC\n');
    expect(m.nodes.map((n) => n.parent)).toEqual([null, 0, 1, 0]);
  });

  it('reads icons and classes, which decorate the node above them', () => {
    const m = model('mindmap\n  root\n    A\n    ::icon(fa fa-book)\n    :::urgent large\n    B\n      :::done\n');
    expect(m.nodes[1]).toMatchObject({ icon: 'fa fa-book', classes: ['urgent', 'large'] });
    expect(m.nodes[2]).toMatchObject({ icon: null, classes: ['done'] });
  });

  it('reads quoted, markdown and entity-coded text', () => {
    const m = model('mindmap\n  root["`**bold** text`"]\n    a["Tom, (Jerry)"]\n    b[Semi #59; colon]\n    c #amp; d\n');
    expect(m.nodes.map((n) => [n.text, n.markdown])).toEqual([
      ['**bold** text', true],
      ['Tom, (Jerry)', false],
      ['Semi ; colon', false],
      ['c & d', false],
    ]);
  });

  it('richText is the label as markdown: entity-coded markers stay literal', () => {
    const m = model('mindmap\n  root[**bold** 2#42;3 a#92;b #59;]\n');
    expect(m.nodes[0].text).toBe('**bold** 2*3 a\\b ;');
    expect(m.nodes[0].richText).toBe('**bold** 2\\*3 a\\\\b ;');
  });

  it('maps each node to its line and its parts', () => {
    const src = 'mindmap\n  root((Top))\n    %% c\n    id1[Box]\n    ::icon(fa)\n';
    const r = parseMindmapSource(src);
    if (!r.ok) throw new Error(r.reason);
    const n = r.map.nodes[1];
    expect(n.line).toBe(3);
    expect(n.endLine).toBe(3);
    expect(r.map.lines[n.line].slice(n.indent.end, n.close!.end)).toBe('id1[Box]');
    expect(n.iconLines).toEqual([4]);
    expect(r.map.nodes[0].lastLine).toBe(4);
  });

  it('reads the frontmatter title', () => {
    expect(model('---\ntitle: Plan\n---\nmindmap\n  root\n').title).toBe('Plan');
  });

  it('accepts an empty mindmap', () => {
    expect(model('mindmap\n').nodes).toEqual([]);
  });

  it('bails on what mermaid rejects', () => {
    for (const bad of [
      'mindmap\n  root\n  second root\n',
      'mindmap\n  root\n    A{x}\n',
      'mindmap\n  root\n    A[x] B\n',
      'mindmap\n  root\n    Mindmap ideas\n',
      'mindmap\n  ::icon(fa)\n  root\n',
      'flowchart LR\n  A --> B\n',
    ]) {
      expect(parseMindmapSource(bad).ok, bad).toBe(false);
    }
  });

  it('the starter is a small valid mindmap', async () => {
    expect(await mermaidAccepts(MINDMAP_STARTER)).toBe(true);
    expect(model(MINDMAP_STARTER).nodes.length).toBeGreaterThan(3);
  });
});

// ── Oracle: mermaid's own tree ───────────────────────────────────────

const SHAPE_OF_TYPE: MindmapShape[] = ['default', 'rounded', 'square', 'circle', 'cloud', 'bang', 'hexagon'];

// mermaid keeps entity codes as placeholders until it renders, and
// sanitizes the text as HTML; undo both to compare with our text.
function mermaidText(s: string): string {
  return decodeMermaidEntities(s.replace(/ﬂ°°(\d+)¶ß/g, '#$1;').replace(/ﬂ°(\w+)¶ß/g, '#$1;'))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function oracle(root: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (n: any, parent: number | null) => {
    out.push({
      index: n.id,
      text: mermaidText(n.descr),
      id: mermaidText(n.nodeId),
      shape: SHAPE_OF_TYPE[n.type],
      icon: n.icon ?? null,
      classes: n.class ? String(n.class).split(/\s+/).filter(Boolean) : [],
      parent,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    n.children.forEach((c: any) => walk(c, n.id));
  };
  if (root) walk(root, null);
  return out;
}

function mindmapBlocks() {
  return corpusBlocks(
    (b) => /^\s*mindmap\s*$/m.test(b.source),
    ['mermaid-corpus.md', 'mermaid-corpus-mindmap.md'],
  );
}

describe('mindmap parser: mermaid oracle', () => {
  const blocks = mindmapBlocks();
  it('finds the mindmap corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(12);
  });
  for (const block of blocks) {
    it(`${block.heading}: same tree as mermaid`, async () => {
      const r = parseMindmap(block.source);
      if (!r.ok) throw new Error(r.reason);
      const { db } = await mermaidDb(block.source);
      const ours = r.model.nodes.map((n) => ({
        index: n.index,
        text: n.text,
        id: n.id ?? n.text,
        shape: n.shape,
        icon: n.icon,
        classes: n.classes,
        parent: n.parent,
      }));
      expect(ours).toEqual(oracle(db.getMindmap()));
    });
  }
});
