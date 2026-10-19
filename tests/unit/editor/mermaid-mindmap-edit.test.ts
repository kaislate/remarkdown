// Source-preserving visual edits on mindmaps. The invariant: after a
// visual edit, every source line the edit did not semantically touch
// is byte-identical — comments, %%{init}%% directives, frontmatter,
// blank lines, other nodes, indentation style, icons and classes.
import { describe, it, expect, beforeAll } from 'vitest';
import mermaid from 'mermaid';
import { applyMindmapEdit, type MindmapEdit } from '../../../src/lib/editor/mermaid/mindmap-edit';
import {
  parseMindmap,
  parseMindmapSource,
  type MindmapModel,
  type MindmapShape,
  type MindmapSourceMap,
} from '../../../src/lib/editor/mermaid/mindmap-parser';
import { corpusBlocks, mermaidAccepts, removedLines, FUZZ_INPUTS } from './mermaid-test-utils';

// jsdom has no SVG layout; mermaid.render needs these two.
(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(SVGElement.prototype as unknown as Record<string, unknown>).getComputedTextLength = () => 10;

function edit(src: string, e: MindmapEdit): string {
  const r = applyMindmapEdit(src, e);
  if (!r) throw new Error('edit refused');
  return r.source;
}

function model(src: string): MindmapModel {
  const r = parseMindmap(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

describe('mindmap edits: targeted examples', () => {
  const SRC = [
    'mindmap',
    '  %% plan',
    '  root((Plan))',
    '    Research',
    '    ::icon(fa fa-book)',
    '      Papers',
    '    Design',
    '      :::urgent',
    '    Build',
  ].join('\n');

  it('rename keeps the shape, the id and the markdown form', () => {
    expect(edit(SRC, { kind: 'rename', index: 0, text: 'Big plan' })).toBe(SRC.replace('root((Plan))', 'root((Big plan))'));
    expect(edit('mindmap\n  a["`**Old**`"]\n', { kind: 'rename', index: 0, text: 'New' })).toBe('mindmap\n  a["`New`"]\n');
    expect(edit('mindmap\n  a["Old"]\n', { kind: 'rename', index: 0, text: 'New' })).toBe('mindmap\n  a["New"]\n');
    expect(edit(SRC, { kind: 'rename', index: 1, text: 'Reading' })).toBe(SRC.replace('    Research', '    Reading'));
  });

  it('rename writes typed text so it shows as typed', () => {
    expect(edit('mindmap\n  root\n    x[a]\n', { kind: 'rename', index: 1, text: 'a (b) "c"' })).toBe(
      'mindmap\n  root\n    x["a (b) #quot;c#quot;"]\n',
    );
    // A default-shape node can't hold parens bare: mermaid's (-"…"-)
    // form is the default shape with a quoted text.
    expect(edit('mindmap\n  root\n    a\n', { kind: 'rename', index: 1, text: 'f(x)' })).toBe('mindmap\n  root\n    (-"f(x)"-)\n');
    expect(edit('mindmap\n  root\n    a\n', { kind: 'rename', index: 1, text: '2*3 #59; <b>' })).toBe(
      'mindmap\n  root\n    2#42;3 #35;59; #lt;b>\n',
    );
    expect(edit('mindmap\n  root\n    a[x]\n', { kind: 'rename', index: 1, text: '' })).toBe('mindmap\n  root\n    a[" "]\n');
  });

  it('rename with markdown writes bold / italic for mermaid to render', async () => {
    const out = edit('mindmap\n  root\n    a[x]\n', { kind: 'rename', index: 1, text: '**Big** *idea* 2\\*3 "q"', markdown: true });
    expect(out).toBe('mindmap\n  root\n    a[**Big** *idea* 2\\*3 #quot;q#quot;]\n');
    const n = model(out).nodes[1];
    expect(n.richText).toBe('**Big** *idea* 2\\*3 "q"');
    expect(await mermaidAccepts(out)).toBe(true);
    // A markdown string keeps its form; the backtick is still escaped.
    expect(edit('mindmap\n  a["`x`"]\n', { kind: 'rename', index: 0, text: '**b** `c`', markdown: true })).toBe('mindmap\n  a["`**b** #96;c#96;`"]\n');
  });

  it('shape changes swap only the delimiters', () => {
    expect(edit(SRC, { kind: 'setShape', index: 0, shape: 'hexagon' })).toBe(SRC.replace('root((Plan))', 'root{{Plan}}'));
    expect(edit(SRC, { kind: 'setShape', index: 1, shape: 'square' })).toBe(SRC.replace('    Research', '    [Research]'));
    expect(edit('mindmap\n  root\n    a["`**b**`"]\n', { kind: 'setShape', index: 1, shape: 'cloud' })).toBe(
      'mindmap\n  root\n    a)"`**b**`"(\n',
    );
    expect(edit('mindmap\n  root\n    [Box]\n', { kind: 'setShape', index: 1, shape: 'default' })).toBe('mindmap\n  root\n    Box\n');
    // An explicit id stays; a bare node can't carry one.
    expect(edit('mindmap\n  root\n    b[Box]\n', { kind: 'setShape', index: 1, shape: 'default' })).toBe(
      'mindmap\n  root\n    b(-"Box"-)\n',
    );
  });

  it('adds children and siblings with the file’s indentation', () => {
    const child = applyMindmapEdit(SRC, { kind: 'addChild', index: 3, text: 'Sketch' })!;
    expect(child.index).toBe(4);
    expect(child.source).toBe(SRC.replace('      :::urgent', '      :::urgent\n      Sketch'));
    const sib = applyMindmapEdit(SRC, { kind: 'addSibling', index: 1, text: 'Ideas', shape: 'rounded' })!;
    expect(sib.index).toBe(3);
    expect(sib.source).toBe(SRC.replace('      Papers', '      Papers\n    (Ideas)'));
    expect(edit('mindmap\n\troot\n\t\ta\n', { kind: 'addChild', index: 1, text: 'b' })).toBe('mindmap\n\troot\n\t\ta\n\t\t\tb\n');
    expect(edit('mindmap\n    root\n', { kind: 'addChild', index: 0, text: 'b' })).toBe('mindmap\n    root\n      b\n');
    expect(applyMindmapEdit(SRC, { kind: 'addSibling', index: 0, text: 'x' })).toBeNull();
    expect(edit('mindmap\n', { kind: 'addRoot', text: 'Start' })).toBe('mindmap\n  Start\n');
  });

  it('delete removes the subtree with its decorations; the root stays', () => {
    expect(edit(SRC, { kind: 'delete', index: 1 })).toBe(SRC.replace('    Research\n    ::icon(fa fa-book)\n      Papers\n', ''));
    expect(applyMindmapEdit(SRC, { kind: 'delete', index: 0 })).toBeNull();
  });

  it('indent and outdent re-indent the subtree only', () => {
    expect(edit(SRC, { kind: 'indent', index: 3 })).toBe(SRC.replace('    Design\n      :::urgent', '      Design\n        :::urgent'));
    expect(applyMindmapEdit(SRC, { kind: 'indent', index: 1 })).toBeNull();
    const out = applyMindmapEdit('mindmap\n  r\n    a\n      b\n      c\n    d\n', { kind: 'outdent', index: 2 })!;
    expect(out.source).toBe('mindmap\n  r\n    a\n      c\n    b\n    d\n');
    expect(out.index).toBe(3);
    expect(applyMindmapEdit(SRC, { kind: 'outdent', index: 1 })).toBeNull();
  });

  it('moves a subtree among its siblings, comments stay put', () => {
    const src = 'mindmap\n  r\n    a\n      a1\n    %% between\n    b\n    ::icon(x)\n';
    const up = applyMindmapEdit(src, { kind: 'moveUp', index: 3 })!;
    expect(up.source).toBe('mindmap\n  r\n    b\n    ::icon(x)\n    %% between\n    a\n      a1\n');
    expect(up.index).toBe(1);
    const down = applyMindmapEdit(src, { kind: 'moveDown', index: 1 })!;
    expect(down.source).toBe(up.source);
    expect(down.index).toBe(2);
    expect(applyMindmapEdit(src, { kind: 'moveUp', index: 1 })).toBeNull();
  });

  it('sets, changes and removes icons', () => {
    expect(edit(SRC, { kind: 'setIcon', index: 1, icon: 'fa fa-star' })).toBe(SRC.replace('fa fa-book', 'fa fa-star'));
    expect(edit(SRC, { kind: 'setIcon', index: 1, icon: '' })).toBe(SRC.replace('    ::icon(fa fa-book)\n', ''));
    expect(edit(SRC, { kind: 'setIcon', index: 4, icon: 'fa fa-hammer' })).toBe(`${SRC}\n      ::icon(fa fa-hammer)`);
  });

  it('keeps CRLF, frontmatter and init directives', () => {
    const src = '---\r\ntitle: T\r\n---\r\n%%{init: {"theme": "forest"}}%%\r\nmindmap\r\n  root\r\n    a\r\n';
    expect(edit(src, { kind: 'addChild', index: 1, text: 'b' })).toBe(src.replace('    a\r\n', '    a\r\n      b\r\n'));
    expect(edit(src, { kind: 'setTitle', title: 'New' })).toBe(src.replace('title: T', 'title: New'));
  });

  it('refuses what it cannot do', () => {
    expect(applyMindmapEdit('flowchart LR\n  A\n', { kind: 'rename', index: 0, text: 'x' })).toBeNull();
    expect(applyMindmapEdit(SRC, { kind: 'rename', index: 99, text: 'x' })).toBeNull();
    expect(applyMindmapEdit(SRC, { kind: 'addRoot', text: 'x' })).toBeNull();
  });
});

// ── Expected models ──────────────────────────────────────────────────

interface Tree {
  text: string;
  shape: MindmapShape;
  markdown: boolean;
  id: string | null;
  icon: string | null;
  classes: string[];
  children: Tree[];
}

function toTree(m: MindmapModel): Tree[] {
  const build = (i: number): Tree => {
    const n = m.nodes[i];
    return { text: n.text, shape: n.shape, markdown: n.markdown, id: n.id, icon: n.icon, classes: n.classes, children: n.children.map(build) };
  };
  return m.nodes.length ? [build(0)] : [];
}

// Flat view of a tree (preorder) for comparing: each node plus its
// parent's position.
function flat(trees: Tree[]) {
  const out: Array<Omit<Tree, 'children'> & { parent: number | null }> = [];
  const walk = (t: Tree, parent: number | null) => {
    const { children, ...rest } = t;
    const me = out.length;
    out.push({ ...rest, parent });
    children.forEach((c) => walk(c, me));
  };
  trees.forEach((t) => walk(t, null));
  return out;
}

// Node `index` (preorder) of `roots`, with its parent's child list.
function locate(roots: Tree[], index: number): { node: Tree; list: Tree[]; at: number; parentList: Tree[] | null; parentAt: number } {
  let n = 0;
  let found: ReturnType<typeof locate> | null = null;
  const walk = (list: Tree[], parentList: Tree[] | null, parentAt: number) => {
    list.forEach((t, at) => {
      if (found) return;
      if (n++ === index) found = { node: t, list, at, parentList, parentAt };
      else walk(t.children, list, at);
    });
  };
  walk(roots, null, -1);
  return found!;
}

const clone = (m: MindmapModel): Tree[] => structuredClone(toTree(m));

const TRICKY = 'Renamed "q" (x) [y] {z} #59; `b` *s* _u_ a\\b %% c & <i> x:::y';

const ADDED = (text: string, shape: MindmapShape): Tree => ({
  text,
  shape,
  markdown: false,
  id: null,
  icon: null,
  classes: [],
  children: [],
});

interface Op {
  name: string;
  edit: MindmapEdit;
  expected: (m: MindmapModel) => Tree[];
  // Inclusive line ranges the op may rewrite or remove; [] = none.
  touches: Array<[number, number]>;
}

function opsFor(m: MindmapModel, map: MindmapSourceMap): Op[] {
  const ops: Op[] = [];
  const range = (i: number): [number, number] => [map.nodes[i].line, map.nodes[i].lastLine];
  for (const n of m.nodes) {
    const i = n.index;
    const own: [number, number] = [map.nodes[i].line, map.nodes[i].endLine];
    ops.push({
      name: `rename ${i}`,
      edit: { kind: 'rename', index: i, text: TRICKY },
      expected: (x) => { const t = clone(x); locate(t, i).node.text = TRICKY; return t; },
      touches: [own],
    });
    for (const shape of ['hexagon', 'default', 'circle'] as MindmapShape[]) {
      ops.push({
        name: `shape ${i} ${shape}`,
        edit: { kind: 'setShape', index: i, shape },
        expected: (x) => { const t = clone(x); locate(t, i).node.shape = shape; return t; },
        touches: [own],
      });
    }
    ops.push({
      name: `add child ${i}`,
      edit: { kind: 'addChild', index: i, text: 'Added child', shape: 'square' },
      expected: (x) => { const t = clone(x); locate(t, i).node.children.push(ADDED('Added child', 'square')); return t; },
      touches: [],
    });
    ops.push({
      name: `icon ${i}`,
      edit: { kind: 'setIcon', index: i, icon: 'fa fa-star' },
      expected: (x) => { const t = clone(x); locate(t, i).node.icon = 'fa fa-star'; return t; },
      touches: map.nodes[i].iconLines.map((l) => [l, l] as [number, number]),
    });
    if (n.parent === null) continue;
    const p = n.parent;
    const sibs = m.nodes[p].children;
    const at = sibs.indexOf(i);
    ops.push({
      name: `add sibling ${i}`,
      edit: { kind: 'addSibling', index: i, text: TRICKY },
      expected: (x) => { const t = clone(x); const l = locate(t, i); l.list.splice(l.at + 1, 0, ADDED(TRICKY, 'default')); return t; },
      touches: [],
    });
    ops.push({
      name: `delete ${i}`,
      edit: { kind: 'delete', index: i },
      expected: (x) => { const t = clone(x); const l = locate(t, i); l.list.splice(l.at, 1); return t; },
      touches: [range(i)],
    });
    if (at > 0) {
      ops.push({
        name: `indent ${i}`,
        edit: { kind: 'indent', index: i },
        expected: (x) => { const t = clone(x); const l = locate(t, i); l.list.splice(l.at, 1); l.list[l.at - 1].children.push(l.node); return t; },
        touches: [range(i)],
      });
      ops.push({
        name: `move up ${i}`,
        edit: { kind: 'moveUp', index: i },
        expected: (x) => { const t = clone(x); const l = locate(t, i); l.list.splice(l.at, 1); l.list.splice(l.at - 1, 0, l.node); return t; },
        touches: [[range(sibs[at - 1])[0], range(i)[1]]],
      });
    }
    if (at < sibs.length - 1) {
      ops.push({
        name: `move down ${i}`,
        edit: { kind: 'moveDown', index: i },
        expected: (x) => { const t = clone(x); const l = locate(t, i); l.list.splice(l.at, 1); l.list.splice(l.at + 1, 0, l.node); return t; },
        touches: [[range(i)[0], range(sibs[at + 1])[1]]],
      });
    }
    if (m.nodes[p].parent !== null) {
      ops.push({
        name: `outdent ${i}`,
        edit: { kind: 'outdent', index: i },
        expected: (x) => {
          const t = clone(x);
          const l = locate(t, i);
          l.list.splice(l.at, 1);
          l.parentList!.splice(l.parentAt + 1, 0, l.node);
          return t;
        },
        touches: [[range(i)[0], range(p)[1]]],
      });
    }
  }
  return ops;
}

function mindmapBlocks() {
  return corpusBlocks((b) => /^\s*mindmap\s*$/m.test(b.source), ['mermaid-corpus.md', 'mermaid-corpus-mindmap.md']);
}

describe('mindmap edits: corpus property', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false });
  });

  const blocks = mindmapBlocks();
  it('finds the mindmap corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(12);
  });

  for (const block of blocks) {
    it(`${block.heading}: every visual edit is exact, minimal and valid`, async () => {
      const parsed = parseMindmapSource(block.source);
      if (!parsed.ok) throw new Error(parsed.reason);
      const lines = parsed.map.lines;
      const ops = opsFor(parsed.model, parsed.map);
      expect(ops.length).toBeGreaterThan(parsed.model.nodes.length * 6);
      for (const op of ops) {
        const res = applyMindmapEdit(block.source, op.edit);
        expect(res, op.name).not.toBeNull();
        const out = res!.source;

        // (a) Semantically exactly the requested change.
        const back = parseMindmap(out);
        expect(back.ok, `${op.name}: own output unparseable:\n${out}`).toBe(true);
        if (!back.ok) continue;
        expect(flat(toTree(back.model)), `${op.name}:\n${out}`).toEqual(flat(op.expected(parsed.model)));

        // (b) Untouched lines are byte-identical.
        const allowed = new Set<string>();
        for (const [a, b] of op.touches) for (let k = a; k <= b; k++) allowed.add(lines[k]);
        for (const line of removedLines(block.source, out)) {
          expect(allowed.has(line), `${op.name} changed an unrelated line ${JSON.stringify(line)}:\n${out}`).toBe(true);
        }

        // (c) mermaid still accepts it.
        expect(await mermaidAccepts(out), `${op.name}:\n${out}`).toBe(true);
      }
    }, 60_000);
  }
});

// ── Typed text: mermaid accepts it and shows it as typed ─────────────

const EXTRA_INPUTS = ['**bold**', '_under_', 'a\\*b', '# heading', '1. item', '- dash', '> quote', '---', 'mindmap ideas', '::icon(x)', ':::cls', '-) x', '%%{init}%%', 'tab\there'];

async function shown(src: string): Promise<string[]> {
  mermaid.initialize({ startOnLoad: false, layout: 'dagre' } as Parameters<typeof mermaid.initialize>[0]);
  const { svg } = await mermaid.render(`mmfuzz${Math.random().toString(36).slice(2)}`, src);
  const d = new DOMParser().parseFromString(svg, 'text/html');
  return Array.from(d.querySelectorAll('g.node')).map((g) => g.textContent ?? '');
}

describe('mindmap edits: typed text', () => {
  const START = 'mindmap\n  root\n    bare\n    sq[square]\n    md["`markdown`"]\n    q("quoted")\n';
  for (const text of [...FUZZ_INPUTS, ...EXTRA_INPUTS]) {
    it(`shows ${JSON.stringify(text)} as typed`, async () => {
      let src = START;
      for (const index of [1, 2, 3, 4]) src = edit(src, { kind: 'rename', index, text });
      src = edit(src, { kind: 'addChild', index: 0, text, shape: 'cloud' });
      src = edit(src, { kind: 'addChild', index: 0, text });
      expect(await mermaidAccepts(src), src).toBe(true);
      // An empty text is written as one space; mermaid shows nothing.
      const want = text === '' ? ' ' : text;
      const m = model(src);
      expect(m.nodes.slice(1).map((n) => n.text), src).toEqual(new Array(6).fill(want));
      const labels = await shown(src);
      expect(labels.slice(1), src).toEqual(new Array(6).fill(text === '' ? '' : text));
    });
  }
});
