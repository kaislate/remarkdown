// Click targets in a rendered ER diagram (see class-svg.ts for the
// idea). What mermaid 11.14 emits (checked against real-browser SVGs,
// tests/fixtures/mermaid-svg/er-*.svg); ids are prefixed with the
// <svg>'s id and a `-`:
//   entity        g.node#<svg>-entity-<name>-<i>  (i = creation index)
//     with attributes:
//                 ├ g.label.name                 the title
//                 ├ .row-rect-odd / .row-rect-even  one per row, in order
//                 └ g.label.attribute-{type,name,keys,comment}
//                                                four per row, in order
//     without:    rect.basic + g.label
//   relationship  path[data-id=id_entity-<A>-<i>_entity-<B>-<j>_<k>]
//                 (k = relationship index) and its g.label[data-id] in
//                 .edgeLabels
//   self loop     three edges entity-<A>-<i>-cyclic-special-{1,mid,2}
//                 and helper g.label.edgeLabel#entity-<A>-<i>---…---{1,2};
//                 several self loops on one entity share them (→ first)
// Cardinality markers are SVG markers on the line, not separate
// elements: clicking near one hits the relationship.
import type { ErModel } from './er-parser';

export type ErTarget =
  | { kind: 'entity'; id: string; part: 'title' | 'box' }
  // cell: which column of the row was hit ('row' for its background).
  | { kind: 'attribute'; entityId: string; index: number; cell: 'type' | 'name' | 'keys' | 'comment' | 'row' }
  | { kind: 'relationship'; index: number; part: 'line' | 'label' };

const CELLS = ['type', 'name', 'keys', 'comment'] as const;

function unprefix(svg: SVGSVGElement, id: string): string {
  const p = svg.id ? `${svg.id}-` : '';
  return p && id.startsWith(p) ? id.slice(p.length) : id;
}

function domIds(model: ErModel): Map<string, string> {
  return new Map([...model.entities.keys()].map((name, i) => [name, `entity-${name}-${i}`]));
}

function edgeIds(model: ErModel): string[] {
  const dom = domIds(model);
  return model.relationships.map((r, k) => {
    const a = dom.get(r.from)!;
    const b = dom.get(r.to)!;
    return a === b ? `${a}-cyclic-special` : `id_${a}_${b}_${k}`;
  });
}

function relationshipForDataId(model: ErModel, dataId: string): number {
  const ids = edgeIds(model);
  const exact = ids.indexOf(dataId);
  if (exact >= 0) return exact;
  const cyc = /^(.*)-cyclic-special(-(1|mid|2))?$/.exec(dataId);
  return cyc ? ids.indexOf(`${cyc[1]}-cyclic-special`) : -1;
}

function entityOfNode(svg: SVGSVGElement, model: ErModel, node: Element): string | null {
  const id = unprefix(svg, node.id);
  for (const [name, dom] of domIds(model)) if (dom === id) return name;
  return null;
}

const rowRects = (node: Element) => [...node.children].filter((c) => /\brow-rect-(odd|even)\b/.test(c.getAttribute('class') ?? ''));
const cellLabels = (node: Element) => [...node.children].filter((c) => /\battribute-(type|name|keys|comment)\b/.test(c.getAttribute('class') ?? ''));

export function erTargetAt(el: Element, svg: SVGSVGElement, model: ErModel): ErTarget | null {
  if (!svg.contains(el)) return null;
  const withId = el.closest('[data-id]');
  if (withId && svg.contains(withId)) {
    const index = relationshipForDataId(model, withId.getAttribute('data-id')!);
    if (index >= 0) return { kind: 'relationship', index, part: withId.closest('.edgeLabels') ? 'label' : 'line' };
  }
  const helper = el.closest('g.edgeLabel[id]');
  if (helper) {
    const m = /^(.*)---\1---\d+$/.exec(helper.id);
    if (m) {
      const index = relationshipForDataId(model, `${m[1]}-cyclic-special`);
      if (index >= 0) return { kind: 'relationship', index, part: 'line' };
    }
  }
  const node = el.closest('g.node');
  if (!node || !svg.contains(node)) return null;
  const name = entityOfNode(svg, model, node);
  if (name === null) return null;
  const entity = model.entities.get(name)!;
  const n = entity.attributes.length;
  // An attribute cell: four labels per row.
  const cell = cellLabels(node).find((c) => c.contains(el));
  if (cell) {
    const cells = cellLabels(node);
    const k = cells.indexOf(cell);
    if (cells.length === 4 * n) return { kind: 'attribute', entityId: name, index: Math.floor(k / 4), cell: CELLS[k % 4] };
    return { kind: 'entity', id: name, part: 'box' };
  }
  const row = rowRects(node).find((r) => r.contains(el));
  if (row) {
    const rows = rowRects(node);
    if (rows.length === n) return { kind: 'attribute', entityId: name, index: rows.indexOf(row), cell: 'row' };
    return { kind: 'entity', id: name, part: 'box' };
  }
  const title = el.closest('g.label');
  if (title && node.contains(title)) return { kind: 'entity', id: name, part: 'title' };
  return { kind: 'entity', id: name, part: 'box' };
}

function entityNode(svg: SVGSVGElement, model: ErModel, id: string): Element | null {
  const dom = domIds(model).get(id);
  if (!dom) return null;
  for (const n of svg.querySelectorAll('g.node')) if (unprefix(svg, n.id) === dom) return n;
  return null;
}

export function erElementFor(svg: SVGSVGElement, model: ErModel, target: ErTarget): Element | null {
  switch (target.kind) {
    case 'entity': {
      const node = entityNode(svg, model, target.id);
      if (!node || target.part === 'box') return node;
      return [...node.children].find((c) => c.matches('g.label') && !/attribute-/.test(c.getAttribute('class') ?? '')) ?? node;
    }
    case 'attribute': {
      const node = entityNode(svg, model, target.entityId);
      const n = model.entities.get(target.entityId)?.attributes.length ?? 0;
      if (!node || target.index < 0 || target.index >= n) return null;
      if (target.cell === 'row') {
        const rows = rowRects(node);
        return rows.length === n ? rows[target.index] : null;
      }
      const cells = cellLabels(node);
      return cells.length === 4 * n ? cells[target.index * 4 + CELLS.indexOf(target.cell)] : null;
    }
    case 'relationship': {
      const id = edgeIds(model)[target.index];
      if (id === undefined) return null;
      const dataId = id.endsWith('-cyclic-special') ? `${id}-mid` : id;
      const scope = target.part === 'label' ? '.edgeLabels g.label' : '.edgePaths path';
      for (const e of svg.querySelectorAll(scope)) if (e.getAttribute('data-id') === dataId) return e;
      return null;
    }
  }
}
