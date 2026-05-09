// Pure data structures + manipulation helpers for a mermaid flowchart
// graph. The NodeView holds an instance, mutates via these functions,
// then serializes back to mermaid source on every change.
//
// Shape names match the mermaid syntax we support:
//   rect          -> A[label]
//   rounded       -> A(label)
//   circle        -> A((label))
//   diamond       -> A{label}
//   hexagon       -> A{{label}}
//   cylinder      -> A[(label)]
//   stadium       -> A([label])
//   parallelogram -> A[/label/]
//
// Edge styles map to mermaid's link variants:
//   arrow  -> A --> B   (default if style is undefined)
//   line   -> A --- B
//   dotted -> A -.-> B
//   thick  -> A ==> B
//
// Direction matches mermaid's directives:
//   TD/TB (top-down), LR (left-right), BT (bottom-up), RL (right-left)

export type MermaidShape =
  | 'rect'
  | 'rounded'
  | 'circle'
  | 'diamond'
  | 'hexagon'
  | 'cylinder'
  | 'stadium'
  | 'parallelogram';
export type EdgeStyle = 'arrow' | 'line' | 'dotted' | 'thick';
export type MermaidDirection = 'TD' | 'LR' | 'BT' | 'RL';

export interface MermaidNode {
  id: string;
  shape: MermaidShape;
  label: string;
}

export interface MermaidEdge {
  from: string;
  to: string;
  label?: string;
  style?: EdgeStyle;
}

export interface MermaidGraph {
  direction: MermaidDirection;
  nodes: Map<string, MermaidNode>;
  edges: MermaidEdge[];
}

export function emptyGraph(): MermaidGraph {
  return { direction: 'TD', nodes: new Map(), edges: [] };
}

// ID generation: A, B, ..., Z, AA, AB, ..., AZ, BA, ...
// Always picks the next id NOT currently used in the graph (so we
// don't reuse ids after a delete and accidentally collide).
function nextId(graph: MermaidGraph): string {
  for (let i = 0; ; i++) {
    const id = idFromIndex(i);
    if (!graph.nodes.has(id)) return id;
  }
}

function idFromIndex(i: number): string {
  // 0 -> A, 25 -> Z, 26 -> AA, 27 -> AB, ...
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function addNode(
  graph: MermaidGraph,
  spec: { shape: MermaidShape; label: string },
): { graph: MermaidGraph; id: string } {
  const id = nextId(graph);
  const nodes = new Map(graph.nodes);
  nodes.set(id, { id, shape: spec.shape, label: spec.label });
  return { graph: { ...graph, nodes }, id };
}

export function addEdge(graph: MermaidGraph, edge: MermaidEdge): MermaidGraph {
  return { ...graph, edges: [...graph.edges, edge] };
}

export function setNodeLabel(
  graph: MermaidGraph,
  id: string,
  label: string,
): MermaidGraph {
  const node = graph.nodes.get(id);
  if (!node) return graph;
  const nodes = new Map(graph.nodes);
  nodes.set(id, { ...node, label });
  return { ...graph, nodes };
}

export function setNodeShape(
  graph: MermaidGraph,
  id: string,
  shape: MermaidShape,
): MermaidGraph {
  const node = graph.nodes.get(id);
  if (!node) return graph;
  const nodes = new Map(graph.nodes);
  nodes.set(id, { ...node, shape });
  return { ...graph, nodes };
}

export function deleteNode(graph: MermaidGraph, id: string): MermaidGraph {
  if (!graph.nodes.has(id)) return graph;
  const nodes = new Map(graph.nodes);
  nodes.delete(id);
  // Cascade delete any edges that touch this node — orphan edges would
  // serialize as references to undefined ids, breaking mermaid render.
  const edges = graph.edges.filter((e) => e.from !== id && e.to !== id);
  return { ...graph, nodes, edges };
}

export function setEdgeLabel(
  graph: MermaidGraph,
  index: number,
  label: string,
): MermaidGraph {
  if (index < 0 || index >= graph.edges.length) return graph;
  const edges = [...graph.edges];
  edges[index] = { ...edges[index], label };
  return { ...graph, edges };
}

export function setEdgeStyle(
  graph: MermaidGraph,
  index: number,
  style: EdgeStyle,
): MermaidGraph {
  if (index < 0 || index >= graph.edges.length) return graph;
  const edges = [...graph.edges];
  edges[index] = { ...edges[index], style };
  return { ...graph, edges };
}

export function deleteEdge(graph: MermaidGraph, index: number): MermaidGraph {
  if (index < 0 || index >= graph.edges.length) return graph;
  const edges = graph.edges.filter((_, i) => i !== index);
  return { ...graph, edges };
}
