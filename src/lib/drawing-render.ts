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

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const PADDING_EM = {
  circle: 0.4,
  rectangle: 0.25,
  underline: 0.15,
  strikethrough: 0.0,
} as const;

export function renderDrawing(
  rc: RoughSVG,
  d: Drawing,
  root: HTMLElement,
  zoom: number,
  svg: SVGSVGElement,
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
      const range = resolveAnchor(d.shape.anchor, root);
      if (!range) return [];
      const r = range.getBoundingClientRect();
      const svg_r = svg.getBoundingClientRect();
      const pad = PADDING_EM[d.shape.kind] * remPx();
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
      const range = resolveAnchor(d.shape.anchor, root);
      if (!range) return [];
      const r = range.getBoundingClientRect();
      const svg_r = svg.getBoundingClientRect();
      const y = r.bottom - svg_r.top + PADDING_EM.underline * remPx();
      const node = rc.line(
        r.left  - svg_r.left, y,
        r.right - svg_r.left, y,
        { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) },
      );
      return [node];
    }

    case 'strikethrough': {
      const range = resolveAnchor(d.shape.anchor, root);
      if (!range) return [];
      const r = range.getBoundingClientRect();
      const svg_r = svg.getBoundingClientRect();
      const y = r.top - svg_r.top + r.height / 2;
      const node = rc.line(
        r.left  - svg_r.left, y,
        r.right - svg_r.left, y,
        { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) },
      );
      return [node];
    }

    case 'circle-empty': {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchor.blockId}"]`);
      if (!block) return [];
      const r = block.getBoundingClientRect();
      const svg_r = svg.getBoundingClientRect();
      const rem = remPx();
      const cx = r.left - svg_r.left + d.shape.anchor.xEm * rem;
      const cy = r.top  - svg_r.top  + d.shape.anchor.yEm * rem;
      const w = d.shape.radiusXEm * rem * 2;
      const h = d.shape.radiusYEm * rem * 2;
      return [rc.ellipse(cx, cy, w, h, { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) })];
    }

    case 'margin-bar': {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchor.blockId}"]`);
      if (!block) return [];
      const r = block.getBoundingClientRect();
      const svg_r = svg.getBoundingClientRect();
      const x = r.left - svg_r.left - 0.5 * remPx();
      return [rc.line(
        x, r.top - svg_r.top,
        x, r.bottom - svg_r.top,
        { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) },
      )];
    }

    case 'freehand': {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchor.blockId}"]`);
      if (!block) return [];
      const r = block.getBoundingClientRect();
      const svg_r = svg.getBoundingClientRect();
      const rem = remPx();
      const pts = d.shape.points.map(([xEm, yEm]) =>
        [r.left - svg_r.left + xEm * rem, r.top - svg_r.top + yEm * rem] as [number, number],
      );
      if (pts.length < 2) return [];
      return [rc.curve(pts, { ...roughOpts, stroke: d.shape.color, strokeWidth: d.shape.width, seed: hashId(d.id) })];
    }

    case 'freehand-legacy': {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchorBlock}"]`);
      if (!block) return [];
      const r = block.getBoundingClientRect();
      const svg_r = svg.getBoundingClientRect();
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
