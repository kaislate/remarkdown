export type Point = [number, number];

export interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export function pathLength(points: ReadonlyArray<Point>): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    total += Math.hypot(x1 - x0, y1 - y0);
  }
  return total;
}

export function chordLength(points: ReadonlyArray<Point>): number {
  if (points.length < 2) return 0;
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  return Math.hypot(x1 - x0, y1 - y0);
}

// Path-straightness: chord / pathLength.
//   1.0  → straight line
//   0.0  → perfectly closed (start == end)
//   (0,1) → curved arc, larger = closer to straight
export function straightness(points: ReadonlyArray<Point>): number {
  const path = pathLength(points);
  if (path === 0) return 0;
  return chordLength(points) / path;
}

// Closure: chord / perimeter, low for closed shapes. Currently identical to
// straightness conceptually, but split for readability at call sites.
export function closure(points: ReadonlyArray<Point>): number {
  const path = pathLength(points);
  if (path === 0) return 1;
  return chordLength(points) / path;
}

export function bbox(points: ReadonlyArray<Point>): BBox {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

// Interior corner angles in degrees, one per non-endpoint vertex.
// 180 = perfectly straight; values near 90 indicate sharp right-angle corners.
export function cornerAngles(points: ReadonlyArray<Point>): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const ax = x0 - x1, ay = y0 - y1;
    const bx = x2 - x1, by = y2 - y1;
    const dot = ax * bx + ay * by;
    const mag = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (mag === 0) continue;
    const cos = Math.max(-1, Math.min(1, dot / mag));
    out.push((Math.acos(cos) * 180) / Math.PI);
  }
  return out;
}
