// Regression (from the mermaid audit): text a user can type into the
// visual-editor popovers must serialize to source mermaid accepts AND
// round-trip back to the same text. Each case is a soft expectation so
// a failing run lists every offending input.
import { describe, it, expect } from 'vitest';
import mermaid from 'mermaid';
import { emptyGraph } from '../../../src/lib/editor/mermaid-graph';
import { serializeMermaid } from '../../../src/lib/editor/mermaid-serializer';
import { parseMermaid } from '../../../src/lib/editor/mermaid-parser';
import { emptySequenceGraph } from '../../../src/lib/editor/mermaid-sequence-graph';
import { serializeSequence } from '../../../src/lib/editor/mermaid-sequence-serializer';
import { parseSequence } from '../../../src/lib/editor/mermaid-sequence-parser';

mermaid.initialize({ startOnLoad: false });

const INPUTS = [
  '',
  'semi; colon',
  'hash # sign',
  'percent %% comment',
  'colon: here',
  'comma, here',
  'back`tick',
  'class:::x',
  'end',
  'a->b',
  'x-->>y',
  'Tom & Jerry',
  '#59; entity',
  '  padded  ',
  'pipe | bar',
  'brace {x}',
  'quote "q"',
  "apostrophe's",
  'unicode Ünï 🚀',
];

async function accepts(src: string): Promise<string | true> {
  try {
    await mermaid.parse(src);
    return true;
  } catch (e) {
    return String((e as Error).message ?? e).split('\n')[0];
  }
}

describe('popover text inputs -> serializer -> mermaid', () => {
  it('flowchart node and edge labels', async () => {
    for (const text of INPUTS) {
      const g = emptyGraph();
      g.nodes.set('A', { id: 'A', shape: 'rect', label: text });
      g.nodes.set('B', { id: 'B', shape: 'rect', label: 'B' });
      g.edges.push({ from: 'A', to: 'B', label: text });
      const src = serializeMermaid(g);
      expect.soft(await accepts(src), `flowchart rejects label ${JSON.stringify(text)}:\n${src}`).toBe(true);
      const back = parseMermaid(src);
      expect.soft(back.ok, `subset parser rejects own output for ${JSON.stringify(text)}`).toBe(true);
      if (back.ok) {
        // Empty labels: a node is written `A[" "]` (mermaid rejects
        // `A[]`), an edge simply has no label.
        expect.soft(back.graph.nodes.get('A')?.label, `node label round-trip ${JSON.stringify(text)}`).toBe(text === '' ? ' ' : text);
        expect.soft(back.graph.edges[0]?.label, `edge label round-trip ${JSON.stringify(text)}`).toBe(text === '' ? undefined : text);
      }
    }
  }, 60_000);

  it('sequence message text, note text, participant display', async () => {
    for (const text of INPUTS) {
      const g = emptySequenceGraph();
      g.participants.set('A', { id: 'A', display: text });
      g.participants.set('B', { id: 'B', display: '' });
      g.events.push({ kind: 'message', from: 'A', to: 'B', text, style: 'arrow' });
      g.events.push({ kind: 'note', participants: ['A'], position: 'over', text });
      const src = serializeSequence(g);
      expect.soft(await accepts(src), `sequence rejects text ${JSON.stringify(text)}:\n${src}`).toBe(true);
      const back = parseSequence(src);
      expect.soft(back.ok, `sequence subset parser rejects own output for ${JSON.stringify(text)}`).toBe(true);
      if (back.ok) {
        // mermaid trims whitespace around sequence text when it draws
        // it; the editor reads it back the same way.
        const shown = text.trim();
        const msg = back.graph.events.find((e) => e.kind === 'message');
        const note = back.graph.events.find((e) => e.kind === 'note');
        expect.soft(msg?.text, `message round-trip ${JSON.stringify(text)}`).toBe(shown);
        expect.soft(note?.text, `note round-trip ${JSON.stringify(text)}`).toBe(shown);
        expect.soft(back.graph.participants.get('A')?.display, `participant display round-trip ${JSON.stringify(text)}`).toBe(shown);
      }
    }
  }, 60_000);
});
