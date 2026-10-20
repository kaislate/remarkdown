// Source-preserving visual edits on timelines. Same invariant as
// mermaid-flowchart-edit.test.ts: every source line an edit does not
// semantically touch stays byte-identical, the result parses to exactly
// the intended model, and mermaid accepts it.
import { describe, it, expect } from 'vitest';
import { applyTimelineEdit, type TimelineEdit } from '../../../src/lib/editor/mermaid/timeline-edit';
import {
  parseTimeline,
  parseTimelineSource,
  type TimelineModel,
  type TimelinePeriod,
} from '../../../src/lib/editor/mermaid/timeline-parser';
import { timelineElementFor } from '../../../src/lib/editor/mermaid/timeline-svg';
import { normalizeUserLines, normalizeUserText } from '../../../src/lib/editor/mermaid/display-text';
import { moveItem } from '../../../src/lib/editor/mermaid/source-text';
import { corpusBlocks, mermaidAccepts, removedLines, FUZZ_INPUTS } from './mermaid-test-utils';
import { EXTRA_CORPUS, renderSvg, shownText } from './mermaid-oracle-utils';

function edit(src: string, e: TimelineEdit): string {
  const r = applyTimelineEdit(src, e);
  if (!r) throw new Error('edit refused');
  return r.source;
}

function model(src: string): TimelineModel {
  const r = parseTimeline(src);
  if (!r.ok) throw new Error(`${r.reason}\n${src}`);
  return r.model;
}

const SECTIONS = [
  'timeline',
  '    title History',
  '    section Early',
  '        %% founding',
  '        1999 : Founded',
  '        2001 : Crash : Layoffs',
  '             : Rehiring',
  '    section Late',
  '        2010 : Growth',
  '',
].join('\n');

const FLAT = 'timeline\n    2002 : LinkedIn\n    2004 : Facebook : Google\n         : YouTube\n    2006 : Twitter\n';

describe('timeline edits: targeted examples', () => {
  it('renames a period, a section, an event — only that text', () => {
    expect(edit(FLAT, { kind: 'setPeriodLabel', index: 1, label: 'Year 2004' })).toBe(FLAT.replace('2004', 'Year 2004'));
    expect(edit(SECTIONS, { kind: 'renameSection', index: 1, name: 'Recent' })).toBe(SECTIONS.replace('section Late', 'section Recent'));
    expect(edit(FLAT, { kind: 'setEventText', period: 1, index: 1, text: 'Alphabet' })).toBe(FLAT.replace('Google', 'Alphabet'));
    expect(edit(FLAT, { kind: 'setEventText', period: 1, index: 2, text: 'Tube' })).toBe(FLAT.replace('YouTube', 'Tube'));
  });

  it('writes text so the lexer keeps it as one piece', () => {
    const out = edit(FLAT, { kind: 'setEventText', period: 0, index: 0, text: 'a: b # c & d' });
    expect(out.split('\n')[1]).toBe('    2002 : a#58; b #35; c #amp; d');
    // A `:` not followed by a space is safe as is.
    expect(edit(FLAT, { kind: 'setEventText', period: 0, index: 0, text: '10:30 call' }).split('\n')[1]).toBe('    2002 : 10:30 call');
    expect(edit(FLAT, { kind: 'setPeriodLabel', index: 0, label: 'Q1: 2002' }).split('\n')[1]).toBe('    Q1#58; 2002 : LinkedIn');
    // A label the lexer would read as a keyword gets its first letter encoded.
    expect(edit(FLAT, { kind: 'setPeriodLabel', index: 0, label: 'title page' }).split('\n')[1]).toBe('    #116;itle page : LinkedIn');
    expect(edit(FLAT, { kind: 'setPeriodLabel', index: 0, label: '' }).split('\n')[1]).toBe('    #32; : LinkedIn');
  });

  it('line breaks become <br> and read back as line breaks', () => {
    const out = edit(FLAT, { kind: 'setEventText', period: 0, index: 0, text: 'two\nlines' });
    expect(out.split('\n')[1]).toBe('    2002 : two<br>lines');
    expect(model(out).periods[0].events[0]).toBe('two\nlines');
  });

  it('adds events on the period line or as a continuation line', () => {
    const r = applyTimelineEdit(FLAT, { kind: 'addEvent', period: 0, text: 'Xing' })!;
    expect(r.index).toBe(1);
    expect(r.source).toBe(FLAT.replace('2002 : LinkedIn', '2002 : LinkedIn : Xing'));
    // The period already has continuation lines: add another one.
    expect(edit(FLAT, { kind: 'addEvent', period: 1, text: 'MySpace' })).toBe(FLAT.replace('         : YouTube\n', '         : YouTube\n         : MySpace\n'));
    expect(edit(FLAT, { kind: 'addEvent', period: 1, text: 'First', afterIndex: -1 })).toBe(FLAT.replace('2004 : Facebook', '2004 : First : Facebook'));
    expect(edit(FLAT, { kind: 'addEvent', period: 1, text: 'Mid', afterIndex: 0 })).toBe(FLAT.replace('Facebook : Google', 'Facebook : Mid : Google'));
    expect(edit('timeline\n  2001\n', { kind: 'addEvent', period: 0, text: 'x' })).toBe('timeline\n  2001 : x\n');
    // A period followed by a `#` comment: the event can't go on that line.
    expect(edit('timeline\n  2001 # note\n', { kind: 'addEvent', period: 0, text: 'x' })).toBe('timeline\n  2001 # note\n      : x\n');
  });

  it('removes events, dropping a continuation line that empties', () => {
    expect(edit(FLAT, { kind: 'removeEvent', period: 1, index: 0 })).toBe(FLAT.replace('2004 : Facebook : Google', '2004 : Google'));
    expect(edit(FLAT, { kind: 'removeEvent', period: 1, index: 1 })).toBe(FLAT.replace('2004 : Facebook : Google', '2004 : Facebook'));
    expect(edit(FLAT, { kind: 'removeEvent', period: 1, index: 2 })).toBe(FLAT.replace('         : YouTube\n', ''));
    expect(edit(FLAT, { kind: 'removeEvent', period: 0, index: 0 })).toBe(FLAT.replace('2002 : LinkedIn', '2002'));
  });

  it('reorders events by swapping their texts in place', () => {
    expect(edit(FLAT, { kind: 'moveEvent', period: 1, from: 2, to: 0 })).toBe(
      FLAT.replace('2004 : Facebook : Google\n         : YouTube', '2004 : YouTube : Facebook\n         : Google'),
    );
  });

  it('adds, removes and moves periods with their event lines', () => {
    const r = applyTimelineEdit(FLAT, { kind: 'addPeriod', label: '2005', events: ['YouTube 2'], afterIndex: 1 })!;
    expect(r.index).toBe(2);
    expect(r.source).toBe(FLAT.replace('    2006', '    2005 : YouTube 2\n    2006'));
    expect(edit(FLAT, { kind: 'removePeriod', index: 1 })).toBe('timeline\n    2002 : LinkedIn\n    2006 : Twitter\n');
    expect(edit(FLAT, { kind: 'movePeriod', from: 1, to: 2 })).toBe(
      'timeline\n    2002 : LinkedIn\n    2006 : Twitter\n    2004 : Facebook : Google\n         : YouTube\n',
    );
    expect(edit(SECTIONS, { kind: 'addPeriod', label: '2020', section: 0 })).toBe(SECTIONS.replace('             : Rehiring\n', '             : Rehiring\n        2020\n'));
  });

  it('moves a period into another section', () => {
    const out = edit(SECTIONS, { kind: 'movePeriodToSection', index: 0, section: 1 });
    expect(out).toBe(SECTIONS.replace('        1999 : Founded\n', '').replace('        2010 : Growth\n', '        2010 : Growth\n        1999 : Founded\n'));
    expect(model(out).periods.map((p) => [p.label, p.section])).toEqual([['2001', 0], ['2010', 1], ['1999', 1]]);
  });

  it('adds, removes and moves sections', () => {
    const r = applyTimelineEdit(SECTIONS, { kind: 'addSection', name: 'Middle', afterIndex: 0 })!;
    expect(r.index).toBe(1);
    expect(r.source).toBe(SECTIONS.replace('    section Late', '    section Middle\n    section Late'));
    expect(edit(SECTIONS, { kind: 'addSection', name: 'Next' })).toBe(SECTIONS.replace('2010 : Growth\n', '2010 : Growth\n    section Next\n'));
    // Removing a section removes its periods.
    expect(edit(SECTIONS, { kind: 'removeSection', index: 0 })).toBe('timeline\n    title History\n    section Late\n        2010 : Growth\n');
    expect(edit(SECTIONS, { kind: 'moveSection', from: 1, to: 0 })).toBe(
      'timeline\n    title History\n    section Late\n        2010 : Growth\n    section Early\n        %% founding\n        1999 : Founded\n        2001 : Crash : Layoffs\n             : Rehiring\n',
    );
    // The first section of a section-less timeline goes above its periods, which join it.
    const first = applyTimelineEdit(FLAT, { kind: 'addSection', name: 'All', afterIndex: -1 })!;
    expect(first.source).toBe(FLAT.replace('timeline\n', 'timeline\n    section All\n'));
    expect(model(first.source).periods.every((p) => p.section === 0)).toBe(true);
  });

  it('sets and clears the title (a frontmatter title is not shown on timelines)', () => {
    expect(edit(SECTIONS, { kind: 'setTitle', title: 'Our story' })).toBe(SECTIONS.replace('title History', 'title Our story'));
    expect(edit(SECTIONS, { kind: 'setTitle', title: '' })).toBe(SECTIONS.replace('    title History\n', ''));
    expect(edit('---\ntitle: Y\n---\ntimeline\n  2001\n', { kind: 'setTitle', title: 'T' })).toBe('---\ntitle: Y\n---\ntimeline\n  title T\n  2001\n');
  });

  it('refuses edits naming something missing', () => {
    expect(applyTimelineEdit(FLAT, { kind: 'removePeriod', index: 9 })).toBeNull();
    expect(applyTimelineEdit(FLAT, { kind: 'setEventText', period: 0, index: 3, text: 'x' })).toBeNull();
    expect(applyTimelineEdit(FLAT, { kind: 'renameSection', index: 0, name: 'x' })).toBeNull();
    expect(applyTimelineEdit('timeline\n  2002 :x\n', { kind: 'setTitle', title: 'x' })).toBeNull();
  });
});

// ── Property test over the corpus ────────────────────────────────────

const TRICKY = 'Renamed: "q" #59; %% & <b> # x: y';
const shownOf = (t: string) => normalizeUserLines(t);

interface Op {
  name: string;
  edit: TimelineEdit;
  expected: (m: TimelineModel) => TimelineModel;
  touches: (line: number) => boolean;
  relocates?: number[];
}

const secOrder = (s: number | null) => (s === null ? -1 : s);

// Where a period appended to section `s` lands in `periods`.
function endOfSection(periods: TimelinePeriod[], s: number | null): number {
  let at = -1;
  periods.forEach((p, i) => p.section === s && (at = i));
  if (at >= 0) return at + 1;
  const after = periods.findIndex((p) => secOrder(p.section) > secOrder(s));
  return after < 0 ? periods.length : after;
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
}

function opsFor(src: string): Op[] {
  const parsed = parseTimelineSource(src);
  if (!parsed.ok) throw new Error(parsed.reason);
  const { model: m, map } = parsed;
  const ops: Op[] = [];
  const titleLines = new Set(map.titles.map((t) => t.line));
  // A section's block: its line through its last period's last line.
  const sectionBlock = (s: number) => {
    const ps = map.periods.filter((_, i) => m.periods[i].section === s);
    return range(map.sections[s].line, ps.length ? ps[ps.length - 1].lastLine : map.sections[s].line);
  };
  const periodBlock = (p: number) => range(map.periods[p].line, map.periods[p].lastLine);

  ops.push({ name: 'set title', edit: { kind: 'setTitle', title: TRICKY }, expected: (x) => ({ ...x, title: normalizeUserText(TRICKY) }), touches: (l) => titleLines.has(l) });
  ops.push({ name: 'clear title', edit: { kind: 'setTitle', title: '' }, expected: (x) => ({ ...x, title: '' }), touches: (l) => titleLines.has(l) });

  m.sections.forEach((_, s) => {
    ops.push({
      name: `rename section ${s}`,
      edit: { kind: 'renameSection', index: s, name: TRICKY },
      expected: (x) => ({ ...x, sections: x.sections.map((y, k) => (k === s ? { name: shownOf(TRICKY) } : y)) }),
      touches: (l) => l === map.sections[s].line,
    });
    const block = new Set(sectionBlock(s));
    ops.push({
      name: `remove section ${s}`,
      edit: { kind: 'removeSection', index: s },
      expected: (x) => ({
        ...x,
        sections: x.sections.filter((_, k) => k !== s),
        periods: x.periods.filter((p) => p.section !== s).map((p) => ({ ...p, section: p.section !== null && p.section > s ? p.section - 1 : p.section })),
      }),
      touches: (l) => block.has(l),
    });
    ops.push({
      name: `add section after ${s}`,
      edit: { kind: 'addSection', name: 'Added', afterIndex: s },
      expected: (x) => ({
        ...x,
        sections: [...x.sections.slice(0, s + 1), { name: 'Added' }, ...x.sections.slice(s + 1)],
        periods: x.periods.map((p) => ({ ...p, section: p.section !== null && p.section > s ? p.section + 1 : p.section })),
      }),
      touches: () => false,
    });
    for (const to of [0, m.sections.length - 1]) {
      if (to === s) continue;
      ops.push({
        name: `move section ${s}→${to}`,
        edit: { kind: 'moveSection', from: s, to },
        expected: (x) => {
          const order = moveItem(x.sections.map((_, k) => k), s, to);
          const remap = new Map(order.map((old, k) => [old, k]));
          const periods = [
            ...x.periods.filter((p) => p.section === null),
            ...order.flatMap((old) => x.periods.filter((p) => p.section === old)),
          ].map((p) => ({ ...p, section: p.section === null ? null : remap.get(p.section)! }));
          return { ...x, sections: order.map((k) => x.sections[k]), periods };
        },
        touches: () => false,
        relocates: sectionBlock(s),
      });
    }
  });
  ops.push({
    name: 'add section at the end',
    edit: { kind: 'addSection', name: TRICKY },
    expected: (x) => ({ ...x, sections: [...x.sections, { name: shownOf(TRICKY) }] }),
    touches: () => false,
  });

  m.periods.forEach((p, i) => {
    ops.push({
      name: `label ${i}`,
      edit: { kind: 'setPeriodLabel', index: i, label: TRICKY },
      expected: (x) => ({ ...x, periods: x.periods.map((y, k) => (k === i ? { ...y, label: shownOf(TRICKY) } : y)) }),
      touches: (l) => l === map.periods[i].line,
    });
    const block = new Set(periodBlock(i));
    ops.push({
      name: `remove period ${i}`,
      edit: { kind: 'removePeriod', index: i },
      expected: (x) => ({ ...x, periods: x.periods.filter((_, k) => k !== i) }),
      touches: (l) => block.has(l),
    });
    ops.push({
      name: `add period after ${i}`,
      edit: { kind: 'addPeriod', label: TRICKY, events: ['e1', TRICKY], afterIndex: i },
      expected: (x) => ({
        ...x,
        periods: [...x.periods.slice(0, i + 1), { label: shownOf(TRICKY), section: p.section, events: ['e1', shownOf(TRICKY)] }, ...x.periods.slice(i + 1)],
      }),
      touches: () => false,
    });
    for (const to of [0, m.periods.length - 1]) {
      if (to === i) continue;
      ops.push({
        name: `move period ${i}→${to}`,
        edit: { kind: 'movePeriod', from: i, to },
        expected: (x) => {
          const periods = moveItem(x.periods, i, to);
          periods[to] = { ...periods[to], section: x.periods[to].section };
          return { ...x, periods };
        },
        touches: () => false,
        relocates: periodBlock(i),
      });
    }
    for (const s of [null, ...m.sections.map((_, k) => k)]) {
      if (s === p.section) continue;
      ops.push({
        name: `move period ${i} to section ${s}`,
        edit: { kind: 'movePeriodToSection', index: i, section: s },
        expected: (x) => {
          const rest = x.periods.filter((_, k) => k !== i);
          const at = endOfSection(rest, s);
          return { ...x, periods: [...rest.slice(0, at), { ...x.periods[i], section: s }, ...rest.slice(at)] };
        },
        touches: () => false,
        relocates: periodBlock(i),
      });
    }
    p.events.forEach((_, e) => {
      const ev = map.periods[i].events[e];
      const setEvents = (x: TimelineModel, f: (events: string[]) => string[]) => ({
        ...x,
        periods: x.periods.map((y, k) => (k === i ? { ...y, events: f(y.events) } : y)),
      });
      ops.push({
        name: `event ${i}.${e} text`,
        edit: { kind: 'setEventText', period: i, index: e, text: TRICKY },
        expected: (x) => setEvents(x, (evs) => evs.map((t, k) => (k === e ? shownOf(TRICKY) : t))),
        touches: (l) => l === ev.line,
      });
      ops.push({
        name: `event ${i}.${e} remove`,
        edit: { kind: 'removeEvent', period: i, index: e },
        expected: (x) => setEvents(x, (evs) => evs.filter((_, k) => k !== e)),
        touches: (l) => l === ev.line,
      });
      ops.push({
        name: `event ${i}.${e} add after`,
        edit: { kind: 'addEvent', period: i, text: TRICKY, afterIndex: e },
        expected: (x) => setEvents(x, (evs) => [...evs.slice(0, e + 1), shownOf(TRICKY), ...evs.slice(e + 1)]),
        touches: (l) => l === ev.line,
      });
      for (const to of [0, p.events.length - 1]) {
        if (to === e) continue;
        const lines = new Set(map.periods[i].events.map((x) => x.line));
        ops.push({
          name: `event ${i}.${e} move→${to}`,
          edit: { kind: 'moveEvent', period: i, from: e, to },
          expected: (x) => setEvents(x, (evs) => moveItem(evs, e, to)),
          touches: (l) => lines.has(l),
        });
      }
    });
    const lastLine = map.periods[i].events.length ? map.periods[i].events[map.periods[i].events.length - 1].line : map.periods[i].line;
    ops.push({
      name: `period ${i} add event`,
      edit: { kind: 'addEvent', period: i, text: TRICKY },
      expected: (x) => ({ ...x, periods: x.periods.map((y, k) => (k === i ? { ...y, events: [...y.events, shownOf(TRICKY)] } : y)) }),
      touches: (l) => l === lastLine,
    });
    ops.push({
      name: `period ${i} add first event`,
      edit: { kind: 'addEvent', period: i, text: 'first', afterIndex: -1 },
      expected: (x) => ({ ...x, periods: x.periods.map((y, k) => (k === i ? { ...y, events: ['first', ...y.events] } : y)) }),
      touches: (l) => l === map.periods[i].line,
    });
  });
  for (const s of [null, ...m.sections.map((_, k) => k)]) {
    ops.push({
      name: `add period to section ${s}`,
      edit: { kind: 'addPeriod', label: 'New', section: s },
      expected: (x) => {
        const at = endOfSection(x.periods, s);
        return { ...x, periods: [...x.periods.slice(0, at), { label: 'New', section: s, events: [] }, ...x.periods.slice(at)] };
      },
      touches: () => false,
    });
  }
  return ops;
}

const isTimeline = (b: { source: string }) => /^\s*timeline\b/m.test(b.source) && parseTimeline(b.source).ok;
const blocks = corpusBlocks(isTimeline, ['mermaid-corpus.md', EXTRA_CORPUS]);

describe('timeline edits: corpus property', () => {
  it('finds editable timelines in the corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(6);
  });

  for (const block of blocks) {
    it(`${block.heading}: every visual edit is exact, minimal and valid`, async () => {
      const before = model(block.source);
      const lines = block.source.split('\n');
      for (const op of opsFor(block.source)) {
        const res = applyTimelineEdit(block.source, op.edit);
        expect(res, op.name).not.toBeNull();
        const out = res!.source;
        expect(model(out), `${op.name}:\n${out}`).toEqual(op.expected(before));
        if (op.relocates) {
          const moved = new Set(op.relocates.map((l) => lines[l]));
          const rest = (s: string) => s.split('\n').filter((l) => !moved.has(l));
          expect(rest(out), `${op.name}:\n${out}`).toEqual(rest(block.source));
          expect(out.split('\n').length, op.name).toBe(lines.length);
        } else {
          const allowed = new Map<string, number>();
          lines.forEach((l, i) => op.touches(i) && allowed.set(l, (allowed.get(l) ?? 0) + 1));
          for (const l of removedLines(block.source, out)) {
            const n = allowed.get(l) ?? 0;
            expect(n > 0, `${op.name} changed an unrelated line ${JSON.stringify(l)}:\n${out}`).toBe(true);
            allowed.set(l, n - 1);
          }
        }
        expect(await mermaidAccepts(out), `${op.name}:\n${out}`).toBe(true);
      }
    }, 120_000);
  }
});

// ── Fuzz ─────────────────────────────────────────────────────────────

describe('timeline edits: fuzz over typed text', () => {
  const SRC = 'timeline\n    title Old\n    section One\n    2001 : a : b\n    2002 : c\n';
  for (const input of FUZZ_INPUTS) {
    it(`every text field ${JSON.stringify(input)}`, async () => {
      const shown = normalizeUserText(input);
      const cases: Array<{ e: TimelineEdit; read: (m: TimelineModel) => string; target: (m: TimelineModel) => Parameters<typeof timelineElementFor>[2] }> = [
        { e: { kind: 'setTitle', title: input }, read: (m) => m.title, target: () => ({ kind: 'title' }) },
        { e: { kind: 'renameSection', index: 0, name: input }, read: (m) => m.sections[0].name, target: () => ({ kind: 'section', index: 0 }) },
        { e: { kind: 'addSection', name: input }, read: (m) => m.sections[1].name, target: () => ({ kind: 'section', index: 1 }) },
        { e: { kind: 'setPeriodLabel', index: 1, label: input }, read: (m) => m.periods[1].label, target: () => ({ kind: 'period', index: 1 }) },
        { e: { kind: 'addPeriod', label: input, events: [input], section: 0 }, read: (m) => m.periods[2].label + '|' + m.periods[2].events[0], target: () => ({ kind: 'period', index: 2 }) },
        { e: { kind: 'setEventText', period: 0, index: 0, text: input }, read: (m) => m.periods[0].events[0], target: () => ({ kind: 'event', period: 0, index: 0 }) },
        { e: { kind: 'addEvent', period: 0, text: input, afterIndex: 0 }, read: (m) => m.periods[0].events[1], target: () => ({ kind: 'event', period: 0, index: 1 }) },
        { e: { kind: 'addEvent', period: 1, text: input }, read: (m) => m.periods[1].events[1], target: () => ({ kind: 'event', period: 1, index: 1 }) },
      ];
      for (const c of cases) {
        const out = edit(SRC, c.e);
        expect(await mermaidAccepts(out), out).toBe(true);
        const m = model(out);
        const expected = c.e.kind === 'addPeriod' ? `${shown}|${shown}` : shown;
        expect(c.read(m), out).toBe(expected);
        if (c.e.kind === 'setTitle' && shown === '') continue;
        const svg = await renderSvg(out);
        const el = timelineElementFor(svg, m, c.target(m));
        expect(el, out).not.toBeNull();
        expect(shownText(el), out).toBe(shown);
      }
    }, 30_000);
  }
});
