// Source-preserving visual edits on flowcharts. The invariant: after a
// visual edit, every source line the edit did not semantically touch
// is byte-identical — comments, %%{init}%% directives, blank lines,
// chain formatting, `TB` vs `TD`, implicit nodes, indentation.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mermaid from 'mermaid';
import { applyFlowchartEdit, type FlowchartEdit } from '../../../src/lib/editor/mermaid-flowchart-edit';
import { parseMermaid } from '../../../src/lib/editor/mermaid-parser';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';
import { parseMarkdown } from '../../../src/lib/editor/markdown';
import {
  addNode,
  addEdge,
  setNodeLabel,
  setNodeShape,
  deleteNode,
  setEdgeLabel,
  setEdgeStyle,
  deleteEdge,
  setDirection,
  type MermaidGraph,
} from '../../../src/lib/editor/mermaid-graph';

// jsdom has no SVG layout; mermaid.render needs these two.
(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(SVGElement.prototype as unknown as Record<string, unknown>).getComputedTextLength = () => 10;

function edit(src: string, e: FlowchartEdit): string {
  const r = applyFlowchartEdit(src, e);
  if (!r) throw new Error('edit refused');
  return r.source;
}

describe('flowchart edits: targeted examples', () => {
  const COMMENTED = [
    'flowchart TD',
    '    %% A comment inside an otherwise editable flowchart',
    '    A[First] --> B[Second]',
    '    %% another comment',
    '    B --> C[Third]',
  ].join('\n');

  it('a label edit rewrites only the defining token', () => {
    expect(edit(COMMENTED, { kind: 'setNodeLabel', id: 'C', label: 'Third renamed' })).toBe(
      COMMENTED.replace('C[Third]', 'C[Third renamed]'),
    );
  });

  it('keeps %%{init}%% directives, TB, and trailing newlines', () => {
    const src = '%%{init: {"theme": "forest"}}%%\nflowchart TB\n    A[Init] --> B[Forest]\n';
    expect(edit(src, { kind: 'setNodeLabel', id: 'B', label: 'Renamed' })).toBe(
      '%%{init: {"theme": "forest"}}%%\nflowchart TB\n    A[Init] --> B[Renamed]\n',
    );
  });

  it('keeps CRLF line endings', () => {
    const src = 'flowchart LR\r\n    A --> B\r\n    %% c\r\n';
    expect(edit(src, { kind: 'setNodeLabel', id: 'A', label: 'Ay' })).toBe(
      'flowchart LR\r\n    A[Ay] --> B\r\n    %% c\r\n',
    );
  });

  it('gives an implicit node a definition where it first appears', () => {
    expect(edit('flowchart LR\n  A --> B\n  B --> C\n', { kind: 'setNodeLabel', id: 'B', label: 'Bee' })).toBe(
      'flowchart LR\n  A --> B[Bee]\n  B --> C\n',
    );
  });

  it('edits the LAST definition of a node defined twice (the one mermaid shows)', () => {
    const src = 'flowchart TD\nA[First] --> B\nA(Second)\n';
    expect(edit(src, { kind: 'setNodeLabel', id: 'A', label: 'Third' })).toBe(
      'flowchart TD\nA[First] --> B\nA(Third)\n',
    );
    expect(edit(src, { kind: 'setNodeShape', id: 'A', shape: 'diamond' })).toBe(
      'flowchart TD\nA[First] --> B\nA{Second}\n',
    );
  });

  it('changes one arrow inside a chain without touching the rest of the line', () => {
    const src = 'flowchart LR\n    A[Input] --> B(Process) --> C[Output]\n';
    expect(edit(src, { kind: 'setEdgeStyle', index: 1, style: 'thick' })).toBe(
      'flowchart LR\n    A[Input] --> B(Process) ==> C[Output]\n',
    );
    expect(edit(src, { kind: 'setEdgeLabel', index: 0, label: 'a|b' })).toBe(
      'flowchart LR\n    A[Input] -->|"a|b"| B(Process) --> C[Output]\n',
    );
    expect(edit('flowchart LR\nA -->|old| B\n', { kind: 'setEdgeLabel', index: 0, label: '' })).toBe(
      'flowchart LR\nA --> B\n',
    );
  });

  it('deleting an edge inside a chain rewrites only that line', () => {
    const src = 'flowchart LR\n    %% keep\n    A[Input] --> B(Process) --> C[Output]\n    C --> D\n';
    expect(edit(src, { kind: 'deleteEdge', index: 0 })).toBe(
      'flowchart LR\n    %% keep\n    A[Input]\n    B(Process) --> C[Output]\n    C --> D\n',
    );
  });

  it('deleting an edge drops a leftover bare reference only when the node appears earlier', () => {
    const src = 'flowchart TD\nA[One]\nB[Two]\nA --> B\n';
    expect(edit(src, { kind: 'deleteEdge', index: 0 })).toBe('flowchart TD\nA[One]\nB[Two]\n');
    // Here B first appears in the deleted edge — keep it as a bare
    // statement so the node (and the node order) survive.
    expect(edit('flowchart TD\nA --> B\n', { kind: 'deleteEdge', index: 0 })).toBe('flowchart TD\nA\nB\n');
  });

  it('deleting a node removes its lines and splits chains around it', () => {
    const src = 'flowchart LR\n    A[Input] --> B(Process) --> C[Output]\n    B --> D\n    %% end\n';
    expect(edit(src, { kind: 'deleteNode', id: 'B' })).toBe(
      'flowchart LR\n    A[Input]\n    C[Output]\n    D\n    %% end\n',
    );
    const own = 'flowchart TD\n    A[First]\n    B[Second]\n    A --> B\n';
    expect(edit(own, { kind: 'deleteNode', id: 'A' })).toBe('flowchart TD\n    B[Second]\n');
  });

  it('changes only the direction keyword', () => {
    const src = '%% top\nflowchart TB\n  A --> B\n';
    expect(edit(src, { kind: 'setDirection', direction: 'LR' })).toBe('%% top\nflowchart LR\n  A --> B\n');
    // TB and TD are the same layout — picking TD on a TB chart is a no-op.
    expect(edit(src, { kind: 'setDirection', direction: 'TD' })).toBe(src);
  });

  it('appends new statements after the last statement, matching its indentation', () => {
    const src = 'flowchart TD\n    A[One] --> B[Two]\n    %% trailing comment\n';
    const added = applyFlowchartEdit(src, { kind: 'addNode', shape: 'rect', label: 'New', connectFrom: 'B' })!;
    expect(added.id).toBe('C');
    expect(added.source).toBe('flowchart TD\n    A[One] --> B[Two]\n    B --> C[New]\n    %% trailing comment\n');
    expect(edit(src, { kind: 'addEdge', from: 'B', to: 'A' })).toBe(
      'flowchart TD\n    A[One] --> B[Two]\n    B --> A\n    %% trailing comment\n',
    );
  });

  it('adds the first node to an empty chart', () => {
    const r = applyFlowchartEdit('flowchart TD\n', { kind: 'addNode', shape: 'rect', label: '' })!;
    expect(r.id).toBe('A');
    expect(r.source).toBe('flowchart TD\n    A[" "]\n');
  });

  // Review finding: a shape change re-emitted the label through the
  // encoder, rewriting bytes the user never touched.
  it('a shape change keeps the label exactly as written', () => {
    expect(edit('flowchart TD\nA["#copy; 2024"]\n', { kind: 'setNodeShape', id: 'A', shape: 'rounded' })).toBe(
      'flowchart TD\nA("#copy; 2024")\n',
    );
    expect(edit('flowchart TD\nA[x #lt;y#gt;] --> B\n', { kind: 'setNodeShape', id: 'A', shape: 'diamond' })).toBe(
      'flowchart TD\nA{x #lt;y#gt;} --> B\n',
    );
  });

  it('typed < and & are written as entity codes; everything renders as typed', async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const label = 'a < b > c & d <b>bold?</b>';
    const out = edit('flowchart TD\nA[x] --> B\n', { kind: 'setNodeLabel', id: 'A', label });
    const written = out.split('\n')[1].split(' --> ')[0];
    expect(written).toBe('A["a #lt; b > c #amp; d #lt;b>bold?#lt;/b>"]');
    const back = parseMermaid(out);
    expect(back.ok && back.graph.nodes.get('A')?.label).toBe(label);
    const { svg } = await mermaid.render('fcamp1', out);
    const d = new DOMParser().parseFromString(svg, 'text/html');
    expect(d.querySelector('g.node')?.textContent).toBe(label);
  });

  it('refuses edits on sources outside the editable subset', () => {
    expect(applyFlowchartEdit('flowchart TD\n  subgraph X\n  A\n  end\n', { kind: 'setNodeLabel', id: 'A', label: 'x' })).toBeNull();
    expect(applyFlowchartEdit('flowchart TD\n  A\n', { kind: 'setNodeLabel', id: 'Nope', label: 'x' })).toBeNull();
  });
});

// ── Property test over the corpus ────────────────────────────────────

const CORPUS = readFileSync(resolve(__dirname, '../../fixtures/mermaid-corpus.md'), 'utf8').replace(/\r\n/g, '\n');

function corpusFlowcharts(): Array<{ heading: string; source: string }> {
  const out: Array<{ heading: string; source: string }> = [];
  let heading = '';
  parseMarkdown(CORPUS).descendants((node) => {
    if (node.type.name === 'heading') heading = node.textContent;
    if (node.type.name === 'code_block' && detectDiagramType(node.textContent) === 'flowchart') {
      if (parseMermaid(node.textContent).ok) out.push({ heading, source: node.textContent });
    }
    return true;
  });
  return out;
}

const TRICKY = 'Renamed "q" [x] #59; `b` ; | end';

function opsFor(g: MermaidGraph): Array<{ name: string; edit: FlowchartEdit; expected: (g: MermaidGraph) => MermaidGraph; touches: string[] | 'directive' | 'none' }> {
  const ops: ReturnType<typeof opsFor> = [];
  const ids = Array.from(g.nodes.keys());
  for (const id of ids) {
    ops.push({ name: `label ${id}`, edit: { kind: 'setNodeLabel', id, label: TRICKY }, expected: (x) => setNodeLabel(x, id, TRICKY), touches: [id] });
    ops.push({ name: `shape ${id}`, edit: { kind: 'setNodeShape', id, shape: 'hexagon' }, expected: (x) => setNodeShape(x, id, 'hexagon'), touches: [id] });
    ops.push({ name: `delete ${id}`, edit: { kind: 'deleteNode', id }, expected: (x) => deleteNode(x, id), touches: [id] });
  }
  g.edges.forEach((e, index) => {
    const ends = [e.from, e.to];
    ops.push({ name: `edge label ${index}`, edit: { kind: 'setEdgeLabel', index, label: TRICKY }, expected: (x) => setEdgeLabel(x, index, TRICKY), touches: ends });
    ops.push({ name: `edge style ${index}`, edit: { kind: 'setEdgeStyle', index, style: 'dotted' }, expected: (x) => setEdgeStyle(x, index, 'dotted'), touches: ends });
    ops.push({ name: `edge delete ${index}`, edit: { kind: 'deleteEdge', index }, expected: (x) => deleteEdge(x, index), touches: ends });
  });
  ops.push({
    name: 'add node',
    edit: { kind: 'addNode', shape: 'stadium', label: 'Added' },
    expected: (x) => addNode(x, { shape: 'stadium', label: 'Added' }).graph,
    touches: 'none',
  });
  if (ids.length) {
    const from = ids[ids.length - 1];
    ops.push({
      name: 'add connected node',
      edit: { kind: 'addNode', shape: 'rect', label: '', connectFrom: from },
      expected: (x) => {
        // An empty label is written as `" "` (mermaid rejects `A[]`), so
        // it reads back as a single space.
        const r = addNode(x, { shape: 'rect', label: ' ' });
        return addEdge(r.graph, { from, to: r.id });
      },
      touches: 'none',
    });
    ops.push({
      name: 'add edge',
      edit: { kind: 'addEdge', from: ids[0], to: from },
      expected: (x) => addEdge(x, { from: ids[0], to: from }),
      touches: 'none',
    });
  }
  const other = g.direction === 'LR' ? 'BT' : 'LR';
  ops.push({ name: `direction ${other}`, edit: { kind: 'setDirection', direction: other }, expected: (x) => setDirection(x, other), touches: 'directive' });
  return ops;
}

// Original lines missing from the output (multiset difference, in order).
function removedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(a[i++]); else j++;
  }
  while (i < a.length) out.push(a[i++]);
  return out;
}

const mentions = (line: string, id: string) => new RegExp(`(^|[^A-Za-z0-9_])${id}([^A-Za-z0-9_]|$)`).test(line);

function graphShape(g: MermaidGraph) {
  return { direction: g.direction, nodes: Array.from(g.nodes.entries()), edges: g.edges };
}

describe('flowchart edits: corpus property', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false });
  });

  const blocks = corpusFlowcharts();
  it('finds editable flowcharts in the corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(10);
  });

  for (const block of blocks) {
    it(`${block.heading}: every visual edit is exact, minimal and valid`, async () => {
      const parsed = parseMermaid(block.source);
      if (!parsed.ok) throw new Error(parsed.reason);
      for (const op of opsFor(parsed.graph)) {
        const res = applyFlowchartEdit(block.source, op.edit);
        expect(res, op.name).not.toBeNull();
        const out = res!.source;

        // (a) Semantically exactly the requested change.
        const back = parseMermaid(out);
        expect(back.ok, `${op.name}: own output unparseable:\n${out}`).toBe(true);
        if (!back.ok) continue;
        expect(graphShape(back.graph), `${op.name}:\n${out}`).toEqual(graphShape(op.expected(parsed.graph)));

        // (b) Untouched lines are byte-identical.
        const removed = removedLines(block.source, out);
        for (const line of removed) {
          const allowed =
            op.touches === 'directive'
              ? /^\s*flowchart\s/.test(line)
              : op.touches !== 'none' && op.touches.some((id) => mentions(line, id));
          expect(allowed, `${op.name} changed an unrelated line ${JSON.stringify(line)}:\n${out}`).toBe(true);
        }

        // (c) mermaid still accepts it.
        await expect(mermaid.parse(out), `${op.name}:\n${out}`).resolves.toBeTruthy();
      }
    }, 60_000);
  }
});
