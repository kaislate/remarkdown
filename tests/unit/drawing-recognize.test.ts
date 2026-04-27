import { describe, it, expect, beforeEach } from 'vitest';
import { recognize } from '../../src/lib/drawing-recognize';
import type { Point } from '../../src/lib/drawing-geometry';

beforeEach(() => { document.body.innerHTML = ''; });

describe('recognize', () => {
  // The "circle around text" and "underline below text" cases depend on
  // findEnclosedText / findTextLineAbove returning non-null Ranges, which
  // require Range.getBoundingClientRect / getClientRects to return
  // meaningful rects — jsdom doesn't implement that. These cases are
  // deferred to integration tests in Tasks 5/8/9 where the recognizer
  // runs against the real browser DOM.
  it.todo('classifies a closed loop around text as kind: "circle" (deferred — needs browser env)');
  it.todo('classifies a horizontal line as "underline" when sitting below text (deferred — needs browser env)');

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
