// Click targets on mermaid's timeline svg, against svgs captured from
// the app (real browser, mermaid 11.14).
import { describe, it, expect } from 'vitest';
import {
  timelineDrawOrder,
  timelineElementFor,
  timelineTargetAt,
  type TimelineTarget,
} from '../../../src/lib/editor/mermaid/timeline-svg';
import { parseTimeline, type TimelineModel } from '../../../src/lib/editor/mermaid/timeline-parser';
import { loadSvgFixture, renderSvg, shownText } from './mermaid-oracle-utils';

function load(name: string): { svg: SVGSVGElement; model: TimelineModel } {
  const { svg, source } = loadSvgFixture(name);
  const r = parseTimeline(source);
  if (!r.ok) throw new Error(r.reason);
  return { svg, model: r.model };
}

function targets(m: TimelineModel): TimelineTarget[] {
  const out: TimelineTarget[] = m.title ? [{ kind: 'title' }] : [];
  m.sections.forEach((_, index) => out.push({ kind: 'section', index }));
  m.periods.forEach((p, index) => {
    out.push({ kind: 'period', index });
    p.events.forEach((_, e) => out.push({ kind: 'event', period: index, index: e }));
  });
  return out;
}

const FIXTURES = ['timeline-basic', 'timeline-sections', 'timeline-multi-events', 'timeline-td', 'timeline-comments-entities'];

describe('timeline svg mapping', () => {
  it('maps clicks on box backgrounds, lines and text', () => {
    const { svg, model } = load('timeline-basic');
    // 2004 : Facebook / : Google — period 1, its events 0 and 1.
    const nodes = svg.querySelectorAll('g.timeline-node');
    expect(timelineTargetAt(nodes[2].querySelector('path')!, svg, model)).toEqual({ kind: 'period', index: 1 });
    expect(timelineTargetAt(nodes[3].querySelector('tspan')!, svg, model)).toEqual({ kind: 'event', period: 1, index: 0 });
    expect(timelineTargetAt(nodes[4].querySelector('line')!, svg, model)).toEqual({ kind: 'event', period: 1, index: 1 });
    const title = Array.from(svg.children).find((c) => c.tagName === 'text')!;
    expect(timelineTargetAt(title, svg, model)).toEqual({ kind: 'title' });
    // The dashed connector lines are not targets.
    expect(timelineTargetAt(svg.querySelector('g.lineWrapper line')!, svg, model)).toBeNull();
  });

  it('section headers come before their periods', () => {
    const { svg, model } = load('timeline-sections');
    const el = timelineElementFor(svg, model, { kind: 'section', index: 1 })!;
    expect(shownText(el)).toBe('21st century');
    expect(timelineTargetAt(el, svg, model)).toEqual({ kind: 'section', index: 1 });
    expect(shownText(timelineElementFor(svg, model, { kind: 'period', index: 3 }))).toBe('Industry 4.0');
  });

  it('the vertical (TD) layout maps the same way', () => {
    const { svg, model } = load('timeline-td');
    expect(model.direction).toBe('TD');
    expect(shownText(timelineElementFor(svg, model, { kind: 'event', period: 0, index: 1 }))).toBe('Setup');
  });

  for (const name of FIXTURES) {
    it(`${name}: every target round-trips and shows its model text`, () => {
      const { svg, model } = load(name);
      for (const t of targets(model)) {
        const el = timelineElementFor(svg, model, t);
        expect(el, JSON.stringify(t)).not.toBeNull();
        expect(timelineTargetAt(el!, svg, model), JSON.stringify(t)).toEqual(t);
        const text =
          t.kind === 'title' ? model.title
          : t.kind === 'section' ? model.sections[t.index].name
          : t.kind === 'period' ? model.periods[t.index].label
          : model.periods[t.period].events[t.index];
        expect(shownText(el), JSON.stringify(t)).toBe(text.replace(/\s+/g, ' ').trim());
      }
    });
  }

  it('periods above the first section are not drawn', async () => {
    const src = 'timeline\n  2000 : hidden\n  section S\n  2001 : shown\n';
    const r = parseTimeline(src);
    if (!r.ok) throw new Error(r.reason);
    expect(timelineDrawOrder(r.model).map((t) => t.kind)).toEqual(['section', 'period', 'event']);
    const svg = await renderSvg(src);
    expect(timelineElementFor(svg, r.model, { kind: 'period', index: 0 })).toBeNull();
    expect(shownText(timelineElementFor(svg, r.model, { kind: 'period', index: 1 }))).toBe('2001');
  });

  it('refuses an svg that does not match the model (stale render)', () => {
    const { svg, model } = load('timeline-basic');
    const stale = { ...model, periods: model.periods.slice(1) };
    expect(timelineTargetAt(svg.querySelector('g.timeline-node path')!, svg, stale)).toBeNull();
    expect(timelineElementFor(svg, stale, { kind: 'period', index: 0 })).toBeNull();
  });
});
