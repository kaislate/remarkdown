// Parser for mermaid timelines — the syntax mermaid 11's timeline.jison
// lexer accepts:
//
//   timeline [LR|TD]
//     title …                        (rest of the line, `#` / `%%` included)
//     accTitle: … / accDescr: … / accDescr { … }
//     section …                      (up to a `:`)
//     2004 : Facebook : Google       (a period, then `: event`s)
//          : YouTube                 (more events of the period above)
//   plus blank lines, comments, `%%{init}%%` directives, frontmatter
//   (whose `title:` mermaid ignores for timelines — only a body title
//   is drawn).
//
// The lexer, not a line grammar, decides what is text, and its rules are
// irregular — mirrored here:
//   - a period ends at `:` or `#`; a `#` there starts a comment that
//     runs to the end of the line (events included)
//   - an event is `:` + one whitespace + text up to the next `:` that is
//     followed by whitespace; `#` and `%%` inside it are plain text
//   - a line is a comment when it starts with `%` (not `%{`), with `#`,
//     or with any character followed by `%%`; `%%` later on is text
// Model text is what mermaid displays: entity codes decoded, whitespace
// collapsed, and each `<br>` (mermaid draws a line break) as '\n'.
//
// Bails (ok:false) on what mermaid rejects (`2002 :x`, an event before
// any period) and on valid-but-odd layouts the editor can't keep in
// shape: statements on the header line, an event line separated from
// its period by a section / title line, a line ending in a bare `:`,
// events after a section name.
import { findPreamble, isBlank, type Span } from './source-text';
import { displayLines, displayText } from './display-text';
import type { TitleStatement } from './title-edit';

export interface TimelineSection {
  name: string;
}

export interface TimelinePeriod {
  // The time label ("2004", "Q1", "Week 3").
  label: string;
  // Index into sections; null = above the first section. (mermaid does
  // not draw such periods once the timeline has sections.)
  section: number | null;
  events: string[];
}

export interface TimelineModel {
  title: string;
  direction: 'LR' | 'TD';
  sections: TimelineSection[];
  // In source (= drawing) order.
  periods: TimelinePeriod[];
}

export interface TimelineEventSource {
  line: number;
  // Column of the event's `:`.
  colon: number;
  // The event text, surrounding whitespace excluded.
  text: Span;
}

export interface TimelinePeriodSource {
  line: number;
  // Last line of the period's block (its last event line).
  lastLine: number;
  label: Span;
  events: TimelineEventSource[];
}

export interface TimelineSectionSource {
  line: number;
  name: Span;
}

export interface TimelineSourceMap {
  lines: string[];
  eol: string;
  headerLine: number;
  titles: TitleStatement[];
  sections: TimelineSectionSource[];
  periods: TimelinePeriodSource[];
}

export type TimelineSourceParseResult =
  | { ok: true; model: TimelineModel; map: TimelineSourceMap }
  | { ok: false; reason: string };

export type TimelineParseResult = { ok: true; model: TimelineModel } | { ok: false; reason: string };

export const TIMELINE_STARTER = [
  'timeline',
  '    title Project history',
  '    2024 : Idea : First sketches',
  '    2025 : Prototype',
  '    2026 : Launch',
  '',
].join('\n');

// mermaid draws a line break at each literal `<br>` (wrap() in svgDraw).
export const TIMELINE_BREAK = /<br>/;

const HEADER_RE = /^([\t ]*)timeline(?:[ \t]+(LR|TD))?\b/i;

// Lines the lexer reads as a comment from their first character on.
function isCommentLine(t: string): boolean {
  return /^%(?!\{)/.test(t) || /^[^}]%%/.test(t) || t.startsWith('#') || t.startsWith('%%{');
}

// Events from column `pos` (at a `:`) to the end of the line, or null
// when the rest isn't a well-formed run of events.
function readEvents(line: string, lineNo: number, pos: number): TimelineEventSource[] | null {
  const out: TimelineEventSource[] = [];
  const run = /(?:[^:]|:(?=\S))+/y;
  while (pos < line.length) {
    // `:` + exactly one whitespace character, then the text run.
    if (line[pos] !== ':' || !/[\t ]/.test(line[pos + 1] ?? '')) return null;
    run.lastIndex = pos + 2;
    const m = run.exec(line);
    if (!m) return null;
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const start = pos + 2 + lead;
    out.push({ line: lineNo, colon: pos, text: { start, end: start + raw.trim().length } });
    pos += 2 + raw.length;
  }
  return out;
}

export function timelineText(raw: string): string {
  return displayLines(raw, TIMELINE_BREAK);
}

export function parseTimelineSource(source: string): TimelineSourceParseResult {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const { headerLine } = findPreamble(lines);
  if (headerLine < 0) return { ok: false, reason: 'empty source' };
  const header = HEADER_RE.exec(lines[headerLine]);
  if (!header) return { ok: false, reason: `not a timeline: ${lines[headerLine].trim()}` };
  const rest = lines[headerLine].slice(header[0].length).trim();
  if (rest && !isCommentLine(rest)) return { ok: false, reason: `statement on the header line: ${rest}` };

  const model: TimelineModel = {
    // mermaid ignores a frontmatter title on timelines.
    title: '',
    direction: header[2]?.toUpperCase() === 'TD' ? 'TD' : 'LR',
    sections: [],
    periods: [],
  };
  const map: TimelineSourceMap = { lines, eol, headerLine, titles: [], sections: [], periods: [] };
  // Can a `: event` line still join the last period?
  let blockOpen = false;

  for (let i = headerLine + 1; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    const indent = line.length - line.trimStart().length;
    if (isBlank(line)) continue;
    if (t.startsWith('%%{') && !t.includes('}%%')) {
      while (i < lines.length && !lines[i].includes('}%%')) i++;
      continue;
    }
    if (isCommentLine(t)) continue;

    if (/^accTitle\s*:/i.test(t) || /^accDescr\s*:/i.test(t)) {
      blockOpen = false;
      continue;
    }
    if (/^accDescr\s*\{/i.test(t)) {
      while (i < lines.length && !lines[i].includes('}')) i++;
      if (i >= lines.length) return { ok: false, reason: 'unterminated accDescr' };
      blockOpen = false;
      continue;
    }

    const title = /^title\s(.+)$/i.exec(t);
    if (title) {
      // `title\s[^\n]+`: everything after `title` and one whitespace.
      const start = indent + 6;
      const lead = line.slice(start).length - line.slice(start).trimStart().length;
      map.titles.push({ line: i, value: { start: start + lead, end: line.trimEnd().length }, cut: null });
      model.title = displayText(line.slice(start));
      blockOpen = false;
      continue;
    }
    // Bare keywords: mermaid's lexer would read the next line as their text.
    if (/^(?:title|section)$/i.test(t)) return { ok: false, reason: `${t} without text` };
    if (/^timeline\b/i.test(t)) return { ok: false, reason: 'second timeline header' };

    const section = /^section\s([^:]+)(.*)$/i.exec(t);
    if (section) {
      if (section[2].trim()) return { ok: false, reason: `events after a section: ${t}` };
      const raw = section[1];
      const start = indent + 8 + (raw.length - raw.trimStart().length);
      map.sections.push({ line: i, name: { start, end: Math.max(start, indent + 8 + raw.trimEnd().length) } });
      model.sections.push({ name: timelineText(raw) });
      blockOpen = false;
      continue;
    }

    if (t.startsWith(':')) {
      const last = map.periods[map.periods.length - 1];
      if (!last) return { ok: false, reason: 'event before any period' };
      if (!blockOpen) return { ok: false, reason: `event line apart from its period: ${t}` };
      const events = readEvents(line, i, indent);
      if (!events) return { ok: false, reason: `unreadable events: ${t}` };
      last.events.push(...events);
      last.lastLine = i;
      model.periods[model.periods.length - 1].events.push(...events.map((e) => timelineText(line.slice(e.text.start, e.text.end))));
      continue;
    }

    // A period: text up to `:` / `#` / the end of the line.
    const stop = line.slice(indent).search(/[:#]/);
    const labelEnd = stop < 0 ? line.length : indent + stop;
    const labelRaw = line.slice(indent, labelEnd);
    let events: TimelineEventSource[] = [];
    if (stop >= 0 && line[labelEnd] === ':') {
      const ev = readEvents(line, i, labelEnd);
      if (!ev) return { ok: false, reason: `unreadable events: ${t}` };
      events = ev;
    }
    map.periods.push({ line: i, lastLine: i, label: { start: indent, end: indent + labelRaw.trimEnd().length }, events });
    model.periods.push({
      label: timelineText(labelRaw),
      section: model.sections.length ? model.sections.length - 1 : null,
      events: events.map((e) => timelineText(line.slice(e.text.start, e.text.end))),
    });
    blockOpen = true;
  }

  return { ok: true, model, map };
}

export function parseTimeline(source: string): TimelineParseResult {
  const r = parseTimelineSource(source);
  return r.ok ? { ok: true, model: r.model } : r;
}
