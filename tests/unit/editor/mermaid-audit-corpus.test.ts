// Regression (from the mermaid audit): every mermaid block of
// tests/fixtures/mermaid-corpus.md through the edit-mode pipeline
// without a browser. Per block:
//   - every mermaid fence spelling opens as a diagram, never raw code
//   - the whole-document markdown round-trip (parse -> serialize)
//     leaves the block's source and fence info string unchanged
//   - mermaid accepts every block except the deliberately invalid ones
//   - blocks the visual editor can edit are recognised as editable
// The per-edit guarantees (untouched lines byte-identical, result
// valid) are property-tested in mermaid-flowchart-edit.test.ts and
// mermaid-sequence-edit.test.ts over the same corpus.
// Set MERMAID_AUDIT_OUT to a path to also write a JSON report.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mermaid from 'mermaid';
import { parseMarkdown, serializeToMarkdown } from '../../../src/lib/editor/markdown';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';
import { canEditDiagram } from '../../../src/lib/editor/mermaid/controller';
import '../../../src/lib/editor/mermaid/registry';
import { isMermaidFence } from '../../../src/lib/mermaid-fence';

mermaid.initialize({ startOnLoad: false });

const CORPUS = readFileSync(
  resolve(__dirname, '../../fixtures/mermaid-corpus.md'),
  'utf8',
).replace(/\r\n/g, '\n');

interface Block { heading: string; lang: string; source: string }

// Collect code_block nodes (with nearest preceding heading) from a PM doc.
function collectBlocks(md: string): Block[] {
  const doc = parseMarkdown(md);
  const out: Block[] = [];
  let heading = '';
  doc.descendants((node) => {
    if (node.type.name === 'heading') heading = node.textContent;
    if (node.type.name === 'code_block') {
      out.push({ heading, lang: String(node.attrs.language || ''), source: node.textContent });
    }
    return true;
  });
  return out;
}

// The blocks the visual editor can't edit (yet) — everything else in
// the corpus must be editable. (Editability is the controller
// registry's own answer: mermaid/registry.ts.)
const NOT_EDITABLE = new Set([
  'journey', 'gitgraph', 'mindmap',
  'quadrant', 'sankey', 'xychart', 'block', 'c4-context', 'requirement', 'architecture',
  'kanban', 'packet', 'radar', 'invalid-diagram', 'invalid-unknown-type',
]);

describe('mermaid corpus (edit-mode pipeline)', () => {
  it('every block round-trips, routes to the diagram view and is valid mermaid', async () => {
    const before = collectBlocks(CORPUS);
    const roundTripped = serializeToMarkdown(parseMarkdown(CORPUS));
    const after = collectBlocks(roundTripped);
    const report: Record<string, unknown>[] = [];

    expect(after.length).toBe(before.length);

    for (let i = 0; i < before.length; i++) {
      const b = before[i];
      const a = after[i];
      if (!/mermaid/i.test(b.lang)) continue;
      const entry: Record<string, unknown> = { heading: b.heading, lang: b.lang };
      expect.soft(isMermaidFence(b.lang), `${b.heading}: fence "${b.lang}" must open as a diagram`).toBe(true);
      expect.soft(a?.source, `doc round-trip changed source of ${b.heading}`).toBe(b.source);
      expect.soft(a?.lang, `doc round-trip changed the fence info of ${b.heading}`).toBe(b.lang);

      const type = detectDiagramType(b.source);
      entry.detected = type;
      entry.editable = canEditDiagram(type, b.source);
      expect.soft(entry.editable, `${b.heading}: editable`).toBe(!NOT_EDITABLE.has(b.heading));

      try {
        await mermaid.parse(b.source);
        entry.valid = true;
      } catch (e) {
        entry.valid = false;
        entry.error = String((e as Error).message ?? e).split('\n')[0];
      }
      // seq-box: mermaid.parse() rejects it under jsdom even though the
      // browser renders it (the e2e regression suite checks that) — an
      // upstream quirk, not ours.
      const expectValid = !/^invalid-/.test(b.heading) && b.heading !== 'seq-box';
      expect.soft(entry.valid, `${b.heading}: mermaid validity ${entry.error ?? ''}`).toBe(expectValid);
      report.push(entry);
    }

    const out = process.env.MERMAID_AUDIT_OUT;
    if (out) writeFileSync(out, JSON.stringify({ report, roundTripped }, null, 2));
  }, 60_000);
});
