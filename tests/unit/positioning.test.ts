import { describe, it, expect } from 'vitest';
import { pinPosition } from '../../src/lib/positioning';

describe('pinPosition', () => {
  it('returns top/left relative to the viewer root', () => {
    const fakeRootRect = { top: 10, left: 20, width: 700, height: 1000, right: 720, bottom: 1010, x: 20, y: 10 } as DOMRect;
    const fakeRangeRect = { top: 50, left: 100, width: 40, height: 20, right: 140, bottom: 70, x: 100, y: 50 } as DOMRect;
    const result = pinPosition(fakeRootRect, fakeRangeRect);
    expect(result.top).toBe(50 - 10); // rangeTop - rootTop
    expect(result.left).toBe(140 - 20); // rangeRight - rootLeft
  });
});
