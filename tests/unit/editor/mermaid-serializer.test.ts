import { describe, it, expect } from 'vitest';
import { emptyGraph, addNode, addEdge, setEdgeLabel } from '../../../src/lib/editor/mermaid-graph';
import { serializeMermaid } from '../../../src/lib/editor/mermaid-serializer';

describe('mermaid serializer', () => {
  it('emits the directive on an empty graph', () => {
    expect(serializeMermaid(emptyGraph())).toBe('flowchart TD\n');
  });

  it('emits a single rect node', () => {
    let g = emptyGraph();
    g = addNode(g, { shape: 'rect', label: 'Start' }).graph;
    expect(serializeMermaid(g)).toBe('flowchart TD\nA[Start]\n');
  });

  it('emits each shape correctly', () => {
    let g = emptyGraph();
    g = addNode(g, { shape: 'rect', label: 'r' }).graph;
    g = addNode(g, { shape: 'rounded', label: 'o' }).graph;
    g = addNode(g, { shape: 'circle', label: 'c' }).graph;
    g = addNode(g, { shape: 'diamond', label: 'd' }).graph;
    expect(serializeMermaid(g)).toBe(
      'flowchart TD\nA[r]\nB(o)\nC((c))\nD{d}\n',
    );
  });

  it('emits unlabeled and labeled edges', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' }); g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' }); g = b.graph;
    g = addEdge(g, { from: a.id, to: b.id });
    g = addEdge(g, { from: b.id, to: a.id });
    g = setEdgeLabel(g, 1, 'back');
    expect(serializeMermaid(g)).toBe(
      'flowchart TD\nA[A]\nB[B]\nA --> B\nB -->|back| A\n',
    );
  });

  it('honours the direction', () => {
    const g = { ...emptyGraph(), direction: 'LR' as const };
    expect(serializeMermaid(g)).toBe('flowchart LR\n');
  });

  it('escapes special characters in labels with double quotes', () => {
    // mermaid lets you wrap node labels in double quotes when they
    // contain reserved characters: A["with [brackets]"]
    let g = emptyGraph();
    g = addNode(g, { shape: 'rect', label: 'has [brackets] inside' }).graph;
    expect(serializeMermaid(g)).toBe(
      'flowchart TD\nA["has [brackets] inside"]\n',
    );
  });
});
