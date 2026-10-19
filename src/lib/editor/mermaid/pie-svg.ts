// Click targets on the svg mermaid draws for a pie chart.
//
// mermaid 11 (pieRenderer.ts) draws, inside one <g>:
//   - path.pieCircle      one wedge per DRAWN slice, in source order
//   - text.slice          the wedge's percentage, same order
//   - text.pieTitleText   the title
//   - g.legend            one per slice (drawn or not), in source order,
//                         holding a colour <rect> and the label <text>
// Wedges are not sorted (d3 pie with sort(null)), but slices under 1 %
// of the total get no wedge and no percentage — only a legend entry. So
// wedges map through pieDrawnSlices(model), legend entries map 1:1.
// None of these carry ids; mapping is by class and order, after checking
// the counts match the model (a stale svg maps to nothing rather than to
// the wrong slice).
import type { PieModel } from './pie-parser';

export type PieTarget = { kind: 'title' } | { kind: 'slice'; index: number };

// Indices of the slices mermaid draws a wedge for, in drawing order.
export function pieDrawnSlices(model: PieModel): number[] {
  const sum = model.slices.reduce((a, s) => a + s.value, 0);
  const out: number[] = [];
  model.slices.forEach((s, i) => {
    if (sum > 0 && (s.value / sum) * 100 >= 1) out.push(i);
  });
  return out;
}

interface PieParts {
  wedges: Element[];
  percents: Element[];
  legends: Element[];
  title: Element | null;
  drawn: number[];
}

function parts(svg: SVGSVGElement, model: PieModel): PieParts | null {
  const drawn = pieDrawnSlices(model);
  const wedges = Array.from(svg.querySelectorAll('path.pieCircle'));
  const percents = Array.from(svg.querySelectorAll('text.slice'));
  const legends = Array.from(svg.querySelectorAll('g.legend'));
  if (wedges.length !== drawn.length || legends.length !== model.slices.length) return null;
  return { wedges, percents, legends, title: svg.querySelector('text.pieTitleText'), drawn };
}

export function pieTargetAt(el: Element, svg: SVGSVGElement, model: PieModel): PieTarget | null {
  const p = parts(svg, model);
  if (!p) return null;
  if (p.title && (el === p.title || p.title.contains(el))) return { kind: 'title' };
  const legend = el.closest('g.legend');
  if (legend) {
    const i = p.legends.indexOf(legend);
    return i >= 0 ? { kind: 'slice', index: i } : null;
  }
  const wedge = el.closest('path.pieCircle');
  if (wedge) {
    const i = p.wedges.indexOf(wedge);
    return i >= 0 ? { kind: 'slice', index: p.drawn[i] } : null;
  }
  const percent = el.closest('text.slice');
  if (percent) {
    const i = p.percents.indexOf(percent);
    return i >= 0 && i < p.drawn.length ? { kind: 'slice', index: p.drawn[i] } : null;
  }
  return null;
}

// The element to anchor a popover at: the wedge, or the legend entry of
// a slice too small to have one; the title text (null when untitled).
export function pieElementFor(svg: SVGSVGElement, model: PieModel, target: PieTarget): Element | null {
  const p = parts(svg, model);
  if (!p) return null;
  if (target.kind === 'title') return model.title ? p.title : null;
  const w = p.drawn.indexOf(target.index);
  if (w >= 0) return p.wedges[w];
  return p.legends[target.index] ?? null;
}
