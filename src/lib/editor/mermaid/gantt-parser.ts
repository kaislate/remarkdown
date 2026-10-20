// Parser for mermaid gantt charts — the syntax mermaid 11's gantt.jison
// accepts, read the way its lexer and db read it:
//
//   gantt
//     title …  /  accTitle: …  /  accDescr …
//     dateFormat YYYY-MM-DD      (how task dates are written)
//     axisFormat / tickInterval / excludes / includes / todayMarker /
//     weekday … / weekend … / inclusiveEndDates / topAxis   (settings)
//     section Name
//     Task name :[tags,] [id,] [start,] end
//     click id href "…" / click id call fn()
//   plus blank lines, `%%` comments, `%%{init}%%` directives, frontmatter.
//
// Task data, as mermaid's db reads it: leading tags (active, done, crit,
// milestone, vert — any order), then 1 item (end; the task starts when
// the previous one ends), 2 items (start, end) or 3 (id, start, end).
//   start: `after id …` | a date in the chart's dateFormat | (mermaid's
//          fallback) anything JavaScript's Date reads — the model takes
//          ISO-shaped text as a date and keeps the rest raw
//   end:   `until id …` | a date in the dateFormat | a duration (`3d`,
//          `1.5h`, `90m`, `2w` …) | anything else (a zero-length task)
// A task without an id gets `task1`, `task2` … in order — the id mermaid
// gives its svg elements.
//
// The lexer is keyword-first and case-insensitive: a task whose name
// starts like a keyword (`title …`, `section …`) is that statement. Model
// text is what mermaid displays (entity codes decoded, whitespace
// collapsed; `<br>` in a section name is a line break, '\n').
//
// Bails (ok:false) on what mermaid rejects or crashes on (tags without
// dates, more than 3 items, a `#` after task data, a name starting with
// `call` / `href` / a date) and on `;` after task data (mermaid reads it
// as the start of the next task's name).
import { findPreamble, isBlank, type Span } from './source-text';
import { displayLines, displayText, maskEntities } from './display-text';
import { frontmatterTitleText, type TitleStatement } from './title-edit';
import { fromGanttDate, ganttDateFormatSupported, parseGanttDate, toGanttDate } from './gantt-dates';

export const GANTT_FLAGS = ['active', 'done', 'crit', 'milestone', 'vert'] as const;
export type GanttFlag = (typeof GANTT_FLAGS)[number];
export type GanttFlags = Record<GanttFlag, boolean>;

// mermaid's duration units: ms, seconds, minutes, hours, days, weeks,
// months, years.
export const GANTT_DURATION_UNITS = ['ms', 's', 'm', 'h', 'd', 'w', 'M', 'y'] as const;
export type GanttDurationUnit = (typeof GANTT_DURATION_UNITS)[number];

export type GanttStart =
  // A model date string ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm[:ss]').
  | { kind: 'date'; date: string }
  // When the latest of these tasks ends. `ids` as written; `tasks` the
  // indices of the ones that exist. (None exist: mermaid uses today.)
  | { kind: 'after'; ids: string[]; tasks: number[] }
  // Nothing written: when the previous task (in source order) ends.
  | { kind: 'previous' }
  // Something mermaid accepts that isn't read as a date here.
  | { kind: 'raw'; text: string };

export type GanttEnd =
  | { kind: 'duration'; value: number; unit: GanttDurationUnit }
  | { kind: 'date'; date: string }
  // When the earliest of these tasks starts.
  | { kind: 'until'; ids: string[]; tasks: number[] }
  | { kind: 'raw'; text: string };

export interface GanttTask {
  name: string;
  // The id written in the source, or null.
  id: string | null;
  // The id mermaid uses (in `after` / `until` and in svg element ids).
  renderId: string;
  // Index into sections; null = above the first section.
  section: number | null;
  flags: GanttFlags;
  start: GanttStart;
  end: GanttEnd;
}

export interface GanttSection {
  name: string;
}

// Lines the editor keeps as written (not editable).
export interface GanttSettings {
  axisFormat: string | null;
  tickInterval: string | null;
  excludes: string[];
  includes: string[];
  todayMarker: string | null;
  weekday: string | null;
  weekend: string | null;
  inclusiveEndDates: boolean;
  topAxis: boolean;
}

export interface GanttModel {
  title: string;
  // As written ('' when the chart has none: then dates are read by
  // JavaScript's Date, and end dates are not read at all).
  dateFormat: string;
  sections: GanttSection[];
  // In source order (= row order; mermaid draws bars by date, but rows
  // keep this order).
  tasks: GanttTask[];
  settings: GanttSettings;
}

export interface GanttTaskSource {
  line: number;
  // The name, surrounding whitespace excluded.
  name: Span;
  // Column of the `:` that starts the data.
  colon: number;
  // Each comma-separated part of the data, untrimmed (the first starts
  // right after the colon, the last runs to the end of the line).
  parts: Span[];
  // How many leading parts are tags.
  tags: number;
  // Trimmed items.
  id: Span | null;
  start: Span | null;
  end: Span;
}

export interface GanttSourceMap {
  lines: string[];
  eol: string;
  headerLine: number;
  titles: TitleStatement[];
  dateFormat: { line: number; value: Span } | null;
  excludes: { line: number; value: Span } | null;
  includes: { line: number; value: Span } | null;
  sections: Array<{ line: number; name: Span }>;
  tasks: GanttTaskSource[];
  clicks: Array<{ line: number; ids: string[] }>;
}

export type GanttSourceParseResult =
  | { ok: true; model: GanttModel; map: GanttSourceMap }
  | { ok: false; reason: string };

export type GanttParseResult = { ok: true; model: GanttModel } | { ok: false; reason: string };

export const GANTT_STARTER = [
  'gantt',
  '    title Project plan',
  '    dateFormat YYYY-MM-DD',
  '    section Planning',
  '    Research      :research, 2026-01-05, 5d',
  '    Design        :design, after research, 7d',
  '    section Delivery',
  '    Build         :build, after design, 10d',
  '    Launch        :milestone, after build, 0d',
  '',
].join('\n');

// mermaid splits a section title into rows at these (common.lineBreakRegex).
export const GANTT_SECTION_BREAK = /<br\s*\/?>/i;

const DURATION_RE = /^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/;
const ISO_RE = /^\d{4}-\d\d-\d\d(?:[T ]\d\d:\d\d(?::\d\d)?)?$/;

// After `keyword` and one whitespace character: the value span (trailing
// whitespace excluded) of a `keyword\s[^…]+` statement.
function valueSpan(text: string, indent: number, keyword: string): Span {
  const start = indent + keyword.length + 1;
  return { start, end: Math.max(start, text.trimEnd().length) };
}

function refIds(text: string, keyword: 'after' | 'until'): string[] | null {
  const m = new RegExp(`^${keyword}\\s+([\\d\\w\\- ]+)`).exec(text);
  return m ? m[1].split(' ').filter(Boolean) : null;
}

export function readGanttStart(text: string, dateFormat: string): Exclude<GanttStart, { kind: 'after' }> | { kind: 'after'; ids: string[] } {
  const ids = refIds(text, 'after');
  if (ids) return { kind: 'after', ids };
  // A format this module can't read (timestamps x, Do MMM …): dayjs
  // might read the text in it, or not — don't guess.
  if (dateFormat && !ganttDateFormatSupported(dateFormat)) return { kind: 'raw', text };
  const strict = dateFormat ? parseGanttDate(text, dateFormat) : null;
  if (strict) return { kind: 'date', date: toGanttDate(strict) };
  // mermaid's fallback is JavaScript's Date, which reads an ISO date
  // without a time as UTC midnight; the model keeps the calendar date.
  // (Date reads much more, but too loosely to call it a date here.)
  if (ISO_RE.test(text)) {
    if (/^\d{4}-\d\d-\d\d$/.test(text)) return fromGanttDate(text) ? { kind: 'date', date: text } : { kind: 'raw', text };
    const d = new Date(text.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? { kind: 'raw', text } : { kind: 'date', date: toGanttDate(d) };
  }
  return { kind: 'raw', text };
}

export function readGanttEnd(text: string, dateFormat: string): Exclude<GanttEnd, { kind: 'until' }> | { kind: 'until'; ids: string[] } {
  const ids = refIds(text, 'until');
  if (ids) return { kind: 'until', ids };
  const strict = ganttDateFormatSupported(dateFormat) ? parseGanttDate(text, dateFormat) : null;
  if (strict) return { kind: 'date', date: toGanttDate(strict) };
  const d = DURATION_RE.exec(text);
  if (d) return { kind: 'duration', value: Number.parseFloat(d[1]), unit: d[2] as GanttDurationUnit };
  return { kind: 'raw', text };
}

const SETTING_RE: Array<[RegExp, string]> = [
  [/^dateFormat\s/i, 'dateFormat'],
  [/^inclusiveEndDates\b/i, 'inclusiveEndDates'],
  [/^topAxis\b/i, 'topAxis'],
  [/^axisFormat\s/i, 'axisFormat'],
  [/^tickInterval\s/i, 'tickInterval'],
  [/^includes\s/i, 'includes'],
  [/^excludes\s/i, 'excludes'],
  [/^todayMarker\s/i, 'todayMarker'],
  [/^weekday\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, 'weekday'],
  [/^weekend\s+(?:friday|saturday)\b/i, 'weekend'],
];

export function parseGanttSource(source: string): GanttSourceParseResult {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const { frontmatter, headerLine } = findPreamble(lines);
  if (headerLine < 0) return { ok: false, reason: 'empty source' };
  const header = /^[\t ]*gantt\b(.*)$/i.exec(lines[headerLine]);
  if (!header) return { ok: false, reason: `not a gantt chart: ${lines[headerLine].trim()}` };
  if (header[1].trim() && !header[1].trim().startsWith('%%')) return { ok: false, reason: `statement on the header line: ${header[1].trim()}` };

  const model: GanttModel = {
    title: frontmatter?.title ? frontmatterTitleText(frontmatter.title.value) : '',
    dateFormat: '',
    sections: [],
    tasks: [],
    settings: {
      axisFormat: null, tickInterval: null, excludes: [], includes: [], todayMarker: null,
      weekday: null, weekend: null, inclusiveEndDates: false, topAxis: false,
    },
  };
  const map: GanttSourceMap = {
    lines, eol, headerLine, titles: [], dateFormat: null, excludes: null, includes: null, sections: [], tasks: [], clicks: [],
  };
  const startTexts: string[] = [];
  const endTexts: string[] = [];
  let auto = 0;

  for (let i = headerLine + 1; i < lines.length; i++) {
    const text = lines[i];
    const line = maskEntities(text);
    const t = line.trim();
    const indent = line.length - line.trimStart().length;
    if (isBlank(line)) continue;
    if (t.startsWith('%%{') && !t.includes('}%%')) {
      while (i < lines.length && !lines[i].includes('}%%')) i++;
      continue;
    }
    if (/^accTitle\s*:/i.test(t) || /^accDescr\s*:/i.test(t)) continue;
    if (/^accDescr\s*\{/i.test(t)) {
      while (i < lines.length && !lines[i].includes('}')) i++;
      if (i >= lines.length) return { ok: false, reason: 'unterminated accDescr' };
      continue;
    }
    // `%…`, and any character followed by `%`, comment out the line.
    if (t.startsWith('%') || (t[1] === '%' && t[0] !== '}')) continue;
    if (/^click\s/i.test(t)) {
      map.clicks.push({ line: i, ids: t.split(/\s+/)[1]?.split(',') ?? [] });
      continue;
    }
    if (/^(?:href\s|call\s|gantt\b)/i.test(t) || /^\d\d\d\d-\d\d-\d\d\b/.test(t)) return { ok: false, reason: `unsupported statement: ${t}` };
    if (/^(?:title|section|dateFormat|axisFormat|tickInterval|includes|excludes|todayMarker|accDescription)$/i.test(t)) {
      return { ok: false, reason: `${t} without a value` };
    }

    const setting = SETTING_RE.find(([re]) => re.test(t));
    if (setting) {
      const key = setting[1];
      // Values end at `#` / `;`; what would follow is a syntax error.
      const value = text.slice(indent + key.length + 1).trim();
      if (key !== 'todayMarker' && /[#;]/.test(line.slice(indent))) return { ok: false, reason: `unsupported ${key}: ${t}` };
      if (key === 'todayMarker' && line.includes(';')) return { ok: false, reason: `unsupported ${key}: ${t}` };
      const span = valueSpan(text, indent, key);
      switch (key) {
        case 'dateFormat': model.dateFormat = value; map.dateFormat = { line: i, value: span }; break;
        case 'inclusiveEndDates': model.settings.inclusiveEndDates = true; break;
        case 'topAxis': model.settings.topAxis = true; break;
        case 'axisFormat': model.settings.axisFormat = value; break;
        case 'tickInterval': model.settings.tickInterval = value; break;
        case 'todayMarker': model.settings.todayMarker = value; break;
        case 'includes':
          model.settings.includes = value.toLowerCase().split(/[\s,]+/).filter(Boolean);
          map.includes = { line: i, value: span };
          break;
        case 'excludes':
          model.settings.excludes = value.toLowerCase().split(/[\s,]+/).filter(Boolean);
          map.excludes = { line: i, value: span };
          break;
        case 'weekday': model.settings.weekday = t.split(/\s+/)[1].toLowerCase(); break;
        case 'weekend': model.settings.weekend = t.split(/\s+/)[1].toLowerCase(); break;
      }
      continue;
    }
    if (/^title\s/i.test(t)) {
      // `title\s[^\n]+`: the rest of the line.
      const start = indent + 6;
      const lead = text.slice(start).length - text.slice(start).trimStart().length;
      map.titles.push({ line: i, value: { start: start + lead, end: text.trimEnd().length }, cut: null });
      model.title = displayText(text.slice(start));
      continue;
    }
    if (/^accDescription\s/i.test(t)) continue;
    if (/^section\s/i.test(t)) {
      const span = valueSpan(text, indent, 'section');
      const lead = text.slice(span.start).length - text.slice(span.start).trimStart().length;
      map.sections.push({ line: i, name: { start: Math.min(span.start + lead, span.end), end: span.end } });
      model.sections.push({ name: displayLines(text.slice(span.start), GANTT_SECTION_BREAK) });
      continue;
    }

    // A task: name up to the first `:`, then data to the end of the line.
    const colon = line.indexOf(':', indent);
    if (colon < 0 || colon === indent) return { ok: false, reason: `unparseable line: ${t}` };
    if (/[#;]/.test(line.slice(colon))) return { ok: false, reason: `unsupported task data: ${t}` };
    const parts: Span[] = [];
    let from = colon + 1;
    for (;;) {
      const comma = line.indexOf(',', from);
      parts.push({ start: from, end: comma < 0 ? line.length : comma });
      if (comma < 0) break;
      from = comma + 1;
    }
    const partText = (s: Span) => text.slice(s.start, s.end);
    let tags = 0;
    const flags: GanttFlags = { active: false, done: false, crit: false, milestone: false, vert: false };
    while (tags < parts.length) {
      const tag = partText(parts[tags]).trim();
      if (!(GANTT_FLAGS as readonly string[]).includes(tag)) break;
      flags[tag as GanttFlag] = true;
      tags++;
    }
    const items = parts.slice(tags).map((p) => {
      const raw = partText(p);
      const lead = raw.length - raw.trimStart().length;
      return { start: p.start + lead, end: p.start + lead + raw.trim().length };
    });
    if (items.length < 1 || items.length > 3) return { ok: false, reason: `unreadable task data: ${t}` };
    const id = items.length === 3 ? items[0] : null;
    const start = items.length >= 2 ? items[items.length - 2] : null;
    const end = items[items.length - 1];
    const nameEnd = indent + text.slice(indent, colon).trimEnd().length;
    map.tasks.push({ line: i, name: { start: indent, end: nameEnd }, colon, parts, tags, id, start, end });
    const startText = start ? partText(start) : '';
    const endText = partText(end);
    startTexts.push(startText);
    endTexts.push(endText);
    model.tasks.push({
      name: displayText(text.slice(indent, colon)),
      id: id ? partText(id) : null,
      renderId: id ? partText(id) : `task${++auto}`,
      section: model.sections.length ? model.sections.length - 1 : null,
      flags,
      start: { kind: 'previous' },
      end: { kind: 'raw', text: '' },
    });
  }

  // A dateFormat line can come after tasks; mermaid compiles dates only
  // once the whole chart is read, so read them now with the final one.
  // `after` / `until` resolve to the LAST task with that id (mermaid's
  // id table is overwritten by later tasks).
  const byId = new Map<string, number>();
  model.tasks.forEach((t, i) => byId.set(t.renderId, i));
  const resolve = (ids: string[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  model.tasks.forEach((task, i) => {
    const s = map.tasks[i].start ? readGanttStart(startTexts[i], model.dateFormat) : ({ kind: 'previous' } as const);
    task.start = s.kind === 'after' ? { kind: 'after', ids: s.ids, tasks: resolve(s.ids) } : s;
    const e = readGanttEnd(endTexts[i], model.dateFormat);
    task.end = e.kind === 'until' ? { kind: 'until', ids: e.ids, tasks: resolve(e.ids) } : e;
  });

  return { ok: true, model, map };
}

export function parseGantt(source: string): GanttParseResult {
  const r = parseGanttSource(source);
  return r.ok ? { ok: true, model: r.model } : r;
}
