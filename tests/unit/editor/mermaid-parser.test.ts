import { describe, it, expect } from 'vitest';
import { parseMermaid } from '../../../src/lib/editor/mermaid-parser';
import { parseSequence } from '../../../src/lib/editor/mermaid-sequence-parser';
import { applyFlowchartEdit } from '../../../src/lib/editor/mermaid-flowchart-edit';
import { serializeMermaid } from '../../../src/lib/editor/mermaid-serializer';

function rt(src: string): string {
  const result = parseMermaid(src);
  if (!result.ok) throw new Error(`parse failed: ${result.reason}`);
  return serializeMermaid(result.graph);
}

describe('mermaid parser', () => {
  it('parses an empty flowchart', () => {
    const r = parseMermaid('flowchart TD\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.direction).toBe('TD');
    expect(r.graph.nodes.size).toBe(0);
    expect(r.graph.edges.length).toBe(0);
  });

  it('parses each direction', () => {
    for (const d of ['TD', 'LR', 'BT', 'RL'] as const) {
      const r = parseMermaid(`flowchart ${d}\n`);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.graph.direction).toBe(d);
    }
  });

  it('treats TB as TD (mermaid alias)', () => {
    const r = parseMermaid('flowchart TB\n');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.graph.direction).toBe('TD');
  });

  it('parses each of the four shapes', () => {
    const r = parseMermaid('flowchart TD\nA[r]\nB(o)\nC((c))\nD{d}\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.get('A')?.shape).toBe('rect');
    expect(r.graph.nodes.get('B')?.shape).toBe('rounded');
    expect(r.graph.nodes.get('C')?.shape).toBe('circle');
    expect(r.graph.nodes.get('D')?.shape).toBe('diamond');
  });

  it('parses unlabeled edges', () => {
    const r = parseMermaid('flowchart TD\nA[A]\nB[B]\nA --> B\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.edges).toEqual([{ from: 'A', to: 'B' }]);
  });

  it('parses labeled edges', () => {
    const r = parseMermaid('flowchart TD\nA[A]\nB[B]\nA -->|yes| B\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.edges).toEqual([{ from: 'A', to: 'B', label: 'yes' }]);
  });

  it('parses inline node definitions on the same line as the edge', () => {
    // mermaid allows `A[Start] --> B{Decision}` — both nodes get defined,
    // edge gets added, all in one line.
    const r = parseMermaid('flowchart TD\nA[Start] --> B{Decision}\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.get('A')?.shape).toBe('rect');
    expect(r.graph.nodes.get('A')?.label).toBe('Start');
    expect(r.graph.nodes.get('B')?.shape).toBe('diamond');
    expect(r.graph.nodes.get('B')?.label).toBe('Decision');
    expect(r.graph.edges.length).toBe(1);
  });

  it('parses chained inline edges (A[a] --> B[b] --> C[c])', () => {
    const r = parseMermaid('flowchart TD\nA[a] --> B[b] --> C[c]\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.size).toBe(3);
    expect(r.graph.edges).toEqual([
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
    ]);
  });

  it('parses bare node references (used in earlier line definitions)', () => {
    const r = parseMermaid('flowchart TD\nA[a]\nB[b]\nA --> B\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.size).toBe(2);
    expect(r.graph.edges.length).toBe(1);
  });

  it('parses quoted labels with reserved chars', () => {
    const r = parseMermaid('flowchart TD\nA["has [brackets]"]\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.get('A')?.label).toBe('has [brackets]');
  });

  it('decodes #quot; in quoted node labels', () => {
    const r = parseMermaid('flowchart TD\nA["say #quot;hi#quot;"]\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.get('A')?.label).toBe('say "hi"');
  });

  it('parses quoted edge labels (pipes allowed inside the quotes)', () => {
    const r = parseMermaid('flowchart TD\nA[a]\nB[b]\nA -->|"Yes|No"| B\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.edges[0]?.label).toBe('Yes|No');
  });

  it('decodes #quot; in quoted edge labels', () => {
    const r = parseMermaid(
      'flowchart TD\nA[a]\nB[b]\nA -->|"say #quot;hi#quot;"| B\n',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.edges[0]?.label).toBe('say "hi"');
  });

  it('skips blank lines and %% comments', () => {
    const r = parseMermaid(
      'flowchart TD\n\n%% a comment\nA[a]\n%% another\n\nB[b]\nA --> B\n',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.size).toBe(2);
  });

  it('returns ok:false for unsupported directives', () => {
    const cases = [
      'sequenceDiagram\nA->>B: hello\n',
      'classDiagram\nclass A\n',
      'stateDiagram-v2\n[*] --> A\n',
      'graph TD\nA --> B\n', // we accept `flowchart` only, not the legacy `graph` keyword (defer)
    ];
    for (const src of cases) {
      const r = parseMermaid(src);
      expect(r.ok).toBe(false);
    }
  });

  it('returns ok:false for subgraphs (deferred feature)', () => {
    const r = parseMermaid('flowchart TD\nsubgraph S\nA[a]\nend\n');
    expect(r.ok).toBe(false);
  });

  it('returns ok:false for classDef / class / click (deferred features)', () => {
    expect(parseMermaid('flowchart TD\nclassDef foo fill:#fff\n').ok).toBe(false);
    expect(parseMermaid('flowchart TD\nA[a]\nclass A foo\n').ok).toBe(false);
    expect(parseMermaid('flowchart TD\nA[a]\nclick A "https://x"\n').ok).toBe(false);
  });

  it('round-trips a representative diagram', () => {
    const src = 'flowchart TD\nA[Start]\nB{Decision}\nC(Process)\nA --> B\nB -->|yes| C\nB -->|no| A\n';
    expect(rt(src)).toBe(src);
  });
});

describe('mermaid parser — new shapes', () => {
  it('parses hexagon, cylinder, stadium, parallelogram', () => {
    const r = parseMermaid('flowchart TD\nA{{h}}\nB[(c)]\nC([s])\nD[/p/]\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.get('A')?.shape).toBe('hexagon');
    expect(r.graph.nodes.get('A')?.label).toBe('h');
    expect(r.graph.nodes.get('B')?.shape).toBe('cylinder');
    expect(r.graph.nodes.get('B')?.label).toBe('c');
    expect(r.graph.nodes.get('C')?.shape).toBe('stadium');
    expect(r.graph.nodes.get('C')?.label).toBe('s');
    expect(r.graph.nodes.get('D')?.shape).toBe('parallelogram');
    expect(r.graph.nodes.get('D')?.label).toBe('p');
  });

  it('round-trips all 8 shapes', () => {
    const src = 'flowchart TD\nA[r]\nB(o)\nC((c))\nD{d}\nE{{h}}\nF[(cy)]\nG([s])\nH[/p/]\n';
    expect(rt(src)).toBe(src);
  });

  it('does not confuse double-bracket shapes with their single-bracket prefixes', () => {
    // The order matters: `[(` must match before `[`. If we got the regex
    // priority wrong, `A[(c)]` would parse as rect with label `(c`.
    const r = parseMermaid('flowchart TD\nA[(cylinder content)]\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.get('A')?.shape).toBe('cylinder');
    expect(r.graph.nodes.get('A')?.label).toBe('cylinder content');
  });
});

describe('mermaid parser — new edge styles', () => {
  it('parses solid line (---) edges', () => {
    const r = parseMermaid('flowchart TD\nA[a]\nB[b]\nA --- B\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.edges).toEqual([{ from: 'A', to: 'B', style: 'line' }]);
  });

  it('parses dotted (-.->) edges', () => {
    const r = parseMermaid('flowchart TD\nA[a]\nB[b]\nA -.-> B\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.edges).toEqual([{ from: 'A', to: 'B', style: 'dotted' }]);
  });

  it('parses thick (==>) edges', () => {
    const r = parseMermaid('flowchart TD\nA[a]\nB[b]\nA ==> B\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.edges).toEqual([{ from: 'A', to: 'B', style: 'thick' }]);
  });

  it('parses labelled non-arrow edges', () => {
    const r = parseMermaid('flowchart TD\nA[a]\nB[b]\nA -.->|maybe| B\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.edges).toEqual([
      { from: 'A', to: 'B', label: 'maybe', style: 'dotted' },
    ]);
  });

  it('plain --> still parses as arrow style', () => {
    const r = parseMermaid('flowchart TD\nA[a]\nB[b]\nA --> B\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // arrow is the implicit default — parser should set style: 'arrow'
    // explicitly OR leave it undefined. Either is acceptable as long as
    // round-trip preserves the canonical form.
    expect(r.graph.edges[0].from).toBe('A');
    expect(r.graph.edges[0].to).toBe('B');
  });

  it('round-trips all 4 edge styles', () => {
    const src = 'flowchart TD\nA[A]\nB[B]\nA --> B\nA --- B\nA -.-> B\nA ==> B\n';
    expect(rt(src)).toBe(src);
  });

  // mermaid's flowDb overwrites a vertex's text and shape on every
  // definition, so the LAST definition is what the reader sees.
  it('uses the last definition of a node, like mermaid', () => {
    const r = parseMermaid('flowchart TD\nA[First] --> B\nA(Second)\nA --> C\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.get('A')).toEqual({ id: 'A', shape: 'rounded', label: 'Second' });
  });

  it('lets a later definition replace an implicit node', () => {
    const r = parseMermaid('flowchart TD\nA --> B\nB[Bob]\n');
    expect(r.ok && r.graph.nodes.get('B')?.label).toBe('Bob');
  });

  // Review finding: String.fromCodePoint threw a RangeError, which left
  // the edit-mode block blank (unhandled rejection in renderFromNode).
  it('keeps out-of-range numeric entities as written instead of throwing', () => {
    const r = parseMermaid('flowchart TD\nA["x #99999999; y"]\n');
    expect(r.ok && r.graph.nodes.get('A')?.label).toBe('x #99999999; y');
    const s = parseSequence('sequenceDiagram\nA->>B: x #1114112; y\n');
    expect(s.ok && s.graph.events[0].text).toBe('x #1114112; y');
  });

  // Review finding: `[/in\]` (a trapezoid, not in the subset) was read
  // as a parallelogram whose label ran on to B's `/]`, so the whole
  // line became one node — renaming A then deleted B and the edge.
  it('leaves trapezoids and labels holding shape syntax outside the subset', () => {
    for (const src of [
      'flowchart TD\nA[/in\\] --> B[/out/]\n',
      'flowchart TD\nA[\\in/] --> B\n',
      'flowchart TD\nA[\\in\\] --> B\n',
      'flowchart TD\nA(one) --> B(two)\n'.replace('A(one)', 'A(one --> X(x)'),
      'flowchart TD\nA[x] --> B{y} --> C[[z]]\n',
    ]) {
      expect(parseMermaid(src).ok, src).toBe(false);
      expect(applyFlowchartEdit(src, { kind: 'setNodeLabel', id: 'A', label: 'x' }), src).toBeNull();
    }
    // Ordinary labels with punctuation still parse.
    expect(parseMermaid('flowchart TD\nA[R&D: phase 1 / 2, done?] --> B\n').ok).toBe(true);
  });

  it('decodes mermaid entity codes in labels', () => {
    const r = parseMermaid('flowchart TD\nA["semi #59; hash #35; quote #quot; amp #amp;"]\n');
    expect(r.ok && r.graph.nodes.get('A')?.label).toBe('semi ; hash # quote " amp &');
  });
});
