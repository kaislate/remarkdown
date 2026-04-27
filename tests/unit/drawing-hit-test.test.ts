import { describe, it, expect, beforeEach } from 'vitest';
import { hitTestDrawing } from '../../src/lib/drawing-hit-test';
import type { Drawing } from '../../src/lib/schema';

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  root.innerHTML = '<p data-block-id="p:1">Hello world example.</p>';
  document.body.appendChild(root);
  // Make jsdom give us a real rect for the block.
  const p = root.querySelector('p')!;
  p.getBoundingClientRect = () => new DOMRect(50, 100, 200, 30);
});

describe('hitTestDrawing', () => {
  it('returns false for circle when text-anchor cannot be resolved', () => {
    const d: Drawing = {
      id: '1', type: 'drawing',
      shape: {
        kind: 'circle',
        anchor: { text: 'NotPresent', prefix: '', suffix: '', blockHint: 'p:99' },
        color: '#ff0', width: 2,
      },
      createdAt: 't', updatedAt: 't',
    };
    expect(hitTestDrawing(d, 0, 0, root, 1.0)).toBe(false);
  });

  it('returns false for circle-empty when block does not exist', () => {
    const d: Drawing = {
      id: '1', type: 'drawing',
      shape: {
        kind: 'circle-empty',
        anchor: { blockId: 'nonexistent', xEm: 1, yEm: 1 },
        radiusXEm: 0.5, radiusYEm: 0.5,
        color: '#ff0', width: 2,
      },
      createdAt: 't', updatedAt: 't',
    };
    expect(hitTestDrawing(d, 0, 0, root, 1.0)).toBe(false);
  });

  it('hits a circle-empty when the click is inside the ellipse body', () => {
    // Block top-left at (50, 100). circle-empty centered 1em inside.
    // 1em ≈ 16px (default font-size), so center at (66, 116), radius ≈ 8px each.
    const d: Drawing = {
      id: '1', type: 'drawing',
      shape: {
        kind: 'circle-empty',
        anchor: { blockId: 'p:1', xEm: 1, yEm: 1 },
        radiusXEm: 0.5, radiusYEm: 0.5,
        color: '#ff0', width: 2,
      },
      createdAt: 't', updatedAt: 't',
    };
    // Click near the center
    expect(hitTestDrawing(d, 66, 116, root, 1.0)).toBe(true);
    // Click far outside the ellipse
    expect(hitTestDrawing(d, 200, 200, root, 1.0)).toBe(false);
  });

  it('hits a margin-bar when click is on the vertical line beside the block', () => {
    // Block at (50, 100, 200, 30). margin-bar at x = 50 - 0.5em ≈ 42.
    const d: Drawing = {
      id: '1', type: 'drawing',
      shape: {
        kind: 'margin-bar',
        anchor: { blockId: 'p:1' },
        color: '#ff0', width: 2,
      },
      createdAt: 't', updatedAt: 't',
    };
    // Click directly on the bar at the block's mid-height
    expect(hitTestDrawing(d, 42, 115, root, 1.0)).toBe(true);
    // Click well to the right of the bar
    expect(hitTestDrawing(d, 150, 115, root, 1.0)).toBe(false);
  });

  it('hits freehand when the click is near a stored point', () => {
    // Block at (50, 100). Single point at (1em, 1em) = roughly (66, 116).
    const d: Drawing = {
      id: '1', type: 'drawing',
      shape: {
        kind: 'freehand',
        anchor: { blockId: 'p:1' },
        points: [[1, 1], [2, 2]],
        color: '#0ff', width: 2,
      },
      createdAt: 't', updatedAt: 't',
    };
    // Click within tolerance of the first em-point
    expect(hitTestDrawing(d, 66, 116, root, 1.0)).toBe(true);
    // Click far from any point
    expect(hitTestDrawing(d, 500, 500, root, 1.0)).toBe(false);
  });
});
