// Mapping between kanban columns / cards and the SVG mermaid 11.14
// draws for them, checked against SVG captured from the real app
// (Chromium): tests/fixtures/mermaid-svg/kanban-*.svg.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseKanban, type KanbanModel } from '../../../src/lib/editor/mermaid/kanban-parser';
import { kanbanTargetAt, kanbanElementFor } from '../../../src/lib/editor/mermaid/kanban-svg';
import { corpusBlocks } from './mermaid-test-utils';

function loadSvg(name: string): SVGSVGElement {
  const html = readFileSync(resolve(__dirname, '../../fixtures/mermaid-svg', name), 'utf8');
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.replaceChildren(host);
  return host.querySelector('svg') as SVGSVGElement;
}

function model(heading: string): KanbanModel {
  const b = corpusBlocks((x) => x.heading === heading, ['mermaid-corpus.md', 'mermaid-corpus-kanban.md'])[0];
  const r = parseKanban(b.source);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

const loose = (s: string) => s.replace(/[\s*_`\\]/g, '');

// The card's title label (the markdown one).
const titleOf = (el: Element) => el.querySelector('.markdown-node-label') ?? el;

const FIXTURES: Array<[string, string]> = [
  ['kanban-corpus.svg', 'kanban'],
  ['kanban-docs-example.svg', 'kb-docs-example'],
  ['kanban-frontmatter.svg', 'kb-frontmatter'],
  ['kanban-empty-columns.svg', 'kb-empty-columns'],
  ['kanban-markdown-strings.svg', 'kb-markdown-strings'],
  ['kanban-odd-indent.svg', 'kb-odd-indent'],
  ['kanban-meta-label-and-numbers.svg', 'kb-meta-label-and-numbers'],
];

describe('kanban svg mapping (real mermaid 11.14 output)', () => {
  for (const [file, heading] of FIXTURES) {
    it(`${heading}: every column and card maps both ways`, () => {
      const svg = loadSvg(file);
      const m = model(heading);
      for (const c of m.columns) {
        const el = kanbanElementFor(svg, m, { kind: 'column', column: c.index });
        expect(el, `column ${c.index}`).not.toBeNull();
        expect(loose(el!.textContent ?? '')).toBe(loose(c.text));
        expect(kanbanTargetAt(el!.querySelector('p') ?? el!, svg, m)).toEqual({ kind: 'column', column: c.index });
        expect(kanbanTargetAt(el!.querySelector('rect')!, svg, m)).toEqual({ kind: 'column', column: c.index });
        for (const k of c.cards) {
          const card = kanbanElementFor(svg, m, { kind: 'card', column: c.index, card: k.position });
          expect(card, `card ${c.index}/${k.position}`).not.toBeNull();
          expect(loose(titleOf(card!).textContent ?? '')).toBe(loose(k.text));
          expect(kanbanTargetAt(titleOf(card!), svg, m)).toEqual({ kind: 'card', column: c.index, card: k.position, field: 'text' });
          expect(kanbanTargetAt(card!.querySelector('rect')!, svg, m)).toMatchObject({ kind: 'card', column: c.index, card: k.position });
        }
      }
    });
  }

  it('tells which card field was clicked (with and without ticket links)', () => {
    for (const [file, heading] of [['kanban-frontmatter.svg', 'kb-frontmatter'], ['kanban-docs-example.svg', 'kb-docs-example']]) {
      const svg = loadSvg(file);
      const m = model(heading);
      for (const c of m.columns) {
        for (const k of c.cards) {
          const card = kanbanElementFor(svg, m, { kind: 'card', column: c.index, card: k.position })!;
          const labels = Array.from(card.querySelectorAll('p'));
          for (const [field, value] of [['ticket', k.ticket], ['assigned', k.assigned]] as const) {
            if (!value) continue;
            const p = labels.find((x) => x.textContent === value && !x.closest('.markdown-node-label'))!;
            expect(kanbanTargetAt(p, svg, m), `${heading} ${field} ${value}`).toEqual({ kind: 'card', column: c.index, card: k.position, field });
          }
        }
      }
    }
  });

  it('falls back to the label text when the svg has a different number of cards', () => {
    const svg = loadSvg('kanban-corpus.svg');
    const r = parseKanban('kanban\n  Todo\n    [Run audit]\n  Doing\n    [Review findings]\n  Done\n    [Setup]\n');
    if (!r.ok) throw new Error(r.reason);
    const extra = r.model;
    // "Run audit" is still found by its text…
    const run = Array.from(svg.querySelectorAll('g.items > g.node')).find((g) => g.textContent?.includes('Run audit'))!;
    expect(kanbanTargetAt(run, svg, extra)).toMatchObject({ kind: 'card', column: 0, card: 0 });
    expect(kanbanElementFor(svg, extra, { kind: 'card', column: 0, card: 0 })).toBe(run);
    // …a card the model no longer has maps to nothing.
    const gone = Array.from(svg.querySelectorAll('g.items > g.node')).find((g) => g.textContent?.includes('Write corpus'))!;
    expect(kanbanTargetAt(gone, svg, extra)).toBeNull();
  });

  it('the background is not a target', () => {
    const svg = loadSvg('kanban-corpus.svg');
    expect(kanbanTargetAt(svg, svg, model('kanban'))).toBeNull();
  });
});
