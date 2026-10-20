// Click targets on mermaid's gantt svg, against svgs captured from the
// app (real browser, mermaid 11.14).
import { describe, it, expect } from 'vitest';
import { ganttElementFor, ganttTargetAt, type GanttTarget } from '../../../src/lib/editor/mermaid/gantt-svg';
import { parseGantt, type GanttModel } from '../../../src/lib/editor/mermaid/gantt-parser';
import { loadSvgFixture, renderSvg, shownText } from './mermaid-oracle-utils';

function load(name: string): { svg: SVGSVGElement; model: GanttModel } {
  const { svg, source } = loadSvgFixture(name);
  const r = parseGantt(source);
  if (!r.ok) throw new Error(r.reason);
  return { svg, model: r.model };
}

// Every target mermaid draws: the title, each section with tasks (first
// of its name), each task.
function targets(m: GanttModel): GanttTarget[] {
  const out: GanttTarget[] = m.title ? [{ kind: 'title' }] : [];
  m.sections.forEach((s, index) => {
    const first = m.sections.findIndex((x) => x.name === s.name) === index;
    if (first && m.tasks.some((t) => t.section !== null && m.sections[t.section].name === s.name)) out.push({ kind: 'section', index });
  });
  m.tasks.forEach((_, index) => out.push({ kind: 'task', index }));
  return out;
}

const FIXTURES = ['gantt-basic', 'gantt-status-flags', 'gantt-frontmatter-compact', 'gantt-no-sections', 'gantt-until-click-vert'];

describe('gantt svg mapping', () => {
  it('maps bars and labels by element id (bars are drawn sorted by date)', () => {
    const { svg, model } = load('gantt-basic');
    // "another task" (task3) starts after the others' first bars; still task 3.
    const bar = svg.querySelector(`[id="${svg.id}-task3"]`)!;
    expect(ganttTargetAt(bar, svg, model)).toEqual({ kind: 'task', index: 3 });
    expect(ganttTargetAt(svg.querySelector(`[id="${svg.id}-a1-text"]`)!, svg, model)).toEqual({ kind: 'task', index: 0 });
  });

  it('maps section titles by their text, and the title', () => {
    const { svg, model } = load('gantt-status-flags');
    const titles = svg.querySelectorAll('text.sectionTitle');
    expect(ganttTargetAt(titles[2].querySelector('tspan')!, svg, model)).toEqual({ kind: 'section', index: 2 });
    expect(ganttTargetAt(svg.querySelector('text.titleText')!, svg, model)).toEqual({ kind: 'title' });
    // Row backgrounds and the grid are not targets.
    expect(ganttTargetAt(svg.querySelector('rect.section')!, svg, model)).toBeNull();
    expect(ganttTargetAt(svg.querySelector('g.grid .tick text')!, svg, model)).toBeNull();
  });

  it('milestones and vert markers are bars too', () => {
    const { svg, model } = load('gantt-until-click-vert');
    const frz = ganttElementFor(svg, model, { kind: 'task', index: 3 })!;
    expect(frz.getAttribute('class')).toContain('vert');
    expect(ganttTargetAt(frz, svg, model)).toEqual({ kind: 'task', index: 3 });
  });

  for (const name of FIXTURES) {
    it(`${name}: every target round-trips through its element`, () => {
      const { svg, model } = load(name);
      for (const t of targets(model)) {
        const el = ganttElementFor(svg, model, t);
        expect(el, JSON.stringify(t)).not.toBeNull();
        expect(ganttTargetAt(el!, svg, model), JSON.stringify(t)).toEqual(t);
        if (t.kind === 'task') {
          const label = svg.querySelector(`[id="${el!.getAttribute('id')}-text"]`);
          expect(shownText(label)).toBe(model.tasks[t.index].name);
        }
      }
    });
  }

  it('sections with the same name share a title; an empty section has none', async () => {
    const src = 'gantt\n  dateFormat YYYY-MM-DD\n  section Build\n  A :2026-01-01, 1d\n  section Build\n  B :1d\n  section Empty\n';
    const r = parseGantt(src);
    if (!r.ok) throw new Error(r.reason);
    const svg = await renderSvg(src);
    const first = ganttElementFor(svg, r.model, { kind: 'section', index: 0 });
    expect(ganttElementFor(svg, r.model, { kind: 'section', index: 1 })).toBe(first);
    expect(ganttTargetAt(first!, svg, r.model)).toEqual({ kind: 'section', index: 0 });
    expect(ganttElementFor(svg, r.model, { kind: 'section', index: 2 })).toBeNull();
    expect(ganttElementFor(svg, r.model, { kind: 'title' })).toBeNull();
  });

  it('a stale model maps nothing it no longer has', () => {
    const { svg, model } = load('gantt-basic');
    const stale = { ...model, tasks: model.tasks.slice(0, 1) };
    expect(ganttTargetAt(svg.querySelector(`[id="${svg.id}-task3"]`)!, svg, stale)).toBeNull();
    expect(ganttElementFor(svg, stale, { kind: 'task', index: 1 })).toBeNull();
  });
});
