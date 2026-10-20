// Packet diagrams: the fields of a network packet (or any bit layout),
// in order, each so many bits wide.
//
//   packet-beta
//     title UDP Packet
//     0-15: "Source Port"
//     16-31: "Destination Port"
//     +16: "Length"
//     48: "Flag"
//
// Edited as a list of fields with their size. Fields follow on without
// gaps, so changing a size (or adding, removing, reordering) moves the
// fields after it: their lines are rewritten with the new positions, in
// the form each was written in (a range, one bit, or `+size`).

import { LineEditor, statements, indentNear, freeName } from './data-lines';
import { indentOf } from './source-text';

export const PACKET_STARTER = 'packet-beta\n    title Message\n    0-7: "Type"\n    8-15: "Length"\n    16-31: "Checksum"\n    32-63: "Data"\n';

type Form = 'range' | 'bit' | 'plus';

export interface PacketField {
  line: number;
  label: string;
  start: number;
  bits: number;
  form: Form;
}

export interface PacketModel {
  header: number;
  title: { line: number; value: string } | null;
  fields: PacketField[];
}

const HEADER = /^packet(-beta)?\s*$/;

export function parsePacket(source: string): PacketModel | null {
  const st = statements(source, HEADER);
  if (!st) return null;
  const model: PacketModel = { header: st.header, title: null, fields: [] };
  let next = 0;
  for (const [line, t] of st.items) {
    let m: RegExpExecArray | null;
    if ((m = /^title\s+(.*)$/.exec(t))) {
      model.title = { line, value: m[1].trim() };
      continue;
    }
    m = /^(?:(\d+)(?:-(\d+))?|\+(\d+))\s*:\s*"([^"]*)"$/.exec(t);
    if (!m) return null;
    if (m[3] !== undefined) {
      const bits = Number(m[3]);
      if (bits < 1) return null;
      model.fields.push({ line, label: m[4], start: next, bits, form: 'plus' });
      next += bits;
    } else {
      const start = Number(m[1]);
      const end = m[2] !== undefined ? Number(m[2]) : start;
      if (end < start) return null;
      model.fields.push({ line, label: m[4], start, bits: end - start + 1, form: m[2] !== undefined ? 'range' : 'bit' });
      next = end + 1;
    }
  }
  return model;
}

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim();

function fieldLine(indent: string, f: { label: string; start: number; bits: number; form: Form }): string {
  const label = `"${clean(f.label) || 'Field'}"`;
  if (f.form === 'plus') return `${indent}+${f.bits}: ${label}`;
  if (f.bits === 1 && f.form === 'bit') return `${indent}${f.start}: ${label}`;
  return `${indent}${f.start}-${f.start + f.bits - 1}: ${label}`;
}

export type PacketEdit =
  | { kind: 'setTitle'; value: string }
  | { kind: 'setField'; index: number; field: 'label' | 'bits'; value: string | number }
  | { kind: 'addField' }
  | { kind: 'removeField'; index: number }
  | { kind: 'moveField'; from: number; to: number };

export function applyPacketEdit(source: string, edit: PacketEdit): string | null {
  const model = parsePacket(source);
  if (!model) return null;
  const ed = new LineEditor(source);
  const lines = ed.lines;
  const fields = model.fields;
  // Writes fields (label, size, form) into the field line slots from
  // `from` on, numbering them on from where the one before ends.
  const lay = (contents: Array<Pick<PacketField, 'label' | 'bits' | 'form'>>, from: number) => {
    let at = from === 0 ? (fields[0]?.start ?? 0) : fields[from - 1].start + fields[from - 1].bits;
    for (let i = from; i < contents.length; i++) {
      const c = contents[i];
      ed.set(fields[i].line, fieldLine(indentOf(lines[fields[i].line]), { ...c, start: at }));
      at += c.bits;
    }
    return ed.toString();
  };
  switch (edit.kind) {
    case 'setTitle': {
      const v = clean(edit.value);
      if (model.title) return v ? ed.set(model.title.line, `${indentOf(lines[model.title.line])}title ${v}`).toString() : ed.remove(model.title.line).toString();
      return v ? ed.insert(model.header + 1, `${indentNear(lines, model.header + 1, model.header)}title ${v}`).toString() : null;
    }
    case 'setField': {
      const f = fields[edit.index];
      if (!f) return null;
      if (edit.field === 'label') return ed.set(f.line, fieldLine(indentOf(lines[f.line]), { ...f, label: String(edit.value) })).toString();
      const bits = Math.round(Number(edit.value));
      if (!Number.isFinite(bits) || bits < 1 || bits > 4096) return null;
      const contents = fields.map((x) => ({ ...x }));
      contents[edit.index].bits = bits;
      if (bits > 1 && contents[edit.index].form === 'bit') contents[edit.index].form = 'range';
      return lay(contents, edit.index);
    }
    case 'addField': {
      const last = fields[fields.length - 1];
      const at = (last?.line ?? model.title?.line ?? model.header) + 1;
      const start = last ? last.start + last.bits : 0;
      const label = freeName('Field', fields.map((f) => f.label));
      return ed.insert(at, fieldLine(indentNear(lines, at - 1, model.header), { label, start, bits: 8, form: last?.form === 'plus' ? 'plus' : 'range' })).toString();
    }
    case 'removeField': {
      const f = fields[edit.index];
      if (!f || fields.length <= 1) return null;
      // Close the gap: the fields after it move up into its place.
      const contents = fields.filter((_, i) => i !== edit.index);
      const slots = fields.filter((_, i) => i !== edit.index);
      let at = edit.index === 0 ? f.start : fields[edit.index - 1].start + fields[edit.index - 1].bits;
      for (let i = edit.index; i < contents.length; i++) {
        ed.set(slots[i].line, fieldLine(indentOf(lines[slots[i].line]), { ...contents[i], start: at }));
        at += contents[i].bits;
      }
      return ed.remove(f.line).toString();
    }
    case 'moveField': {
      if (!fields[edit.from] || !fields[edit.to]) return null;
      const contents = fields.map((x) => ({ ...x }));
      const [it] = contents.splice(edit.from, 1);
      contents.splice(edit.to, 0, it);
      return lay(contents, Math.min(edit.from, edit.to));
    }
  }
}
