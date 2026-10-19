// Source-preserving visual edits on gantt charts. Same invariant as
// mermaid-flowchart-edit.test.ts, plus the gantt-specific one: no edit
// moves another task's schedule (except the documented rules for tasks
// that waited on a removed one), checked on a canonical form where
// "previous" means "after the task that was above it".
import { describe, it, expect } from 'vitest';
import { applyGanttEdit, type GanttEdit } from '../../../src/lib/editor/mermaid/gantt-edit';
import {
  parseGantt,
  parseGanttSource,
  readGanttEnd,
  readGanttStart,
  type GanttModel,
} from '../../../src/lib/editor/mermaid/gantt-parser';
import { ganttDateAs } from '../../../src/lib/editor/mermaid/gantt-dates';
import { normalizeUserLines, normalizeUserText } from '../../../src/lib/editor/mermaid/display-text';
import { moveItem } from '../../../src/lib/editor/mermaid/source-text';
import { corpusBlocks, mermaidAccepts, removedLines, FUZZ_INPUTS } from './mermaid-test-utils';
import { EXTRA_CORPUS, oracleDb, renderSvg, shownText } from './mermaid-oracle-utils';

function edit(src: string, e: GanttEdit): string {
  const r = applyGanttEdit(src, e);
  if (!r) throw new Error('edit refused');
  return r.source;
}

function model(src: string): GanttModel {
  const r = parseGantt(src);
  if (!r.ok) throw new Error(`${r.reason}\n${src}`);
  return r.model;
}

// mermaid accepts it AND can lay it out (mermaid.parse alone doesn't
// compute task dates; a broken dependency only fails there).
async function drawable(src: string): Promise<true | string> {
  const ok = await mermaidAccepts(src);
  if (ok !== true) return ok;
  try {
    const { db } = await oracleDb(src);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tasks = db.getTasks() as any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = tasks.find((t: any) => !(t.startTime instanceof Date) || Number.isNaN(t.startTime.getTime()) || !(t.endTime instanceof Date));
    return bad ? `task ${bad.id} has no dates` : true;
  } catch (e) {
    return String(e);
  }
}

const BASIC = [
  'gantt',
  '    title A Gantt Diagram',
  '    dateFormat YYYY-MM-DD',
  '    section Section',
  '        A task          :a1, 2026-01-01, 30d',
  '        Another task    :after a1, 20d',
  '    section Another',
  '        Task in Another :2026-01-12, 12d',
  '        another task    :24d',
  '',
].join('\n');
const L = BASIC.split('\n');
const withLines = (changes: Record<number, string | null>, inserts: Record<number, string[]> = {}) =>
  L.flatMap((l, i) => [...(inserts[i] ?? []), ...(i in changes ? (changes[i] === null ? [] : [changes[i]!]) : [l])]).join('\n');

describe('gantt edits: targeted examples', () => {
  it('a name edit rewrites only the name', () => {
    expect(edit(BASIC, { kind: 'setTaskName', index: 0, name: 'First' })).toBe(withLines({ 4: '        First          :a1, 2026-01-01, 30d' }));
  });

  it('start / end edits rewrite one data item, in the chart format', () => {
    expect(edit(BASIC, { kind: 'setTaskEnd', index: 0, end: { kind: 'duration', value: 2.5, unit: 'w' } })).toBe(withLines({ 4: '        A task          :a1, 2026-01-01, 2.5w' }));
    expect(edit(BASIC, { kind: 'setTaskEnd', index: 0, end: { kind: 'date', date: '2026-01-20' } })).toBe(withLines({ 4: '        A task          :a1, 2026-01-01, 2026-01-20' }));
    expect(edit(BASIC, { kind: 'setTaskStart', index: 2, start: { kind: 'date', date: '2026-01-15' } })).toBe(withLines({ 7: '        Task in Another :2026-01-15, 12d' }));
    expect(edit(BASIC, { kind: 'setTaskStart', index: 3, start: { kind: 'after', tasks: [0] } })).toBe(withLines({ 8: '        another task    :after a1, 24d' }));
    expect(edit(BASIC, { kind: 'setTaskStart', index: 1, start: { kind: 'previous' } })).toBe(withLines({ 5: '        Another task    :20d' }));
    expect(edit(BASIC, { kind: 'setTaskEnd', index: 3, end: { kind: 'until', tasks: [0] } })).toBe(withLines({ 8: '        another task    :until a1' }));
  });

  it('a task that gets depended on gets an id, from its name', () => {
    expect(edit(BASIC, { kind: 'setTaskStart', index: 3, start: { kind: 'after', tasks: [2] } })).toBe(
      withLines({ 7: '        Task in Another :task-in-another, 2026-01-12, 12d', 8: '        another task    :after task-in-another, 24d' }),
    );
  });

  it('toggles status flags at the front of the data', () => {
    expect(edit(BASIC, { kind: 'setTaskFlag', index: 0, flag: 'crit', on: true })).toBe(withLines({ 4: '        A task          :crit, a1, 2026-01-01, 30d' }));
    const flagged = 'gantt\n  A :done, crit, a, 2026-01-01, 1d\n';
    expect(edit(flagged, { kind: 'setTaskFlag', index: 0, flag: 'done', on: false })).toBe('gantt\n  A :crit, a, 2026-01-01, 1d\n');
    expect(edit(flagged, { kind: 'setTaskFlag', index: 0, flag: 'crit', on: false })).toBe('gantt\n  A :done, a, 2026-01-01, 1d\n');
    expect(edit(flagged, { kind: 'setTaskFlag', index: 0, flag: 'milestone', on: true })).toBe('gantt\n  A :done, crit, milestone, a, 2026-01-01, 1d\n');
  });

  it('removing a task hands its start to the tasks that waited on it', () => {
    expect(edit(BASIC, { kind: 'removeTask', index: 0 })).toBe(withLines({ 4: null, 5: '        Another task    :2026-01-01, 20d' }));
    // "previous" below a removed task: pinned to where the removed one started.
    expect(edit(BASIC, { kind: 'removeTask', index: 2 })).toBe(withLines({ 7: null, 8: '        another task    :2026-01-12, 24d' }));
    const until = 'gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2026-01-05, 1d\n  B :2026-01-01, until a\n';
    expect(edit(until, { kind: 'removeTask', index: 0 })).toBe('gantt\n  dateFormat YYYY-MM-DD\n  B :2026-01-01, 2026-01-05\n');
  });

  it('moving a task keeps every schedule: "previous" tasks are pinned', () => {
    expect(edit(BASIC, { kind: 'moveTask', from: 3, to: 0 })).toBe(
      withLines({ 7: '        Task in Another :task-in-another, 2026-01-12, 12d', 8: null }, { 4: ['        another task    :after task-in-another, 24d'] }),
    );
    expect(edit(BASIC, { kind: 'moveTaskToSection', index: 0, section: 1 })).toBe(
      withLines({ 4: null }, { 9: ['        A task          :a1, 2026-01-01, 30d'] }),
    );
  });

  it('adds tasks; a "previous" task below the new one keeps its schedule', () => {
    const r = applyGanttEdit(BASIC, { kind: 'addTask', name: 'New', section: 1, start: { kind: 'previous' }, end: { kind: 'duration', value: 3, unit: 'd' } })!;
    expect(r.index).toBe(4);
    expect(r.source).toBe(withLines({}, { 9: ['        New :3d'] }));
    const mid = applyGanttEdit(BASIC, { kind: 'addTask', name: 'Mid', afterIndex: 2, start: { kind: 'previous' }, end: { kind: 'duration', value: 1, unit: 'd' }, flags: { crit: true } })!;
    expect(mid.index).toBe(3);
    expect(mid.source).toBe(
      withLines(
        { 7: '        Task in Another :task-in-another, 2026-01-12, 12d', 8: '        another task    :after task-in-another, 24d' },
        { 8: ['        Mid :crit, 1d'] },
      ),
    );
  });

  it('sections: add, rename, move, remove (with their tasks)', () => {
    expect(edit(BASIC, { kind: 'addSection', name: 'Later' })).toBe(withLines({}, { 9: ['    section Later'] }));
    expect(edit(BASIC, { kind: 'renameSection', index: 1, name: 'Other' })).toBe(BASIC.replace('section Another', 'section Other'));
    expect(edit(BASIC, { kind: 'removeSection', index: 0 })).toBe(withLines({ 3: null, 4: null, 5: null }));
    expect(edit(BASIC, { kind: 'moveSection', from: 1, to: 0 })).toBe([...L.slice(0, 3), ...L.slice(6, 9), ...L.slice(3, 6), ''].join('\n'));
  });

  it('changing the date format rewrites every task date', () => {
    const out = edit(BASIC, { kind: 'setDateFormat', format: 'DD/MM/YYYY' });
    expect(out).toBe(withLines({ 2: '    dateFormat DD/MM/YYYY', 4: '        A task          :a1, 01/01/2026, 30d', 7: '        Task in Another :12/01/2026, 12d' }));
    expect(edit('gantt\n  A :2026-01-01, 1d\n', { kind: 'setDateFormat', format: 'DD.MM.YYYY' })).toBe('gantt\n  dateFormat DD.MM.YYYY\n  A :01.01.2026, 1d\n');
    expect(edit('gantt\n  dateFormat DD-MM-YYYY\n  excludes weekends, 05-03-2026\n  A :02-03-2026, 1d\n', { kind: 'setDateFormat', format: 'YYYY-MM-DD' })).toBe(
      'gantt\n  dateFormat YYYY-MM-DD\n  excludes weekends, 2026-03-05\n  A :2026-03-02, 1d\n',
    );
    expect(applyGanttEdit(BASIC, { kind: 'setDateFormat', format: 'MMM D, YYYY' })).toBeNull();
    // From a format whose dates can't be read, nothing could be rewritten.
    expect(applyGanttEdit('gantt\n  dateFormat Do MMM YYYY\n  A :5th Jan 2026, 1d\n', { kind: 'setDateFormat', format: 'YYYY-MM-DD' })).toBeNull();
  });

  it('pins references to task1, task2 … when their numbering changes', () => {
    const src = 'gantt\n  dateFormat YYYY-MM-DD\n  A :2026-01-01, 1d\n  B :2026-01-02, 1d\n  C :after task2, 1d\n';
    expect(edit(src, { kind: 'removeTask', index: 0 })).toBe('gantt\n  dateFormat YYYY-MM-DD\n  B :b, 2026-01-02, 1d\n  C :after b, 1d\n');
  });

  it('keeps CRLF line endings', () => {
    const src = BASIC.replace(/\n/g, '\r\n');
    expect(edit(src, { kind: 'setTaskName', index: 0, name: 'First' })).toBe(withLines({ 4: '        First          :a1, 2026-01-01, 30d' }).replace(/\n/g, '\r\n'));
  });

  it('refuses edits that would break the chart', () => {
    expect(applyGanttEdit('gantt\n  A :2026-01-01, 1d\n', { kind: 'setTaskEnd', index: 0, end: { kind: 'date', date: '2026-01-05' } })).toBeNull();
    expect(applyGanttEdit(BASIC, { kind: 'setTaskStart', index: 0, start: { kind: 'after', tasks: [0] } })).toBeNull();
    expect(applyGanttEdit(BASIC, { kind: 'setTaskStart', index: 0, start: { kind: 'after', tasks: [1] } })).toBeNull();
    expect(applyGanttEdit(BASIC, { kind: 'setTaskStart', index: 0, start: { kind: 'previous' } })).toBeNull();
    // B ends when C starts; C starting when B ends would be a cycle.
    const until = 'gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2026-01-01, 1d\n  B :b, after a, until c\n  C :c, 2026-01-09, 1d\n';
    expect(applyGanttEdit(until, { kind: 'setTaskStart', index: 2, start: { kind: 'previous' } })).toBeNull();
    expect(applyGanttEdit(until, { kind: 'setTaskStart', index: 2, start: { kind: 'after', tasks: [1] } })).toBeNull();
    expect(applyGanttEdit(BASIC, { kind: 'setTaskEnd', index: 0, end: { kind: 'duration', value: -1, unit: 'd' } })).toBeNull();
    expect(applyGanttEdit(BASIC, { kind: 'setTaskStart', index: 0, start: { kind: 'date', date: '2026-02-30' } })).toBeNull();
    expect(applyGanttEdit(BASIC, { kind: 'removeTask', index: 9 })).toBeNull();
    expect(applyGanttEdit('gantt\n  A :crit\n', { kind: 'setTitle', title: 'x' })).toBeNull();
  });
});

// ── Property test over the corpus ────────────────────────────────────

type Ident = number | string;
interface Canon {
  ident: Ident;
  name: string;
  section: string | null;
  flags: GanttModel['tasks'][number]['flags'];
  start: unknown;
  end: unknown;
}

// Schedule semantics, with tasks named by identity (original index, or
// 'new'): "previous" = after the task above; ids resolved.
function canon(m: GanttModel, idents: Ident[]): Canon[] {
  const resolve = (id: string): Ident => {
    let k = -1;
    m.tasks.forEach((t, i) => t.renderId === id && (k = i));
    return k >= 0 ? idents[k] : `?${id}`;
  };
  const refs = (ids: string[]) => ids.map(resolve).map(String).sort();
  return m.tasks.map((t, i) => ({
    ident: idents[i],
    name: t.name,
    section: t.section === null ? null : m.sections[t.section].name,
    flags: t.flags,
    start:
      t.start.kind === 'previous' ? { after: [String(idents[i - 1])] }
      : t.start.kind === 'after' ? { after: refs(t.start.ids) }
      : t.start,
    end: t.end.kind === 'until' ? { until: refs(t.end.ids) } : t.end,
  }));
}

const TRICKY = 'Renamed: "q" #59; %% & <b> 5% title x';

interface Op {
  name: string;
  edit: GanttEdit;
  // Expected canonical tasks and section names.
  expected: () => { tasks: Canon[]; sections: string[]; title?: string; dateFormat?: string };
  // Lines (other than task data rewrites) the op may change.
  touches: (line: number) => boolean;
  // A move: these lines are relocated; every other line keeps its place
  // (task lines up to their data, which pinning may rewrite).
  relocates?: number[];
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
}

function opsFor(src: string): Op[] {
  const parsed = parseGanttSource(src);
  if (!parsed.ok) throw new Error(parsed.reason);
  const { model: m, map } = parsed;
  const lines = src.split('\n');
  const ids = m.tasks.map((_, i) => i);
  const base = canon(m, ids);
  const secs = m.sections.map((s) => s.name);
  const ops: Op[] = [];
  const taskLine = (i: number) => map.tasks[i].line;
  const same = () => ({ tasks: base, sections: secs });
  const mapTask = (i: number, f: (c: Canon) => Canon) => base.map((c, k) => (k === i ? f(c) : c));
  const fm = lines[0]?.trim() === '---' ? lines.indexOf('---', 1) : -1;
  const titleLines = new Set(map.titles.map((t) => t.line));

  ops.push({ name: 'title', edit: { kind: 'setTitle', title: TRICKY }, expected: () => ({ ...same(), title: normalizeUserText(TRICKY) }), touches: (l) => titleLines.has(l) || (fm > 0 && l <= fm) });
  ops.push({ name: 'clear title', edit: { kind: 'setTitle', title: '' }, expected: () => ({ ...same(), title: '' }), touches: (l) => titleLines.has(l) || (fm > 0 && l <= fm) });

  // A different date format: every date reads back as the same day (time
  // as far as the format holds it); raw texts are re-read.
  const fmt = m.dateFormat === 'DD/MM/YYYY' ? 'YYYY-MM-DD' : 'DD/MM/YYYY';
  ops.push({
    name: `dateFormat ${fmt}`,
    edit: { kind: 'setDateFormat', format: fmt },
    expected: () => ({
      dateFormat: fmt,
      sections: secs,
      tasks: base.map((c, i) => {
        const t = m.tasks[i];
        const start = t.start.kind === 'date' ? { kind: 'date', date: ganttDateAs(t.start.date, fmt) } : t.start.kind === 'raw' ? readGanttStart(t.start.text, fmt) : c.start;
        const end = t.end.kind === 'date' ? { kind: 'date', date: ganttDateAs(t.end.date, fmt) } : t.end.kind === 'raw' ? readGanttEnd(t.end.text, fmt) : c.end;
        return { ...c, start, end };
      }),
    }),
    touches: (l) => l === map.dateFormat?.line || l === map.excludes?.line || l === map.includes?.line || m.tasks.some((_, i) => taskLine(i) === l),
  });

  m.sections.forEach((s, si) => {
    const own = m.tasks.flatMap((t, i) => (t.section === si ? [i] : []));
    const lastLine = own.length ? taskLine(own[own.length - 1]) : map.sections[si].line;
    ops.push({
      name: `rename section ${si}`,
      edit: { kind: 'renameSection', index: si, name: TRICKY },
      expected: () => {
        const name = normalizeUserLines(TRICKY);
        return { sections: secs.map((x, k) => (k === si ? name : x)), tasks: base.map((c) => (m.tasks[c.ident as number].section === si ? { ...c, section: name } : c)) };
      },
      touches: (l) => l === map.sections[si].line,
    });
    ops.push({
      name: `remove section ${si}`,
      edit: { kind: 'removeSection', index: si },
      expected: () => ({ sections: secs.filter((_, k) => k !== si), tasks: removed(m, base, new Set(own)) }),
      touches: (l) => (l >= map.sections[si].line && l <= lastLine) || map.clicks.some((c) => c.line === l),
    });
    ops.push({
      name: `add section after ${si}`,
      edit: { kind: 'addSection', name: 'Added', afterIndex: si },
      expected: () => ({ sections: [...secs.slice(0, si + 1), 'Added', ...secs.slice(si + 1)], tasks: base }),
      touches: () => false,
    });
    for (const to of [0, m.sections.length - 1]) {
      if (to === si) continue;
      ops.push({
        name: `move section ${si}→${to}`,
        edit: { kind: 'moveSection', from: si, to },
        expected: () => {
          const order = moveItem(secs.map((_, k) => k), si, to);
          const tasks = [...base.filter((c) => m.tasks[c.ident as number].section === null), ...order.flatMap((k) => base.filter((c) => m.tasks[c.ident as number].section === k))];
          return { sections: order.map((k) => secs[k]), tasks };
        },
        touches: () => false,
        relocates: range(map.sections[si].line, lastLine),
      });
    }
  });
  ops.push({ name: 'add section at end', edit: { kind: 'addSection', name: TRICKY }, expected: () => ({ sections: [...secs, normalizeUserLines(TRICKY)], tasks: base }), touches: () => false });
  ops.push({
    name: 'add section at top',
    edit: { kind: 'addSection', name: 'Top', afterIndex: -1 },
    expected: () => ({ sections: ['Top', ...secs], tasks: base.map((c) => (c.section === null ? { ...c, section: 'Top' } : c)) }),
    touches: () => false,
  });

  m.tasks.forEach((t, i) => {
    const own = (l: number) => l === taskLine(i);
    ops.push({ name: `name ${i}`, edit: { kind: 'setTaskName', index: i, name: TRICKY }, expected: () => ({ sections: secs, tasks: mapTask(i, (c) => ({ ...c, name: normalizeUserText(TRICKY) })) }), touches: own });
    for (const flag of ['done', 'crit', 'milestone'] as const) {
      ops.push({
        name: `flag ${i} ${flag}`,
        edit: { kind: 'setTaskFlag', index: i, flag, on: !t.flags[flag] },
        expected: () => ({ sections: secs, tasks: mapTask(i, (c) => ({ ...c, flags: { ...c.flags, [flag]: !t.flags[flag] } })) }),
        touches: own,
      });
    }
    ops.push({
      name: `end ${i} duration`,
      edit: { kind: 'setTaskEnd', index: i, end: { kind: 'duration', value: 3, unit: 'd' } },
      expected: () => ({ sections: secs, tasks: mapTask(i, (c) => ({ ...c, end: { kind: 'duration', value: 3, unit: 'd' } })) }),
      touches: own,
    });
    if (m.dateFormat) {
      ops.push({
        name: `end ${i} date`,
        edit: { kind: 'setTaskEnd', index: i, end: { kind: 'date', date: '2026-12-24' } },
        expected: () => ({ sections: secs, tasks: mapTask(i, (c) => ({ ...c, end: { kind: 'date', date: ganttDateAs('2026-12-24', m.dateFormat) } })) }),
        touches: own,
      });
    }
    ops.push({
      name: `start ${i} date`,
      edit: { kind: 'setTaskStart', index: i, start: { kind: 'date', date: '2026-03-02' } },
      expected: () => ({ sections: secs, tasks: mapTask(i, (c) => ({ ...c, start: { kind: 'date', date: ganttDateAs('2026-03-02', m.dateFormat || 'YYYY-MM-DD') } })) }),
      touches: own,
    });
    if (i > 0 && !dependsOnTask(m, i - 1, i)) {
      ops.push({
        name: `start ${i} previous`,
        edit: { kind: 'setTaskStart', index: i, start: { kind: 'previous' } },
        expected: () => ({ sections: secs, tasks: mapTask(i, (c) => ({ ...c, start: { after: [String(i - 1)] } })) }),
        touches: own,
      });
      // after the first task, unless that would be a cycle
      if (!dependsOnTask(m, 0, i)) {
        ops.push({
          name: `start ${i} after 0`,
          edit: { kind: 'setTaskStart', index: i, start: { kind: 'after', tasks: [0] } },
          expected: () => ({ sections: secs, tasks: mapTask(i, (c) => ({ ...c, start: { after: ['0'] } })) }),
          touches: own,
        });
      }
    }
    ops.push({
      name: `remove task ${i}`,
      edit: { kind: 'removeTask', index: i },
      expected: () => ({ sections: secs, tasks: removed(m, base, new Set([i])) }),
      touches: (l) => own(l) || map.clicks.some((c) => c.line === l),
    });
    for (const to of [0, m.tasks.length - 1]) {
      if (to === i) continue;
      ops.push({
        name: `move task ${i}→${to}`,
        edit: { kind: 'moveTask', from: i, to },
        expected: () => {
          const tasks = moveItem(base, i, to);
          tasks[to] = { ...tasks[to], section: base[to].section };
          return { sections: secs, tasks };
        },
        touches: () => false,
        relocates: [taskLine(i)],
      });
    }
    for (const s of [null, ...m.sections.map((_, k) => k)]) {
      if (s === t.section) continue;
      ops.push({
        name: `move task ${i} to section ${s}`,
        edit: { kind: 'moveTaskToSection', index: i, section: s },
        expected: () => {
          // At the end of section s: after its last task, else after
          // every task of the sections before it.
          const rest = base.filter((_, k) => k !== i);
          const order = (x: number | null) => (x === null ? -1 : x);
          const sec = (c: Canon) => m.tasks[c.ident as number].section;
          let last = -1;
          rest.forEach((c, k) => sec(c) === s && (last = k));
          const k = last >= 0 ? last + 1 : rest.filter((c) => order(sec(c)) < order(s)).length;
          const moved = { ...base[i], section: s === null ? null : secs[s] };
          return { sections: secs, tasks: [...rest.slice(0, k), moved, ...rest.slice(k)] };
        },
        touches: () => false,
        relocates: [taskLine(i)],
      });
    }
    ops.push({
      name: `add task after ${i}`,
      edit: { kind: 'addTask', name: TRICKY, afterIndex: i, start: { kind: 'previous' }, end: { kind: 'duration', value: 1, unit: 'h' }, flags: { active: true } },
      expected: () => {
        const added: Canon = {
          ident: 'new',
          name: normalizeUserText(TRICKY),
          section: base[i].section,
          flags: { active: true, done: false, crit: false, milestone: false, vert: false },
          start: { after: [String(i)] },
          end: { kind: 'duration', value: 1, unit: 'h' },
        };
        return { sections: secs, tasks: [...base.slice(0, i + 1), added, ...base.slice(i + 1)] };
      },
      touches: () => false,
    });
  });
  return ops;
}

// Does task `a` (transitively) wait on task `b`?
function dependsOnTask(m: GanttModel, a: number, b: number): boolean {
  const seen = new Set<number>();
  const stack = [a];
  while (stack.length) {
    const i = stack.pop()!;
    if (i === b) return true;
    if (seen.has(i)) continue;
    seen.add(i);
    const t = m.tasks[i];
    if (t.start.kind === 'after') stack.push(...t.start.tasks);
    if (t.start.kind === 'previous' && i > 0) stack.push(i - 1);
    if (t.end.kind === 'until') stack.push(...t.end.tasks);
  }
  return false;
}

// The documented removal rules, on the canonical form.
function removed(m: GanttModel, base: Canon[], gone: Set<number>): Canon[] {
  const isGone = (r: string) => gone.has(Number(r)) && /^\d+$/.test(r);
  const startOf = (k: number): unknown => {
    const s = base[k].start as { after?: string[] };
    if (!s.after) return base[k].start;
    const keep = s.after.filter((r) => !isGone(r));
    return keep.length ? { after: keep } : startOf(Number(s.after.find(isGone)));
  };
  return base
    .filter((c) => !gone.has(c.ident as number))
    .map((c) => {
      let start = c.start as { after?: string[] };
      if (start.after?.some(isGone)) {
        const keep = start.after.filter((r) => !isGone(r));
        start = (keep.length ? { after: keep } : startOf(Number(start.after.find(isGone)))) as typeof start;
      }
      let end = c.end as { until?: string[] };
      if (end.until?.some(isGone)) {
        const keep = end.until.filter((r) => !isGone(r));
        const first = m.tasks[Number(end.until.find(isGone))];
        end = (keep.length
          ? { until: keep }
          : first.start.kind === 'date' && m.dateFormat
            ? { kind: 'date', date: ganttDateAs(first.start.date, m.dateFormat) }
            : { kind: 'duration', value: 1, unit: 'd' }) as typeof end;
      }
      return { ...c, start, end };
    });
}

const isGantt = (b: { source: string }) => /^\s*gantt\b/m.test(b.source) && parseGantt(b.source).ok;
const blocks = corpusBlocks(isGantt, ['mermaid-corpus.md', EXTRA_CORPUS]);

describe('gantt edits: corpus property', () => {
  it('finds editable gantts in the corpus', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(9);
  });

  for (const block of blocks) {
    it(`${block.heading}: every visual edit is exact, minimal and valid`, async () => {
      const before = model(block.source);
      const lines = block.source.split('\n');
      const parsed = parseGanttSource(block.source);
      if (!parsed.ok) throw new Error(parsed.reason);
      const taskLines = new Set(parsed.map.tasks.map((t) => t.line));
      for (const op of opsFor(block.source)) {
        const res = applyGanttEdit(block.source, op.edit);
        expect(res, op.name).not.toBeNull();
        const out = res!.source;
        const after = model(out);
        const exp = op.expected();
        // (a) the intended change, and no other task's schedule moved
        const idents = expectedIdents(exp.tasks);
        expect(canon(after, idents), `${op.name}:\n${out}`).toEqual(exp.tasks);
        expect(after.sections.map((s) => s.name), op.name).toEqual(exp.sections);
        expect(after.title, op.name).toBe(exp.title ?? before.title);
        expect(after.dateFormat, op.name).toBe(exp.dateFormat ?? before.dateFormat);
        expect(after.settings.axisFormat, op.name).toBe(before.settings.axisFormat);
        // (b) lines the op doesn't touch survive; another task's line may
        // only have its data rewritten (an id added, a start pinned)
        const prefix = (l: string) => l.slice(0, l.indexOf(':') + 1);
        const prefixes = new Set(out.split('\n').map(prefix));
        if (op.relocates) {
          // Task lines compare by their name part (pinning may rewrite data).
          const rest = (s: string) => {
            const p = parseGanttSource(s);
            const tl = new Set(p.ok ? p.map.tasks.map((t) => t.line) : []);
            return s.split('\n').map((l, i) => (tl.has(i) ? prefix(l) : l));
          };
          const moved = new Set(op.relocates.map((l) => rest(block.source)[l]));
          const keep = (s: string) => rest(s).filter((l) => !moved.has(l));
          expect(keep(out), `${op.name}:\n${out}`).toEqual(keep(block.source));
        }
        for (const l of op.relocates ? [] : removedLines(block.source, out)) {
          const ok = lines.some((x, j) => x === l && (op.touches(j) || (taskLines.has(j) && prefixes.has(prefix(l)))));
          expect(ok, `${op.name} changed an unrelated line ${JSON.stringify(l)}:\n${out}`).toBe(true);
        }
        // (c) mermaid accepts it and can lay it out
        expect(await drawable(out), `${op.name}:\n${out}`).toBe(true);
      }
    }, 180_000);
  }
});

// The identity of each output task: the expected list says it, in order.
function expectedIdents(tasks: Canon[]): Ident[] {
  return tasks.map((c) => c.ident);
}

// ── Fuzz ─────────────────────────────────────────────────────────────

describe('gantt edits: fuzz over typed text', () => {
  const SRC = 'gantt\n    title Old\n    dateFormat YYYY-MM-DD\n    section One\n    First :a, 2026-01-01, 2d\n    Second :2d\n';
  for (const input of FUZZ_INPUTS) {
    it(`every text field ${JSON.stringify(input)}`, async () => {
      const shown = normalizeUserText(input);
      const cases: Array<{ e: GanttEdit; read: (m: GanttModel) => string; drawn: (svg: SVGSVGElement, m: GanttModel) => Element | null }> = [
        { e: { kind: 'setTitle', title: input }, read: (m) => m.title, drawn: (svg) => svg.querySelector('text.titleText') },
        { e: { kind: 'setTaskName', index: 1, name: input }, read: (m) => m.tasks[1].name, drawn: (svg, m) => svg.querySelector(`[id="${svg.id}-${m.tasks[1].renderId}-text"]`) },
        {
          e: { kind: 'addTask', name: input, section: 0, start: { kind: 'previous' }, end: { kind: 'duration', value: 1, unit: 'd' } },
          read: (m) => m.tasks[2].name,
          drawn: (svg, m) => svg.querySelector(`[id="${svg.id}-${m.tasks[2].renderId}-text"]`),
        },
        { e: { kind: 'renameSection', index: 0, name: input }, read: (m) => m.sections[0].name, drawn: (svg) => svg.querySelector('text.sectionTitle') },
      ];
      for (const c of cases) {
        const out = edit(SRC, c.e);
        expect(await drawable(out), out).toBe(true);
        const m = model(out);
        expect(m.tasks.length, out).toBeGreaterThanOrEqual(2);
        expect(c.read(m), out).toBe(shown);
        const svg = await renderSvg(out);
        expect(shownText(c.drawn(svg, m)), out).toBe(shown);
      }
      // A new, empty section is not drawn (mermaid draws sections with tasks).
      const sec = edit(SRC, { kind: 'addSection', name: input });
      expect(await drawable(sec), sec).toBe(true);
      expect(model(sec).sections[1].name).toBe(shown);
    }, 30_000);
  }
});
