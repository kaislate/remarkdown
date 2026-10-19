import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { parseGantt, parseGanttSource, GANTT_STARTER, type GanttModel } from '../../../src/lib/editor/mermaid/gantt-parser';
import { toGanttDate } from '../../../src/lib/editor/mermaid/gantt-dates';
import { corpusBlocks, mermaidAccepts } from './mermaid-test-utils';
import { EXTRA_CORPUS, oracleDb, oracleText, renderSvg, shownText } from './mermaid-oracle-utils';

dayjs.extend(customParseFormat);

function model(src: string): GanttModel {
  const r = parseGantt(src);
  if (!r.ok) throw new Error(r.reason);
  return r.model;
}

const NO_FLAGS = { active: false, done: false, crit: false, milestone: false, vert: false };

describe('gantt parser', () => {
  it('reads the corpus gantt', () => {
    const m = model(
      'gantt\n    title Project plan\n    dateFormat YYYY-MM-DD\n    section Design\n    Research      :a1, 2026-01-01, 10d\n    Wireframes    :after a1, 7d\n    section Build\n    Implementation :2026-01-20, 20d\n    Testing        :crit, 2026-02-10, 5d\n',
    );
    expect(m.title).toBe('Project plan');
    expect(m.dateFormat).toBe('YYYY-MM-DD');
    expect(m.sections).toEqual([{ name: 'Design' }, { name: 'Build' }]);
    expect(m.tasks).toEqual([
      { name: 'Research', id: 'a1', renderId: 'a1', section: 0, flags: NO_FLAGS, start: { kind: 'date', date: '2026-01-01' }, end: { kind: 'duration', value: 10, unit: 'd' } },
      { name: 'Wireframes', id: null, renderId: 'task1', section: 0, flags: NO_FLAGS, start: { kind: 'after', ids: ['a1'], tasks: [0] }, end: { kind: 'duration', value: 7, unit: 'd' } },
      { name: 'Implementation', id: null, renderId: 'task2', section: 1, flags: NO_FLAGS, start: { kind: 'date', date: '2026-01-20' }, end: { kind: 'duration', value: 20, unit: 'd' } },
      { name: 'Testing', id: null, renderId: 'task3', section: 1, flags: { ...NO_FLAGS, crit: true }, start: { kind: 'date', date: '2026-02-10' }, end: { kind: 'duration', value: 5, unit: 'd' } },
    ]);
  });

  it('reads every shape of task data', () => {
    const m = model(
      [
        'gantt',
        '  dateFormat YYYY-MM-DD',
        '  A :a, 2026-01-01, 2026-01-05',
        '  B : 2d',
        '  C :done, crit, c, after a b zz, until d',
        '  D :milestone, d, 2026-01-09, 0d',
        '  E :e, 2026-01-02 10:00, 1.5h',
        '  F :vert, 2026-01-03, xyz',
      ].join('\n'),
    );
    expect(m.tasks.map((t) => [t.start, t.end])).toEqual([
      [{ kind: 'date', date: '2026-01-01' }, { kind: 'date', date: '2026-01-05' }],
      [{ kind: 'previous' }, { kind: 'duration', value: 2, unit: 'd' }],
      [{ kind: 'after', ids: ['a', 'b', 'zz'], tasks: [0] }, { kind: 'until', ids: ['d'], tasks: [3] }],
      [{ kind: 'date', date: '2026-01-09' }, { kind: 'duration', value: 0, unit: 'd' }],
      // Not YYYY-MM-DD, but mermaid falls back to JavaScript's Date for starts.
      [{ kind: 'date', date: '2026-01-02T10:00' }, { kind: 'duration', value: 1.5, unit: 'h' }],
      [{ kind: 'date', date: '2026-01-03' }, { kind: 'raw', text: 'xyz' }],
    ]);
    expect(m.tasks[2].flags).toEqual({ ...NO_FLAGS, done: true, crit: true });
    expect(m.tasks[3].flags.milestone && m.tasks[5].flags.vert).toBe(true);
    expect(m.tasks.map((t) => t.renderId)).toEqual(['a', 'task1', 'c', 'd', 'e', 'task2']);
  });

  it('reads dates in the chart format', () => {
    const m = model('gantt\n  dateFormat DD.MM.YYYY\n  A :31.01.2026, 02.02.2026\n  B :2026-02-01, 3d\n');
    expect(m.tasks[0].start).toEqual({ kind: 'date', date: '2026-01-31' });
    expect(m.tasks[0].end).toEqual({ kind: 'date', date: '2026-02-02' });
    // A start in another format is still read (mermaid's Date fallback)…
    expect(m.tasks[1].start).toEqual({ kind: 'date', date: '2026-02-01' });
    // …but an end is not: mermaid only reads ends in the chart format.
    expect(model('gantt\n  dateFormat DD.MM.YYYY\n  A :31.01.2026, 2026-02-02\n').tasks[0].end).toEqual({ kind: 'raw', text: '2026-02-02' });
  });

  it('reads names, sections and the title the way mermaid shows them', () => {
    const m = model('gantt\n  title  Plan #amp; do \n  section  Phase #59; 1 \n  Write #58; draft   :a, 2026-01-01, 1d\n  section Two<br>lines\n  B :1d\n');
    expect(m.title).toBe('Plan & do');
    expect(m.sections).toEqual([{ name: 'Phase ; 1' }, { name: 'Two\nlines' }]);
    expect(m.tasks[0].name).toBe('Write : draft');
  });

  it('keeps settings as read-only facts', () => {
    const m = model('gantt\n  dateFormat YYYY-MM-DD\n  axisFormat %d %b\n  tickInterval 1week\n  excludes weekends, 2026-01-05\n  includes 2026-01-10\n  todayMarker off\n  weekday monday\n  weekend friday\n  inclusiveEndDates\n  topAxis\n  A :2026-01-01, 1d\n');
    expect(m.settings).toEqual({
      axisFormat: '%d %b',
      tickInterval: '1week',
      excludes: ['weekends', '2026-01-05'],
      includes: ['2026-01-10'],
      todayMarker: 'off',
      weekday: 'monday',
      weekend: 'friday',
      inclusiveEndDates: true,
      topAxis: true,
    });
  });

  it('skips comments, click lines, accessibility statements, directives', () => {
    const src = '---\ntitle: Yaml\ndisplayMode: compact\n---\n%%{init: {}}%%\ngantt\n  %% c\n  accTitle: a\n  accDescr {\n    b\n  }\n  A :a, 2026-01-01, 1d\n  click a href "https://x.y"\n';
    const m = model(src);
    expect(m.title).toBe('Yaml');
    expect(m.tasks.map((t) => t.name)).toEqual(['A']);
    const r = parseGanttSource(src);
    expect(r.ok && r.map.clicks).toEqual([{ line: 12, ids: ['a'] }]);
  });

  it('records where each part sits', () => {
    const r = parseGanttSource('gantt\n  dateFormat YYYY-MM-DD\n  section S\n  Task one :crit, t1, 2026-01-01, 3d\n');
    if (!r.ok) throw new Error(r.reason);
    expect(r.map.dateFormat).toEqual({ line: 1, value: { start: 13, end: 23 } });
    expect(r.map.sections).toEqual([{ line: 2, name: { start: 10, end: 11 } }]);
    expect(r.map.tasks[0]).toMatchObject({ line: 3, name: { start: 2, end: 10 }, colon: 11 });
  });

  it('refuses what it cannot read', () => {
    expect(parseGantt('pie\n  "a" : 1\n').ok).toBe(false);
    // mermaid rejects or crashes on these
    expect(parseGantt('gantt\n  A :crit\n').ok).toBe(false);
    expect(parseGantt('gantt\n  A :a, b, c, d\n').ok).toBe(false);
    expect(parseGantt('gantt\n  A :a1, 2026-01-01, 3d # c\n').ok).toBe(false);
    expect(parseGantt('gantt\n  call mom :2026-01-01, 1d\n').ok).toBe(false);
    // valid, but mermaid reads `;` as the start of the next task's name
    expect(parseGantt('gantt\n  A :2026-01-01, 1d; B :1d\n').ok).toBe(false);
  });

  it('the starter is a valid, editable gantt', async () => {
    expect(await mermaidAccepts(GANTT_STARTER)).toBe(true);
    expect(model(GANTT_STARTER).tasks.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Oracle ───────────────────────────────────────────────────────────

const isGantt = (b: { source: string }) => /^\s*gantt\b/m.test(b.source);
const blocks = corpusBlocks(isGantt, ['mermaid-corpus.md', EXTRA_CORPUS]);
const lines = (raw: string) => String(raw).split(/<br\s*\/?>/i).map(oracleText).join('\n');

describe('gantt parser: oracle over the corpus', () => {
  it('reads every corpus gantt', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(9);
    for (const b of blocks) expect(parseGantt(b.source).ok, b.heading).toBe(true);
  });

  for (const b of blocks) {
    it(`${b.heading}: matches mermaid's db`, async () => {
      const r = parseGanttSource(b.source);
      if (!r.ok) throw new Error(r.reason);
      const { model: m, map } = r;
      const { db, title } = await oracleDb(b.source);
      expect(m.title).toBe(title);
      expect(m.dateFormat).toBe(db.getDateFormat().trim());
      expect(m.sections.map((s) => s.name)).toEqual(db.getSections().map(lines));
      expect(m.settings.excludes).toEqual(db.getExcludes().filter(Boolean));
      expect(m.settings.inclusiveEndDates).toBe(db.endDatesAreInclusive());
      const tasks = db.getTasks();
      expect(tasks.length).toBe(m.tasks.length);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tasks.forEach((t: any, i: number) => {
        const ours = m.tasks[i];
        const at = `${b.heading} task ${i}`;
        expect(ours.name, at).toBe(oracleText(t.task));
        expect(ours.renderId, at).toBe(t.id);
        expect(ours.section === null ? '' : m.sections[ours.section].name, at).toBe(lines(t.section));
        expect(ours.flags, at).toEqual({ active: !!t.active, done: !!t.done, crit: !!t.crit, milestone: !!t.milestone, vert: !!t.vert });
        const raw = t.raw.startTime;
        const startText: string = map.tasks[i].start ? b.source.split('\n')[map.tasks[i].line].slice(map.tasks[i].start!.start, map.tasks[i].start!.end) : '';
        switch (ours.start.kind) {
          case 'previous':
            expect(raw.type, at).toBe('prevTaskEnd');
            break;
          case 'after':
            expect(raw.startData, at).toMatch(/^after\s/);
            expect(ours.start.ids, at).toEqual(raw.startData.replace(/^after\s+/, '').split(' ').filter(Boolean));
            // mermaid starts it at the end of the latest of them (or today, none found)
            break;
          case 'date': {
            expect(raw.startData, at).toBe(startText);
            // mermaid's own instant: strict in the chart format (local), else Date's reading
            const strict = dayjs(startText, m.dateFormat, true);
            const expected = strict.isValid() && m.dateFormat ? toGanttDate(strict.toDate()) : isoCalendar(new Date(startText), startText);
            expect(ours.start.date, at).toBe(expected);
            expect(t.startTime.getTime(), at).toBe((strict.isValid() && m.dateFormat ? strict.toDate() : new Date(startText)).getTime());
            break;
          }
          case 'raw':
            expect(raw.startData, at).toBe(ours.start.text);
            break;
        }
        const end: string = t.raw.endTime.data.trim();
        switch (ours.end.kind) {
          case 'duration':
            expect(end, at).toBe(`${ours.end.value}${ours.end.unit}`.replace(/^(\d+)$/, '$1'));
            break;
          case 'until':
            expect(ours.end.ids, at).toEqual(end.replace(/^until\s+/, '').split(' ').filter(Boolean));
            break;
          case 'date':
            expect(toGanttDate(dayjs(end, m.dateFormat, true).toDate()), at).toBe(ours.end.date);
            break;
          case 'raw':
            expect(end, at).toBe(ours.end.text);
            break;
        }
      });
    });

    it(`${b.heading}: matches what mermaid draws`, async () => {
      const m = model(b.source);
      const svg = await renderSvg(b.source);
      expect(shownText(svg.querySelector('text.titleText'))).toBe(m.title);
      for (const t of m.tasks) {
        expect(shownText(svg.querySelector(`[id="${svg.id}-${t.renderId}-text"]`)), t.renderId).toBe(t.name);
      }
      // One title per section that has tasks; rows are the name's lines.
      const titles = Array.from(svg.querySelectorAll('text.sectionTitle')).map((el) =>
        Array.from(el.querySelectorAll('tspan')).map((s) => shownText(s)).join('\n'),
      );
      const withTasks = [...new Set(m.tasks.map((t) => (t.section === null ? '' : m.sections[t.section].name)))];
      expect([...titles].sort()).toEqual([...withTasks].sort());
    });
  }
});

// mermaid's Date fallback reads an ISO date without a time as UTC: the
// model keeps the calendar date as written.
function isoCalendar(d: Date, text: string): string {
  if (/^\d{4}-\d\d-\d\d$/.test(text)) return text;
  return toGanttDate(d);
}
