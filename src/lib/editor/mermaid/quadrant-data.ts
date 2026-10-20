// Quadrant charts: points placed on two axes (0 to 1 each), the square
// split into four named quarters.
//
//   quadrantChart
//     title Reach and engagement
//     x-axis Low Reach --> High Reach
//     y-axis Low Engagement --> High Engagement
//     quadrant-1 We should expand
//     quadrant-2 Need to promote
//     quadrant-3 Re-evaluate
//     quadrant-4 May be improved
//     Campaign A: [0.3, 0.6]
//
// Points with their own styling, or class definitions, make it a
// text-edited diagram instead.

import { LineEditor, statements, indentNear, freeName, formatNumber } from './data-lines';
import { indentOf } from './source-text';

export const QUADRANT_STARTER =
  'quadrantChart\n    title Effort and value\n    x-axis Low effort --> High effort\n    y-axis Low value --> High value\n    quadrant-1 Plan carefully\n    quadrant-2 Do first\n    quadrant-3 Maybe later\n    quadrant-4 Skip\n    Idea A: [0.3, 0.7]\n    Idea B: [0.75, 0.4]\n';

export interface QuadrantPoint {
  line: number;
  name: string;
  x: number;
  y: number;
}

type Setting = { line: number; value: string } | null;

export interface QuadrantModel {
  header: number;
  title: Setting;
  xAxis: { line: number; low: string; high: string } | null;
  yAxis: { line: number; low: string; high: string } | null;
  // quadrant-1 … quadrant-4: top right, top left, bottom left, bottom right.
  quadrants: [Setting, Setting, Setting, Setting];
  points: QuadrantPoint[];
}

const HEADER = /^quadrantChart\s*$/;

export function parseQuadrant(source: string): QuadrantModel | null {
  const st = statements(source, HEADER);
  if (!st) return null;
  const model: QuadrantModel = { header: st.header, title: null, xAxis: null, yAxis: null, quadrants: [null, null, null, null], points: [] };
  for (const [line, t] of st.items) {
    let m: RegExpExecArray | null;
    if ((m = /^title\s+(.*)$/.exec(t))) model.title = { line, value: m[1].trim() };
    else if ((m = /^([xy])-axis\s+(.*?)(?:\s*-->\s*(.*))?$/.exec(t))) {
      const axis = { line, low: m[2].trim(), high: (m[3] ?? '').trim() };
      if (m[1] === 'x') model.xAxis = axis;
      else model.yAxis = axis;
    } else if ((m = /^quadrant-([1-4])\s+(.*)$/.exec(t))) model.quadrants[Number(m[1]) - 1] = { line, value: m[2].trim() };
    else if ((m = /^([^:[\]]+?)\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]$/.exec(t))) {
      model.points.push({ line, name: m[1].trim(), x: Number(m[2]), y: Number(m[3]) });
    } else return null;
  }
  return model;
}

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/[:[\]]/g, ' ').replace(/-->/g, '→').replace(/\s+/g, ' ').trim();
const unit = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0.5));

export function pointLine(indent: string, p: { name: string; x: number; y: number }): string {
  return `${indent}${clean(p.name) || 'Point'}: [${formatNumber(unit(p.x))}, ${formatNumber(unit(p.y))}]`;
}

export type QuadrantEdit =
  | { kind: 'setTitle'; value: string }
  | { kind: 'setAxis'; axis: 'x' | 'y'; end: 'low' | 'high'; value: string }
  | { kind: 'setQuadrant'; index: number; value: string }
  | { kind: 'setPoint'; index: number; field: 'name' | 'x' | 'y'; value: string | number }
  | { kind: 'addPoint' }
  | { kind: 'removePoint'; index: number }
  | { kind: 'movePoint'; from: number; to: number };

// The line after the last setting (title, axes, quadrants), where a new
// setting goes.
function afterSettings(m: QuadrantModel): number {
  const lines = [m.title, m.xAxis, m.yAxis, ...m.quadrants].filter(Boolean).map((s) => s!.line);
  return Math.max(m.header, ...lines) + 1;
}

export function applyQuadrantEdit(source: string, edit: QuadrantEdit): string | null {
  const model = parseQuadrant(source);
  if (!model) return null;
  const ed = new LineEditor(source);
  const lines = ed.lines;
  const settingLine = (existing: Setting | { line: number } | null, text: string | null): string | null => {
    if (existing) return text === null ? ed.remove(existing.line).toString() : ed.set(existing.line, `${indentOf(lines[existing.line])}${text}`).toString();
    if (text === null) return null;
    const at = afterSettings(model);
    return ed.insert(at, `${indentNear(lines, at - 1, model.header)}${text}`).toString();
  };
  switch (edit.kind) {
    case 'setTitle': {
      const v = clean(edit.value);
      return settingLine(model.title, v ? `title ${v}` : null);
    }
    case 'setAxis': {
      const axis = edit.axis === 'x' ? model.xAxis : model.yAxis;
      const next = { low: axis?.low ?? '', high: axis?.high ?? '', [edit.end]: clean(edit.value) };
      if (!next.low && !next.high) return settingLine(axis, null);
      return settingLine(axis, `${edit.axis}-axis ${next.low || 'Low'}${next.high ? ` --> ${next.high}` : ''}`);
    }
    case 'setQuadrant': {
      const v = clean(edit.value);
      return settingLine(model.quadrants[edit.index], v ? `quadrant-${edit.index + 1} ${v}` : null);
    }
    case 'setPoint': {
      const p = model.points[edit.index];
      if (!p) return null;
      const next = { ...p, [edit.field]: edit.field === 'name' ? String(edit.value) : Number(edit.value) };
      return ed.set(p.line, pointLine(indentOf(lines[p.line]), next)).toString();
    }
    case 'addPoint': {
      const last = model.points[model.points.length - 1];
      const at = last ? last.line + 1 : afterSettings(model);
      const name = freeName('Point', model.points.map((p) => p.name));
      return ed.insert(at, pointLine(indentNear(lines, at - 1, model.header), { name, x: 0.5, y: 0.5 })).toString();
    }
    case 'removePoint': {
      const p = model.points[edit.index];
      return p ? ed.remove(p.line).toString() : null;
    }
    case 'movePoint': {
      const a = model.points[edit.from];
      const b = model.points[edit.to];
      return a && b ? ed.swap(a.line, b.line).toString() : null;
    }
  }
}
