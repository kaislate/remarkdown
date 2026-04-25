import { describe, it, expect } from 'vitest';
import { pinPosition } from '../../src/lib/positioning';

describe('pinPosition', () => {
  it('places the pin at the BOTTOM of the anchored line (subscript-style)', () => {
    const fakeRootRect = { top: 10, left: 20, width: 700, height: 1000, right: 720, bottom: 1010, x: 20, y: 10 } as DOMRect;
    const fakeRangeRect = { top: 50, left: 100, width: 40, height: 20, right: 140, bottom: 70, x: 100, y: 50 } as DOMRect;
    const result = pinPosition(fakeRootRect, fakeRangeRect);
    // top: range.bottom (70) - root.top (10) = 60
    expect(result.top).toBe(60);
    // left: range.right (140) - root.left (20) + 2 (offset) = 122
    expect(result.left).toBe(122);
  });

  it('left tracks the range end so notes on different lines land at different x', () => {
    const fakeRootRect = { top: 10, left: 20, width: 700, height: 1000, right: 720, bottom: 1010, x: 20, y: 10 } as DOMRect;
    const earlyRange = { top: 50, left: 30, width: 20, height: 20, right: 50, bottom: 70, x: 30, y: 50 } as DOMRect;
    const lateRange = { top: 90, left: 600, width: 80, height: 20, right: 680, bottom: 110, x: 600, y: 90 } as DOMRect;
    expect(pinPosition(fakeRootRect, earlyRange).left).not.toBe(
      pinPosition(fakeRootRect, lateRange).left,
    );
  });

  it('top reflects the range bottom — taller lines push the pin further down', () => {
    const fakeRootRect = { top: 0, left: 0, width: 700, height: 1000, right: 700, bottom: 1000, x: 0, y: 0 } as DOMRect;
    const tightLine = { top: 50, left: 100, width: 40, height: 20, right: 140, bottom: 70, x: 100, y: 50 } as DOMRect;
    const tallLine = { top: 50, left: 100, width: 40, height: 40, right: 140, bottom: 90, x: 100, y: 50 } as DOMRect;
    expect(pinPosition(fakeRootRect, tightLine).top).toBe(70);
    expect(pinPosition(fakeRootRect, tallLine).top).toBe(90);
  });
});
