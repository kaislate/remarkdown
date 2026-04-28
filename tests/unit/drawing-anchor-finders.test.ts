import { describe, it, expect, beforeEach } from 'vitest';
import {
  findTextLineThrough,
  findBlockBeside,
  findBlockAtPoint,
} from '../../src/lib/drawing-anchor-finders';
import type { BBox } from '../../src/lib/drawing-geometry';

// findEnclosedText happy-path coverage lives in tests/e2e/drawing-recognition.spec.ts —
// jsdom doesn't implement Range layout for getBoundingClientRect at the character
// level, so meaningful tests need a real browser.

function makeRoot(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('findBlockBeside', () => {
  it('finds the block whose left edge is just to the right of the bbox', () => {
    const root = makeRoot(`<p data-block-id="p:1">Hi</p>`);
    const p = root.querySelector('p')!;
    // Mock getBoundingClientRect to return a proper rect
    // p is at x=100-150, y=10-30
    p.getBoundingClientRect = () => new DOMRect(100, 10, 50, 20);
    // bbox is to the left: x=88-96, y=12-28
    const bbox: BBox = {
      minX: 88, maxX: 96,
      minY: 12, maxY: 28,
      width: 8, height: 16,
    };
    expect(findBlockBeside(bbox, root)).toBe(p);
  });
});

describe('findBlockAtPoint', () => {
  it('returns the smallest block containing the point (innermost when nested)', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <section data-block-id="s:1">
        <p data-block-id="p:1">Inner</p>
      </section>
    `;
    document.body.appendChild(root);
    const section = root.querySelector('section')!;
    const p = root.querySelector('p')!;
    section.getBoundingClientRect = () => new DOMRect(0, 0, 200, 200);
    p.getBoundingClientRect = () => new DOMRect(50, 50, 100, 100);
    // Point is inside both — should return the smaller (innermost) block.
    expect(findBlockAtPoint(100, 100, root)).toBe(p);
    // Point is inside section but outside p — should return section.
    expect(findBlockAtPoint(10, 10, root)).toBe(section);
    // Point is outside both — should return null.
    expect(findBlockAtPoint(500, 500, root)).toBeNull();
  });
});
