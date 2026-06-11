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

  it('emits each new shape correctly', () => {
    let g = emptyGraph();
    g = addNode(g, { shape: 'hexagon', label: 'h' }).graph;
    g = addNode(g, { shape: 'cylinder', label: 'c' }).graph;
    g = addNode(g, { shape: 'stadium', label: 's' }).graph;
    g = addNode(g, { shape: 'parallelogram', label: 'p' }).graph;
    expect(serializeMermaid(g)).toBe(
      'flowchart TD\nA{{h}}\nB[(c)]\nC([s])\nD[/p/]\n',
    );
  });

  it('emits each edge style correctly', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' }); g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' }); g = b.graph;
    // edge 0: default (arrow)
    g = addEdge(g, { from: a.id, to: b.id });
    // edge 1: line
    g = addEdge(g, { from: a.id, to: b.id, style: 'line' });
    // edge 2: dotted
    g = addEdge(g, { from: a.id, to: b.id, style: 'dotted' });
    // edge 3: thick
    g = addEdge(g, { from: a.id, to: b.id, style: 'thick' });
    expect(serializeMermaid(g)).toBe(
      'flowchart TD\nA[A]\nB[B]\nA --> B\nA --- B\nA -.-> B\nA ==> B\n',
    );
  });

  it('emits labelled non-arrow edges correctly', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' }); g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' }); g = b.graph;
    g = addEdge(g, { from: a.id, to: b.id, label: 'maybe', style: 'dotted' });
    expect(serializeMermaid(g)).toBe(
      'flowchart TD\nA[A]\nB[B]\nA -.->|maybe| B\n',
    );
  });

  it('emits a quoted single space for empty labels (mermaid rejects `A[]`)', () => {
    let g = emptyGraph();
    g = addNode(g, { shape: 'rect', label: '' }).graph;
    expect(serializeMermaid(g)).toBe('flowchart TD\nA[" "]\n');
  });

  it('escapes embedded double quotes as #quot; (mermaid rejects the "" escape)', () => {
    let g = emptyGraph();
    g = addNode(g, { shape: 'rect', label: 'say "hi"' }).graph;
    expect(serializeMermaid(g)).toBe(
      'flowchart TD\nA["say #quot;hi#quot;"]\n',
    );
  });

  it('quote-wraps edge labels containing reserved characters', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' }); g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' }); g = b.graph;
    g = addEdge(g, { from: a.id, to: b.id, label: 'yes|no' });
    expect(serializeMermaid(g)).toBe(
      'flowchart TD\nA[A]\nB[B]\nA -->|"yes|no"| B\n',
    );
  });

  it('does not emit explicit "arrow" style — it is the default', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' }); g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' }); g = b.graph;
    g = addEdge(g, { from: a.id, to: b.id, style: 'arrow' });
    expect(serializeMermaid(g)).toBe(
      'flowchart TD\nA[A]\nB[B]\nA --> B\n',
    );
  });
});
