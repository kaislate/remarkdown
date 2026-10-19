// The flowchart parser checked against mermaid's own parse of every
// flowchart in the corpora: same nodes (in order) with the same text and
// shape, same edges (in order — linkStyle indexes and edge ids depend on
// it) with the same kind, text and length, same subgraphs with the same
// titles and members, same direction.
import { describe, it, expect } from 'vitest';
import { parseMermaidSource, decodeMermaidEntities, ATTR_SHAPE_NAMES } from '../../../src/lib/editor/mermaid-parser';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';
import type { MermaidGraph, MermaidShape } from '../../../src/lib/editor/mermaid-graph';
import { corpusBlocks, mermaidDb } from './mermaid-test-utils';

const MERMAID_TYPE: Record<Exclude<MermaidShape, 'other'>, string> = {
  rect: 'square',
  rounded: 'round',
  stadium: 'stadium',
  subroutine: 'subroutine',
  cylinder: 'cylinder',
  circle: 'circle',
  doubleCircle: 'doublecircle',
  asymmetric: 'odd',
  diamond: 'diamond',
  hexagon: 'hexagon',
  parallelogram: 'lean_right',
  parallelogramAlt: 'lean_left',
  trapezoid: 'trapezoid',
  trapezoidAlt: 'inv_trapezoid',
};

const LINK_TYPE: Record<string, string> = {
  arrow: 'arrow_point',
  none: 'arrow_open',
  circle: 'arrow_circle',
  cross: 'arrow_cross',
  'both-arrow': 'double_arrow_point',
  'both-circle': 'double_arrow_circle',
  'both-cross': 'double_arrow_cross',
};

const STROKE: Record<string, string> = { solid: 'normal', dotted: 'dotted', thick: 'thick', invisible: 'invisible' };

// mermaid's db text as the editor shows it. The db holds entity codes
// in mermaid's own placeholder form (`ﬂ°quot¶ß`, `ﬂ°°59¶ß`) and `<` /
// `>` / `&` HTML-escaped; both are undone when mermaid draws the label.
function shown(text: string, markdown: boolean): string {
  if (markdown) return text.split('\n').map((l, i) => (i ? l.replace(/^\s+/, '') : l)).join('\n');
  const codes = text.replace(/ﬂ°°(\d+)¶ß/g, '#$1;').replace(/ﬂ°(\w+)¶ß/g, '#$1;');
  const html = codes.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return decodeMermaidEntities(html).replace(/<br\s*\/?>/gi, '\n');
}

const blocks = [
  ...corpusBlocks((b) => detectDiagramType(b.source) === 'flowchart' && !/^invalid-/.test(b.heading)),
  ...corpusBlocks((b) => detectDiagramType(b.source) === 'flowchart', ['mermaid-corpus-flowchart.md']),
];

describe('flowchart parser vs mermaid', () => {
  it('covers the corpora', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(35);
  });

  for (const b of blocks) {
    it(`${b.heading}: same graph as mermaid`, async () => {
      const r = parseMermaidSource(b.source);
      expect(r.ok, r.ok ? '' : r.reason).toBe(true);
      if (!r.ok) return;
      const g: MermaidGraph = r.graph;
      const { db } = await mermaidDb(b.source);

      expect(g.direction === 'TD' ? 'TB' : g.direction).toBe(db.getDirection() === 'TD' ? 'TB' : db.getDirection());

      const subgraphs = db.getSubGraphs() as Array<{ id: string; title: string; nodes: string[]; labelType: string }>;
      const sgIds = new Set(subgraphs.map((s) => s.id));
      const vertices = [...db.getVertices().values()].filter((v: { id: string }) => !sgIds.has(v.id)) as Array<{
        id: string; text: string; type?: string; labelType: string;
      }>;
      expect([...g.nodes.keys()], 'node order').toEqual(vertices.map((v) => v.id));
      for (const v of vertices) {
        const n = g.nodes.get(v.id)!;
        expect(n.label, `${v.id} label`).toBe(shown(v.text, v.labelType === 'markdown'));
        expect(!!n.markdown, `${v.id} markdown`).toBe(v.labelType === 'markdown');
        if (v.type === undefined) expect(n.shape, `${v.id} implicit shape`).toBe('rect');
        else if (n.shape === 'other') expect(Object.values(ATTR_SHAPE_NAMES).flat()).not.toContain(v.type);
        else if (MERMAID_TYPE[n.shape] !== v.type) expect(ATTR_SHAPE_NAMES[n.shape], `${v.id} shape`).toContain(v.type);
      }

      const edges = db.getEdges() as Array<{ start: string; end: string; type: string; stroke: string; text: string; length: number; id: string; labelType: string }>;
      expect(g.edges.length, 'edge count').toBe(edges.length);
      edges.forEach((e, i) => {
        const ours = g.edges[i];
        expect([ours.from, ours.to], `edge ${i} ends`).toEqual([e.start, e.end]);
        expect(LINK_TYPE[ours.ends ?? 'arrow'], `edge ${i} type`).toBe(e.type);
        expect(STROKE[ours.stroke ?? 'solid'], `edge ${i} stroke`).toBe(e.stroke);
        expect(ours.length ?? 1, `edge ${i} length`).toBe(e.length);
        expect(ours.label ?? '', `edge ${i} text`).toBe(shown(e.text, e.labelType === 'markdown'));
        if (ours.id) expect(ours.id).toBe(e.id);
      });

      expect([...g.subgraphs.keys()].sort(), 'subgraph ids').toEqual([...sgIds].sort());
      for (const s of subgraphs) {
        const ours = g.subgraphs.get(s.id)!;
        expect(ours.title, `${s.id} title`).toBe(shown(s.title, s.labelType === 'markdown'));
        const members = [
          ...[...g.groupOf].filter(([, grp]) => grp === s.id).map(([n]) => n),
          ...[...g.subgraphs.values()].filter((x) => x.parent === s.id).map((x) => x.id),
        ].sort();
        expect(members, `${s.id} members`).toEqual([...s.nodes].sort());
      }
    });
  }
});
