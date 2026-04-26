import { describe, it, expect, beforeEach } from 'vitest';
import rough from 'roughjs';
import { renderDrawing } from '../../src/lib/drawing-render';
import type { Drawing } from '../../src/lib/schema';

let svg: SVGSVGElement;
let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  root = document.createElement('div');
  root.innerHTML = '<p data-block-id="p:1">Sample text passage here.</p>';
  document.body.appendChild(root);
});

describe('renderDrawing', () => {
  it('returns empty array when an anchor cannot be resolved (orphan)', () => {
    const d: Drawing = {
      id: '1', type: 'drawing',
      shape: {
        kind: 'circle',
        anchor: { text: 'NotInDoc', prefix: '', suffix: '', blockHint: 'p:99' },
        color: '#ff0', width: 2,
      },
      createdAt: 't', updatedAt: 't',
    };
    const els = renderDrawing(rough.svg(svg), d, root, 1.0);
    expect(els.length).toBe(0);
  });

  it('returns empty array when anchored block is missing for circle-empty', () => {
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
    const els = renderDrawing(rough.svg(svg), d, root, 1.0);
    expect(els.length).toBe(0);
  });

  it('renders legacy strokes via rough.js curve when block resolves', () => {
    const d: Drawing = {
      id: '1', type: 'drawing',
      shape: {
        kind: 'freehand-legacy',
        anchorBlock: 'p:1',
        captureZoom: 1.0,
        strokes: [{ color: '#0ff', width: 2, points: [[10, 10], [20, 20]] }],
      },
      createdAt: 't', updatedAt: 't',
    };
    const els = renderDrawing(rough.svg(svg), d, root, 1.5);
    // jsdom returns rect-zero for the block; rough.js still produces an
    // SVG group element. We assert at least one element comes back.
    expect(els.length).toBeGreaterThanOrEqual(1);
  });
});
