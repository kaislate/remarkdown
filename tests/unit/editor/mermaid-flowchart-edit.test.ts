// Source-preserving visual edits on flowcharts. The invariant: after a
// visual edit, every source line the edit did not semantically touch
// is byte-identical — comments, %%{init}%% directives, frontmatter,
// blank lines, chain formatting, `TB` vs `TD`, `graph` vs `flowchart`,
// implicit nodes, indentation, styling.
import { describe, it, expect, beforeAll } from 'vitest';
import mermaid from 'mermaid';
import { applyFlowchartEdit, type FlowchartEdit } from '../../../src/lib/editor/mermaid-flowchart-edit';
import { parseMermaid, parseMermaidSource } from '../../../src/lib/editor/mermaid-parser';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';
import {
  addNode,
  addEdge,
  addSubgraph,
  setNodeLabel,
  setNodeShape,
  deleteNode,
  setEdgeLabel,
  setEdgeStroke,
  setEdgeEnds,
  deleteEdge,
  setDirection,
  setNodeStyle,
  setEdgeStyleProp,
  setSubgraphTitle,
  setNodeGroup,
  ungroupSubgraph,
  type MermaidGraph,
} from '../../../src/lib/editor/mermaid-graph';
import { corpusBlocks, mentions, removedLines } from './mermaid-test-utils';

// jsdom has no SVG layout; mermaid.render needs these two.
(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(SVGElement.prototype as unknown as Record<string, unknown>).getComputedTextLength = () => 10;

function edit(src: string, e: FlowchartEdit): string {
  const r = applyFlowchartEdit(src, e);
  if (!r) throw new Error('edit refused');
  return r.source;
}

function graphOf(src: string): MermaidGraph {
  const r = parseMermaid(src);
  if (!r.ok) throw new Error(`unparseable:\n${src}\n${r.reason}`);
  return r.graph;
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
    expect(edit(src, { kind: 'addEdge', from: 'B', to: 'A' })).toBe('flowchart LR\r\n    A --> B\r\n    B --> A\r\n    %% c\r\n');
    expect(edit(src, { kind: 'deleteEdge', index: 0 })).toBe('flowchart LR\r\n    A\r\n    B\r\n    %% c\r\n');
  });

  it('gives an implicit node a definition where it first appears', () => {
    expect(edit('flowchart LR\n  A --> B\n  B --> C\n', { kind: 'setNodeLabel', id: 'B', label: 'Bee' })).toBe(
      'flowchart LR\n  A --> B[Bee]\n  B --> C\n',
    );
  });

  it('edits the LAST definition of a node defined twice (the one mermaid shows)', () => {
    const src = 'flowchart TD\nA[First] --> B\nA(Second)\n';
    expect(edit(src, { kind: 'setNodeLabel', id: 'A', label: 'Third' })).toBe('flowchart TD\nA[First] --> B\nA(Third)\n');
    expect(edit(src, { kind: 'setNodeShape', id: 'A', shape: 'diamond' })).toBe('flowchart TD\nA[First] --> B\nA{Second}\n');
  });

  it('changes one link inside a chain without touching the rest of the line', () => {
    const src = 'flowchart LR\n    A[Input] --> B(Process) --> C[Output]\n';
    expect(edit(src, { kind: 'setEdgeStroke', index: 1, stroke: 'thick' })).toBe(
      'flowchart LR\n    A[Input] --> B(Process) ==> C[Output]\n',
    );
    expect(edit(src, { kind: 'setEdgeEnds', index: 0, ends: 'circle' })).toBe(
      'flowchart LR\n    A[Input] --o B(Process) --> C[Output]\n',
    );
    expect(edit(src, { kind: 'setEdgeLabel', index: 0, label: 'a|b' })).toBe(
      'flowchart LR\n    A[Input] -->|"a|b"| B(Process) --> C[Output]\n',
    );
    expect(edit('flowchart LR\nA -->|old| B\n', { kind: 'setEdgeLabel', index: 0, label: '' })).toBe('flowchart LR\nA --> B\n');
  });

  it('every link kind can be written', () => {
    const src = 'flowchart LR\nA --> B\n';
    const cases: Array<[FlowchartEdit, string]> = [
      [{ kind: 'setEdgeEnds', index: 0, ends: 'none' }, 'A --- B'],
      [{ kind: 'setEdgeEnds', index: 0, ends: 'cross' }, 'A --x B'],
      [{ kind: 'setEdgeEnds', index: 0, ends: 'both-arrow' }, 'A <--> B'],
      [{ kind: 'setEdgeEnds', index: 0, ends: 'both-circle' }, 'A o--o B'],
      [{ kind: 'setEdgeEnds', index: 0, ends: 'both-cross' }, 'A x--x B'],
      [{ kind: 'setEdgeStroke', index: 0, stroke: 'dotted' }, 'A -.-> B'],
      [{ kind: 'setEdgeStroke', index: 0, stroke: 'invisible' }, 'A ~~~ B'],
    ];
    for (const [e, line] of cases) expect(edit(src, e)).toBe(`flowchart LR\n${line}\n`);
    // Length survives a change of kind.
    expect(edit('flowchart LR\nA ----> B\n', { kind: 'setEdgeStroke', index: 0, stroke: 'thick' })).toBe('flowchart LR\nA ====> B\n');
    // An inline label survives as a pipe label.
    expect(edit('flowchart LR\nA -- yes --> B\n', { kind: 'setEdgeStroke', index: 0, stroke: 'dotted' })).toBe(
      'flowchart LR\nA -.->|yes| B\n',
    );
    // A named edge keeps its name.
    expect(edit('flowchart LR\nA e1@--> B\n', { kind: 'setEdgeEnds', index: 0, ends: 'none' })).toBe('flowchart LR\nA e1@--- B\n');
  });

  it('the legacy graph keyword is edited like flowchart and stays graph', () => {
    const src = 'graph TD;\n    A-->B;\n    A-->C;\n';
    expect(edit(src, { kind: 'setNodeLabel', id: 'C', label: 'Sea' })).toBe('graph TD;\n    A-->C[Sea];\n    A-->B;\n'.replace('A-->C[Sea];\n    A-->B;', 'A-->B;\n    A-->C[Sea];'));
    expect(edit(src, { kind: 'setDirection', direction: 'LR' })).toBe('graph LR;\n    A-->B;\n    A-->C;\n');
    expect(edit('graph\n  A --> B\n', { kind: 'setDirection', direction: 'LR' })).toBe('graph LR\n  A --> B\n');
    expect(edit('graph TD;A-->B;B-->C', { kind: 'deleteNode', id: 'C' })).toBe('graph TD;A-->B');
  });

  it('deleting an edge inside a chain rewrites only that line', () => {
    const src = 'flowchart LR\n    %% keep\n    A[Input] --> B(Process) --> C[Output]\n    C --> D\n';
    expect(edit(src, { kind: 'deleteEdge', index: 0 })).toBe(
      'flowchart LR\n    %% keep\n    A[Input]\n    B(Process) --> C[Output]\n    C --> D\n',
    );
  });

  it('deleting an edge drops a leftover bare reference only when the node appears earlier', () => {
    expect(edit('flowchart TD\nA[One]\nB[Two]\nA --> B\n', { kind: 'deleteEdge', index: 0 })).toBe('flowchart TD\nA[One]\nB[Two]\n');
    expect(edit('flowchart TD\nA --> B\n', { kind: 'deleteEdge', index: 0 })).toBe('flowchart TD\nA\nB\n');
  });

  it('deleting a node removes its lines and splits chains around it', () => {
    const src = 'flowchart LR\n    A[Input] --> B(Process) --> C[Output]\n    B --> D\n    %% end\n';
    expect(edit(src, { kind: 'deleteNode', id: 'B' })).toBe('flowchart LR\n    A[Input]\n    C[Output]\n    D\n    %% end\n');
    expect(edit('flowchart TD\n    A[First]\n    B[Second]\n    A --> B\n', { kind: 'deleteNode', id: 'A' })).toBe(
      'flowchart TD\n    B[Second]\n',
    );
  });

  it('fans (&): deleting a member keeps the rest; editing one edge splits just that link', () => {
    const src = 'flowchart LR\n    a & b --> c & d\n    %% x\n';
    expect(edit(src, { kind: 'deleteNode', id: 'b' })).toBe('flowchart LR\n    a --> c & d\n    %% x\n');
    expect(edit(src, { kind: 'setEdgeLabel', index: 1, label: 'yes' })).toBe(
      'flowchart LR\n    a & b\n    a --> c\n    a -->|yes| d\n    b --> c\n    b --> d\n    c & d\n    %% x\n',
    );
    expect(edit(src, { kind: 'deleteEdge', index: 2 })).toBe(
      'flowchart LR\n    a & b\n    a --> c\n    a --> d\n    b --> d\n    c & d\n    %% x\n',
    );
  });

  it('every shape can be chosen; the label keeps its exact bytes', () => {
    const src = 'flowchart TD\nA["#copy; 2024"]\n';
    const want: Record<string, string> = {
      rect: 'A["#copy; 2024"]', rounded: 'A("#copy; 2024")', stadium: 'A(["#copy; 2024"])', subroutine: 'A[["#copy; 2024"]]',
      cylinder: 'A[("#copy; 2024")]', circle: 'A(("#copy; 2024"))', doubleCircle: 'A((("#copy; 2024")))',
      asymmetric: 'A>"#copy; 2024"]', diamond: 'A{"#copy; 2024"}', hexagon: 'A{{"#copy; 2024"}}',
      parallelogram: 'A[/"#copy; 2024"/]', parallelogramAlt: 'A[\\"#copy; 2024"\\]', trapezoid: 'A[/"#copy; 2024"\\]',
      trapezoidAlt: 'A[\\"#copy; 2024"/]',
    };
    for (const [shape, text] of Object.entries(want)) {
      expect(edit(src, { kind: 'setNodeShape', id: 'A', shape: shape as never })).toBe(`flowchart TD\n${text}\n`);
    }
    // v11 `@{}` nodes keep their form.
    expect(edit('flowchart LR\nA@{ shape: cyl, label: "DB" }\n', { kind: 'setNodeShape', id: 'A', shape: 'diamond' })).toBe(
      'flowchart LR\nA@{ shape: diam, label: "DB" }\n',
    );
    expect(edit('flowchart LR\nA@{ shape: cyl, label: "DB" }\n', { kind: 'setNodeLabel', id: 'A', label: 'Orders' })).toBe(
      'flowchart LR\nA@{ shape: cyl, label: "Orders" }\n',
    );
  });

  it('markdown labels: bold / italic are written as a markdown string, plain text as plain', () => {
    const src = 'flowchart LR\n    A["`**Bold** label`"] --> B[Plain]\n';
    expect(edit(src, { kind: 'setNodeLabel', id: 'B', label: 'Now *italic*', markdown: true })).toBe(
      'flowchart LR\n    A["`**Bold** label`"] --> B["`Now *italic*`"]\n',
    );
    expect(edit(src, { kind: 'setNodeLabel', id: 'A', label: 'Plain again' })).toBe('flowchart LR\n    A[Plain again] --> B[Plain]\n');
    const g = graphOf(edit(src, { kind: 'setEdgeLabel', index: 0, label: '**yes**', markdown: true }));
    expect(g.edges[0]).toMatchObject({ label: '**yes**', markdown: true });
    // A line break in a plain label is mermaid's <br>.
    expect(edit(src, { kind: 'setNodeLabel', id: 'B', label: 'two\nlines' })).toBe(
      'flowchart LR\n    A["`**Bold** label`"] --> B["two<br>lines"]\n',
    );
    expect(graphOf(edit(src, { kind: 'setNodeLabel', id: 'B', label: 'two\nlines' })).nodes.get('B')?.label).toBe('two\nlines');
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

  it('typed < and & are written as entity codes; everything renders as typed', async () => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const label = 'a < b > c & d <b>bold?</b>';
    const out = edit('flowchart TD\nA[x] --> B\n', { kind: 'setNodeLabel', id: 'A', label });
    const written = out.split('\n')[1].split(' --> ')[0];
    expect(written).toBe('A["a #lt; b > c #amp; d #lt;b>bold?#lt;/b>"]');
    expect(graphOf(out).nodes.get('A')?.label).toBe(label);
    const { svg } = await mermaid.render('fcamp1', out);
    const d = new DOMParser().parseFromString(svg, 'text/html');
    expect(d.querySelector('g.node')?.textContent).toBe(label);
  });

  describe('groups (subgraphs)', () => {
    const NESTED = [
      'flowchart TB',
      '    subgraph Outer[Outer group]',
      '        direction TB',
      '        subgraph Inner1[Inner one]',
      '            a1 --> a2',
      '        end',
      '        subgraph Inner2[Inner two]',
      '            b1 --> b2',
      '        end',
      '    end',
      '    c1 --> a1',
      '    a2 --> b1',
      '    b2 --> c2',
      '    linkStyle 3 stroke:#f00',
    ].join('\n');

    it('renames a group in any title form', () => {
      expect(edit(NESTED, { kind: 'setGroupTitle', id: 'Inner1', title: 'First' })).toBe(NESTED.replace('Inner1[Inner one]', 'Inner1[First]'));
      expect(edit('flowchart TB\n  subgraph Plain\n    p1\n  end\n', { kind: 'setGroupTitle', id: 'Plain', title: 'Nice title' })).toBe(
        'flowchart TB\n  subgraph Plain [Nice title]\n    p1\n  end\n',
      );
      // Id-less groups keep their quoted form (their id comes from it).
      const quoted = 'flowchart TB\n  subgraph "Old title"\n    q1\n  end\n';
      expect(edit(quoted, { kind: 'setGroupTitle', id: 'subGraph0', title: 'New' })).toBe('flowchart TB\n  subgraph "New"\n    q1\n  end\n');
      expect(edit('flowchart TB\n  subgraph Two words\n    t\n  end\n', { kind: 'setGroupTitle', id: 'subGraph0', title: 'Three words now' })).toBe(
        'flowchart TB\n  subgraph "Three words now"\n    t\n  end\n',
      );
    });

    it('moves a node out of its group: its statements follow the outer group, the others stay', () => {
      const out = edit(NESTED, { kind: 'setNodeGroup', id: 'a1', group: null });
      expect(out).toBe([
        'flowchart TB',
        '    subgraph Outer[Outer group]',
        '        direction TB',
        '        subgraph Inner1[Inner one]',
        '            a2',
        '        end',
        '        subgraph Inner2[Inner two]',
        '            b1 --> b2',
        '        end',
        '    end',
        '    a1 --> a2',
        '    c1 --> a1',
        '    a2 --> b1',
        '    b2 --> c2',
        // The edge order changed (a1 --> a2 is now after b1 --> b2):
        // the styled edge keeps its colour under its new index.
        '    linkStyle 3 stroke:#f00',
      ].join('\n'));
      const g = graphOf(out);
      expect(g.groupOf.get('a1')).toBeUndefined();
      expect(g.groupOf.get('a2')).toBe('Inner1');
      expect(g.edgeStyles.get(3)).toEqual([{ name: 'stroke', value: '#f00' }]);
      expect(g.edges[3]).toMatchObject({ from: 'a2', to: 'b1' });
    });

    it('moves a node into a group', () => {
      const out = edit(NESTED, { kind: 'setNodeGroup', id: 'c2', group: 'Inner2' });
      expect(out).toBe(NESTED.replace('            b1 --> b2\n', '            b1 --> b2\n            c2\n'));
      expect(graphOf(out).groupOf.get('c2')).toBe('Inner2');
    });

    it('adds a group around a node, and ungroups keeping the nodes', () => {
      const r = applyFlowchartEdit(NESTED, { kind: 'addGroup', title: 'Ends', members: ['c2'] })!;
      expect(r.id).toBe('group1');
      expect(r.source).toBe(NESTED.replace('    linkStyle 3 stroke:#f00', '    linkStyle 3 stroke:#f00\n    subgraph group1 [Ends]\n        c2\n    end'));
      expect(graphOf(r.source).groupOf.get('c2')).toBe('group1');
      const un = edit(NESTED, { kind: 'ungroup', id: 'Inner1' });
      expect(un).toBe(NESTED.replace('        subgraph Inner1[Inner one]\n', '').replace('            a1 --> a2\n        end\n', '            a1 --> a2\n'));
      const g = graphOf(un);
      expect(g.subgraphs.has('Inner1')).toBe(false);
      expect(g.groupOf.get('a1')).toBe('Outer');
    });

    it('adds a shape inside a group', () => {
      const r = applyFlowchartEdit(NESTED, { kind: 'addNode', shape: 'rounded', label: 'Inside', group: 'Inner1' })!;
      expect(r.source).toBe(NESTED.replace('            a1 --> a2\n', `            a1 --> a2\n            ${r.id}(Inside)\n`));
      expect(graphOf(r.source).groupOf.get(r.id!)).toBe('Inner1');
    });

    it('a node added from a grouped node joins its group', () => {
      const r = applyFlowchartEdit(NESTED, { kind: 'addNode', shape: 'rect', label: 'More', connectFrom: 'b2' })!;
      const g = graphOf(r.source);
      expect(g.groupOf.get(r.id!)).toBe('Inner2');
      expect(g.edges[g.edges.length - 1]).toEqual({ from: 'b2', to: r.id });
      expect(g.edgeStyles.get(3)).toEqual([{ name: 'stroke', value: '#f00' }]);
    });
  });

  describe('colours', () => {
    it('node colours write, update and clear one style statement', () => {
      const src = 'flowchart LR\n  A --> B\n';
      const one = edit(src, { kind: 'setNodeColor', id: 'A', prop: 'fill', value: '#fde68a' });
      expect(one).toBe('flowchart LR\n  A --> B\n  style A fill:#fde68a\n');
      const two = edit(one, { kind: 'setNodeColor', id: 'A', prop: 'stroke', value: '#dc2626' });
      expect(two).toBe('flowchart LR\n  A --> B\n  style A fill:#fde68a,stroke:#dc2626\n');
      expect(edit(two, { kind: 'setNodeColor', id: 'A', prop: 'fill', value: '#bfdbfe' })).toBe('flowchart LR\n  A --> B\n  style A fill:#bfdbfe,stroke:#dc2626\n');
      expect(edit(edit(two, { kind: 'setNodeColor', id: 'A', prop: 'fill', value: null }), { kind: 'setNodeColor', id: 'A', prop: 'stroke', value: null })).toBe(src);
    });

    it('edge colours use linkStyle; a shared statement keeps the other edges', () => {
      const src = 'flowchart LR\n  A --> B --> C\n  linkStyle 0,1 stroke:#9333ea\n';
      const out = edit(src, { kind: 'setEdgeColor', index: 1, prop: 'stroke', value: '#16a34a' });
      expect(out).toBe('flowchart LR\n  A --> B --> C\n  linkStyle 0 stroke:#9333ea\n  linkStyle 1 stroke:#16a34a\n');
      const g = graphOf(out);
      expect(g.edgeStyles.get(0)).toEqual([{ name: 'stroke', value: '#9333ea' }]);
      expect(g.edgeStyles.get(1)).toEqual([{ name: 'stroke', value: '#16a34a' }]);
      expect(edit(out, { kind: 'setEdgeColor', index: 1, prop: 'stroke', value: null })).toBe('flowchart LR\n  A --> B --> C\n  linkStyle 0 stroke:#9333ea\n');
    });

    it('deleting an edge renumbers linkStyle so every other edge keeps its colour', () => {
      const src = 'flowchart LR\n  A --> B\n  B --> C\n  C --> D\n  linkStyle 0 stroke:red\n  linkStyle 2 stroke:blue\n';
      // (C first appears in the cut statement, so it stays mentioned there.)
      expect(edit(src, { kind: 'deleteEdge', index: 1 })).toBe('flowchart LR\n  A --> B\n  C\n  C --> D\n  linkStyle 0 stroke:red\n  linkStyle 1 stroke:blue\n');
      expect(edit(src, { kind: 'deleteEdge', index: 0 })).toBe('flowchart LR\n  A\n  B\n  B --> C\n  C --> D\n  linkStyle 1 stroke:blue\n');
    });

    it('deleting a node takes its style, class and click lines with it', () => {
      const src = 'flowchart LR\n  A --> B\n  style A fill:#f00\n  class A,B hot\n  click A "https://x"\n';
      expect(edit(src, { kind: 'deleteNode', id: 'A' })).toBe('flowchart LR\n  B\n  class B hot\n');
    });
  });

  it('frontmatter is left alone', () => {
    const src = '---\ntitle: Flow\n---\nflowchart LR\n    A[Frontmatter] --> B[Title above]\n';
    expect(edit(src, { kind: 'setNodeLabel', id: 'B', label: 'Below' })).toBe(src.replace('Title above', 'Below'));
  });

  it('refuses edits naming things that do not exist', () => {
    expect(applyFlowchartEdit('flowchart TD\n  A\n', { kind: 'setNodeLabel', id: 'Nope', label: 'x' })).toBeNull();
    expect(applyFlowchartEdit('flowchart TD\n  A\n', { kind: 'setNodeGroup', id: 'A', group: 'Nope' })).toBeNull();
    expect(applyFlowchartEdit('notflow\n', { kind: 'setNodeLabel', id: 'A', label: 'x' })).toBeNull();
  });
});

// ── Property test over the corpora ───────────────────────────────────

const BLOCKS = [
  ...corpusBlocks((b) => detectDiagramType(b.source) === 'flowchart' && parseMermaid(b.source).ok),
  ...corpusBlocks((b) => detectDiagramType(b.source) === 'flowchart', ['mermaid-corpus-flowchart.md']),
];

const TRICKY = 'Renamed "q" [x] #59; `b` ; | end';

interface Op {
  name: string;
  edit: FlowchartEdit;
  expected: (g: MermaidGraph) => MermaidGraph;
  // Ids whose lines may change; 'directive' = the header / direction
  // lines; plus linkStyle lines when edges go or move.
  touches: string[] | 'directive' | 'none';
  linkStyles?: boolean;
  // Lines other than those mentioning `touches` the op may rewrite.
  lines?: RegExp;
  // Node order may change (a node joins a group via a line in its block).
  anyNodeOrder?: boolean;
  // Edge order may change (statements move out of a group's block).
  anyEdgeOrder?: boolean;
}

function opsFor(g: MermaidGraph, src: string): Op[] {
  const ops: Op[] = [];
  const ids = Array.from(g.nodes.keys());
  const { map } = parseMermaidSource(src) as Extract<ReturnType<typeof parseMermaidSource>, { ok: true }>;
  const attrNode = (id: string) =>
    (map.nodeTokens.get(id) ?? []).some((r) => {
      const st = map.statements[r.stmt];
      return st.kind === 'chain' && st.tokens[r.token].kind === 'vertex' && !!(st.tokens[r.token] as { attrs?: unknown }).attrs;
    });
  for (const id of ids) {
    if (!attrNode(id)) {
      ops.push({ name: `label ${id}`, edit: { kind: 'setNodeLabel', id, label: TRICKY }, expected: (x) => setNodeLabel(x, id, TRICKY), touches: [id] });
      ops.push({
        name: `bold label ${id}`,
        edit: { kind: 'setNodeLabel', id, label: '**Bold** and *it*', markdown: true },
        expected: (x) => setNodeLabel(x, id, '**Bold** and *it*', true),
        touches: [id],
      });
    }
    for (const shape of ['hexagon', 'trapezoidAlt', 'doubleCircle'] as const) {
      ops.push({ name: `shape ${shape} ${id}`, edit: { kind: 'setNodeShape', id, shape }, expected: (x) => setNodeShape(x, id, shape), touches: [id] });
    }
    // A removed named edge's `e1@{…}` line goes too.
    const namedEdges = g.edges.filter((e) => (e.from === id || e.to === id) && e.id).map((e) => e.id!);
    ops.push({ name: `delete ${id}`, edit: { kind: 'deleteNode', id }, expected: (x) => deleteNode(x, id), touches: [id, ...namedEdges], linkStyles: true });
    ops.push({
      name: `fill ${id}`,
      edit: { kind: 'setNodeColor', id, prop: 'fill', value: '#fde68a' },
      expected: (x) => setNodeStyle(x, id, 'fill', '#fde68a'),
      touches: [id],
    });
    if (g.nodeStyles.get(id)?.some((p) => p.name === 'stroke')) {
      ops.push({ name: `clear stroke ${id}`, edit: { kind: 'setNodeColor', id, prop: 'stroke', value: null }, expected: (x) => setNodeStyle(x, id, 'stroke', null), touches: [id] });
    }
    ops.push({ name: `ungroup node ${id}`, edit: { kind: 'setNodeGroup', id, group: null }, expected: (x) => setNodeGroup(x, id, null), touches: [id], linkStyles: true, anyNodeOrder: true, anyEdgeOrder: true });
    for (const sg of g.subgraphs.keys()) {
      if (g.groupOf.get(id) === sg) continue;
      ops.push({ name: `move ${id} into ${sg}`, edit: { kind: 'setNodeGroup', id, group: sg }, expected: (x) => setNodeGroup(x, id, sg), touches: [id], linkStyles: true, anyNodeOrder: true, anyEdgeOrder: true });
    }
    ops.push({
      name: `new group around ${id}`,
      edit: { kind: 'addGroup', title: 'Fresh group', members: [id] },
      expected: (x) => addSubgraph(x, 'Fresh group', [id]).graph,
      touches: [id],
      linkStyles: true,
      anyNodeOrder: true,
      anyEdgeOrder: true,
    });
  }
  g.edges.forEach((e, index) => {
    const ends = [e.from, e.to];
    ops.push({ name: `edge label ${index}`, edit: { kind: 'setEdgeLabel', index, label: TRICKY }, expected: (x) => setEdgeLabel(x, index, TRICKY), touches: ends });
    ops.push({ name: `edge md label ${index}`, edit: { kind: 'setEdgeLabel', index, label: '*maybe*', markdown: true }, expected: (x) => setEdgeLabel(x, index, '*maybe*', true), touches: ends });
    ops.push({ name: `edge clear label ${index}`, edit: { kind: 'setEdgeLabel', index, label: '' }, expected: (x) => setEdgeLabel(x, index, ''), touches: ends });
    for (const stroke of ['dotted', 'thick', 'solid'] as const) {
      ops.push({ name: `edge stroke ${stroke} ${index}`, edit: { kind: 'setEdgeStroke', index, stroke }, expected: (x) => setEdgeStroke(x, index, stroke), touches: ends });
    }
    if (e.stroke !== 'invisible') {
      for (const endsKind of ['none', 'both-arrow', 'cross'] as const) {
        ops.push({ name: `edge ends ${endsKind} ${index}`, edit: { kind: 'setEdgeEnds', index, ends: endsKind }, expected: (x) => setEdgeEnds(x, index, endsKind), touches: ends });
      }
    }
    ops.push({ name: `edge delete ${index}`, edit: { kind: 'deleteEdge', index }, expected: (x) => deleteEdge(x, index), touches: e.id ? [...ends, e.id] : ends, linkStyles: true });
    ops.push({
      name: `edge colour ${index}`,
      edit: { kind: 'setEdgeColor', index, prop: 'stroke', value: '#2563eb' },
      expected: (x) => setEdgeStyleProp(x, index, 'stroke', '#2563eb'),
      touches: 'none',
      linkStyles: true,
    });
  });
  for (const [sgId, sg] of g.subgraphs) {
    ops.push({
      name: `group title ${sgId}`,
      edit: { kind: 'setGroupTitle', id: sgId, title: TRICKY },
      expected: (x) => setSubgraphTitle(x, sgId, TRICKY),
      touches: [sgId],
      lines: new RegExp(`^\\s*subgraph\\s.*${escapeRe(sg.title.split('\n')[0].slice(0, 6))}`),
    });
    ops.push({
      name: `ungroup ${sgId}`,
      edit: { kind: 'ungroup', id: sgId },
      expected: (x) => ungroupSubgraph(x, sgId),
      touches: [sgId],
      linkStyles: true,
      lines: /^\s*(subgraph\s|end\s*$|direction\s)/,
    });
  }
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
        // An empty label is written as `" "` (mermaid rejects `A[]`).
        const r = addNode(x, { shape: 'rect', label: ' ', group: x.groupOf.get(from) });
        return addEdge(r.graph, { from, to: r.id });
      },
      touches: 'none',
      anyNodeOrder: true,
    });
    ops.push({ name: 'add edge', edit: { kind: 'addEdge', from: ids[0], to: from }, expected: (x) => addEdge(x, { from: ids[0], to: from }), touches: 'none' });
  }
  const other = g.direction === 'LR' ? 'BT' : 'LR';
  ops.push({ name: `direction ${other}`, edit: { kind: 'setDirection', direction: other }, expected: (x) => setDirection(x, other), touches: 'directive' });
  return ops;
}

// Lines spanned by multi-line chain statements that mention one of `ids`.
function statementLines(source: string, ids: string[]): Set<string> {
  const r = parseMermaidSource(source);
  const out = new Set<string>();
  if (!r.ok) return out;
  for (const s of r.map.statements) {
    if (s.kind !== 'chain' || !s.tokens.some((t) => t.kind === 'vertex' && ids.includes(t.id))) continue;
    const start = source.lastIndexOf('\n', s.span.start - 1) + 1;
    const nl = source.indexOf('\n', s.span.end);
    source.slice(start, nl === -1 ? source.length : nl).split(/\r?\n/).forEach((l) => out.add(l));
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sortedEntries<V>(m: Map<string | number, V>): Array<[string | number, V]> {
  return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

// mermaid names an id-less group `subGraph<n>` after how many groups
// closed before it, so removing an earlier group renames later ones —
// compare those by title.
function normalizeGeneratedIds(g: MermaidGraph): MermaidGraph {
  const alias = new Map<string, string>();
  for (const [id, s] of g.subgraphs) if (/^subGraph\d+$/.test(id)) alias.set(id, `untitled-id:${s.title}`);
  const a = (id: string | null) => (id !== null && alias.has(id) ? alias.get(id)! : id);
  return {
    ...g,
    subgraphs: new Map([...g.subgraphs].map(([id, s]) => [a(id)!, { ...s, id: a(id)!, parent: a(s.parent) }])),
    groupOf: new Map([...g.groupOf].map(([n, grp]) => [n, a(grp)!])),
  };
}

function shape(graph: MermaidGraph, anyNodeOrder: boolean, anyEdgeOrder: boolean) {
  const g = normalizeGeneratedIds(graph);
  const sortProps = (p: Array<{ name: string; value: string }>) => [...p].sort((a, b) => a.name.localeCompare(b.name));
  // When statements move, edges keep their identity (and styles) but
  // not their index.
  const edges = anyEdgeOrder
    ? g.edges.map((e, i) => JSON.stringify({ ...e, style: sortProps(g.edgeStyles.get(i) ?? []) })).sort()
    : g.edges;
  return {
    direction: g.direction,
    nodes: anyNodeOrder ? sortedEntries(g.nodes) : [...g.nodes.entries()],
    edges,
    subgraphs: sortedEntries(g.subgraphs),
    groupOf: sortedEntries(g.groupOf),
    nodeStyles: sortedEntries(g.nodeStyles).map(([k, v]) => [k, sortProps(v)]),
    edgeStyles: anyEdgeOrder ? [] : sortedEntries(g.edgeStyles).map(([k, v]) => [k, sortProps(v)]),
  };
}

describe('flowchart edits: corpus property', () => {
  beforeAll(() => {
    mermaid.initialize({ startOnLoad: false });
  });

  it('finds editable flowcharts in the corpora', () => {
    expect(BLOCKS.length).toBeGreaterThanOrEqual(38);
  });

  for (const block of BLOCKS) {
    it(`${block.heading}: every visual edit is exact, minimal and valid`, async () => {
      const g = graphOf(block.source);
      for (const op of opsFor(g, block.source)) {
        let res: ReturnType<typeof applyFlowchartEdit>;
        try {
          res = applyFlowchartEdit(block.source, op.edit);
        } catch (e) {
          throw new Error(`${op.name}: ${(e as Error).message}`);
        }
        expect(res, op.name).not.toBeNull();
        const out = res!.source;

        // (a) Semantically exactly the requested change.
        const back = parseMermaid(out);
        expect(back.ok, `${op.name}: own output unparseable:\n${out}\n${back.ok ? '' : back.reason}`).toBe(true);
        if (!back.ok) continue;
        expect(shape(back.graph, !!op.anyNodeOrder, !!op.anyEdgeOrder), `${op.name}:\n${out}`).toEqual(
          shape(op.expected(g), !!op.anyNodeOrder, !!op.anyEdgeOrder),
        );

        // (b) Untouched lines are byte-identical. A statement naming a
        // touched id is touched on every line it spans (a multi-line
        // label's continuation lines included).
        const spanned = Array.isArray(op.touches) ? statementLines(block.source, op.touches) : new Set<string>();
        for (const line of removedLines(block.source, out)) {
          const allowed =
            (op.touches === 'directive' && /^\s*(flowchart|graph)\b|^\s*direction\s/.test(line)) ||
            (Array.isArray(op.touches) && op.touches.some((id) => mentions(line, id))) ||
            spanned.has(line) ||
            (!!op.linkStyles && /^\s*linkStyle\s/.test(line)) ||
            (!!op.lines && op.lines.test(line));
          expect(allowed, `${op.name} changed an unrelated line ${JSON.stringify(line)}:\n${out}`).toBe(true);
        }

        // (c) mermaid still accepts it.
        await expect(mermaid.parse(out), `${op.name}:\n${out}`).resolves.toBeTruthy();
      }
    }, 120_000);
  }
});
