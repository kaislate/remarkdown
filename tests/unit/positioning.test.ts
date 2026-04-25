import { describe, it, expect } from 'vitest';
import { pinPosition } from '../../src/lib/positioning';

describe('pinPosition', () => {
  it('returns top vertically aligned with the line, plus a small leading offset', () => {
    const fakeRootRect = { top: 10, left: 20, width: 700, height: 1000, right: 720, bottom: 1010, x: 20, y: 10 } as DOMRect;
    const fakeRangeRect = { top: 50, left: 100, width: 40, height: 20, right: 140, bottom: 70, x: 100, y: 50 } as DOMRect;
    const result = pinPosition(fakeRootRect, fakeRangeRect);
    // 50 - 10 = 40 (range top in root coords) + 4 (line-leading offset)
    expect(result.top).toBe(44);
  });

  it('left is anchored to the article right margin, not the range end', () => {
    const fakeRootRect = { top: 10, left: 20, width: 700, height: 1000, right: 720, bottom: 1010, x: 20, y: 10 } as DOMRect;
    const fakeRangeRect = { top: 50, left: 100, width: 40, height: 20, right: 140, bottom: 70, x: 100, y: 50 } as DOMRect;
    const result = pinPosition(fakeRootRect, fakeRangeRect);
    // 700 (root width) - 28 (right margin offset) = 672
    expect(result.left).toBe(672);
  });

  it('left is the same regardless of where the range ends in the line', () => {
    const fakeRootRect = { top: 10, left: 20, width: 700, height: 1000, right: 720, bottom: 1010, x: 20, y: 10 } as DOMRect;
    const earlyRange = { top: 50, left: 30, width: 20, height: 20, right: 50, bottom: 70, x: 30, y: 50 } as DOMRect;
    const lateRange = { top: 50, left: 600, width: 80, height: 20, right: 680, bottom: 70, x: 600, y: 50 } as DOMRect;
    expect(pinPosition(fakeRootRect, earlyRange).left).toBe(
      pinPosition(fakeRootRect, lateRange).left,
    );
  });
});
