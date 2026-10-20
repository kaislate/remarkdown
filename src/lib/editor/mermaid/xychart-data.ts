// XY charts: bars and lines over a row of categories.
//
//   xychart-beta
//     title "Sales"
//     x-axis [Jan, Feb, Mar]
//     y-axis "Revenue" 0 --> 100
//     bar [50, 60, 75]
//     line "Target" [55, 65, 70]
//
// Edited as a small spreadsheet: one row per category, one column per
// bar or line. A numeric x-axis (`x-axis 1 --> 10`) or anything else
// unusual makes it a text-edited diagram instead.

import { LineEditor, statements, indentNear, splitList, listItem, numberList, parseNumber, moved, freeName } from './data-lines';
import { indentOf } from './source-text';

export const XYCHART_STARTER =
  'xychart-beta\n    title "Visitors"\n    x-axis [Mon, Tue, Wed, Thu, Fri]\n    y-axis "People"\n    bar [30, 45, 40, 60, 55]\n    line [30, 45, 40, 60, 55]\n';

export interface XySeries {
  line: number;
  kind: 'bar' | 'line';
  name: string; // '' when unnamed
  values: number[];
}

export interface XyModel {
  header: number;
  horizontal: boolean;
  title: { line: number; value: string } | null;
  xAxis: { line: number; title: string; categories: string[] } | null;
  yAxis: { line: number; title: string; min: number | null; max: number | null } | null;
  series: XySeries[];
}

const HEADER = /^xychart(-beta)?(\s+(horizontal|vertical))?\s*$/;

// `"Quoted title"` or a bare word, then the rest.
function leadingTitle(t: string): { title: string; rest: string } | null {
  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1);
    if (end < 0) return null;
    return { title: t.slice(1, end), rest: t.slice(end + 1).trim() };
  }
  const m = /^([^\s[]+)\s*(.*)$/.exec(t);
  return m && !/^-?\d/.test(m[1]) ? { title: m[1], rest: m[2] } : { title: '', rest: t };
}

function bracketList(t: string): string[] | null {
  const m = /^\[(.*)\]$/.exec(t.trim());
  return m ? splitList(m[1]) : null;
}

export function parseXyChart(source: string): XyModel | null {
  const st = statements(source, HEADER);
  if (!st) return null;
  const model: XyModel = {
    header: st.header,
    horizontal: /horizontal/.test(st.lines[st.header]),
    title: null,
    xAxis: null,
    yAxis: null,
    series: [],
  };
  for (const [line, t] of st.items) {
    let m: RegExpExecArray | null;
    if ((m = /^title\s+(.*)$/.exec(t))) {
      const v = m[1].trim();
      model.title = { line, value: v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v };
    } else if ((m = /^x-axis\s*(.*)$/.exec(t))) {
      const lt = leadingTitle(m[1].trim());
      const cats = lt ? bracketList(lt.rest) : null;
      if (!lt || !cats) return null; // a numeric x-axis: text-edited
      model.xAxis = { line, title: lt.title, categories: cats };
    } else if ((m = /^y-axis\s*(.*)$/.exec(t))) {
      const lt = leadingTitle(m[1].trim());
      if (!lt) return null;
      let min: number | null = null;
      let max: number | null = null;
      if (lt.rest) {
        const r = /^(-?[\d.]+)\s*-->\s*(-?[\d.]+)$/.exec(lt.rest);
        if (!r) return null;
        min = Number(r[1]);
        max = Number(r[2]);
      }
      model.yAxis = { line, title: lt.title, min, max };
    } else if ((m = /^(bar|line)\s+(?:"([^"]*)"\s*)?(\[.*\])$/.exec(t))) {
      const items = bracketList(m[3]);
      const values = items?.map(parseNumber);
      if (!values || values.some((v) => v === null)) return null;
      model.series.push({ line, kind: m[1] as 'bar' | 'line', name: m[2] ?? '', values: values as number[] });
    } else return null;
  }
  return model;
}

const cleanTitle = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim();

function seriesLine(indent: string, s: { kind: string; name: string; values: number[] }): string {
  return `${indent}${s.kind}${s.name ? ` "${cleanTitle(s.name)}"` : ''} [${numberList(s.values)}]`;
}

function xAxisLine(indent: string, title: string, cats: string[]): string {
  return `${indent}x-axis ${title ? `"${cleanTitle(title)}" ` : ''}[${cats.map(listItem).join(', ')}]`;
}

function yAxisLine(indent: string, y: { title: string; min: number | null; max: number | null }): string | null {
  const range = y.min !== null && y.max !== null ? `${y.min} --> ${y.max}` : '';
  const title = y.title ? `"${cleanTitle(y.title)}"` : '';
  if (!title && !range) return null;
  return `${indent}y-axis ${[title, range].filter(Boolean).join(' ')}`;
}

// The categories, as many as the longest of the axis and the series.
export function xyRows(model: XyModel): number {
  return Math.max(model.xAxis?.categories.length ?? 0, ...model.series.map((s) => s.values.length));
}

export type XyEdit =
  | { kind: 'setTitle'; value: string }
  | { kind: 'setHorizontal'; value: boolean }
  | { kind: 'setXTitle'; value: string }
  | { kind: 'setY'; title?: string; min?: number | null; max?: number | null }
  | { kind: 'setCategory'; row: number; value: string }
  | { kind: 'setValue'; row: number; series: number; value: number }
  | { kind: 'addRow' }
  | { kind: 'removeRow'; row: number }
  | { kind: 'moveRow'; from: number; to: number }
  | { kind: 'setSeries'; series: number; field: 'kind' | 'name'; value: string }
  | { kind: 'addSeries'; seriesKind: 'bar' | 'line' }
  | { kind: 'removeSeries'; series: number };

export function applyXyEdit(source: string, edit: XyEdit): string | null {
  const model = parseXyChart(source);
  if (!model) return null;
  const ed = new LineEditor(source);
  const lines = ed.lines;
  const rows = xyRows(model);
  const cats = Array.from({ length: rows }, (_, i) => model.xAxis?.categories[i] ?? `Item ${i + 1}`);
  const filled = (s: XySeries) => Array.from({ length: rows }, (_, i) => s.values[i] ?? 0);
  const lastSetting = Math.max(model.header, model.title?.line ?? -1, model.xAxis?.line ?? -1, model.yAxis?.line ?? -1);
  const indent = (at: number) => indentNear(lines, at, model.header);

  // Writes the x-axis and every series with these columns (only lines
  // whose text changes are touched).
  const writeColumns = (newCats: string[], values: (s: XySeries) => number[]) => {
    const xText = xAxisLine(model.xAxis ? indentOf(lines[model.xAxis.line]) : indent(lastSetting), model.xAxis?.title ?? '', newCats);
    for (const s of model.series) ed.set(s.line, seriesLine(indentOf(lines[s.line]), { ...s, values: values(s) }));
    if (model.xAxis) ed.set(model.xAxis.line, xText);
    else ed.insert(lastSetting + 1, xText);
    return ed.toString();
  };

  switch (edit.kind) {
    case 'setTitle': {
      const v = cleanTitle(edit.value);
      if (model.title) return v ? ed.set(model.title.line, `${indentOf(lines[model.title.line])}title "${v}"`).toString() : ed.remove(model.title.line).toString();
      return v ? ed.insert(model.header + 1, `${indent(model.header + 1)}title "${v}"`).toString() : null;
    }
    case 'setHorizontal': {
      const head = lines[model.header];
      const base = head.replace(/\s+(horizontal|vertical)\s*$/, '').trimEnd();
      return ed.set(model.header, edit.value ? `${base} horizontal` : base).toString();
    }
    case 'setXTitle': {
      const title = cleanTitle(edit.value);
      const text = xAxisLine(model.xAxis ? indentOf(lines[model.xAxis.line]) : indent(lastSetting), title, cats);
      return model.xAxis ? ed.set(model.xAxis.line, text).toString() : ed.insert(lastSetting + 1, text).toString();
    }
    case 'setY': {
      const y = { title: model.yAxis?.title ?? '', min: model.yAxis?.min ?? null, max: model.yAxis?.max ?? null };
      if (edit.title !== undefined) y.title = cleanTitle(edit.title);
      if (edit.min !== undefined) y.min = edit.min;
      if (edit.max !== undefined) y.max = edit.max;
      // A range needs both ends, the right way round.
      if (y.min !== null && y.max !== null && y.min >= y.max) return null;
      const text = yAxisLine(model.yAxis ? indentOf(lines[model.yAxis.line]) : indent(lastSetting), y);
      if (model.yAxis) return text ? ed.set(model.yAxis.line, text).toString() : ed.remove(model.yAxis.line).toString();
      return text ? ed.insert(lastSetting + 1, text).toString() : null;
    }
    case 'setCategory': {
      const next = [...cats];
      next[edit.row] = edit.value.trim() || `Item ${edit.row + 1}`;
      return writeColumns(next, filled);
    }
    case 'setValue': {
      const s = model.series[edit.series];
      if (!s || !Number.isFinite(edit.value)) return null;
      const values = filled(s);
      values[edit.row] = edit.value;
      return ed.set(s.line, seriesLine(indentOf(lines[s.line]), { ...s, values })).toString();
    }
    case 'addRow':
      return writeColumns([...cats, freeName('Item', cats)], (s) => [...filled(s), 0]);
    case 'removeRow':
      if (rows <= 1) return null;
      return writeColumns(cats.filter((_, i) => i !== edit.row), (s) => filled(s).filter((_, i) => i !== edit.row));
    case 'moveRow':
      return writeColumns(moved(cats, edit.from, edit.to), (s) => moved(filled(s), edit.from, edit.to));
    case 'setSeries': {
      const s = model.series[edit.series];
      if (!s) return null;
      const next = { ...s, values: filled(s), [edit.field]: edit.field === 'kind' ? (edit.value === 'line' ? 'line' : 'bar') : edit.value };
      return ed.set(s.line, seriesLine(indentOf(lines[s.line]), next)).toString();
    }
    case 'addSeries': {
      const last = model.series[model.series.length - 1];
      const at = (last?.line ?? lastSetting) + 1;
      return ed.insert(at, seriesLine(indent(at - 1), { kind: edit.seriesKind, name: '', values: new Array(Math.max(rows, 1)).fill(0) })).toString();
    }
    case 'removeSeries': {
      const s = model.series[edit.series];
      return s && model.series.length > 1 ? ed.remove(s.line).toString() : null;
    }
  }
}
