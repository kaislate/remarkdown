// E2E test bridge: exposes drawing helpers on window so Playwright can
// exercise them against real DOM Range layout (which jsdom doesn't
// implement). Imported only in e2e mode by main.ts.

import { findEnclosedText, findTextLineAbove } from './drawing-anchor-finders';
import { recognize } from './drawing-recognize';
import type { BBox } from './drawing-geometry';

export function installE2EBridge(): void {
  if (import.meta.env.MODE !== 'e2e') return;
  (window as unknown as { __E2E_DRAW__: unknown }).__E2E_DRAW__ = {
    findEnclosedText: (bbox: BBox, root: HTMLElement) => {
      const r = findEnclosedText(bbox, root);
      return r ? r.toString() : null;
    },
    findTextLineAbove: (bbox: BBox, root: HTMLElement) => {
      const r = findTextLineAbove(bbox, root);
      return r ? r.toString() : null;
    },
    recognize: (points: Array<[number, number]>, root: HTMLElement) => {
      return recognize(points, root);
    },
  };
}
