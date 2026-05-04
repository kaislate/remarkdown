import { describe, it, expect } from 'vitest';
import { parseMermaid } from '../../../src/lib/editor/mermaid-parser';
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
