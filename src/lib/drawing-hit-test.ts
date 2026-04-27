import type { Drawing } from './schema';
import { resolveAnchor } from './anchoring';

const HIT_TOLERANCE_EM = 0.6;
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

function ellipseBoundaryHit(cx: number, cy: number, rx: number, ry: number, x: number, y: number, tol: number): boolean {
  if (rx === 0 || ry === 0) return false;
  // Tolerance band around the ellipse boundary (relative).
  const dxOut = (x - cx) / (rx + tol);
  const dyOut = (y - cy) / (ry + tol);
  const dxIn  = (x - cx) / Math.max(0.001, rx - tol);
  const dyIn  = (y - cy) / Math.max(0.001, ry - tol);
  return (dxOut * dxOut + dyOut * dyOut) <= 1 &&
         (dxIn  * dxIn  + dyIn  * dyIn ) >= 1;
}

function ellipseFullHit(cx: number, cy: number, rx: number, ry: number, x: number, y: number, tol: number): boolean {
  const dx = (x - cx) / (rx + tol);
  const dy = (y - cy) / (ry + tol);
  return dx * dx + dy * dy <= 1;
}

function rectBoundaryHit(left: number, top: number, w: number, h: number, x: number, y: number, tol: number): boolean {
  const inOuter = x >= left - tol && x <= left + w + tol && y >= top - tol && y <= top + h + tol;
  const inInner = x >= left + tol && x <= left + w - tol && y >= top + tol && y <= top + h - tol;
  return inOuter && !inInner;
}

function lineHit(x1: number, y1: number, x2: number, y2: number, x: number, y: number, tol: number): boolean {
  // Distance from point to line segment.
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(x - x1, y - y1) <= tol;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(x - px, y - py) <= tol;
}

export function hitTestDrawing(d: Drawing, x: number, y: number, root: HTMLElement, zoom: number): boolean {
  const tol = HIT_TOLERANCE_EM * remPx();
  switch (d.shape.kind) {
    case 'circle': {
      const range = resolveAnchor(d.shape.anchor, root);
      if (!range) return false;
      const r = range.getBoundingClientRect();
      const pad = 0.4 * remPx();
      return ellipseBoundaryHit(
        r.left + r.width / 2, r.top + r.height / 2,
        r.width / 2 + pad, r.height / 2 + pad, x, y, tol,
      );
    }
    case 'rectangle': {
      const range = resolveAnchor(d.shape.anchor, root);
      if (!range) return false;
      const r = range.getBoundingClientRect();
      const pad = 0.25 * remPx();
      return rectBoundaryHit(r.left - pad, r.top - pad, r.width + pad * 2, r.height + pad * 2, x, y, tol);
    }
    case 'underline': {
      const range = resolveAnchor(d.shape.anchor, root);
      if (!range) return false;
      const r = range.getBoundingClientRect();
      const ly = r.bottom + 0.15 * remPx();
      return lineHit(r.left, ly, r.right, ly, x, y, tol);
    }
    case 'strikethrough': {
      const range = resolveAnchor(d.shape.anchor, root);
      if (!range) return false;
      const r = range.getBoundingClientRect();
      const ly = r.top + r.height / 2;
      return lineHit(r.left, ly, r.right, ly, x, y, tol);
    }
    case 'circle-empty': {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchor.blockId}"]`);
      if (!block) return false;
      const r = block.getBoundingClientRect();
      const rem = remPx();
      const cx = r.left + d.shape.anchor.xEm * rem;
      const cy = r.top  + d.shape.anchor.yEm * rem;
      return ellipseFullHit(cx, cy, d.shape.radiusXEm * rem, d.shape.radiusYEm * rem, x, y, tol);
    }
    case 'margin-bar': {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchor.blockId}"]`);
      if (!block) return false;
      const r = block.getBoundingClientRect();
      const lx = r.left - 0.5 * remPx();
      return lineHit(lx, r.top, lx, r.bottom, x, y, tol);
    }
    case 'freehand': {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchor.blockId}"]`);
      if (!block) return false;
      const r = block.getBoundingClientRect();
      const rem = remPx();
      return d.shape.points.some(([xEm, yEm]) =>
        Math.hypot((r.left + xEm * rem) - x, (r.top + yEm * rem) - y) <= tol,
      );
    }
    case 'freehand-legacy': {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchorBlock}"]`);
      if (!block) return false;
      const r = block.getBoundingClientRect();
      const scale = zoom / d.shape.captureZoom;
      return d.shape.strokes.some(s => s.points.some(([px, py]) =>
        Math.hypot((r.left + px * scale) - x, (r.top + py * scale) - y) <= tol,
      ));
    }
  }
}
