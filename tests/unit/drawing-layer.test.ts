import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import rough from 'roughjs';
import { createDrawingPainter, type ShownDrawing, type PaintOptions } from '../../src/lib/drawing-layer';
import { renderDrawing } from '../../src/lib/drawing-render';
import type { Drawing, Stroke } from '../../src/lib/schema';

// The pen layer repaints on every annotation change (a keystroke in a
// re.mark, a new highlight) and on every pen stroke let go of. These count
// the rough.js shapes it generates, and check that what it paints is what
// drawing every shape afresh paints.

const SVG_NS = 'http://www.w3.org/2000/svg';
const DRAWN = ['curve', 'ellipse', 'line', 'linearPath', 'rectangle'] as const;

let root: HTMLElement;
let svg: SVGSVGElement;
let layer: SVGGElement;
let events: string[];
let generated: number;
const proto = Object.getPrototypeOf(rough.svg(document.createElementNS(SVG_NS, 'svg'))) as Record<string, (...a: unknown[]) => unknown>;
const originals = Object.fromEntries(DRAWN.map((m) => [m, proto[m]]));

function box(el: Element, r: DOMRect): void {
  (el as HTMLElement).getBoundingClientRect = () => {
    events.push('read');
    return r;
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  events = [];
  generated = 0;
  for (const m of DRAWN) {
    proto[m] = function (this: unknown, ...args: unknown[]) {
      generated++;
      return originals[m].apply(this, args);
    };
  }
  root = document.createElement('article');
  root.innerHTML = Array.from({ length: 60 }, (_, i) => `<p data-block-id="p:${i + 1}">Paragraph ${i + 1} text.</p>`).join('');
  document.body.appendChild(root);
  root.querySelectorAll('p').forEach((p, i) => box(p, new DOMRect(120, 40 + i * 30.5, 600, 24)));
  svg = document.createElementNS(SVG_NS, 'svg');
  box(svg, new DOMRect(0, -12.25, 1200, 4000));
  layer = document.createElementNS(SVG_NS, 'g');
  svg.appendChild(layer);
  document.body.appendChild(svg);
  const append = layer.appendChild.bind(layer);
  const remove = layer.removeChild.bind(layer);
  layer.appendChild = <T extends Node>(n: T): T => { events.push('write'); return append(n); };
  layer.removeChild = <T extends Node>(n: T): T => { events.push('write'); return remove(n); };
});

afterEach(() => {
  for (const m of DRAWN) proto[m] = originals[m];
});

const at = 't';
function drawings(): ShownDrawing[] {
  const out: ShownDrawing[] = [];
  for (let i = 0; i < 50; i++) {
    const blockId = `p:${i + 1}`;
    const kind = i % 5;
    let d: Drawing;
    if (kind === 0) {
      d = { id: `D${i}`, type: 'drawing', shape: { kind: 'freehand', anchor: { blockId }, points: [[0, 0], [2.5, 0.4], [5, 1.1], [7.5, 0.2]], color: '#e05', width: 2 }, recognitionConfidence: 0.5, createdAt: at, updatedAt: at };
    } else if (kind === 1) {
      d = { id: `D${i}`, type: 'drawing', shape: { kind: 'circle-empty', anchor: { blockId, xEm: 3, yEm: 0.5 }, radiusXEm: 2, radiusYEm: 1, color: '#05e', width: 2 }, createdAt: at, updatedAt: at };
    } else if (kind === 2) {
      d = { id: `D${i}`, type: 'drawing', shape: { kind: 'margin-bar', anchor: { blockId }, color: '#0a0', width: 3 }, recognitionConfidence: 0.7, createdAt: at, updatedAt: at };
    } else if (kind === 3) {
      d = { id: `D${i}`, type: 'drawing', shape: { kind: 'freehand', anchor: { blockId }, points: [[0, 0], [9, 0]], color: '#333', width: 2, drawn: 'arrow' }, createdAt: at, updatedAt: at };
    } else {
      // Anchored to text: the store hands over the range it found.
      const p = root.querySelector(`[data-block-id="${blockId}"]`)!;
      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.firstChild!, 9);
      box(range as unknown as Element, new DOMRect(124, 42 + i * 30.5, 80.75, 20));
      d = { id: `D${i}`, type: 'drawing', shape: { kind: i % 10 === 4 ? 'circle' : 'underline', anchor: { text: 'Paragraph', prefix: '', suffix: '', blockHint: blockId }, color: '#a0a', width: 2 }, recognitionConfidence: 0.91, createdAt: at, updatedAt: at };
      out.push({ d, range });
      continue;
    }
    out.push({ d, range: null });
  }
  return out;
}

// What the layer held when every drawing was drawn afresh, one after the
// other (the old repaint).
function everyShapeAfresh(list: ShownDrawing[], pending: Stroke[], opts: PaintOptions): string {
  const g = document.createElementNS(SVG_NS, 'g');
  const rc = rough.svg(svg);
  for (const { d, range } of list) {
    for (const el of renderDrawing(rc, d, root, opts.zoom, svg, opts.roughness, range)) g.appendChild(el);
    if (opts.showConfidence && d.recognitionConfidence != null) {
      const rects = d.shape.kind === 'circle' || d.shape.kind === 'underline'
        ? range!.getBoundingClientRect()
        : root.querySelector<HTMLElement>(`[data-block-id="${(d.shape as { anchor: { blockId: string } }).anchor.blockId}"]`)!.getBoundingClientRect();
      const s = svg.getBoundingClientRect();
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(rects.right - s.left + 4));
      text.setAttribute('y', String(rects.top - s.top - 2));
      text.setAttribute('class', 'confidence-overlay');
      text.textContent = d.recognitionConfidence.toFixed(2);
      g.appendChild(text);
    }
  }
  for (const s of pending) {
    g.appendChild(rc.curve(s.points as Array<[number, number]>, { stroke: s.color, strokeWidth: s.width, roughness: opts.roughness, bowing: Math.min(1.4, opts.roughness), seed: 1 }));
  }
  return g.innerHTML;
}

const opts: PaintOptions = { zoom: 1, roughness: 1.4, showConfidence: true };

describe('the pen layer', () => {
  it('paints what drawing every shape afresh paints', () => {
    const paint = createDrawingPainter();
    const list = drawings();
    paint(layer, svg, root, list, [], opts);
    expect(layer.innerHTML).toBe(everyShapeAfresh(list, [], opts));
    const rougher = { ...opts, roughness: 2.6, zoom: 1.25 };
    paint(layer, svg, root, list, [], rougher);
    expect(layer.innerHTML).toBe(everyShapeAfresh(list, [], rougher));
  });

  it('keeps unchanged drawings when another annotation changes', () => {
    const paint = createDrawingPainter();
    const list = drawings();
    paint(layer, svg, root, list, [], opts);
    expect(generated).toBeGreaterThanOrEqual(50);
    const before = Array.from(layer.childNodes);

    // A keystroke in a re.mark: a new list, the same drawings.
    generated = 0;
    events = [];
    paint(layer, svg, root, [...list], [], opts);
    expect(generated).toBe(0);
    expect(events.filter((e) => e === 'write')).toEqual([]);
    expect(Array.from(layer.childNodes)).toEqual(before);

    // One drawing recoloured: only it is drawn again.
    const changed = list.map((x, i) => (i === 7 ? { ...x, d: { ...x.d, shape: { ...x.d.shape, color: '#123' } } as Drawing } : x));
    generated = 0;
    paint(layer, svg, root, changed, [], opts);
    expect(generated).toBe(1);
    expect(layer.innerHTML).toBe(everyShapeAfresh(changed, [], opts));
  });

  it("doesn't draw the other drawings again when a pen stroke is let go of", () => {
    const paint = createDrawingPainter();
    const list = drawings();
    const s1: Stroke = { color: '#e05', width: 2, points: [[10, 10], [40, 22], [70, 15]] };
    const s2: Stroke = { color: '#05e', width: 2, points: [[100, 100], [140, 90]] };
    paint(layer, svg, root, list, [s1], opts);
    generated = 0;
    paint(layer, svg, root, list, [s1, s2], opts);
    expect(generated).toBe(1);
    expect(layer.innerHTML).toBe(everyShapeAfresh(list, [s1, s2], opts));
  });

  it('measures every anchor before it changes the layer', () => {
    const paint = createDrawingPainter();
    paint(layer, svg, root, drawings(), [], opts);
    const firstWrite = events.indexOf('write');
    expect(firstWrite).toBeGreaterThan(0);
    expect(events.slice(firstWrite)).not.toContain('read');
  });

  it('draws a drawing again when its anchor moves', () => {
    const paint = createDrawingPainter();
    const list = drawings();
    paint(layer, svg, root, list, [], opts);
    box(root.querySelector('[data-block-id="p:1"]')!, new DOMRect(120, 400, 600, 24));
    generated = 0;
    paint(layer, svg, root, list, [], opts);
    expect(generated).toBe(1);
    expect(layer.innerHTML).toBe(everyShapeAfresh(list, [], opts));
  });
});
