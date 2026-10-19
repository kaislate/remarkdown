// Click targets in a rendered class diagram: which model item an SVG
// element belongs to (classTargetAt), and the element for a model item
// (classElementFor) — for selection outlines and popover anchors.
//
// What mermaid 11.14 emits (checked against real-browser SVGs, see
// tests/fixtures/mermaid-svg/class-*.svg). Every id is prefixed with
// the <svg>'s own id and a `-`:
//   class box   g.node#<svg>-classId-<classId>-<n>   (n is a counter
//               mermaid never resets between renders: ignored)
//               ├ .annotation-group  «annotation»
//               ├ .label-group       the title
//               ├ .members-group > g.label   one per field, in order
//               └ .methods-group > g.label   one per method, in order
//   note        g.node#<svg>-note<i>   (i = note index)
//   namespace   g.cluster#<svg>-<namespace id>
//   lollipop    g.node#<svg>-interface<k> (the k-th lollipop relation)
//   relation    path[data-id=id_<from>_<to>_<i+1>] in .edgePaths and
//               g.label[data-id=…] in .edgeLabels; a lollipop end is
//               named interface<k>
//   self loop   split into three edges, data-id
//               <classId>-cyclic-special-{1,mid,2}, plus two helper
//               g.label.edgeLabel#<classId>---<classId>---{1,2} (no
//               prefix). Several self loops on one class share those
//               ids: they all map to the first.
//   note line   path[data-id=edgeNote<i>]
//   cardinality .edgeTerminals groups WITHOUT any id, one per non-empty
//               cardinality in relation order (from before to). Mapped
//               by position — only when their count is the expected one.
// Fragility: all of this is mermaid's internal DOM. Mapping is
// defensive: anything unexpected maps to null (or to the enclosing
// class box) rather than to a wrong item.
import type { ClassModel } from './class-parser';

export type ClassTarget =
  // part: what in the box was hit.
  | { kind: 'class'; id: string; part: 'title' | 'annotation' | 'box' }
  // index: into model.classes.get(classId).members.
  | { kind: 'member'; classId: string; index: number }
  | { kind: 'relation'; index: number; part: 'line' | 'label' }
  | { kind: 'cardinality'; index: number; end: 'from' | 'to' }
  | { kind: 'note'; index: number }
  | { kind: 'namespace'; id: string };

// data-id of each relation's edge as mermaid's ClassDB.getData names it.
function edgeIds(model: ClassModel): string[] {
  let iface = 0;
  return model.relations.map((r, i) => {
    let from = r.from;
    let to = r.to;
    const marked = (m: string) => m !== 'none';
    if (r.fromMarker === 'lollipop' && !marked(r.toMarker)) from = `interface${iface++}`;
    else if (r.toMarker === 'lollipop' && !marked(r.fromMarker)) to = `interface${iface++}`;
    return from === to ? `${from}-cyclic-special` : `id_${from}_${to}_${i + 1}`;
  });
}

// Index of the relation whose k-th lollipop interface node this is.
function lollipopRelation(model: ClassModel, k: number): number {
  let n = 0;
  for (let i = 0; i < model.relations.length; i++) {
    const r = model.relations[i];
    const lp = (r.fromMarker === 'lollipop' && r.toMarker === 'none') || (r.toMarker === 'lollipop' && r.fromMarker === 'none');
    if (lp && n++ === k) return i;
  }
  return -1;
}

// The cardinality terminals in DOM order ↔ (relation, end).
function terminalSlots(model: ClassModel): Array<{ index: number; end: 'from' | 'to' }> {
  const out: Array<{ index: number; end: 'from' | 'to' }> = [];
  model.relations.forEach((r, index) => {
    if (r.fromCardinality) out.push({ index, end: 'from' });
    if (r.toCardinality) out.push({ index, end: 'to' });
  });
  return out;
}

function unprefix(svg: SVGSVGElement, id: string): string {
  const p = svg.id ? `${svg.id}-` : '';
  return p && id.startsWith(p) ? id.slice(p.length) : id;
}

function relationForDataId(model: ClassModel, dataId: string): number {
  const ids = edgeIds(model);
  const exact = ids.indexOf(dataId);
  if (exact >= 0) return exact;
  const cyc = /^(.*)-cyclic-special(-(1|mid|2))?$/.exec(dataId);
  if (cyc) return ids.indexOf(`${cyc[1]}-cyclic-special`);
  return -1;
}

export function classTargetAt(el: Element, svg: SVGSVGElement, model: ClassModel): ClassTarget | null {
  if (!svg.contains(el)) return null;
  // Cardinality labels: by position.
  const term = el.closest('.edgeTerminals');
  if (term) {
    const all = [...svg.querySelectorAll('.edgeTerminals')];
    const slots = terminalSlots(model);
    const k = all.indexOf(term);
    return all.length === slots.length && k >= 0 ? { kind: 'cardinality', ...slots[k] } : null;
  }
  // Edges and their labels.
  const withId = el.closest('[data-id]');
  if (withId && svg.contains(withId)) {
    const dataId = withId.getAttribute('data-id')!;
    const note = /^edgeNote(\d+)$/.exec(dataId);
    if (note) return model.notes[+note[1]] ? { kind: 'note', index: +note[1] } : null;
    const index = relationForDataId(model, dataId);
    if (index >= 0) return { kind: 'relation', index, part: withId.closest('.edgeLabels') ? 'label' : 'line' };
  }
  // Self-loop helper nodes.
  const helper = el.closest('g.edgeLabel[id]');
  if (helper) {
    const m = /^(.*)---\1---\d+$/.exec(helper.id);
    if (m) {
      const index = relationForDataId(model, `${m[1]}-cyclic-special`);
      if (index >= 0) return { kind: 'relation', index, part: 'line' };
    }
  }
  const node = el.closest('g.node');
  if (node && svg.contains(node)) {
    const id = unprefix(svg, node.id);
    const cls = /^classId-(.*)-\d+$/.exec(id);
    if (cls) {
      const c = model.classes.get(cls[1]);
      if (!c) return null;
      for (const [group, kind] of [['.members-group', 'field'], ['.methods-group', 'method']] as const) {
        const g = el.closest(group);
        if (g && node.contains(g)) {
          const row = el.closest('g.label');
          const rows = [...g.children].filter((x) => x.matches('g.label'));
          const k = row ? rows.indexOf(row) : -1;
          const indexes = c.members.map((m, i) => (m.kind === kind ? i : -1)).filter((i) => i >= 0);
          if (k >= 0 && rows.length === indexes.length) return { kind: 'member', classId: c.id, index: indexes[k] };
          return { kind: 'class', id: c.id, part: 'box' };
        }
      }
      if (el.closest('.annotation-group')) return { kind: 'class', id: c.id, part: 'annotation' };
      if (el.closest('.label-group')) return { kind: 'class', id: c.id, part: 'title' };
      return { kind: 'class', id: c.id, part: 'box' };
    }
    const note = /^note(\d+)$/.exec(id);
    if (note) return model.notes[+note[1]] ? { kind: 'note', index: +note[1] } : null;
    const iface = /^interface(\d+)$/.exec(id);
    if (iface) {
      const index = lollipopRelation(model, +iface[1]);
      return index >= 0 ? { kind: 'relation', index, part: 'line' } : null;
    }
    return null;
  }
  const cluster = el.closest('g.cluster');
  if (cluster && svg.contains(cluster)) {
    const id = unprefix(svg, cluster.id);
    if (model.namespaces.some((n) => n.id === id)) return { kind: 'namespace', id };
  }
  return null;
}

function classNode(svg: SVGSVGElement, id: string): Element | null {
  for (const n of svg.querySelectorAll('g.node')) {
    const m = /^classId-(.*)-\d+$/.exec(unprefix(svg, n.id));
    if (m && m[1] === id) return n;
  }
  return null;
}

function edgeElement(svg: SVGSVGElement, model: ClassModel, index: number, part: 'line' | 'label'): Element | null {
  const id = edgeIds(model)[index];
  if (id === undefined) return null;
  // A self loop's label sits on its middle piece.
  const dataId = id.endsWith('-cyclic-special') ? `${id}-mid` : id;
  const scope = part === 'label' ? '.edgeLabels g.label' : '.edgePaths path';
  for (const e of svg.querySelectorAll(scope)) if (e.getAttribute('data-id') === dataId) return e;
  return null;
}

export function classElementFor(svg: SVGSVGElement, model: ClassModel, target: ClassTarget): Element | null {
  switch (target.kind) {
    case 'class': {
      const node = classNode(svg, target.id);
      if (!node || target.part === 'box') return node;
      return node.querySelector(target.part === 'title' ? '.label-group' : '.annotation-group') ?? node;
    }
    case 'member': {
      const c = model.classes.get(target.classId);
      const m = c?.members[target.index];
      const node = classNode(svg, target.classId);
      if (!c || !m || !node) return null;
      const group = node.querySelector(m.kind === 'field' ? '.members-group' : '.methods-group');
      const rows = group ? [...group.children].filter((x) => x.matches('g.label')) : [];
      const k = c.members.slice(0, target.index).filter((x) => x.kind === m.kind).length;
      return rows[k] ?? null;
    }
    case 'relation':
      return edgeElement(svg, model, target.index, target.part);
    case 'cardinality': {
      const all = [...svg.querySelectorAll('.edgeTerminals')];
      const slots = terminalSlots(model);
      if (all.length !== slots.length) return null;
      const k = slots.findIndex((s) => s.index === target.index && s.end === target.end);
      return k >= 0 ? all[k] : null;
    }
    case 'note':
      for (const n of svg.querySelectorAll('g.node')) if (unprefix(svg, n.id) === `note${target.index}`) return n;
      return null;
    case 'namespace':
      for (const n of svg.querySelectorAll('g.cluster')) if (unprefix(svg, n.id) === target.id) return n;
      return null;
  }
}
