import { describe, it, expect } from 'vitest';
import { pinPosition } from '../../src/lib/positioning';

describe('pinPosition', () => {
  it('places the pin at the end of the anchored text + a small offset', () => {
    const fakeRootRect = { top: 10, left: 20, width: 700, height: 1000, right: 720, bottom: 1010, x: 20, y: 10 } as DOMRect;
    const fakeRangeRect = { top: 50, left: 100, width: 40, height: 20, right: 140, bottom: 70, x: 100, y: 50 } as DOMRect;
    const result = pinPosition(fakeRootRect, fakeRangeRect);
    // top: 50 - 10 + 1 (offset) = 41
    expect(result.top).toBe(41);
    // left: 140 - 20 + 2 (offset) = 122
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

  it('top is independent of root left/width — only relative top matters', () => {
    const a = { top: 50, left: 100, width: 40, height: 20, right: 140, bottom: 70, x: 100, y: 50 } as DOMRect;
    const root1 = { top: 10, left: 0, width: 800, height: 1000, right: 800, bottom: 1010, x: 0, y: 10 } as DOMRect;
    const root2 = { top: 10, left: 200, width: 500, height: 1000, right: 700, bottom: 1010, x: 200, y: 10 } as DOMRect;
    expect(pinPosition(root1, a).top).toBe(pinPosition(root2, a).top);
  });
});
