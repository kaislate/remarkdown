// Source-preserving visual edits for gantt charts — the gantt
// counterpart of mermaid-flowchart-edit.ts (see there for the why).
//
// Every task is one line: `Name :tags, id, start, end`. Edits splice the
// part they change (the name, one data item, one tag) and keep every
// other byte of the line, including how its items are spaced. Removes /
// moves drop or relocate whole lines; adds insert one.
//
// Gantt tasks depend on each other, and an edit must never leave a task
// pointing at something that moved or vanished. The rules:
//   - A task with no start ("previous") starts when the task above it
//     ends. Adding, removing or moving tasks changes what is above; any
//     task whose predecessor changes is written as `after <its old
//     predecessor>` instead, so its schedule stays the same. (Rows are
//     source order; dates never move because a row did.)
//   - Removing a task: tasks that start `after` it lose it from the list;
//     if the list empties they take over its start (as written). Tasks
//     that end `until` it lose it likewise; if that list empties they end
//     on its start date (or after 1 day when it has none). `click` lines
//     for it alone go.
//   - Removing a section removes its tasks, by the same rules.
//   - References need ids. A task that gets referenced (a new `after` /
//     `until`, or one of the rewrites above) and has none gets one,
//     derived from its name. Tasks without an id are known to mermaid as
//     task1, task2 … in order, so when a structural edit renumbers them,
//     references to those numbers are pinned to explicit ids first.
// Dates arrive as model date strings and are written in the chart's
// dateFormat; changing the dateFormat rewrites every task date into the
// new one (and dates in `excludes` / `includes` as YYYY-MM-DD, which
// mermaid always honours).
import {
  parseGanttSource,
  GANTT_FLAGS,
  readGanttEnd,
  readGanttStart,
  type GanttDurationUnit,
  type GanttFlag,
  type GanttFlags,
  type GanttModel,
  type GanttSourceMap,
  type GanttTaskSource,
} from './gantt-parser';
import { formatGanttDate, fromGanttDate, ganttDateFormatSupported, parseGanttDate } from './gantt-dates';
import { indentFor, indentOf, isBlankOrComment, lastStatementLine, nextFreeId, replaceSpan, type Span } from './source-text';
import { ALWAYS_ENCODED, EMPTY_TEXT, emitDecimal, encodeChars, encodeFirstChar, encodeLines } from './display-text';
import { applyTitle } from './title-edit';

export type GanttStartInput =
  | { kind: 'date'; date: string }
  // Indices of the tasks it waits for.
  | { kind: 'after'; tasks: number[] }
  // Right when the task above it ends.
  | { kind: 'previous' };

export type GanttEndInput =
  | { kind: 'duration'; value: number; unit: GanttDurationUnit }
  | { kind: 'date'; date: string }
  | { kind: 'until'; tasks: number[] };

export type GanttEdit =
  // '' removes the title.
  | { kind: 'setTitle'; title: string }
  // One of GANTT_DATE_FORMATS (or any format ganttDateFormatSupported
  // accepts). Rewrites every task date.
  | { kind: 'setDateFormat'; format: string }
  // After section `afterIndex`'s tasks (default: at the end); -1 puts it
  // above every task, so tasks that had no section join it.
  | { kind: 'addSection'; name: string; afterIndex?: number }
  | { kind: 'renameSection'; index: number; name: string }
  // Removes the section AND its tasks (see the rules above).
  | { kind: 'removeSection'; index: number }
  | { kind: 'moveSection'; from: number; to: number }
  // Right after task `afterIndex` (in its section), else at the end of
  // `section` (null: above the first section), else at the end of the
  // last section.
  | {
      kind: 'addTask';
      name: string;
      start: GanttStartInput;
      end: GanttEndInput;
      section?: number | null;
      afterIndex?: number;
      flags?: Partial<GanttFlags>;
    }
  | { kind: 'setTaskName'; index: number; name: string }
  // `previous` on a task that has an id is written `after <the task
  // above>` (an id needs an explicit start), so it reads back as 'after'.
  | { kind: 'setTaskStart'; index: number; start: GanttStartInput }
  | { kind: 'setTaskEnd'; index: number; end: GanttEndInput }
  | { kind: 'setTaskFlag'; index: number; flag: GanttFlag; on: boolean }
  | { kind: 'removeTask'; index: number }
  // Task `from` ends up at index `to`, in the section of the task that
  // was at `to`.
  | { kind: 'moveTask'; from: number; to: number }
  // To the end of `section` (null: above the first section).
  | { kind: 'moveTaskToSection'; index: number; section: number | null };

export interface GanttEditResult {
  source: string;
  // Index of the section / task an add edit created.
  index?: number;
}

// ── Writing text ─────────────────────────────────────────────────────

// Starts the lexer would read as a statement rather than a task name.
const TASK_KEYWORD = /^(?:gantt\b|dateFormat\s|inclusiveEndDates\b|topAxis\b|axisFormat\s|tickInterval\s|includes\s|excludes\s|todayMarker\s|weekday\s|weekend\s|title\s|accTitle|accDescr|section\s|click\s|href\s|call\s|\d\d\d\d-\d\d-\d\d\b)/i;

// A task name ends at `:`; a `%` near its start comments the line out.
export function emitGanttTaskName(text: string): string {
  const out = encodeChars(text, `${ALWAYS_ENCODED}:%`);
  if (!out) return EMPTY_TEXT;
  return TASK_KEYWORD.test(out) ? encodeFirstChar(out) : out;
}

// A section name runs to the end of the line; `<br>` is a line break.
export function emitGanttSectionName(text: string): string {
  const out = encodeLines(text, ALWAYS_ENCODED);
  return out.replace(/<br>/g, '') ? out : EMPTY_TEXT + out;
}

function emitTitle(text: string): string {
  return encodeChars(text, ALWAYS_ENCODED);
}

// A date in the chart's format ('' = none: ISO, which mermaid's Date
// fallback reads). null when the format can't be written.
function emitDate(date: string, dateFormat: string): string | null {
  const d = fromGanttDate(date);
  if (!d) return null;
  if (!dateFormat) return formatGanttDate(d, d.getHours() || d.getMinutes() || d.getSeconds() ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD');
  return ganttDateFormatSupported(dateFormat) ? formatGanttDate(d, dateFormat) : null;
}

export function isValidGanttDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

// ── Task lines ───────────────────────────────────────────────────────

// One task line, as its parts: the text up to and including the `:`, and
// the comma-separated data parts (raw, whitespace kept).
class TaskLine {
  private constructor(
    private prefix: string,
    private nameSpan: Span,
    private parts: string[],
    private tags: number,
    // Roles of the item parts (after the tags), in order.
    private roles: Array<'id' | 'start' | 'end'>,
  ) {}

  static fromSource(line: string, t: GanttTaskSource): TaskLine {
    const parts = t.parts.map((p) => line.slice(p.start, p.end));
    const n = parts.length - t.tags;
    const roles: Array<'id' | 'start' | 'end'> = n === 3 ? ['id', 'start', 'end'] : n === 2 ? ['start', 'end'] : ['end'];
    return new TaskLine(line.slice(0, t.colon + 1), t.name, parts, t.tags, roles);
  }

  static create(indent: string, name: string, tags: string[], start: string | null, end: string): TaskLine {
    const prefix = `${indent}${name} :`;
    const items = start === null ? [end] : [start, end];
    const parts = [...tags, ...items].map((p, i) => (i === 0 ? p : ` ${p}`));
    return new TaskLine(prefix, { start: indent.length, end: indent.length + name.length }, parts, tags.length, start === null ? ['end'] : ['start', 'end']);
  }

  get name(): string {
    return this.prefix.slice(this.nameSpan.start, this.nameSpan.end);
  }

  setName(name: string): void {
    this.prefix = replaceSpan(this.prefix, this.nameSpan, name);
    this.nameSpan = { start: this.nameSpan.start, end: this.nameSpan.start + name.length };
  }

  private itemIndex(role: 'id' | 'start' | 'end'): number {
    const k = this.roles.indexOf(role);
    return k < 0 ? -1 : this.tags + k;
  }

  get(role: 'id' | 'start' | 'end'): string | null {
    const k = this.itemIndex(role);
    return k < 0 ? null : this.parts[k].trim();
  }

  // Replace an item's text, keeping the whitespace around it.
  private put(k: number, text: string): void {
    const raw = this.parts[k];
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    this.parts[k] = raw.slice(0, lead) + text + raw.slice(raw.length - trail);
  }

  // Insert a part at index k (k may be parts.length).
  private insert(k: number, text: string): void {
    if (k === 0 && this.parts.length) {
      // The new first part takes over the old first part's lead-in.
      const old = this.parts[0];
      const lead = old.length - old.trimStart().length;
      this.parts[0] = ` ${old.slice(lead)}`;
      this.parts.unshift(old.slice(0, lead) + text);
    } else {
      this.parts.splice(k, 0, ` ${text}`);
    }
  }

  private remove(k: number): void {
    if (k === 0 && this.parts.length > 1) {
      const old = this.parts[0];
      const lead = old.slice(0, old.length - old.trimStart().length);
      this.parts.splice(0, 1);
      this.parts[0] = lead + this.parts[0].trimStart();
    } else {
      this.parts.splice(k, 1);
    }
  }

  set(role: 'start' | 'end', text: string): void {
    const k = this.itemIndex(role);
    if (k >= 0) return this.put(k, text);
    // Only a start can be missing: insert it before the end (after the id).
    this.insert(this.itemIndex('end'), text);
    this.roles.splice(this.roles.indexOf('end'), 0, 'start');
  }

  // Drop the start ("previous"); only possible without an id.
  dropStart(): boolean {
    if (this.get('id') !== null) return false;
    const k = this.itemIndex('start');
    if (k >= 0) {
      this.remove(k);
      this.roles.splice(this.roles.indexOf('start'), 1);
    }
    return true;
  }

  // Give the task an id; it must have a start.
  setId(id: string): void {
    const k = this.itemIndex('start');
    if (k < 0) throw new Error('setId without a start');
    this.insert(k, id);
    this.roles.unshift('id');
  }

  flags(): Set<string> {
    return new Set(this.parts.slice(0, this.tags).map((p) => p.trim()));
  }

  setFlag(flag: GanttFlag, on: boolean): void {
    const has = this.flags().has(flag);
    if (on && !has) {
      this.insert(this.tags, flag);
      this.tags++;
    } else if (!on && has) {
      for (let k = this.tags - 1; k >= 0; k--) {
        if (this.parts[k].trim() === flag) {
          this.remove(k);
          this.tags--;
        }
      }
    }
  }

  toString(): string {
    return this.prefix + this.parts.join(',');
  }
}

// ── The document being edited ────────────────────────────────────────

interface TaskEntry {
  kind: 'task';
  t: TaskLine;
  // Index in the original model; null for a task this edit adds.
  orig: number | null;
}
interface LineEntry {
  kind: 'line';
  text: string;
  orig: number;
}
type Entry = TaskEntry | LineEntry;

class Failed extends Error {}

class GanttDoc {
  entries: Entry[];
  readonly taskEntry: TaskEntry[];
  readonly removed = new Set<number>();
  // Original renderId → original task index (the last one with it, as
  // mermaid resolves them).
  private readonly byOldId = new Map<string, number>();
  private readonly taken = new Set<string>();
  // Ids this edit created (references to them are explicit by design).
  private readonly created = new Set<string>();

  constructor(readonly model: GanttModel, readonly map: GanttSourceMap) {
    const taskAt = new Map(map.tasks.map((t, i) => [t.line, i]));
    this.taskEntry = [];
    this.entries = map.lines.map((text, line) => {
      const i = taskAt.get(line);
      if (i === undefined) return { kind: 'line', text, orig: line } as LineEntry;
      const e: TaskEntry = { kind: 'task', t: TaskLine.fromSource(text, map.tasks[i]), orig: i };
      this.taskEntry[i] = e;
      return e;
    });
    model.tasks.forEach((t, i) => {
      this.byOldId.set(t.renderId, i);
      this.taken.add(t.renderId);
      if (t.id) this.taken.add(t.id);
    });
  }

  tasks(): TaskEntry[] {
    return this.entries.filter((e): e is TaskEntry => e.kind === 'task');
  }

  // Position in `entries` of original line `line` (lines never move
  // before structural edits are done with them).
  at(line: number): number {
    return this.entries.findIndex((e) => (e.kind === 'line' ? e.orig === line : e.orig !== null && this.map.tasks[e.orig].line === line));
  }

  indexOfEntry(e: Entry): number {
    return this.entries.indexOf(e);
  }

  // ── ids ──

  private newId(name: string): string {
    const slug = name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/#\w+;/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      // At most ~24 characters, cut between words.
      .replace(/^(.{0,24})(?:-.*|$)/, '$1')
      .slice(0, 24);
    const free = (id: string) => !this.taken.has(id) && !/^task\d+$/.test(id);
    const id = slug && /^[a-z]/.test(slug) && free(slug) ? slug : nextFreeId((x) => !free(x), slug && /^[a-z]/.test(slug) ? `${slug}-` : 't');
    this.taken.add(id);
    this.created.add(id);
    return id;
  }

  // The id of task entry `e`, giving it one if it has none.
  ensureId(e: TaskEntry): string {
    const own = e.t.get('id');
    if (own !== null) return own;
    if (e.t.get('start') === null) e.t.set('start', this.startFor(e));
    const id = this.newId(e.t.name);
    e.t.setId(id);
    return id;
  }

  // The predecessor whose end a "previous" start means: the original one
  // for original tasks, the one above for new tasks.
  private previousOf(e: TaskEntry): { orig: number } | { entry: TaskEntry } | null {
    if (e.orig !== null) return e.orig > 0 ? { orig: e.orig - 1 } : null;
    const list = this.tasks();
    const k = list.indexOf(e);
    return k > 0 ? { entry: list[k - 1] } : null;
  }

  // An explicit start text meaning what "previous" means for `e`.
  startFor(e: TaskEntry): string {
    const p = this.previousOf(e);
    if (!p) throw new Failed('first task cannot start after the previous one');
    if ('entry' in p) return `after ${this.ensureId(p.entry)}`;
    if (this.removed.has(p.orig)) return this.resolvedStart(p.orig);
    return `after ${this.ensureId(this.taskEntry[p.orig])}`;
  }

  // The start of removed task k, as a start for a task that waited on it.
  resolvedStart(k: number): string {
    const e = this.taskEntry[k];
    const start = e.t.get('start');
    if (start === null) return this.startFor(e);
    const ids = /^after\s+([\d\w\- ]+)/.exec(start)?.[1].split(' ').filter(Boolean);
    if (!ids) return start;
    const keep = ids.filter((id) => !this.isRemovedId(id));
    if (keep.length) return `after ${keep.join(' ')}`;
    return this.resolvedStart(this.byOldId.get(ids[0])!);
  }

  isRemovedId(id: string): boolean {
    const k = this.byOldId.get(id);
    return k !== undefined && this.removed.has(k) && !this.created.has(id);
  }

  // ── structure ──

  removeTasks(set: Set<number>): void {
    for (const k of set) this.removed.add(k);
    this.entries = this.entries.filter((e) => !(e.kind === 'task' && e.orig !== null && set.has(e.orig)));
    for (const e of this.tasks()) {
      const start = e.t.get('start');
      const after = start && /^after\s+([\d\w\- ]+)/.exec(start)?.[1].split(' ').filter(Boolean);
      if (after && after.some((id) => this.isRemovedId(id))) {
        const keep = after.filter((id) => !this.isRemovedId(id));
        const first = after.find((id) => this.isRemovedId(id))!;
        e.t.set('start', keep.length ? `after ${keep.join(' ')}` : this.resolvedStart(this.byOldId.get(first)!));
      }
      const end = e.t.get('end')!;
      const until = /^until\s+([\d\w\- ]+)/.exec(end)?.[1].split(' ').filter(Boolean);
      if (until && until.some((id) => this.isRemovedId(id))) {
        const keep = until.filter((id) => !this.isRemovedId(id));
        const first = this.byOldId.get(until.find((id) => this.isRemovedId(id))!)!;
        const s = this.model.tasks[first].start;
        const date = s.kind === 'date' ? emitDate(s.date, this.model.dateFormat) : null;
        e.t.set('end', keep.length ? `until ${keep.join(' ')}` : date && this.model.dateFormat ? date : '1d');
      }
    }
    // `click` lines for removed tasks only.
    const clickLines = new Map(this.map.clicks.map((c) => [c.line, c.ids]));
    this.entries = this.entries.filter((e) => {
      if (e.kind !== 'line' || !clickLines.has(e.orig)) return true;
      const ids = clickLines.get(e.orig)!;
      return !(ids.length && ids.every((id) => this.isRemovedId(id)));
    });
  }

  // Tasks without a start whose predecessor changed: pin them to the old one.
  fixPrevious(): void {
    const list = this.tasks();
    list.forEach((e, k) => {
      if (e.orig === null || e.t.get('start') !== null || e.orig === 0) return;
      const was = e.orig - 1;
      const now = k > 0 ? list[k - 1] : null;
      if (this.removed.has(was) || this.taskEntry[was] !== now) e.t.set('start', this.startFor(e));
    });
    // A new first task can't be "previous" either.
    const first = this.tasks()[0];
    if (first && first.t.get('start') === null && first.orig === null) throw new Failed('first task needs a start');
  }

  // References to task1, task2 … whose numbering changed: pin them.
  fixReferences(): void {
    for (let guard = 0; guard < 1000; guard++) {
      const renderOf = new Map<TaskEntry, string>();
      let auto = 0;
      for (const e of this.tasks()) renderOf.set(e, e.t.get('id') ?? `task${++auto}`);
      const fix = this.findStaleReference(renderOf);
      if (!fix) return;
      const id = this.ensureId(fix.target);
      fix.rewrite(id);
    }
    throw new Failed('references did not settle');
  }

  private findStaleReference(renderOf: Map<TaskEntry, string>): { target: TaskEntry; rewrite: (id: string) => void } | null {
    const stale = (id: string): TaskEntry | null => {
      if (this.created.has(id)) return null;
      const k = this.byOldId.get(id);
      if (k === undefined || this.removed.has(k)) return null;
      const target = this.taskEntry[k];
      return renderOf.get(target) === id ? null : target;
    };
    const swap = (list: string[], from: string, to: string) => list.map((x) => (x === from ? to : x));
    for (const e of this.tasks()) {
      for (const role of ['start', 'end'] as const) {
        const text = e.t.get(role);
        const m = text && new RegExp(`^(${role === 'start' ? 'after' : 'until'}\\s+)([\\d\\w\\- ]+)(.*)$`).exec(text);
        if (!m) continue;
        const ids = m[2].split(' ').filter(Boolean);
        for (const id of ids) {
          const target = stale(id);
          if (target) return { target, rewrite: (to) => e.t.set(role, `${m[1]}${swap(ids, id, to).join(' ')}${m[3]}`) };
        }
      }
    }
    for (const c of this.map.clicks) {
      const k = this.entries.findIndex((e) => e.kind === 'line' && e.orig === c.line);
      if (k < 0) continue;
      const entry = this.entries[k] as LineEntry;
      const m = /^(\s*click\s+)(\S+)(.*)$/i.exec(entry.text);
      if (!m) continue;
      const ids = m[2].split(',');
      for (const id of ids) {
        const target = stale(id);
        if (target) return { target, rewrite: (to) => (entry.text = `${m[1]}${swap(ids, id, to).join(',')}${m[3]}`) };
      }
    }
    return null;
  }

  // Would task `from` depending on tasks `on` close a cycle?
  dependsOn(on: number[], from: number): boolean {
    const deps = (i: number): number[] => {
      const t = this.model.tasks[i];
      const out: number[] = [];
      if (t.start.kind === 'after') out.push(...t.start.tasks);
      if (t.start.kind === 'previous' && i > 0) out.push(i - 1);
      if (t.end.kind === 'until') out.push(...t.end.tasks);
      return out;
    };
    const seen = new Set<number>();
    const stack = [...on];
    while (stack.length) {
      const i = stack.pop()!;
      if (i === from) return true;
      if (seen.has(i)) continue;
      seen.add(i);
      stack.push(...deps(i));
    }
    return false;
  }

  toString(): string {
    return this.entries.map((e) => (e.kind === 'task' ? e.t.toString() : e.text)).join(this.map.eol);
  }
}

// ── The edits ────────────────────────────────────────────────────────

function valid(i: number | undefined, n: number): i is number {
  return i !== undefined && Number.isInteger(i) && i >= 0 && i < n;
}

export function applyGanttEdit(source: string, edit: GanttEdit): GanttEditResult | null {
  const parsed = parseGanttSource(source);
  if (!parsed.ok) return null;
  try {
    return apply(source, parsed.model, parsed.map, edit);
  } catch (e) {
    if (e instanceof Failed) return null;
    throw e;
  }
}

function apply(source: string, model: GanttModel, map: GanttSourceMap, edit: GanttEdit): GanttEditResult | null {
  const doc = new GanttDoc(model, map);
  const nTasks = model.tasks.length;
  const nSections = model.sections.length;
  const lines = map.lines;

  // Section s: its line through its last task's line.
  const sectionRange = (s: number): [number, number] => {
    const own = model.tasks.flatMap((t, i) => (t.section === s ? [map.tasks[i].line] : []));
    return [map.sections[s].line, own.length ? own[own.length - 1] : map.sections[s].line];
  };
  // The original line after which a task appended to section s goes.
  const endOfSection = (s: number | null, except = -1): number => {
    const own = model.tasks.flatMap((t, i) => (t.section === s && i !== except ? [map.tasks[i].line] : []));
    if (own.length) return own[own.length - 1];
    if (s !== null) return map.sections[s].line;
    return nSections ? map.sections[0].line - 1 : lastStatementLine(lines, map.headerLine);
  };
  const taskIndent = (near: number): string => {
    const sample = map.tasks.length ? map.tasks[Math.min(near, map.tasks.length - 1)] : null;
    return sample ? indentOf(lines[sample.line]) : indentFor(lines, map.headerLine, map.headerLine);
  };
  // Move entries [a, b] (original lines) to right after original line
  // `after` (-1: the top).
  const relocate = (a: number, b: number, after: number) => {
    const ia = doc.at(a);
    const ib = doc.at(b);
    const block = doc.entries.slice(ia, ib + 1);
    doc.entries.splice(ia, ib - ia + 1);
    const k = after < 0 ? 0 : doc.at(after) + 1;
    doc.entries.splice(k, 0, ...block);
  };
  const startText = (s: GanttStartInput, self: number | null): string | null => {
    if (s.kind === 'previous') return null;
    if (s.kind === 'date') {
      const d = emitDate(s.date, model.dateFormat);
      if (d === null) throw new Failed('date not writable');
      return d;
    }
    if (!s.tasks.length || s.tasks.some((k) => !valid(k, nTasks) || k === self)) throw new Failed('bad after');
    if (self !== null && doc.dependsOn(s.tasks, self)) throw new Failed('cycle');
    return `after ${s.tasks.map((k) => doc.ensureId(doc.taskEntry[k])).join(' ')}`;
  };
  const endText = (e: GanttEndInput, self: number | null): string => {
    if (e.kind === 'duration') {
      if (!isValidGanttDuration(e.value)) throw new Failed('bad duration');
      return `${emitDecimal(e.value)}${e.unit}`;
    }
    if (e.kind === 'date') {
      // mermaid reads end dates only in an explicit dateFormat.
      if (!model.dateFormat) throw new Failed('end dates need a dateFormat');
      const d = emitDate(e.date, model.dateFormat);
      if (d === null) throw new Failed('date not writable');
      return d;
    }
    if (!e.tasks.length || e.tasks.some((k) => !valid(k, nTasks) || k === self)) throw new Failed('bad until');
    if (self !== null && doc.dependsOn(e.tasks, self)) throw new Failed('cycle');
    return `until ${e.tasks.map((k) => doc.ensureId(doc.taskEntry[k])).join(' ')}`;
  };
  const finish = (index?: (doc: GanttDoc) => number): GanttEditResult => {
    doc.fixPrevious();
    doc.fixReferences();
    const out: GanttEditResult = { source: doc.toString() };
    if (index) out.index = index(doc);
    return out;
  };

  switch (edit.kind) {
    case 'setTitle':
      return { source: applyTitle(source, map.titles, edit.title, emitTitle) };

    case 'setDateFormat': {
      const format = edit.format.trim();
      if (!ganttDateFormatSupported(format)) return null;
      if (format === model.dateFormat) return { source };
      model.tasks.forEach((t, i) => {
        const e = doc.taskEntry[i];
        if (t.start.kind === 'date') e.t.set('start', formatGanttDate(fromGanttDate(t.start.date)!, format));
        if (t.end.kind === 'date') e.t.set('end', formatGanttDate(fromGanttDate(t.end.date)!, format));
      });
      // Dates in excludes / includes: as YYYY-MM-DD, which mermaid
      // matches whatever the dateFormat.
      for (const s of [map.excludes, map.includes]) {
        if (!s || !ganttDateFormatSupported(model.dateFormat)) continue;
        const entry = doc.entries[doc.at(s.line)] as LineEntry;
        const value = entry.text.slice(s.value.start, s.value.end).replace(/[^\s,]+/g, (tok) => {
          if (/^\d{4}-\d\d-\d\d$/.test(tok)) return tok;
          const d = parseGanttDate(tok, model.dateFormat);
          return d ? formatGanttDate(d, 'YYYY-MM-DD') : tok;
        });
        entry.text = replaceSpan(entry.text, s.value, value);
      }
      if (map.dateFormat) {
        const entry = doc.entries[doc.at(map.dateFormat.line)] as LineEntry;
        entry.text = replaceSpan(entry.text, map.dateFormat.value, format);
      } else {
        // Below the title when it comes first, else below the header.
        const first = map.titles[0];
        const firstStatement = Math.min(map.tasks[0]?.line ?? Infinity, map.sections[0]?.line ?? Infinity);
        const after = first && first.line < firstStatement ? first.line : map.headerLine;
        doc.entries.splice(doc.at(after) + 1, 0, { kind: 'line', text: `${indentFor(lines, after, map.headerLine)}dateFormat ${format}`, orig: -1 });
      }
      return { source: doc.toString() };
    }

    case 'addSection': {
      let after: number;
      let index: number;
      if (edit.afterIndex === -1) {
        const first = Math.min(map.tasks[0]?.line ?? Infinity, map.sections[0]?.line ?? Infinity);
        after = Number.isFinite(first) ? first - 1 : lastStatementLine(lines, map.headerLine);
        index = 0;
      } else if (edit.afterIndex !== undefined) {
        if (!valid(edit.afterIndex, nSections)) return null;
        after = sectionRange(edit.afterIndex)[1];
        index = edit.afterIndex + 1;
      } else {
        after = lastStatementLine(lines, map.headerLine);
        index = nSections;
      }
      const indent = nSections ? indentOf(lines[map.sections[0].line]) : indentFor(lines, after, map.headerLine);
      doc.entries.splice(doc.at(after) + 1, 0, { kind: 'line', text: `${indent}section ${emitGanttSectionName(edit.name)}`, orig: -1 });
      return { source: doc.toString(), index };
    }

    case 'renameSection': {
      if (!valid(edit.index, nSections)) return null;
      const s = map.sections[edit.index];
      const entry = doc.entries[doc.at(s.line)] as LineEntry;
      entry.text = replaceSpan(entry.text, s.name, emitGanttSectionName(edit.name));
      return { source: doc.toString() };
    }

    case 'removeSection': {
      if (!valid(edit.index, nSections)) return null;
      const [a, b] = sectionRange(edit.index);
      const own = new Set(model.tasks.flatMap((t, i) => (t.section === edit.index ? [i] : [])));
      // The section line, plus comments / blank lines among its tasks.
      const drop = new Set<number>([a]);
      for (let l = a + 1; l < b; l++) if (isBlankOrComment(lines[l])) drop.add(l);
      doc.entries = doc.entries.filter((e) => !(e.kind === 'line' && drop.has(e.orig)));
      doc.removeTasks(own);
      return finish();
    }

    case 'moveSection': {
      const { from, to } = edit;
      if (!valid(from, nSections) || !valid(to, nSections)) return null;
      if (from === to) return { source };
      const [a, b] = sectionRange(from);
      relocate(a, b, to < from ? map.sections[to].line - 1 : sectionRange(to)[1]);
      return finish();
    }

    case 'addTask': {
      let after: number;
      let section: number | null;
      if (edit.afterIndex !== undefined) {
        if (!valid(edit.afterIndex, nTasks)) return null;
        after = map.tasks[edit.afterIndex].line;
        section = model.tasks[edit.afterIndex].section;
      } else {
        section = edit.section !== undefined ? edit.section : nSections ? nSections - 1 : null;
        if (section !== null && !valid(section, nSections)) return null;
        after = endOfSection(section);
      }
      const tags = GANTT_FLAGS.filter((f) => edit.flags?.[f]);
      const entry: TaskEntry = {
        kind: 'task',
        orig: null,
        t: TaskLine.create(taskIndent(edit.afterIndex ?? nTasks - 1), emitGanttTaskName(edit.name), tags, null, endText(edit.end, null)),
      };
      doc.entries.splice(doc.at(after) + 1, 0, entry);
      const start = startText(edit.start, null);
      if (start !== null) entry.t.set('start', start);
      else if (doc.tasks()[0] === entry) return null;
      return finish((d) => d.tasks().indexOf(entry));
    }

    case 'setTaskName': {
      if (!valid(edit.index, nTasks)) return null;
      doc.taskEntry[edit.index].t.setName(emitGanttTaskName(edit.name));
      return { source: doc.toString() };
    }

    case 'setTaskStart': {
      if (!valid(edit.index, nTasks)) return null;
      const e = doc.taskEntry[edit.index];
      const text = startText(edit.start, edit.index);
      if (text !== null) e.t.set('start', text);
      else {
        // The first task has nothing above it; a task above that waits
        // for this one would make a cycle.
        if (edit.index === 0 || doc.dependsOn([edit.index - 1], edit.index)) return null;
        if (!e.t.dropStart()) e.t.set('start', `after ${doc.ensureId(doc.taskEntry[edit.index - 1])}`);
      }
      return finish();
    }

    case 'setTaskEnd': {
      if (!valid(edit.index, nTasks)) return null;
      doc.taskEntry[edit.index].t.set('end', endText(edit.end, edit.index));
      return finish();
    }

    case 'setTaskFlag': {
      if (!valid(edit.index, nTasks) || !(GANTT_FLAGS as readonly string[]).includes(edit.flag)) return null;
      doc.taskEntry[edit.index].t.setFlag(edit.flag, edit.on);
      return { source: doc.toString() };
    }

    case 'removeTask': {
      if (!valid(edit.index, nTasks)) return null;
      doc.removeTasks(new Set([edit.index]));
      return finish();
    }

    case 'moveTask': {
      const { from, to } = edit;
      if (!valid(from, nTasks) || !valid(to, nTasks)) return null;
      if (from === to) return { source };
      const line = map.tasks[from].line;
      relocate(line, line, to < from ? map.tasks[to].line - 1 : map.tasks[to].line);
      return finish();
    }

    case 'moveTaskToSection': {
      if (!valid(edit.index, nTasks)) return null;
      if (edit.section !== null && !valid(edit.section, nSections)) return null;
      if (model.tasks[edit.index].section === edit.section) return { source };
      const line = map.tasks[edit.index].line;
      relocate(line, line, endOfSection(edit.section, edit.index));
      return finish();
    }
  }
}

// What a start / end text reads as in a chart (for previews).
export { readGanttStart, readGanttEnd };
