// Source-preserving visual edits for timelines — the timeline
// counterpart of mermaid-flowchart-edit.ts (see there for the why).
//
// A period is a block of lines: its own line (`2004 : a : b`) plus any
// continuation lines (`     : c`) below it. A section is a block too:
// its `section` line through its last period. Edits work on the
// smallest piece that holds what they change:
//   - label / name / event text edits splice one span of one line
//   - event add / remove splice ` : text` into or out of a line (a
//     continuation line that loses its only event goes); event reorder
//     swaps the texts between the existing slots, so the layout of the
//     lines stays as written
//   - period / section remove and move cut / relocate whole blocks;
//     a removed section takes its periods with it
//   - adds insert one line
// Comments and blank lines outside the blocks an edit touches never move.
import {
  parseTimelineSource,
  type TimelineModel,
  type TimelineSourceMap,
} from './timeline-parser';
import { indentFor, indentOf, joinLines, lastStatementLine, moveItem, replaceSpan, type SourceLines } from './source-text';
import { ALWAYS_ENCODED, EMPTY_TEXT, encodeChars, encodeFirstChar, encodeLines } from './display-text';
import { applyTitle } from './title-edit';

export type TimelineEdit =
  // '' removes the title.
  | { kind: 'setTitle'; title: string }
  // Inserted after section `afterIndex`'s block (default: at the end);
  // afterIndex -1 puts it above everything, so periods that had no
  // section join it.
  | { kind: 'addSection'; name: string; afterIndex?: number }
  | { kind: 'renameSection'; index: number; name: string }
  // Removes the section AND its periods.
  | { kind: 'removeSection'; index: number }
  // Moves the section with its periods.
  | { kind: 'moveSection'; from: number; to: number }
  // Inserted right after period `afterIndex` (in its section), else at
  // the end of `section` (null: above the first section), else at the
  // end of the last section.
  | { kind: 'addPeriod'; label: string; events?: string[]; section?: number | null; afterIndex?: number }
  | { kind: 'setPeriodLabel'; index: number; label: string }
  // Removes the period and its events.
  | { kind: 'removePeriod'; index: number }
  // Period `from` ends up at index `to`, in the section of the period
  // that was at `to`.
  | { kind: 'movePeriod'; from: number; to: number }
  // Moved to the end of section `section` (null: above the first section).
  | { kind: 'movePeriodToSection'; index: number; section: number | null }
  // Inserted after event `afterIndex` (default: last; -1: first).
  | { kind: 'addEvent'; period: number; text: string; afterIndex?: number }
  | { kind: 'setEventText'; period: number; index: number; text: string }
  | { kind: 'removeEvent'; period: number; index: number }
  | { kind: 'moveEvent'; period: number; from: number; to: number };

export interface TimelineEditResult {
  source: string;
  // Index of the section / period / event (within its period) an add
  // edit created.
  index?: number;
}

// Text that starts like one of the lexer's keywords would be read as it.
const KEYWORD_START = /^(?:timeline\b|title\s|section\s|accTitle|accDescr)/i;

// A period label: ends at `:` or `#`, `%` at its start is a comment.
export function emitTimelineLabel(text: string): string {
  const out = encodeLines(text, `${ALWAYS_ENCODED}:%`);
  if (!out.replace(/<br>/g, '')) return EMPTY_TEXT + out;
  return KEYWORD_START.test(out) ? encodeFirstChar(out) : out;
}

// A section name: ends at `:`.
export function emitTimelineSection(text: string): string {
  const out = encodeLines(text, `${ALWAYS_ENCODED}:`);
  return out.replace(/<br>/g, '') ? out : EMPTY_TEXT + out;
}

// An event: ends at a `:` followed by whitespace (the next event).
export function emitTimelineEvent(text: string): string {
  const out = text
    .split(/\r\n|\r|\n/)
    .map((l) => encodeChars(l, ALWAYS_ENCODED).replace(/:(?=\s|$)/g, '#58;'))
    .join('<br>');
  return out.replace(/<br>/g, '') ? out : EMPTY_TEXT + out;
}

function emitTitle(text: string): string {
  return encodeChars(text, ALWAYS_ENCODED);
}

function periodLine(indent: string, label: string, events: string[]): string {
  return indent + emitTimelineLabel(label) + events.map((e) => ` : ${emitTimelineEvent(e)}`).join('');
}

// Index of a valid item, or null.
function at<T>(arr: readonly T[], i: number | undefined): T | null {
  return i !== undefined && Number.isInteger(i) && i >= 0 && i < arr.length ? arr[i] : null;
}

// Where things sit, in terms of whole lines.
class Layout {
  constructor(readonly model: TimelineModel, readonly map: TimelineSourceMap) {}

  periodRange(p: number): [number, number] {
    return [this.map.periods[p].line, this.map.periods[p].lastLine];
  }

  periodsOf(s: number | null): number[] {
    return this.model.periods.flatMap((p, i) => (p.section === s ? [i] : []));
  }

  // Section s: its line through its last period's last line.
  sectionRange(s: number): [number, number] {
    const ps = this.periodsOf(s);
    const line = this.map.sections[s].line;
    return [line, ps.length ? this.map.periods[ps[ps.length - 1]].lastLine : line];
  }

  // The line after which a period appended to section s goes.
  endOfSection(s: number | null): number {
    const ps = this.periodsOf(s);
    if (ps.length) return this.map.periods[ps[ps.length - 1]].lastLine;
    if (s !== null) return this.map.sections[s].line;
    // No section-less period yet: just above the first section.
    return this.map.sections.length ? this.map.sections[0].line - 1 : lastStatementLine(this.map.lines, this.map.headerLine);
  }

  // Indentation for a new period line in section s.
  periodIndent(s: number | null, after: number): string {
    const ps = this.periodsOf(s);
    const sample = ps.length ? ps[ps.length - 1] : this.map.periods.length ? this.map.periods.length - 1 : -1;
    if (sample >= 0) return indentOf(this.map.lines[this.map.periods[sample].line]);
    if (s !== null) return indentOf(this.map.lines[this.map.sections[s].line]) + '    ';
    return indentFor(this.map.lines, after, this.map.headerLine);
  }
}

// Move lines [a, b] to just after line `after` (or before line 0 when -1),
// in original line numbers.
function relocate(lines: string[], [a, b]: [number, number], after: number): string[] {
  const block = lines.slice(a, b + 1);
  const out: string[] = [];
  if (after < 0) out.push(...block);
  lines.forEach((l, i) => {
    if (i < a || i > b) out.push(l);
    if (i === after) out.push(...block);
  });
  return out;
}

export function applyTimelineEdit(source: string, edit: TimelineEdit): TimelineEditResult | null {
  const parsed = parseTimelineSource(source);
  if (!parsed.ok) return null;
  const { model, map } = parsed;
  const src: SourceLines = { lines: map.lines, eol: map.eol };
  const lines = [...map.lines];
  const layout = new Layout(model, map);
  const done = (out: string[], index?: number): TimelineEditResult =>
    index === undefined ? { source: joinLines(src, out) } : { source: joinLines(src, out), index };

  switch (edit.kind) {
    case 'setTitle':
      return { source: applyTitle(source, map.titles, edit.title, emitTitle, false) };

    case 'renameSection': {
      const s = at(map.sections, edit.index);
      if (!s) return null;
      lines[s.line] = replaceSpan(lines[s.line], s.name, emitTimelineSection(edit.name));
      return done(lines);
    }

    case 'addSection': {
      const n = map.sections.length;
      let after: number;
      let index: number;
      if (edit.afterIndex === -1) {
        // Above the first period / section, below title and the like.
        const first = Math.min(map.periods[0]?.line ?? Infinity, map.sections[0]?.line ?? Infinity);
        after = Number.isFinite(first) ? first - 1 : lastStatementLine(lines, map.headerLine);
        index = 0;
      } else if (edit.afterIndex !== undefined) {
        if (!at(map.sections, edit.afterIndex)) return null;
        after = layout.sectionRange(edit.afterIndex)[1];
        index = edit.afterIndex + 1;
      } else {
        after = lastStatementLine(lines, map.headerLine);
        index = n;
      }
      const indent = n ? indentOf(lines[map.sections[0].line]) : indentFor(lines, after, map.headerLine);
      lines.splice(after + 1, 0, `${indent}section ${emitTimelineSection(edit.name)}`);
      return done(lines, index);
    }

    case 'removeSection': {
      if (!at(map.sections, edit.index)) return null;
      const [a, b] = layout.sectionRange(edit.index);
      return done(lines.filter((_, i) => i < a || i > b));
    }

    case 'moveSection': {
      const { from, to } = edit;
      if (!at(map.sections, from) || !at(map.sections, to)) return null;
      if (from === to) return { source };
      const after = to < from ? map.sections[to].line - 1 : layout.sectionRange(to)[1];
      return done(relocate(lines, layout.sectionRange(from), after));
    }

    case 'addPeriod': {
      let after: number;
      let section: number | null;
      if (edit.afterIndex !== undefined) {
        if (!at(map.periods, edit.afterIndex)) return null;
        after = map.periods[edit.afterIndex].lastLine;
        section = model.periods[edit.afterIndex].section;
      } else {
        section = edit.section !== undefined ? edit.section : map.sections.length ? map.sections.length - 1 : null;
        if (section !== null && !at(map.sections, section)) return null;
        after = layout.endOfSection(section);
      }
      lines.splice(after + 1, 0, periodLine(layout.periodIndent(section, after), edit.label, edit.events ?? []));
      return withIndex(done(lines), (m, r) => r.map.periods.findIndex((p) => p.line === after + 1));
    }

    case 'setPeriodLabel': {
      const p = at(map.periods, edit.index);
      if (!p) return null;
      lines[p.line] = replaceSpan(lines[p.line], p.label, emitTimelineLabel(edit.label));
      return done(lines);
    }

    case 'removePeriod': {
      if (!at(map.periods, edit.index)) return null;
      const [a, b] = layout.periodRange(edit.index);
      return done(lines.filter((_, i) => i < a || i > b));
    }

    case 'movePeriod': {
      const { from, to } = edit;
      if (!at(map.periods, from) || !at(map.periods, to)) return null;
      if (from === to) return { source };
      const after = to < from ? map.periods[to].line - 1 : map.periods[to].lastLine;
      return done(relocate(lines, layout.periodRange(from), after));
    }

    case 'movePeriodToSection': {
      const p = at(map.periods, edit.index);
      if (!p) return null;
      if (edit.section !== null && !at(map.sections, edit.section)) return null;
      if (model.periods[edit.index].section === edit.section) return { source };
      // endOfSection ignores the moved period: it isn't in the target.
      return done(relocate(lines, layout.periodRange(edit.index), layout.endOfSection(edit.section)));
    }

    case 'setEventText': {
      const ev = at(map.periods[edit.period]?.events ?? [], edit.index);
      if (!ev) return null;
      lines[ev.line] = replaceSpan(lines[ev.line], ev.text, emitTimelineEvent(edit.text));
      return done(lines);
    }

    case 'removeEvent': {
      const p = at(map.periods, edit.period);
      const ev = p && at(p.events, edit.index);
      if (!p || !ev) return null;
      const next = p.events[edit.index + 1];
      const prev = p.events[edit.index - 1];
      if (next && next.line === ev.line) {
        // `: this : next` → `: next`
        lines[ev.line] = replaceSpan(lines[ev.line], { start: ev.colon, end: next.colon }, '');
      } else if (prev && prev.line === ev.line) {
        lines[ev.line] = replaceSpan(lines[ev.line], { start: prev.text.end, end: ev.text.end }, '');
      } else if (ev.line === p.line) {
        lines[ev.line] = replaceSpan(lines[ev.line], { start: p.label.end, end: ev.text.end }, '');
      } else {
        // The continuation line's only event.
        lines.splice(ev.line, 1);
      }
      return done(lines);
    }

    case 'addEvent': {
      const p = at(map.periods, edit.period);
      if (!p) return null;
      const text = emitTimelineEvent(edit.text);
      const events = p.events;
      const last = events.length - 1;
      const afterIndex = edit.afterIndex ?? last;
      if (afterIndex < -1 || afterIndex > last) return null;
      const index = afterIndex + 1;
      // Nothing may follow a period label but events: a `#` comment there
      // would swallow an event added to the line.
      const labelLineOpen = !/#/.test(lines[p.line].slice(p.label.end, events[0]?.line === p.line ? events[0].colon : undefined));
      if (afterIndex >= 0 && !(afterIndex === last && events.some((e) => e.line !== p.line))) {
        // Right after that event, on its line.
        const ev = events[afterIndex];
        lines[ev.line] = replaceSpan(lines[ev.line], { start: ev.text.end, end: ev.text.end }, ` : ${text}`);
      } else if (afterIndex >= 0) {
        // After the last event, which sits on a continuation line: one more.
        const ev = events[last];
        lines.splice(ev.line + 1, 0, `${continuationPrefix(lines, map, edit.period)}: ${text}`);
      } else if (labelLineOpen) {
        lines[p.line] = replaceSpan(lines[p.line], { start: p.label.end, end: p.label.end }, ` : ${text}`);
      } else {
        lines.splice(p.line + 1, 0, `${continuationPrefix(lines, map, edit.period)}: ${text}`);
      }
      return done(lines, index);
    }

    case 'moveEvent': {
      const p = at(map.periods, edit.period);
      if (!p || !at(p.events, edit.from) || !at(p.events, edit.to)) return null;
      const texts = p.events.map((e) => lines[e.line].slice(e.text.start, e.text.end));
      const order = moveItem(texts, edit.from, edit.to);
      // Right to left, so earlier spans on the same line stay valid.
      for (let k = p.events.length - 1; k >= 0; k--) {
        const e = p.events[k];
        lines[e.line] = replaceSpan(lines[e.line], e.text, order[k]);
      }
      return done(lines);
    }
  }
}

// Whitespace before the `:` of a new continuation line: copied from an
// existing one, else lined up under the period line's first `:`, else
// the period's indentation plus four.
function continuationPrefix(lines: string[], map: TimelineSourceMap, period: number): string {
  const p = map.periods[period];
  const cont = [...p.events].reverse().find((e) => e.line !== p.line);
  if (cont) return lines[cont.line].slice(0, cont.colon);
  const first = p.events.find((e) => e.line === p.line);
  if (first) return ' '.repeat(first.colon);
  return indentOf(lines[p.line]) + '    ';
}

// Fill in `index` from a re-parse of the result.
function withIndex(
  r: TimelineEditResult,
  find: (m: TimelineModel, parsed: { map: TimelineSourceMap }) => number,
): TimelineEditResult | null {
  const back = parseTimelineSource(r.source);
  if (!back.ok) return null;
  const index = find(back.model, back);
  return index < 0 ? null : { ...r, index };
}
