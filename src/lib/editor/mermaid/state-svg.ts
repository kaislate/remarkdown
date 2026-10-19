// Map between a rendered state diagram (mermaid 11.14's SVG, the same
// for `stateDiagram` and `stateDiagram-v2`) and the model of
// state-parser.ts: which item did a click hit, and which element draws
// an item (for highlighting / anchoring a popover).
//
// What mermaid emits (prefix = the <svg>'s id):
//   - a state:      g.node#<prefix>-state-<Id>-<N>
//   - start / end:  g.node#<prefix>-state-<owner>_start-<N> / _end-<N>,
//                   owner = `root`, the group's id, or a concurrency
//                   region's node id (`divider-id-<k>`, or a RANDOM id
//                   for a group's last region)
//   - a group:      .statediagram-cluster[data-id=<Id>]; its regions are
//                   .statediagram-cluster-alt clusters without data-id
//   - a transition: path.transition[data-id=edge<N>] and its label
//                   g.edgeLabel > g.label[data-id=edge<N>]
//   - a note:       g.node.statediagram-note#<prefix>-state-<Id>----note-<N>,
//                   its connector path.note-edge[data-id=<Id>-<note id>]
//                   (`<note id>-<Id>` for a left-of note) and its
//                   background g.note-cluster#<prefix>-state-<Id>----parent-<N>
// <N> is mermaid's counter: transitions AND notes, depth-first in source
// order. The parser computes the same numbers (model.render), so ids are
// matched exactly; the trailing -<N> of a state's id is NOT used (it is
// the counter at the state's last mention — fragile, and not needed:
// state ids can't contain '-').
//
// Fragility: all of this is mermaid-internal markup. If an upgrade
// changes it, stateTargetAt returns null (nothing is selected) rather
// than a wrong item; mermaid-state-svg.test.ts pins it with SVG captured
// from a real browser.
import type { StateModel, StateScope } from './state-parser';

export type StateTarget =
  // A state box (also a fork / join bar, a choice diamond).
  | { kind: 'state'; id: string }
  // A group's box: its title or background (also a concurrency region's).
  | { kind: 'composite'; id: string }
  | { kind: 'transition'; index: number }
  | { kind: 'note'; index: number }
  // A start / end circle of a scope.
  | { kind: 'start' | 'end'; scope: StateScope };

// Every item a click can hit, in a stable order: states and groups (in
// model order), transitions, notes, start / end circles.
export function stateTargets(model: StateModel): StateTarget[] {
  const out: StateTarget[] = [];
  for (const s of model.states.values()) out.push(s.composite ? { kind: 'composite', id: s.id } : { kind: 'state', id: s.id });
  model.transitions.forEach((_, index) => out.push({ kind: 'transition', index }));
  model.notes.forEach((_, index) => out.push({ kind: 'note', index }));
  for (const t of model.terminals) out.push({ kind: t.kind, scope: t.scope });
  return out;
}

// `<prefix>-state-` → the rest of a mermaid node id; null if it isn't one.
function stateDomId(el: Element, svg: SVGSVGElement): string | null {
  const id = el.id;
  if (!id) return null;
  const prefix = svg.id ? `${svg.id}-state-` : null;
  if (prefix) return id.startsWith(prefix) ? id.slice(prefix.length) : null;
  const k = id.indexOf('-state-');
  return k >= 0 ? id.slice(k + '-state-'.length) : null;
}

function noteFor(model: StateModel, noteId: string): number {
  return model.render.notes.indexOf(noteId);
}

// A note connector's data-id: `<Id>-<note id>` or `<note id>-<Id>`.
function noteOfEdge(model: StateModel, dataId: string): number {
  return model.render.notes.findIndex((n, k) => {
    const s = model.notes[k].state;
    return dataId === `${s}-${n}` || dataId === `${n}-${s}`;
  });
}

// The group an element is drawn inside, from the nesting of mermaid's
// `g.root` subgraphs (each group's subgraph holds its cluster).
function enclosingGroup(el: Element, model: StateModel, ok: (id: string) => boolean): string | null {
  for (let r = el.closest('g.root'); r; r = r.parentElement?.closest('g.root') ?? null) {
    const clusters = [...r.children].find((c) => c.classList.contains('clusters'));
    for (const c of clusters ? [...clusters.children] : []) {
      const id = c.getAttribute('data-id');
      if (id && model.states.get(id)?.composite && ok(id)) return id;
    }
  }
  return null;
}

// The scope of a start / end circle or region whose node id is `owner`.
function scopeOfOwner(owner: string, el: Element, model: StateModel): StateScope | null {
  if (owner === 'root') return { parent: null, region: 0 };
  if (model.states.get(owner)?.composite) return { parent: owner, region: 0 };
  for (const [g, ids] of model.render.regions) {
    const k = ids.indexOf(owner);
    if (k >= 0) return { parent: g, region: k };
  }
  // mermaid's random id: the last region of a group with regions.
  const random = [...model.render.regions].filter(([, ids]) => ids[ids.length - 1] === null);
  if (random.length === 1) return { parent: random[0][0], region: random[0][1].length - 1 };
  const g = enclosingGroup(el, model, (id) => random.some(([r]) => r === id));
  return g ? { parent: g, region: model.render.regions.get(g)!.length - 1 } : null;
}

// What a click on `el` (inside `svg`) hit, or null for the background /
// anything not in the model.
export function stateTargetAt(el: Element, svg: SVGSVGElement, model: StateModel): StateTarget | null {
  // A transition (or note connector) path / label.
  const edge = el.closest('path[data-id], g.edgeLabel');
  if (edge && svg.contains(edge)) {
    const holder = edge.matches('[data-id]') ? edge : edge.querySelector('[data-id]');
    const dataId = holder?.getAttribute('data-id') ?? '';
    const index = model.render.transitions.indexOf(dataId);
    if (index >= 0) return { kind: 'transition', index };
    const note = noteOfEdge(model, dataId);
    return note >= 0 ? { kind: 'note', index: note } : null;
  }

  // A node: state, start / end circle, note.
  const node = el.closest('g.node');
  if (node && svg.contains(node)) {
    const rest = stateDomId(node, svg);
    if (rest === null) return null;
    if (rest.includes('----note-')) {
      const index = noteFor(model, rest);
      return index >= 0 ? { kind: 'note', index } : null;
    }
    const id = rest.replace(/-\d+$/, '');
    const st = model.states.get(id);
    if (st) return st.composite ? { kind: 'composite', id } : { kind: 'state', id };
    const term = /^(.*)_(start|end)$/.exec(id);
    if (term) {
      const scope = scopeOfOwner(term[1], node, model);
      const kind = term[2] as 'start' | 'end';
      if (scope && model.terminals.some((t) => t.kind === kind && t.scope.parent === scope.parent && t.scope.region === scope.region)) {
        return { kind, scope };
      }
    }
    return null;
  }

  // A note's background.
  const noteBg = el.closest('g.note-cluster');
  if (noteBg && svg.contains(noteBg)) {
    const m = /^(.*)----parent-(\d+)$/.exec(stateDomId(noteBg, svg) ?? '');
    if (!m) return null;
    let index = noteFor(model, `${m[1]}----note-${m[2]}`);
    if (index < 0) index = model.notes.findIndex((n) => n.state === m[1]);
    return index >= 0 ? { kind: 'note', index } : null;
  }

  // A group (or one of its concurrency regions).
  const cluster = el.closest('.statediagram-cluster');
  if (cluster && svg.contains(cluster)) {
    const id = cluster.getAttribute('data-id');
    if (id && model.states.get(id)?.composite) return { kind: 'composite', id };
    const owner = stateDomId(cluster, svg)?.replace(/-\d+$/, '');
    const scope = owner ? scopeOfOwner(owner, cluster, model) : null;
    return scope?.parent ? { kind: 'composite', id: scope.parent } : null;
  }
  return null;
}

// Where mermaid draws `target` (the element to highlight / anchor to):
// the state's node, the group's cluster, the transition's path, the
// note's box, the circle. Null when the SVG doesn't show it.
export function stateElementFor(svg: SVGSVGElement, model: StateModel, target: StateTarget): Element | null {
  const same = (t: StateTarget | null) => !!t && JSON.stringify(t) === JSON.stringify(target);
  if (target.kind === 'composite') {
    const c = svg.querySelector(`.statediagram-cluster[data-id="${cssString(target.id)}"]`);
    if (c && same(stateTargetAt(c, svg, model))) return c;
  }
  if (target.kind === 'transition') {
    const dataId = model.render.transitions[target.index];
    const p = dataId ? svg.querySelector(`path[data-id="${cssString(dataId)}"]`) : null;
    if (p && same(stateTargetAt(p, svg, model))) return p;
  }
  // Otherwise: the first drawn element that maps to it, nodes first.
  for (const sel of ['g.node', '.statediagram-cluster', 'path[data-id]', 'g.edgeLabel', 'g.note-cluster']) {
    for (const el of svg.querySelectorAll(sel)) if (same(stateTargetAt(el, svg, model))) return el;
  }
  return null;
}

function cssString(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}
