// Arrows and brackets recognised from pen strokes (viewport pixels).
import { describe, it, expect } from 'vitest';
import { arrowFromStroke, arrowFromStrokes, bracketFromStroke } from '../../src/lib/drawing-recognize';
import { DrawingSchema } from '../../src/lib/schema';

type P = [number, number];
// Points along a polyline, every few pixels, with a little hand wobble.
function path(...corners: P[]): P[] {
  const out: P[] = [];
  for (let i = 1; i < corners.length; i++) {
    const [x0, y0] = corners[i - 1];
    const [x1, y1] = corners[i];
    const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 4));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      out.push([x0 + (x1 - x0) * t + Math.sin(k * 1.7) * 0.6, y0 + (y1 - y0) * t + Math.cos(k * 1.3) * 0.6]);
    }
  }
  return out;
}

describe('arrows', () => {
  it('one stroke: shaft, then a barb back without lifting', () => {
    const a = arrowFromStroke(path([100, 100], [300, 100], [285, 88]));
    expect(a).not.toBeNull();
    expect(a!.tail[0]).toBeCloseTo(100, -1);
    expect(a!.tip[0]).toBeCloseTo(300, -1);
  });

  it('one stroke with both barbs (a "V" at the tip), any direction', () => {
    expect(arrowFromStroke(path([200, 300], [200, 120], [188, 135], [200, 120], [212, 135]))).not.toBeNull();
  });

  it('not a plain line, a hook bending forward, a circle, or a scribble', () => {
    expect(arrowFromStroke(path([100, 100], [300, 100]))).toBeNull();
    // Turning a corner (90°) and going on is a corner, not a barb.
    expect(arrowFromStroke(path([100, 100], [300, 100], [300, 180]))).toBeNull();
    const circle: P[] = Array.from({ length: 40 }, (_, i) => [200 + 50 * Math.cos(i / 6), 200 + 50 * Math.sin(i / 6)]);
    expect(arrowFromStroke(circle)).toBeNull();
    expect(arrowFromStroke(path([0, 0], [10, 30], [20, 0], [30, 30], [40, 0]))).toBeNull();
    // Too short to be an arrow.
    expect(arrowFromStroke(path([100, 100], [125, 100], [118, 94]))).toBeNull();
  });

  it('several strokes: a shaft and a head near one end', () => {
    const shaft = path([100, 200], [320, 200]);
    const head = path([300, 186], [320, 200], [300, 214]);
    const other = path([500, 500], [560, 530]);
    const a = arrowFromStrokes([other, shaft, head]);
    expect(a?.used.sort()).toEqual([1, 2]);
    expect(a!.tip[0]).toBeCloseTo(320, -1);
    // Two separate barbs work too; the head at the start end makes the start the tip.
    const b = arrowFromStrokes([path([100, 200], [320, 200]), path([100, 200], [118, 188]), path([100, 200], [118, 212])]);
    expect(b!.tip[0]).toBeCloseTo(100, -1);
  });

  it('two unrelated lines are not an arrow', () => {
    expect(arrowFromStrokes([path([100, 200], [320, 200]), path([100, 400], [320, 400])])).toBeNull();
  });
});

describe('brackets', () => {
  const LINE = 24;
  it('a "[" beside a passage: hooks the same way, straightened', () => {
    const corners = bracketFromStroke(path([60, 100], [48, 101], [47, 220], [61, 222]), LINE);
    expect(corners).not.toBeNull();
    const [hookTop, spineTop, spineBottom, hookBottom] = corners!;
    expect(spineTop[0]).toBe(spineBottom[0]);
    expect(hookTop[0]).toBeGreaterThan(spineTop[0]);
    expect(hookTop[0]).toBe(hookBottom[0]);
    expect(spineBottom[1] - spineTop[1]).toBeGreaterThan(110);
  });

  it('a "]" drawn bottom to top', () => {
    expect(bracketFromStroke(path([700, 300], [712, 300], [713, 160], [700, 158]), LINE)).not.toBeNull();
  });

  it('not a straight bar, a short mark, or an "S"', () => {
    expect(bracketFromStroke(path([50, 100], [50, 220]), LINE)).toBeNull();
    expect(bracketFromStroke(path([60, 100], [48, 100], [48, 125], [60, 125]), LINE)).toBeNull();
    expect(bracketFromStroke(path([60, 100], [48, 100], [48, 220], [36, 220]), LINE)).toBeNull();
  });
});

describe('how they are kept', () => {
  it('as a freehand drawing with what it was drawn as — and one without still loads', () => {
    const base = { id: 'd', type: 'drawing', createdAt: 'x', updatedAt: 'x' };
    const shape = { kind: 'freehand', anchor: { blockId: 'p:1' }, points: [[0, 0], [5, 0]], color: '#000', width: 2 };
    expect(DrawingSchema.parse({ ...base, shape: { ...shape, drawn: 'arrow' } }).shape).toMatchObject({ drawn: 'arrow' });
    expect(DrawingSchema.safeParse({ ...base, shape }).success).toBe(true);
  });
});
