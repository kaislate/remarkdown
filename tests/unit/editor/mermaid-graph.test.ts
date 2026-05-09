import { describe, it, expect } from 'vitest';
import {
  emptyGraph,
  addNode,
  addEdge,
  setNodeLabel,
  setNodeShape,
  deleteNode,
  setEdgeLabel,
  deleteEdge,
} from '../../../src/lib/editor/mermaid-graph';
import { setEdgeStyle } from '../../../src/lib/editor/mermaid-graph';

describe('mermaid graph', () => {
  it('emptyGraph yields TD direction with no nodes or edges', () => {
    const g = emptyGraph();
    expect(g.direction).toBe('TD');
    expect(g.nodes.size).toBe(0);
    expect(g.edges.length).toBe(0);
  });

  it('addNode produces a fresh id and stores the node', () => {
    const g0 = emptyGraph();
    const { graph: g1, id } = addNode(g0, { shape: 'rect', label: 'Start' });
    expect(g1.nodes.size).toBe(1);
    expect(g1.nodes.get(id)?.label).toBe('Start');
    expect(g1.nodes.get(id)?.shape).toBe('rect');
  });

  it('addNode picks ids in alphabetical order: A, B, C, ..., AA, AB, ...', () => {
    let g = emptyGraph();
    const ids: string[] = [];
    for (let i = 0; i < 28; i++) {
      const r = addNode(g, { shape: 'rect', label: `n${i}` });
      g = r.graph;
      ids.push(r.id);
    }
    expect(ids[0]).toBe('A');
    expect(ids[25]).toBe('Z');
    expect(ids[26]).toBe('AA');
    expect(ids[27]).toBe('AB');
  });

  it('addEdge stores the edge', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' });
    g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' });
    g = b.graph;
    g = addEdge(g, { from: a.id, to: b.id });
    expect(g.edges).toEqual([{ from: a.id, to: b.id }]);
  });

  it('setNodeLabel updates the label without affecting other fields', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'circle', label: 'Old' });
    g = setNodeLabel(a.graph, a.id, 'New');
    expect(g.nodes.get(a.id)?.label).toBe('New');
    expect(g.nodes.get(a.id)?.shape).toBe('circle');
  });

  it('setNodeShape updates the shape without affecting the label', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'X' });
    g = setNodeShape(a.graph, a.id, 'diamond');
    expect(g.nodes.get(a.id)?.shape).toBe('diamond');
    expect(g.nodes.get(a.id)?.label).toBe('X');
  });

  it('deleteNode removes the node AND any incident edges', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' }); g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' }); g = b.graph;
    const c = addNode(g, { shape: 'rect', label: 'C' }); g = c.graph;
    g = addEdge(g, { from: a.id, to: b.id });
    g = addEdge(g, { from: b.id, to: c.id });
    g = deleteNode(g, b.id);
    expect(g.nodes.has(b.id)).toBe(false);
    expect(g.edges.length).toBe(0);
    expect(g.nodes.size).toBe(2);
  });

  it('setEdgeLabel + deleteEdge work by index', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' }); g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' }); g = b.graph;
    g = addEdge(g, { from: a.id, to: b.id });
    g = setEdgeLabel(g, 0, 'yes');
    expect(g.edges[0].label).toBe('yes');
    g = deleteEdge(g, 0);
    expect(g.edges.length).toBe(0);
  });

  it('addNode supports hexagon, cylinder, stadium, parallelogram shapes', () => {
    let g = emptyGraph();
    g = addNode(g, { shape: 'hexagon', label: 'h' }).graph;
    g = addNode(g, { shape: 'cylinder', label: 'c' }).graph;
    g = addNode(g, { shape: 'stadium', label: 's' }).graph;
    g = addNode(g, { shape: 'parallelogram', label: 'p' }).graph;
    const shapes = Array.from(g.nodes.values()).map((n) => n.shape);
    expect(shapes).toEqual(['hexagon', 'cylinder', 'stadium', 'parallelogram']);
  });

  it('setEdgeStyle changes the style attribute (default is undefined → arrow)', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' }); g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' }); g = b.graph;
    g = addEdge(g, { from: a.id, to: b.id });
    expect(g.edges[0].style).toBeUndefined();
    g = setEdgeStyle(g, 0, 'dotted');
    expect(g.edges[0].style).toBe('dotted');
  });
});
