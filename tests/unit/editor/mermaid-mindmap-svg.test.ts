// Mapping between mindmap nodes and the SVG mermaid 11.14 draws for
// them, checked against SVG captured from the real app (Chromium):
// tests/fixtures/mermaid-svg/mindmap-*.svg.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMindmap, type MindmapModel } from '../../../src/lib/editor/mermaid/mindmap-parser';
import { mindmapTargetAt, mindmapElementFor } from '../../../src/lib/editor/mermaid/mindmap-svg';
import { corpusBlocks } from './mermaid-test-utils';

function loadSvg(name: string): SVGSVGElement {
  const html = readFileSync(resolve(__dirname, '../../fixtures/mermaid-svg', name), 'utf8');
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.replaceChildren(host);
  return host.querySelector('svg') as SVGSVGElement;
}

function sourceOf(heading: string): string {
  const b = corpusBlocks((x) => x.heading === heading, ['mermaid-corpus.md', 'mermaid-corpus-mindmap.md'])[0];
  if (!b) throw new Error(`no corpus block ${heading}`);
  return b.source;
}

function model(src: string): MindmapModel {
  const r = parseMindmap(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

// Label text with markdown markers and whitespace dropped.
const loose = (s: string) => s.replace(/<[^>]*>/g, '').replace(/[\s*_`]/g, '');

const FIXTURES: Array<[string, string]> = [
  ['mindmap-corpus.svg', 'mindmap'],
  ['mindmap-all-shapes.svg', 'mm-all-shapes'],
  ['mindmap-icons-classes.svg', 'mm-icons-classes'],
  ['mindmap-deep-tree.svg', 'mm-deep-tree'],
  ['mindmap-inconsistent-indent.svg', 'mm-inconsistent-indent'],
  ['mindmap-markdown-strings.svg', 'mm-markdown-strings'],
];

describe('mindmap svg mapping (real mermaid 11.14 output)', () => {
  for (const [file, heading] of FIXTURES) {
    it(`${heading}: every node maps both ways`, () => {
      const svg = loadSvg(file);
      const m = model(sourceOf(heading));
      for (const n of m.nodes) {
        const el = mindmapElementFor(svg, m, { kind: 'node', index: n.index });
        expect(el, `node ${n.index}`).not.toBeNull();
        expect(loose(el!.textContent ?? ''), `node ${n.index}`).toBe(loose(n.text));
        // A click on the label text or on the shape finds the node.
        const label = el!.querySelector('p, span, text') ?? el!;
        expect(mindmapTargetAt(label, svg, m)).toEqual({ kind: 'node', index: n.index });
        const shape = el!.querySelector('path, rect, circle, polygon') ?? el!;
        expect(mindmapTargetAt(shape, svg, m)).toEqual({ kind: 'node', index: n.index });
      }
    });
  }

  it('edges and the background are not nodes', () => {
    const svg = loadSvg('mindmap-corpus.svg');
    const m = model(sourceOf('mindmap'));
    expect(mindmapTargetAt(svg.querySelector('path.edge')!, svg, m)).toBeNull();
    expect(mindmapTargetAt(svg, svg, m)).toBeNull();
  });

  it('falls back to drawing order when the node ids are gone', () => {
    const svg = loadSvg('mindmap-deep-tree.svg');
    const m = model(sourceOf('mm-deep-tree'));
    svg.querySelectorAll('[id]').forEach((e) => {
      if (e !== svg) e.removeAttribute('id');
    });
    for (const n of m.nodes) {
      const el = mindmapElementFor(svg, m, { kind: 'node', index: n.index });
      expect(loose(el!.textContent ?? '')).toBe(loose(n.text));
      expect(mindmapTargetAt(el!, svg, m)).toEqual({ kind: 'node', index: n.index });
    }
  });

  it('ignores an svg that is not the one the model describes', () => {
    const svg = loadSvg('mindmap-corpus.svg');
    const m = model('mindmap\n  root\n    a\n');
    expect(mindmapElementFor(svg, m, { kind: 'node', index: 2 })).toBeNull();
    expect(mindmapTargetAt(svg.querySelector('g.mindmap-node:last-of-type p')!, svg, m)).toBeNull();
  });
});
