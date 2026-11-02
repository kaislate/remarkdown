// Paints the pen layer's finished drawings (and the strokes waiting to be
// recognised) into an svg group. Any annotation change repaints it, and
// so does each stroke the pen lets go of; with hundreds of drawings that
// regenerated every rough.js shape, measuring each drawing's anchor right
// after the previous one was added, which made the browser lay out the
// page again for every drawing.
//
// So it measures every anchor first, before changing anything, and keeps
// each drawing's nodes for as long as the numbers they're drawn from are
// the same: a drawing whose annotation, anchor box, overlay box, root font
// size, zoom and roughness haven't changed is the same picture (rough.js
// is seeded per drawing), so it's reused rather than drawn again.

import rough from 'roughjs';
import type { RoughSVG } from 'roughjs/bin/svg';
import type { Drawing, Stroke } from './schema';
import { anchorRect, drawShape, remPx } from './drawing-render';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ShownDrawing {
  d: Drawing;
  // Where a drawing anchored to text is (found by the annotation store);
  // null for the others.
  range: Range | null;
}

export interface PaintOptions {
  zoom: number;
  roughness: number;
  showConfidence: boolean;
}

export type Painter = (
  layer: SVGGElement,
  svg: SVGSVGElement,
  root: HTMLElement,
  drawings: ShownDrawing[],
  pending: Stroke[],
  opts: PaintOptions,
) => void;

export function createDrawingPainter(): Painter {
  const shapes = new WeakMap<Drawing, { key: string; nodes: SVGElement[] }>();
  const labels = new WeakMap<Drawing, { key: string; el: SVGTextElement }>();
  const strokes = new WeakMap<Stroke, { roughness: number; node: SVGElement }>();

  return (layer, svg, root, drawings, pending, opts) => {
    // Read: every box, before anything on the page changes.
    const svg_r = svg.getBoundingClientRect();
    const rem = remPx();
    const boxes = drawings.map(({ d, range }): { r: DOMRect | null } | { error: unknown } => {
      try {
        return { r: anchorRect(d, root, range) };
      } catch (error) {
        return { error };
      }
    });

    // Build: reuse what's unchanged, draw the rest.
    let rc: RoughSVG | null = null;
    const gen = () => (rc ??= rough.svg(svg));
    const next: Node[] = [];
    let failed: { error: unknown } | null = null;
    for (let i = 0; i < drawings.length; i++) {
      const { d } = drawings[i];
      const box = boxes[i];
      const r = 'r' in box ? box.r : null;
      if (r) {
        const key = [r.x, r.y, r.width, r.height, svg_r.x, svg_r.y, rem, opts.zoom, opts.roughness].join(',');
        let kept = shapes.get(d);
        if (kept?.key !== key) {
          kept = undefined;
          try {
            kept = { key, nodes: drawShape(gen(), d, r, svg_r, rem, opts.zoom, opts.roughness) };
            shapes.set(d, kept);
          } catch { /* per-drawing error swallow */ }
        }
        if (kept) next.push(...kept.nodes);
      }
      if (opts.showConfidence && d.recognitionConfidence != null) {
        // Measuring its anchor threw: so did placing its label, which
        // stopped the whole repaint there.
        if ('error' in box) {
          failed = box;
          break;
        }
        if (r) {
          const x = String(r.right - svg_r.left + 4);
          const y = String(r.top - svg_r.top - 2);
          const text = d.recognitionConfidence.toFixed(2);
          const key = `${x},${y},${text}`;
          let label = labels.get(d);
          if (label?.key !== key) {
            const el = document.createElementNS(SVG_NS, 'text');
            el.setAttribute('x', x);
            el.setAttribute('y', y);
            el.setAttribute('class', 'confidence-overlay');
            el.textContent = text;
            label = { key, el };
            labels.set(d, label);
          }
          next.push(label.el);
        }
      }
    }
    // Pending strokes (released but not yet recognized + saved).
    if (!failed) {
      for (const s of pending) {
        const pts = s.points as Array<[number, number]>;
        if (pts.length < 2) continue;
        let kept = strokes.get(s);
        if (kept?.roughness !== opts.roughness) {
          kept = {
            roughness: opts.roughness,
            node: gen().curve(pts, {
              stroke: s.color, strokeWidth: s.width,
              roughness: opts.roughness,
              bowing: Math.min(1.4, opts.roughness),
              seed: 1,
            }),
          };
          strokes.set(s, kept);
        }
        next.push(kept.node);
      }
    }

    // Write: only when something differs.
    const now = layer.childNodes;
    if (now.length !== next.length || next.some((n, i) => now[i] !== n)) {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      const frag = document.createDocumentFragment();
      for (const n of next) frag.appendChild(n);
      layer.appendChild(frag);
    }
    if (failed) throw failed.error;
  };
}
