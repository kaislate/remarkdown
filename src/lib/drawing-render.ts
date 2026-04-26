import type { RoughSVG } from 'roughjs/bin/svg';
import type { Drawing } from './schema';
import { resolveAnchor } from './anchoring';

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const PADDING_EM = {
  circle: 0.4,
  rectangle: 0.25,
  underline: 0.15,
  strikethrough: 0.0,
} as const;

const DEFAULT_ROUGH = {
  roughness: 1.4,
  bowing: 1.2,
};

export function renderDrawing(
  rc: RoughSVG,
  d: Drawing,
  root: HTMLElement,
  zoom: number,
  svg: SVGSVGElement,
): SVGElement[] {
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
          ? rc.ellipse(cx, cy, w, h, { ...DEFAULT_ROUGH, stroke: d.shape.color, strokeWidth: d.shape.width })
          : rc.rectangle(cx - w / 2, cy - h / 2, w, h, { ...DEFAULT_ROUGH, stroke: d.shape.color, strokeWidth: d.shape.width });
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
        { ...DEFAULT_ROUGH, stroke: d.shape.color, strokeWidth: d.shape.width },
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
        { ...DEFAULT_ROUGH, stroke: d.shape.color, strokeWidth: d.shape.width },
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
      return [rc.ellipse(cx, cy, w, h, { ...DEFAULT_ROUGH, stroke: d.shape.color, strokeWidth: d.shape.width })];
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
        { ...DEFAULT_ROUGH, stroke: d.shape.color, strokeWidth: d.shape.width },
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
      return [rc.curve(pts, { ...DEFAULT_ROUGH, stroke: d.shape.color, strokeWidth: d.shape.width })];
    }

    case 'freehand-legacy': {
      const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchorBlock}"]`);
      if (!block) return [];
      const r = block.getBoundingClientRect();
      const svg_r = svg.getBoundingClientRect();
      const scale = zoom / d.shape.captureZoom;
      const out: SVGElement[] = [];
      for (const s of d.shape.strokes) {
        const pts = s.points.map(([px, py]) =>
          [r.left - svg_r.left + px * scale, r.top - svg_r.top + py * scale] as [number, number],
        );
        if (pts.length < 2) continue;
        out.push(rc.curve(pts, { ...DEFAULT_ROUGH, stroke: s.color, strokeWidth: s.width }));
      }
      return out;
    }
  }
}
