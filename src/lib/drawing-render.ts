import type { RoughSVG } from 'roughjs/bin/svg';
import type { Drawing } from './schema';
import { resolveAnchor } from './anchoring';

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h) + id.charCodeAt(i);
    h |= 0;
  }
  // rough.js seed must be a non-zero positive integer.
  return Math.abs(h) || 1;
}

export const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const PADDING_EM = {
  circle: 0.4,
  rectangle: 0.25,
  underline: 0.15,
  strikethrough: 0.0,
} as const;

// An arrow: the shaft, and two barbs at the tip, sized to the arrow.
function arrowNodes(rc: RoughSVG, tail: [number, number], tip: [number, number], opts: Record<string, unknown>): SVGElement[] {
  const len = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]);
  if (!len) return [];
  const head = Math.min(18, Math.max(8, len * 0.22));
  const back = Math.atan2(tail[1] - tip[1], tail[0] - tip[0]);
  const barb = (turn: number) => rc.line(tip[0], tip[1], tip[0] + head * Math.cos(back + turn), tip[1] + head * Math.sin(back + turn), opts);
  return [rc.line(tail[0], tail[1], tip[0], tip[1], opts), barb(0.5), barb(-0.5)];
}

// Where a drawing's anchor is on screen: its text's box for a shape anchored
// to text, its block's box for the others; null when it isn't in the
// article. Reading layout only, so a caller drawing many can measure them
// all before it changes anything.
export function anchorRect(
  d: Drawing,
  root: HTMLElement,
  // Where a shape anchored to text is, when the caller has found it already
  // (the annotation store does, for every drawing it shows).
  found?: Range | null,
): DOMRect | null {
  switch (d.shape.kind) {
    case 'circle':
    case 'rectangle':
    case 'underline':
    case 'strikethrough': {
      const range = found ?? resolveAnchor(d.shape.anchor, root);
      return range ? range.getBoundingClientRect() : null;
    }
    case 'circle-empty':
    case 'margin-bar':
    case 'freehand': {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchor.blockId}"]`);
      return block ? block.getBoundingClientRect() : null;
    }
    case 'freehand-legacy': {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchorBlock}"]`);
      return block ? block.getBoundingClientRect() : null;
    }
  }
}

// A drawing's rough.js nodes, from its anchor's box (anchorRect), the
// overlay svg's box and the root font size. Nothing here reads layout: the
// same numbers always give the same nodes.
export function drawShape(
  rc: RoughSVG,
  d: Drawing,
  r: DOMRect,
  svg_r: DOMRect,
  rem: number,
  zoom: number,
  roughness: number,
): SVGElement[] {
  const roughOpts = {
    roughness,
    // bowing scales with roughness up to a cap, so very-rough also gets
    // very-curvy. At roughness=0 bowing=0 (perfectly straight lines).
    bowing: Math.min(1.4, roughness),
  };
  switch (d.shape.kind) {
    case 'circle':
    case 'rectangle': {
      const pad = PADDING_EM[d.shape.kind] * rem;
      const cx = r.left - svg_r.left + r.width / 2;
      const cy = r.top  - svg_r.top  + r.height / 2;
      const w = r.width + pad * 2;
      const h = r.height + pad * 2;
      const node =
        d.shape.kind === 'circle'
          ? rc.ellipse(cx, cy, w, h, { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) })
          : rc.rectangle(cx - w / 2, cy - h / 2, w, h, { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) });
      return [node];
    }

    case 'underline': {
      const y = r.bottom - svg_r.top + PADDING_EM.underline * rem;
      const node = rc.line(
        r.left  - svg_r.left, y,
        r.right - svg_r.left, y,
        { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) },
      );
      return [node];
    }

    case 'strikethrough': {
      const y = r.top - svg_r.top + r.height / 2;
      const node = rc.line(
        r.left  - svg_r.left, y,
        r.right - svg_r.left, y,
        { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) },
      );
      return [node];
    }

    case 'circle-empty': {
      const cx = r.left - svg_r.left + d.shape.anchor.xEm * rem;
      const cy = r.top  - svg_r.top  + d.shape.anchor.yEm * rem;
      const w = d.shape.radiusXEm * rem * 2;
      const h = d.shape.radiusYEm * rem * 2;
      return [rc.ellipse(cx, cy, w, h, { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) })];
    }

    case 'margin-bar': {
      const x = r.left - svg_r.left - 0.5 * rem;
      return [rc.line(
        x, r.top - svg_r.top,
        x, r.bottom - svg_r.top,
        { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) },
      )];
    }

    case 'freehand': {
      const pts = d.shape.points.map(([xEm, yEm]) =>
        [r.left - svg_r.left + xEm * rem, r.top - svg_r.top + yEm * rem] as [number, number],
      );
      if (pts.length < 2) return [];
      const opts = { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) };
      if (d.shape.drawn === 'arrow') return arrowNodes(rc, pts[0], pts[pts.length - 1], opts);
      if (d.shape.drawn === 'bracket') return [rc.linearPath(pts, opts)];
      return [rc.curve(pts, opts)];
    }

    case 'freehand-legacy': {
      const scale = zoom / d.shape.captureZoom;
      const out: SVGElement[] = [];
      for (let i = 0; i < d.shape.strokes.length; i++) {
        const s = d.shape.strokes[i];
        const pts = s.points.map(([px, py]) =>
          [r.left - svg_r.left + px * scale, r.top - svg_r.top + py * scale] as [number, number],
        );
        if (pts.length < 2) continue;
        out.push(rc.curve(pts, { ...roughOpts, stroke: s.color, strokeWidth: s.width, seed: hashId(d.id) + i }));
      }
      return out;
    }
  }
}

export function renderDrawing(
  rc: RoughSVG,
  d: Drawing,
  root: HTMLElement,
  zoom: number,
  svg: SVGSVGElement,
  roughness: number,
  found?: Range | null,
): SVGElement[] {
  const r = anchorRect(d, root, found);
  if (!r) return [];
  return drawShape(rc, d, r, svg.getBoundingClientRect(), remPx(), zoom, roughness);
}
