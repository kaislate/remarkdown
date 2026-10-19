// Mapping between mindmap nodes and the SVG mermaid draws for them —
// what a click on the rendered diagram means, and which element to
// highlight for a node.
//
// mermaid 11.14 draws every node as
//   <g class="node mindmap-node section-…" id="<svgId>-node_<n>">
// where <n> is mermaid's own node number: source order, the same as
// MindmapNode.index. (The node's background <path> repeats that id —
// a known mermaid quirk — so lookups go through the `g.mindmap-node`
// group, never getElementById.) Edges are `path.edge` with data-id
// `edge_<parent>_<child>`; they are not click targets.
//
// Defensive mapping, in order:
//   1. the `node_<n>` id — trusted when the label text agrees or the
//      SVG has exactly as many nodes as the model
//   2. no ids at all (a future mermaid): drawing order, when the node
//      counts agree
//   3. the one model node whose label matches the clicked text
// Anything else — a stale SVG that doesn't fit the model — maps to
// nothing rather than to the wrong node.
import type { MindmapModel } from './mindmap-parser';

export type MindmapTarget = { kind: 'node'; index: number };

const NODE_SELECTOR = 'g.mindmap-node';

// Label text compared loosely: markdown markers, escapes and
// whitespace (all reshaped by mermaid's markdown rendering) dropped.
function loose(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/[\s*_`\\]/g, '');
}

function groupsOf(svg: SVGSVGElement): Element[] {
  return Array.from(svg.querySelectorAll(NODE_SELECTOR));
}

function idIndex(g: Element): number | null {
  const m = /node_(\d+)$/.exec(g.id);
  return m ? Number(m[1]) : null;
}

function textMatches(g: Element, model: MindmapModel, index: number): boolean {
  const n = model.nodes[index];
  return !!n && loose(g.textContent ?? '') === loose(n.text);
}

// The one model node whose text matches `g`'s, or null.
function uniqueTextMatch(g: Element, model: MindmapModel): number | null {
  const want = loose(g.textContent ?? '');
  const hits = model.nodes.filter((n) => loose(n.text) === want);
  return hits.length === 1 ? hits[0].index : null;
}

// The node a click on `el` (anything inside the diagram) is about, or
// null for edges, the background and SVGs that don't fit the model.
export function mindmapTargetAt(el: Element, svg: SVGSVGElement, model: MindmapModel): MindmapTarget | null {
  const g = el.closest(NODE_SELECTOR);
  if (!g || !svg.contains(g)) return null;
  const groups = groupsOf(svg);
  const sameCount = groups.length === model.nodes.length;
  const byId = idIndex(g);
  if (byId !== null && byId < model.nodes.length && (sameCount || textMatches(g, model, byId))) {
    return { kind: 'node', index: byId };
  }
  if (byId === null && sameCount) return { kind: 'node', index: groups.indexOf(g) };
  const byText = uniqueTextMatch(g, model);
  return byText === null ? null : { kind: 'node', index: byText };
}

// The `g` element drawn for `target`, or null.
export function mindmapElementFor(svg: SVGSVGElement, model: MindmapModel, target: MindmapTarget): SVGGElement | null {
  const n = model.nodes[target.index];
  if (!n) return null;
  const groups = groupsOf(svg);
  const sameCount = groups.length === model.nodes.length;
  const byId = groups.find((g) => idIndex(g) === target.index);
  if (byId && (sameCount || textMatches(byId, model, target.index))) return byId as SVGGElement;
  if (sameCount && groups.every((g) => idIndex(g) === null)) return groups[target.index] as SVGGElement;
  const want = loose(n.text);
  if (model.nodes.filter((x) => loose(x.text) === want).length !== 1) return null;
  const hits = groups.filter((g) => loose(g.textContent ?? '') === want);
  return hits.length === 1 ? (hits[0] as SVGGElement) : null;
}
