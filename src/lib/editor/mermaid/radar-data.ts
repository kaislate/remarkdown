// Radar charts: a few curves scored on the same axes.
//
//   radar-beta
//     title Skills
//     axis m["Maths"], s["Science"], e["English"]
//     curve a["Alice"]{85, 90, 80}
//     curve b["Bob"]{70, 75, 85}
//     max 100
//     min 0
//
// Edited as a spreadsheet: one row per axis, one column per curve. Curves
// written by axis name (`{ m: 85, … }`) make it a text-edited diagram.

import { LineEditor, statements, indentNear, numberList, parseNumber, splitList, moved, freeName } from './data-lines';
import { indentOf } from './source-text';

export const RADAR_STARTER =
  'radar-beta\n    title Team skills\n    axis design["Design"], code["Code"], test["Testing"], docs["Writing"], talk["Speaking"]\n    curve ana["Ana"]{4, 3, 5, 2, 4}\n    curve ben["Ben"]{2, 5, 3, 4, 3}\n    max 5\n    min 0\n';

export interface RadarAxis {
  line: number;
  id: string;
  label: string; // '' when it has none (the id shows)
}

export interface RadarCurve {
  line: number;
  id: string;
  label: string;
  values: number[];
}

export interface RadarModel {
  header: number;
  title: { line: number; value: string } | null;
  axes: RadarAxis[];
  curves: RadarCurve[];
  max: { line: number; value: number } | null;
  min: { line: number; value: number } | null;
}

const HEADER = /^radar(-beta)?\s*$/;
const NAMED = /^([A-Za-z_][\w-]*)\s*(?:\[\s*"([^"]*)"\s*\])?$/;

export function parseRadar(source: string): RadarModel | null {
  const st = statements(source, HEADER);
  if (!st) return null;
  const model: RadarModel = { header: st.header, title: null, axes: [], curves: [], max: null, min: null };
  for (const [line, t] of st.items) {
    let m: RegExpExecArray | null;
    if ((m = /^title\s+(.*)$/.exec(t))) model.title = { line, value: m[1].trim() };
    else if ((m = /^axis\s+(.*)$/.exec(t))) {
      // Split on commas outside [" "].
      const parts = m[1].match(/[^,[]+(?:\[[^\]]*\])?/g) ?? [];
      for (const p of parts) {
        const a = NAMED.exec(p.trim());
        if (!a) return null;
        model.axes.push({ line, id: a[1], label: a[2] ?? '' });
      }
    } else if ((m = /^curve\s+([A-Za-z_][\w-]*)\s*(?:\[\s*"([^"]*)"\s*\])?\s*\{(.*)\}$/.exec(t))) {
      const items = splitList(m[3]);
      const values = items?.map(parseNumber);
      if (!values || values.some((v) => v === null)) return null;
      model.curves.push({ line, id: m[1], label: m[2] ?? '', values: values as number[] });
    } else if ((m = /^(max|min)\s+(-?[\d.]+)$/.exec(t))) {
      model[m[1] as 'max' | 'min'] = { line, value: Number(m[2]) };
    } else if (/^(showLegend|ticks|graticule)\b/.test(t)) {
      // Kept as written.
    } else return null;
  }
  return model;
}

const cleanLabel = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/["\]]/g, "'").trim();
const named = (id: string, label: string) => (label ? `${id}["${cleanLabel(label)}"]` : id);

// An id for a new axis / curve from its label: letters and digits, unique.
export function freeId(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^\d+/, '') || 'item';
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) if (!set.has(`${base}${n}`)) return `${base}${n}`;
}

function curveLine(indent: string, c: { id: string; label: string; values: number[] }): string {
  return `${indent}curve ${named(c.id, c.label)}{${numberList(c.values)}}`;
}

export type RadarEdit =
  | { kind: 'setTitle'; value: string }
  | { kind: 'setRange'; end: 'max' | 'min'; value: number | null }
  | { kind: 'setAxisLabel'; row: number; value: string }
  | { kind: 'setValue'; row: number; curve: number; value: number }
  | { kind: 'addAxis' }
  | { kind: 'removeAxis'; row: number }
  | { kind: 'moveAxis'; from: number; to: number }
  | { kind: 'setCurveLabel'; curve: number; value: string }
  | { kind: 'addCurve' }
  | { kind: 'removeCurve'; curve: number };

export function applyRadarEdit(source: string, edit: RadarEdit): string | null {
  const model = parseRadar(source);
  if (!model) return null;
  const ed = new LineEditor(source);
  const lines = ed.lines;
  const rows = model.axes.length;
  const filled = (c: RadarCurve) => Array.from({ length: rows }, (_, i) => c.values[i] ?? 0);
  const lastLine = Math.max(model.header, ...[model.title, model.max, model.min, ...model.axes, ...model.curves].filter(Boolean).map((x) => x!.line));
  const indent = (at: number) => indentNear(lines, at, model.header);

  // Rewrites the axes onto their lines: on the first axis line when the
  // order or number changed (the others go), else each on its own line.
  const writeAxes = (axes: Array<{ id: string; label: string }>, curveValues: (c: RadarCurve) => number[]) => {
    for (const c of model.curves) ed.set(c.line, curveLine(indentOf(lines[c.line]), { ...c, values: curveValues(c) }));
    const axisLines = [...new Set(model.axes.map((a) => a.line))];
    const text = `axis ${axes.map((a) => named(a.id, a.label)).join(', ')}`;
    if (!axisLines.length) return ed.insert(model.header + 1, `${indent(model.header + 1)}${text}`).toString();
    ed.set(axisLines[0], `${indentOf(lines[axisLines[0]])}${text}`);
    for (const l of axisLines.slice(1).sort((a, b) => b - a)) ed.remove(l);
    return ed.toString();
  };

  switch (edit.kind) {
    case 'setTitle': {
      const v = edit.value.replace(/[\r\n]+/g, ' ').trim();
      if (model.title) return v ? ed.set(model.title.line, `${indentOf(lines[model.title.line])}title ${v}`).toString() : ed.remove(model.title.line).toString();
      return v ? ed.insert(model.header + 1, `${indent(model.header + 1)}title ${v}`).toString() : null;
    }
    case 'setRange': {
      const cur = model[edit.end];
      if (edit.value === null) return cur ? ed.remove(cur.line).toString() : null;
      if (!Number.isFinite(edit.value)) return null;
      const other = model[edit.end === 'max' ? 'min' : 'max'];
      if (other && (edit.end === 'max' ? edit.value <= other.value : edit.value >= other.value)) return null;
      const text = `${edit.end} ${edit.value}`;
      return cur ? ed.set(cur.line, `${indentOf(lines[cur.line])}${text}`).toString() : ed.insert(lastLine + 1, `${indent(lastLine)}${text}`).toString();
    }
    case 'setAxisLabel': {
      const a = model.axes[edit.row];
      if (!a) return null;
      const onLine = model.axes.filter((x) => x.line === a.line).map((x) => (x === a ? { ...x, label: edit.value.trim() } : x));
      return ed.set(a.line, `${indentOf(lines[a.line])}axis ${onLine.map((x) => named(x.id, x.label)).join(', ')}`).toString();
    }
    case 'setValue': {
      const c = model.curves[edit.curve];
      if (!c || !Number.isFinite(edit.value)) return null;
      const values = filled(c);
      values[edit.row] = edit.value;
      return ed.set(c.line, curveLine(indentOf(lines[c.line]), { ...c, values })).toString();
    }
    case 'addAxis': {
      const label = freeName('Axis', model.axes.map((a) => a.label || a.id));
      const id = freeId(label, [...model.axes.map((a) => a.id), ...model.curves.map((c) => c.id)]);
      return writeAxes([...model.axes, { id, label }], (c) => [...filled(c), 0]);
    }
    case 'removeAxis':
      if (rows <= 1) return null;
      return writeAxes(model.axes.filter((_, i) => i !== edit.row), (c) => filled(c).filter((_, i) => i !== edit.row));
    case 'moveAxis':
      return writeAxes(moved(model.axes, edit.from, edit.to), (c) => moved(filled(c), edit.from, edit.to));
    case 'setCurveLabel': {
      const c = model.curves[edit.curve];
      return c ? ed.set(c.line, curveLine(indentOf(lines[c.line]), { ...c, values: filled(c), label: edit.value.trim() })).toString() : null;
    }
    case 'addCurve': {
      const last = model.curves[model.curves.length - 1];
      const label = freeName('Curve', model.curves.map((c) => c.label || c.id));
      const id = freeId(label, [...model.axes.map((a) => a.id), ...model.curves.map((c) => c.id)]);
      const at = (last?.line ?? Math.max(model.header, ...model.axes.map((a) => a.line))) + 1;
      return ed.insert(at, curveLine(indent(at - 1), { id, label, values: new Array(rows).fill(0) })).toString();
    }
    case 'removeCurve': {
      const c = model.curves[edit.curve];
      return c && model.curves.length > 1 ? ed.remove(c.line).toString() : null;
    }
  }
}
