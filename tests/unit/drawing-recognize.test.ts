import { describe, it, expect, beforeEach } from 'vitest';
import { recognize } from '../../src/lib/drawing-recognize';
import type { Point } from '../../src/lib/drawing-geometry';

beforeEach(() => { document.body.innerHTML = ''; });

describe('recognize', () => {
  // "circle" and "underline" cases are exercised in tests/e2e/drawing-recognition.spec.ts —
  // they depend on Range.getBoundingClientRect / getClientRects returning
  // meaningful rects, which jsdom doesn't implement.

  it('classifies a tiny scribble as kind: "freehand"', () => {
    const root = document.createElement('div');
    root.innerHTML = `<p data-block-id="p:1">Sample text</p>`;
    document.body.appendChild(root);
    const stroke: Point[] = [[10, 10], [12, 13], [10, 11]];
    const result = recognize(stroke, root);
    expect(result.kind).toBe('freehand');
  });

  it('returns recognitionConfidence in [0, 1]', () => {
    const root = document.createElement('div');
    root.innerHTML = `<p data-block-id="p:1">Text</p>`;
    document.body.appendChild(root);
    const stroke: Point[] = [[1, 1], [2, 2]];
    const result = recognize(stroke, root);
    expect(result.recognitionConfidence).toBeGreaterThanOrEqual(0);
    expect(result.recognitionConfidence).toBeLessThanOrEqual(1);
  });
});
