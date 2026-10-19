// Click targets on mermaid's pie svg, against svgs captured from the
// app (real browser, mermaid 11.14).
import { describe, it, expect } from 'vitest';
import { pieElementFor, pieTargetAt, pieDrawnSlices, type PieTarget } from '../../../src/lib/editor/mermaid/pie-svg';
import { parsePie, type PieModel } from '../../../src/lib/editor/mermaid/pie-parser';
import { loadSvgFixture, renderSvg } from './mermaid-oracle-utils';

function load(name: string): { svg: SVGSVGElement; model: PieModel } {
  const { svg, source } = loadSvgFixture(name);
  const r = parsePie(source);
  if (!r.ok) throw new Error(r.reason);
  return { svg, model: r.model };
}

function targets(model: PieModel): PieTarget[] {
  return [{ kind: 'title' }, ...model.slices.map((_, index) => ({ kind: 'slice' as const, index }))];
}

describe('pie svg mapping', () => {
  it('slices <1% get no wedge but keep their legend entry', () => {
    const { svg, model } = load('pie-tiny-slice');
    expect(pieDrawnSlices(model)).toEqual([0, 1, 3]);
    const paths = svg.querySelectorAll('path.pieCircle');
    expect(paths.length).toBe(3);
    // Wedges are in source order (mermaid does not sort): the third wedge is "Photos".
    expect(pieTargetAt(paths[2], svg, model)).toEqual({ kind: 'slice', index: 3 });
    expect(pieTargetAt(svg.querySelectorAll('text.slice')[2], svg, model)).toEqual({ kind: 'slice', index: 3 });
    const cacheLegend = svg.querySelectorAll('g.legend')[2];
    expect(pieTargetAt(cacheLegend.querySelector('rect')!, svg, model)).toEqual({ kind: 'slice', index: 2 });
    expect(pieTargetAt(cacheLegend.querySelector('text')!, svg, model)).toEqual({ kind: 'slice', index: 2 });
    // A tiny slice anchors at its legend entry.
    expect(pieElementFor(svg, model, { kind: 'slice', index: 2 })).toBe(cacheLegend);
  });

  it('maps the title and nothing for the background', () => {
    const { svg, model } = load('pie-comments-showdata');
    expect(pieTargetAt(svg.querySelector('.pieTitleText')!, svg, model)).toEqual({ kind: 'title' });
    expect(pieTargetAt(svg.querySelector('circle.pieOuterCircle')!, svg, model)).toBeNull();
    expect(pieTargetAt(svg, svg, model)).toBeNull();
  });

  for (const name of ['pie-tiny-slice', 'pie-comments-showdata', 'pie-duplicate-labels', 'pie-frontmatter-init']) {
    it(`${name}: every target round-trips through its element`, () => {
      const { svg, model } = load(name);
      for (const t of targets(model)) {
        const el = pieElementFor(svg, model, t);
        expect(el, JSON.stringify(t)).not.toBeNull();
        expect(pieTargetAt(el!, svg, model), JSON.stringify(t)).toEqual(t);
      }
      expect(pieElementFor(svg, model, { kind: 'slice', index: model.slices.length })).toBeNull();
    });
  }

  it('refuses an svg that does not match the model (stale render)', () => {
    const { svg, model } = load('pie-frontmatter-init');
    const stale = { ...model, slices: model.slices.slice(1) };
    expect(pieTargetAt(svg.querySelector('path.pieCircle')!, svg, stale)).toBeNull();
    expect(pieElementFor(svg, stale, { kind: 'slice', index: 0 })).toBeNull();
  });

  it('works on a fresh jsdom render too', async () => {
    const src = 'pie\n  title T\n  "a" : 1\n  "b" : 2\n';
    const svg = await renderSvg(src);
    const r = parsePie(src);
    if (!r.ok) throw new Error(r.reason);
    for (const t of targets(r.model)) expect(pieTargetAt(pieElementFor(svg, r.model, t)!, svg, r.model)).toEqual(t);
  });
});
