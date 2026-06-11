// Validates serializer output against the REAL mermaid parser. The
// parser/serializer unit suites prove the pair agree with each other;
// this suite proves the emitted source is accepted by mermaid itself,
// so popover edits can never commit source that renders as an error
// box. Regression net for three confirmed mismatches with mermaid 11:
//   - empty labels emitted as `A[]` (mermaid rejects; `A[" "]` is fine)
//   - the `""` quote escape (mermaid rejects; it wants `#quot;`)
//   - raw `|` in edge labels (mermaid rejects; quote-wrapping is fine)
import { describe, it, expect } from 'vitest';
import mermaid from 'mermaid';
import {
  emptyGraph,
  addNode,
  addEdge,
  type MermaidShape,
} from '../../../src/lib/editor/mermaid-graph';
import { serializeMermaid } from '../../../src/lib/editor/mermaid-serializer';
import { parseMermaid } from '../../../src/lib/editor/mermaid-parser';

mermaid.initialize({ startOnLoad: false });

async function expectMermaidAccepts(source: string): Promise<void> {
  // mermaid.parse rejects on source its grammar can't handle.
  await expect(
    mermaid.parse(source),
    `mermaid rejected serializer output:\n${source}`,
  ).resolves.toBeTruthy();
}

const ALL_SHAPES: MermaidShape[] = [
  'rect',
  'rounded',
  'circle',
  'diamond',
  'hexagon',
  'cylinder',
  'stadium',
  'parallelogram',
];

describe('mermaid accepts serializer output', () => {
  it('accepts a fresh node with an empty label (the "+ Add first shape" path)', async () => {
    const { graph } = addNode(emptyGraph(), { shape: 'rect', label: '' });
    await expectMermaidAccepts(serializeMermaid(graph));
  });

  it('accepts empty labels for every shape', async () => {
    let g = emptyGraph();
    for (const shape of ALL_SHAPES) {
      g = addNode(g, { shape, label: '' }).graph;
    }
    await expectMermaidAccepts(serializeMermaid(g));
  });

  it('accepts node labels containing double quotes', async () => {
    const { graph } = addNode(emptyGraph(), {
      shape: 'rect',
      label: 'say "hi" there',
    });
    await expectMermaidAccepts(serializeMermaid(graph));
  });

  it('accepts node labels containing brackets, braces and pipes', async () => {
    let g = addNode(emptyGraph(), {
      shape: 'rect',
      label: 'a [b] {c} (d)',
    }).graph;
    g = addNode(g, { shape: 'diamond', label: 'x|y' }).graph;
    await expectMermaidAccepts(serializeMermaid(g));
  });

  it('accepts edge labels containing pipes', async () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' });
    g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' });
    g = b.graph;
    g = addEdge(g, { from: a.id, to: b.id, label: 'yes|no' });
    await expectMermaidAccepts(serializeMermaid(g));
  });

  it('accepts edge labels containing double quotes', async () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' });
    g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' });
    g = b.graph;
    g = addEdge(g, { from: a.id, to: b.id, label: 'say "hi"' });
    await expectMermaidAccepts(serializeMermaid(g));
  });

  it('accepts every shape and every edge style with plain labels', async () => {
    let g = emptyGraph();
    const ids: string[] = [];
    for (const shape of ALL_SHAPES) {
      const r = addNode(g, { shape, label: `a ${shape}` });
      g = r.graph;
      ids.push(r.id);
    }
    g = addEdge(g, { from: ids[0], to: ids[1] });
    g = addEdge(g, { from: ids[1], to: ids[2], style: 'line' });
    g = addEdge(g, { from: ids[2], to: ids[3], style: 'dotted', label: 'maybe' });
    g = addEdge(g, { from: ids[3], to: ids[4], style: 'thick', label: 'yes' });
    await expectMermaidAccepts(serializeMermaid(g));
  });
});

describe('serializer output round-trips through our parser', () => {
  it('preserves node labels containing double quotes', () => {
    const { graph } = addNode(emptyGraph(), {
      shape: 'rect',
      label: 'say "hi" there',
    });
    const r = parseMermaid(serializeMermaid(graph));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.get('A')?.label).toBe('say "hi" there');
  });

  it('preserves edge labels containing pipes', () => {
    let g = emptyGraph();
    const a = addNode(g, { shape: 'rect', label: 'A' });
    g = a.graph;
    const b = addNode(g, { shape: 'rect', label: 'B' });
    g = b.graph;
    g = addEdge(g, { from: a.id, to: b.id, label: 'yes|no' });
    const r = parseMermaid(serializeMermaid(g));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.edges[0]?.label).toBe('yes|no');
  });

  it('normalizes an empty node label to a single space', () => {
    // Mermaid rejects `A[]`, so empty labels are emitted as `A[" "]` —
    // the label intentionally becomes ' ' after one round trip.
    const { graph } = addNode(emptyGraph(), { shape: 'rect', label: '' });
    const r = parseMermaid(serializeMermaid(graph));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.graph.nodes.get('A')?.label).toBe(' ');
  });
});
