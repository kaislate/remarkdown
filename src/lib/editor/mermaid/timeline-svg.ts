// Click targets on the svg mermaid draws for a timeline.
//
// mermaid 11 (timelineRenderer.ts / timelineRendererVertical.ts) draws
// every box — section header, period, event — as a `g.timeline-node`,
// each inside its own wrapper appended to the svg root:
//   - section header: a bare <g>
//   - period:         g.taskWrapper
//   - event:          g.eventWrapper (between them: g.lineWrapper, no box)
// and the title as a bare <text> child of the svg root. The order is
// fixed: with sections, each section's header followed by its periods,
// each period followed by its events; without, just periods + events.
// Two details matter for mapping:
//   - mermaid picks a section's periods by section NAME, so two sections
//     with the same name both draw the periods of both; and once a
//     timeline has sections, periods above the first one are not drawn
//   - the boxes' ids are not reliable (the vertical renderer writes
//     `undefined-node-N`), so mapping is by document order, checked
//     against the wrapper kind and the expected count
import type { TimelineModel } from './timeline-parser';

export type TimelineTarget =
  | { kind: 'title' }
  | { kind: 'section'; index: number }
  | { kind: 'period'; index: number }
  | { kind: 'event'; period: number; index: number };

// The boxes mermaid draws for `model`, in document order.
export function timelineDrawOrder(model: TimelineModel): TimelineTarget[] {
  const out: TimelineTarget[] = [];
  const periodBoxes = (index: number) => {
    out.push({ kind: 'period', index });
    model.periods[index].events.forEach((_, e) => out.push({ kind: 'event', period: index, index: e }));
  };
  if (!model.sections.length) {
    model.periods.forEach((_, i) => periodBoxes(i));
    return out;
  }
  model.sections.forEach((s, si) => {
    out.push({ kind: 'section', index: si });
    model.periods.forEach((p, i) => {
      if (p.section !== null && model.sections[p.section].name === s.name) periodBoxes(i);
    });
  });
  return out;
}

const WRAPPER: Record<Exclude<TimelineTarget['kind'], 'title'>, (g: Element) => boolean> = {
  section: (g) => !g.getAttribute('class'),
  period: (g) => g.classList.contains('taskWrapper'),
  event: (g) => g.classList.contains('eventWrapper'),
};

// Drawn boxes zipped with what they show, or null when the svg doesn't
// match the model (a stale render).
function boxes(svg: SVGSVGElement, model: TimelineModel): Array<{ el: Element; target: TimelineTarget }> | null {
  const order = timelineDrawOrder(model);
  const nodes = Array.from(svg.querySelectorAll('g.timeline-node'));
  if (nodes.length !== order.length) return null;
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const t = order[i];
    const wrapper = nodes[i].parentElement;
    if (t.kind === 'title' || !wrapper || !WRAPPER[t.kind](wrapper)) return null;
    out.push({ el: nodes[i], target: t });
  }
  return out;
}

function titleElement(svg: SVGSVGElement): Element | null {
  return Array.from(svg.children).find((c) => c.tagName.toLowerCase() === 'text') ?? null;
}

export function timelineTargetAt(el: Element, svg: SVGSVGElement, model: TimelineModel): TimelineTarget | null {
  const title = titleElement(svg);
  if (title && model.title && (el === title || title.contains(el))) return { kind: 'title' };
  const node = el.closest('g.timeline-node');
  if (!node || !svg.contains(node)) return null;
  return boxes(svg, model)?.find((b) => b.el === node)?.target ?? null;
}

// The box to anchor a popover at (the first one, for a period drawn
// under two same-named sections); null when it isn't drawn.
export function timelineElementFor(svg: SVGSVGElement, model: TimelineModel, target: TimelineTarget): Element | null {
  if (target.kind === 'title') return model.title ? titleElement(svg) : null;
  const same = (t: TimelineTarget) =>
    t.kind === target.kind &&
    (t.kind === 'event' && target.kind === 'event'
      ? t.period === target.period && t.index === target.index
      : (t as { index: number }).index === (target as { index: number }).index);
  return boxes(svg, model)?.find((b) => same(b.target))?.el ?? null;
}
