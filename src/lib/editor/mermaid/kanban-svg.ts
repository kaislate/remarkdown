// Mapping between kanban columns / cards and the SVG mermaid draws for
// them — what a click on the rendered board means, and which element
// to highlight.
//
// mermaid 11.14 draws
//   <g class="sections">  one <g class="cluster … section-<n>"> per
//                         column, in column order
//   <g class="items">     one <g class="node …"> per card, column by
//                         column, in card order
// Their ids are `<svgId>-<mermaid id>`, and mermaid ids are the node
// text when no id is written — so they may repeat, hold spaces or
// entity placeholders. We map by drawing ORDER instead, checked
// against the label text:
//   - same number of columns / cards as the model: the n-th one, unless
//     its text disagrees and exactly one other model item has it (a
//     stale SVG after a move)
//   - otherwise: the one model item with that text, else nothing
// A card has three labels: its text (the markdown label), the ticket
// (wrapped in `a.kanban-ticket-link` when a ticketBaseUrl is set) and
// the assigned person; a click reports which one it hit.
import type { KanbanModel } from './kanban-parser';

export type KanbanCardField = 'text' | 'ticket' | 'assigned';

export type KanbanTarget =
  | { kind: 'column'; column: number }
  // `field` — which part of the card was clicked ('text' for the card
  // background). Not needed by kanbanElementFor.
  | { kind: 'card'; column: number; card: number; field?: KanbanCardField };

function loose(s: string): string {
  return s.replace(/[\s*_`\\]/g, '');
}

function clustersOf(svg: SVGSVGElement): Element[] {
  return Array.from(svg.querySelectorAll('g.sections > g.cluster'));
}

function itemsOf(svg: SVGSVGElement): Element[] {
  return Array.from(svg.querySelectorAll('g.items > g.node'));
}

function flatCards(model: KanbanModel): Array<{ column: number; card: number; text: string }> {
  return model.columns.flatMap((c) => c.cards.map((k, card) => ({ column: c.index, card, text: k.text })));
}

// A card's labels in drawing order, and which is which.
function cardLabels(card: Element): { title: Element | null; ticket: Element | null; assigned: Element | null } {
  const labels = Array.from(card.querySelectorAll('g.label'));
  const link = card.querySelector('a.kanban-ticket-link g.label');
  const title =
    labels.find((l) => l.querySelector('.markdown-node-label')) ?? (link ? labels[1] : labels[0]) ?? null;
  const rest = labels.filter((l) => l !== title);
  const ticket = link ?? rest[0] ?? null;
  const assigned = rest.filter((l) => l !== ticket).pop() ?? null;
  return { title, ticket, assigned };
}

function cardText(card: Element): string {
  return cardLabels(card).title?.textContent ?? '';
}

function columnText(cluster: Element): string {
  return cluster.querySelector('.cluster-label')?.textContent ?? cluster.textContent ?? '';
}

// Index into `texts` for the drawn item at `drawn` with label `text`.
function resolve(drawn: number, sameCount: boolean, text: string, texts: string[]): number | null {
  const want = loose(text);
  const hits = texts.flatMap((t, i) => (loose(t) === want ? [i] : []));
  const unique = hits.length === 1 ? hits[0] : null;
  if (sameCount && drawn >= 0 && (loose(texts[drawn]) === want || unique === null)) return drawn;
  return unique;
}

// The column / card a click on `el` is about, or null.
export function kanbanTargetAt(el: Element, svg: SVGSVGElement, model: KanbanModel): KanbanTarget | null {
  const card = el.closest('g.node');
  if (card && svg.contains(card) && card.parentElement?.matches('g.items')) {
    const items = itemsOf(svg);
    const flat = flatCards(model);
    const i = resolve(items.indexOf(card), items.length === flat.length, cardText(card), flat.map((f) => f.text));
    if (i === null) return null;
    const { ticket, assigned } = cardLabels(card);
    const label = el.closest('g.label');
    const field: KanbanCardField = label && label === ticket ? 'ticket' : label && label === assigned ? 'assigned' : 'text';
    return { kind: 'card', column: flat[i].column, card: flat[i].card, field };
  }
  const cluster = el.closest('g.cluster');
  if (cluster && svg.contains(cluster) && cluster.parentElement?.matches('g.sections')) {
    const clusters = clustersOf(svg);
    const i = resolve(
      clusters.indexOf(cluster),
      clusters.length === model.columns.length,
      columnText(cluster),
      model.columns.map((c) => c.text),
    );
    return i === null ? null : { kind: 'column', column: i };
  }
  return null;
}

// The `g` element drawn for `target`, or null.
export function kanbanElementFor(svg: SVGSVGElement, model: KanbanModel, target: KanbanTarget): SVGGElement | null {
  const pick = (drawn: Element[], texts: string[], index: number, textOf: (e: Element) => string): Element | null => {
    if (index < 0 || index >= texts.length) return null;
    const want = loose(texts[index]);
    if (drawn.length === texts.length) {
      const el = drawn[index];
      // Trust the order unless the text says it's someone else's.
      if (loose(textOf(el)) === want || texts.filter((t) => loose(t) === want).length !== 1) return el;
    }
    if (texts.filter((t) => loose(t) === want).length !== 1) return null;
    const hits = drawn.filter((e) => loose(textOf(e)) === want);
    return hits.length === 1 ? hits[0] : null;
  };
  if (target.kind === 'column') {
    return pick(clustersOf(svg), model.columns.map((c) => c.text), target.column, columnText) as SVGGElement | null;
  }
  const flat = flatCards(model);
  const index = flat.findIndex((f) => f.column === target.column && f.card === target.card);
  return pick(itemsOf(svg), flat.map((f) => f.text), index, cardText) as SVGGElement | null;
}
