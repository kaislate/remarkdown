// Click targets on the svg mermaid draws for a gantt chart.
//
// mermaid 11 (ganttRenderer.js) draws:
//   - rect#<svgId>-<taskId>         a task's bar (milestones and `vert`
//                                   markers too)
//   - text#<svgId>-<taskId>-text    its label (inside or beside the bar)
//   - text.sectionTitle             one per section NAME that has tasks,
//                                   its rows (tspans) split at <br>
//   - text.titleText                the title
// <taskId> is the task's renderId (its id, or task1, task2 …), so tasks
// map by element id — mermaid draws bars sorted by start date, so their
// order says nothing. Section titles carry only a style class (cycling
// through 4), so they map by their text. The svg id is the prefix of
// every element id. Row backgrounds (rect.section) and the grid are not
// targets.
import type { GanttModel } from './gantt-parser';

export type GanttTarget = { kind: 'title' } | { kind: 'section'; index: number } | { kind: 'task'; index: number };

// renderId → task index (the last task with it, as mermaid resolves ids).
function taskIds(model: GanttModel): Map<string, number> {
  const out = new Map<string, number>();
  model.tasks.forEach((t, i) => out.set(t.renderId, i));
  return out;
}

const rowsOf = (el: Element) => {
  const spans = Array.from(el.querySelectorAll('tspan'));
  const rows = spans.length ? spans.map((s) => s.textContent ?? '') : [el.textContent ?? ''];
  return rows.map((r) => r.replace(/[ \t\n\r\f]+/g, ' ').trim()).join('\n');
};

export function ganttTargetAt(el: Element, svg: SVGSVGElement, model: GanttModel): GanttTarget | null {
  if (!svg.contains(el)) return null;
  const prefix = `${svg.id}-`;
  const ids = taskIds(model);
  for (let n: Element | null = el; n && n !== svg; n = n.parentElement) {
    const id = n.getAttribute('id');
    if (id?.startsWith(prefix)) {
      const rest = id.slice(prefix.length);
      const i = ids.get(rest) ?? (rest.endsWith('-text') ? ids.get(rest.slice(0, -5)) : undefined);
      if (i !== undefined) return { kind: 'task', index: i };
    }
  }
  const section = el.closest('text.sectionTitle');
  if (section) {
    const text = rowsOf(section);
    const i = model.sections.findIndex((s) => s.name === text);
    return i >= 0 ? { kind: 'section', index: i } : null;
  }
  if (el.closest('text.titleText') && model.title) return { kind: 'title' };
  return null;
}

// The element to anchor a popover at: a task's bar, a section's title,
// the title. null when mermaid didn't draw it (an empty section, an
// untitled chart).
export function ganttElementFor(svg: SVGSVGElement, model: GanttModel, target: GanttTarget): Element | null {
  if (target.kind === 'title') return model.title ? svg.querySelector('text.titleText') : null;
  if (target.kind === 'task') {
    const t = model.tasks[target.index];
    if (!t || taskIds(model).get(t.renderId) !== target.index) return null;
    const id = `${svg.id}-${t.renderId}`;
    return Array.from(svg.querySelectorAll('rect[id]')).find((r) => r.getAttribute('id') === id) ?? null;
  }
  // Sections with the same name share one title (mermaid groups by name);
  // clicking it gives the first.
  const s = model.sections[target.index];
  if (!s) return null;
  return Array.from(svg.querySelectorAll('text.sectionTitle')).find((el) => rowsOf(el) === s.name) ?? null;
}
