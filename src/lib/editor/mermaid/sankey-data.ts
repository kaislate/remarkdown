// Sankey diagrams: flows from one thing to another, as wide as their
// amount. One flow per line, comma-separated (quotes when a name has a
// comma):
//
//   sankey-beta
//   Electricity,Homes,40
//   "Gas, imported",Industry,25.5

import { LineEditor, statements, freeName, formatNumber } from './data-lines';
import { indentOf } from './source-text';

export const SANKEY_STARTER = 'sankey-beta\nIncome,Rent,900\nIncome,Food,400\nIncome,Savings,300\nSavings,Holiday,200\n';

export interface SankeyFlow {
  line: number;
  from: string;
  to: string;
  amount: number;
}

export interface SankeyModel {
  header: number;
  flows: SankeyFlow[];
}

const HEADER = /^sankey(-beta)?\s*$/;

// One CSV record: fields, unquoted ("" inside quotes is a quote).
export function csvFields(line: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    if (line[i] === '"') {
      let v = '';
      i++;
      for (;;) {
        if (i >= line.length) return null;
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            v += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        v += line[i++];
      }
      out.push(v);
    } else {
      const comma = line.indexOf(',', i);
      const stop = comma < 0 ? line.length : comma;
      out.push(line.slice(i, stop).trim());
      i = stop;
    }
    if (i >= line.length) return out;
    if (line[i] !== ',') return null;
    i++;
  }
}

const csv = (s: string) => {
  const t = s.replace(/[\r\n]+/g, ' ').trim();
  return /[",]/.test(t) || t !== s.trim() ? `"${t.replace(/"/g, '""')}"` : t;
};

export function flowLine(indent: string, f: { from: string; to: string; amount: number }): string {
  return `${indent}${csv(f.from || 'From')},${csv(f.to || 'To')},${formatNumber(Math.max(0, f.amount))}`;
}

export function parseSankey(source: string): SankeyModel | null {
  const st = statements(source, HEADER);
  if (!st) return null;
  const flows: SankeyFlow[] = [];
  for (const [line, t] of st.items) {
    const f = csvFields(t);
    if (!f || f.length !== 3 || !/^\d+(\.\d+)?$/.test(f[2])) return null;
    flows.push({ line, from: f[0], to: f[1], amount: Number(f[2]) });
  }
  return { header: st.header, flows };
}

export type SankeyEdit =
  | { kind: 'setFlow'; index: number; field: 'from' | 'to' | 'amount'; value: string | number }
  | { kind: 'addFlow' }
  | { kind: 'removeFlow'; index: number }
  | { kind: 'moveFlow'; from: number; to: number };

export function applySankeyEdit(source: string, edit: SankeyEdit): string | null {
  const model = parseSankey(source);
  if (!model) return null;
  const ed = new LineEditor(source);
  const lines = ed.lines;
  switch (edit.kind) {
    case 'setFlow': {
      const f = model.flows[edit.index];
      if (!f) return null;
      const next = { ...f, [edit.field]: edit.field === 'amount' ? Number(edit.value) : String(edit.value) };
      if (!Number.isFinite(next.amount) || next.amount < 0) return null;
      return ed.set(f.line, flowLine(indentOf(lines[f.line]), next)).toString();
    }
    case 'addFlow': {
      const last = model.flows[model.flows.length - 1];
      const names = model.flows.flatMap((f) => [f.from, f.to]);
      const at = (last?.line ?? model.header) + 1;
      return ed.insert(at, flowLine(last ? indentOf(lines[last.line]) : '', { from: last?.to ?? freeName('Source', names), to: freeName('Destination', names), amount: 10 })).toString();
    }
    case 'removeFlow': {
      const f = model.flows[edit.index];
      return f && model.flows.length > 1 ? ed.remove(f.line).toString() : null;
    }
    case 'moveFlow': {
      const a = model.flows[edit.from];
      const b = model.flows[edit.to];
      return a && b ? ed.swap(a.line, b.line).toString() : null;
    }
  }
}
