import {
  bbox,
  closure,
  cornerAngles,
  pathLength,
  straightness,
  type Point,
} from './drawing-geometry';
import {
  findEnclosedText,
  findTextLineAbove,
  findTextLineThrough,
  findBlockBeside,
  findBlockAtPoint,
} from './drawing-anchor-finders';
import { createAnchor } from './anchoring';

export type TextAnchor = {
  text: string;
  prefix: string;
  suffix: string;
  blockHint: string;
};

export type BlockAnchor = { blockId: string };

export type BlockEmAnchor = { blockId: string; xEm: number; yEm: number };

export type RecognizedShape =
  | { kind: 'circle'; anchor: TextAnchor; recognitionConfidence: number }
  | {
      kind: 'circle-empty';
      anchor: BlockEmAnchor;
      radiusXEm: number;
      radiusYEm: number;
      recognitionConfidence: number;
    }
  | { kind: 'rectangle'; anchor: TextAnchor; recognitionConfidence: number }
  | { kind: 'underline'; anchor: TextAnchor; recognitionConfidence: number }
  | { kind: 'strikethrough'; anchor: TextAnchor; recognitionConfidence: number }
  | { kind: 'margin-bar'; anchor: BlockAnchor; recognitionConfidence: number }
  | {
      kind: 'freehand';
      anchor: BlockAnchor;
      points: Array<[number, number]>;
      recognitionConfidence: number;
      drawn?: 'arrow' | 'bracket';
    };

const CLOSED_LOOP_THRESHOLD = 0.15;
const STRAIGHTNESS_THRESHOLD = 0.85;
const RECT_CORNER_TOLERANCE = 25;
const MIN_SHAPE_DIMENSION_PX = 20;
const HORIZ_ASPECT_THRESHOLD = 4;       // aspect > 4 = "horizontal" stroke
const VERT_ASPECT_THRESHOLD = 0.25;     // aspect < 0.25 = "vertical" stroke
const LINE_HEIGHT_EM_CAP = 1.25;        // strokes thicker than this aren't lines

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

// Build a TextAnchor (text + prefix + suffix + blockHint) from a Range.
// Delegates to anchoring.createAnchor which uses precise offset extraction
// rather than the fragile indexOf approach. Falls back to a minimal anchor
// if createAnchor returns null (e.g., the range isn't inside a block).
function textAnchorFromRange(range: Range, root: HTMLElement): TextAnchor {
  const anchor = createAnchor(range, root);
  if (anchor) return anchor;
  // Minimal fallback — text only, no context.
  const text = range.toString();
  const blockEl = (range.startContainer.parentElement?.closest('[data-block-id]') ??
                    range.endContainer.parentElement?.closest('[data-block-id]')) as HTMLElement | null;
  return { text, prefix: '', suffix: '', blockHint: blockEl?.dataset.blockId ?? '' };
}

export function recognize(points: Point[], root: HTMLElement): RecognizedShape {
  if (points.length < 3) {
    return recognizeAsFreehand(points, root, 1.0);
  }

  const b = bbox(points);
  const aspect = b.height === 0 ? Infinity : b.width / b.height;
  const isClosed = closure(points) < CLOSED_LOOP_THRESHOLD;
  const isStraight = straightness(points) > STRAIGHTNESS_THRESHOLD;
  const minDim = Math.min(b.width, b.height);
  const remH = remPx();

  // Closed loops → circle / rectangle / circle-empty
  if (isClosed && minDim >= MIN_SHAPE_DIMENSION_PX) {
    const enclosed = findEnclosedText(b, root);
    const angles = cornerAngles(points);
    const rectLikeCount = angles.filter((a) => Math.abs(a - 90) < RECT_CORNER_TOLERANCE).length;
    const looksLikeRect = rectLikeCount >= 3;

    if (enclosed) {
      if (looksLikeRect) {
        return {
          kind: 'rectangle',
          anchor: textAnchorFromRange(enclosed, root),
          recognitionConfidence: 0.7 + (rectLikeCount / angles.length) * 0.3,
        };
      }
      return {
        kind: 'circle',
        anchor: textAnchorFromRange(enclosed, root),
        recognitionConfidence: 0.7 + (1 - closure(points)) * 0.3,
      };
    }

    // No text inside → circle-empty bound to nearest block
    const cx = b.minX + b.width / 2;
    const cy = b.minY + b.height / 2;
    const block = findBlockAtPoint(cx, cy, root);
    if (block) {
      const r = block.getBoundingClientRect();
      return {
        kind: 'circle-empty',
        anchor: { blockId: block.dataset.blockId ?? '', xEm: (cx - r.left) / remH, yEm: (cy - r.top) / remH },
        radiusXEm: (b.width / 2) / remH,
        radiusYEm: (b.height / 2) / remH,
        recognitionConfidence: 0.5,
      };
    }
  }

  // A bracket beside a passage: before the straight lines, as a tall
  // bracket with short hooks is almost straight.
  const bracket = bracketFromStroke(points, remH);
  if (bracket) return recognizeAsFreehand(bracket, root, 0.75, 'bracket');

  // An arrow drawn in one go (shaft, then the head without lifting) —
  // also before the straight lines: with a short head it's nearly one.
  const arrow = arrowFromStroke(points);
  if (arrow) return recognizeAsFreehand([arrow.tail, arrow.tip], root, 0.7, 'arrow');

  // Roughly straight lines
  if (isStraight && pathLength(points) >= MIN_SHAPE_DIMENSION_PX) {
    // Horizontal: aspect ratio > HORIZ_ASPECT_THRESHOLD and height < LINE_HEIGHT_EM_CAP
    if (aspect > HORIZ_ASPECT_THRESHOLD && b.height < remH * LINE_HEIGHT_EM_CAP) {
      // Through text? → strikethrough
      const through = findTextLineThrough(b, root);
      if (through) {
        return {
          kind: 'strikethrough',
          anchor: textAnchorFromRange(through, root),
          recognitionConfidence: 0.7,
        };
      }
      // Below text? → underline
      const above = findTextLineAbove(b, root);
      if (above) {
        return {
          kind: 'underline',
          anchor: textAnchorFromRange(above, root),
          recognitionConfidence: 0.7,
        };
      }
    }

    // Vertical: aspect ratio < VERT_ASPECT_THRESHOLD and width < LINE_HEIGHT_EM_CAP
    if (aspect < VERT_ASPECT_THRESHOLD && b.width < remH * LINE_HEIGHT_EM_CAP) {
      const beside = findBlockBeside(b, root);
      if (beside) {
        return {
          kind: 'margin-bar',
          anchor: { blockId: beside.dataset.blockId ?? '' },
          recognitionConfidence: 0.7,
        };
      }
    }
  }

  return recognizeAsFreehand(points, root, 0.5);
}

// ── arrows and brackets ───────────────────────────────────────────────
// Recognised from the stroke's shape alone (viewport pixels) and stored
// tidied: an arrow as its tail and tip, a bracket as its four corners.

const MIN_ARROW_PX = 40;

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// The angle (degrees) at `at` between the directions to a and b.
function angleAt(at: Point, a: Point, b: Point): number {
  const ax = a[0] - at[0], ay = a[1] - at[1], bx = b[0] - at[0], by = b[1] - at[1];
  const mag = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (!mag) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / mag))) * 180) / Math.PI;
}

// One stroke: a straight shaft to the tip, then back out along a barb (or
// two) that points back towards the tail.
export function arrowFromStroke(points: Point[]): { tail: Point; tip: Point } | null {
  if (points.length < 4) return null;
  const tail = points[0];
  let tipIdx = 0;
  for (let i = 1; i < points.length; i++) if (dist(points[i], tail) > dist(points[tipIdx], tail)) tipIdx = i;
  const tip = points[tipIdx];
  const shaft = points.slice(0, tipIdx + 1);
  const head = points.slice(tipIdx);
  const len = dist(tail, tip);
  if (len < MIN_ARROW_PX || shaft.length < 2 || head.length < 2) return null;
  if (straightness(shaft) < 0.9) return null;
  const headLen = pathLength(head);
  if (headLen < len * 0.08 || headLen > len * 0.9) return null;
  // The head stays near the tip…
  if (head.some((p) => dist(p, tip) > len * 0.45)) return null;
  // …and its barbs point back towards the tail, at an angle.
  const barbs = head.filter((p) => dist(p, tip) > len * 0.06);
  if (!barbs.length) return null;
  const sharp = barbs.every((p) => {
    const a = angleAt(tip, tail, p);
    return a > 8 && a < 80;
  });
  return sharp ? { tail, tip } : null;
}

// Several strokes: a straight shaft and one or two short strokes (the
// head) all near one of its ends. Returns the arrow and which strokes it
// used, or null.
export function arrowFromStrokes(strokes: Point[][]): { tail: Point; tip: Point; used: number[] } | null {
  for (let s = 0; s < strokes.length; s++) {
    const shaft = strokes[s];
    if (shaft.length < 2 || straightness(shaft) < 0.9) continue;
    const a = shaft[0];
    const b = shaft[shaft.length - 1];
    const len = dist(a, b);
    if (len < MIN_ARROW_PX) continue;
    for (const [tail, tip] of [[a, b], [b, a]] as Array<[Point, Point]>) {
      const heads = strokes
        .map((pts, i) => ({ pts, i }))
        .filter(({ pts, i }) => i !== s && pts.length >= 2 && pathLength(pts) <= len * 0.9 && pts.every((p) => dist(p, tip) <= len * 0.45));
      if (heads.length < 1 || heads.length > 2) continue;
      // Each head stroke reaches back towards the tail at an angle.
      const ok = heads.every(({ pts }) => {
        const far = pts.reduce((m, p) => (dist(p, tip) > dist(m, tip) ? p : m), pts[0]);
        const ang = angleAt(tip, tail, far);
        return dist(far, tip) > len * 0.06 && ang > 8 && ang < 80;
      });
      if (ok) return { tail, tip, used: [s, ...heads.map((h) => h.i)] };
    }
  }
  return null;
}

// A tall "[" or "]" beside text: both ends hook the same way off a
// straight spine. Returns its corners (hook, spine top, spine bottom,
// hook), straightened, or null.
export function bracketFromStroke(points: Point[], lineHeightPx: number): Point[] | null {
  if (points.length < 4) return null;
  const b = bbox(points);
  if (b.height < lineHeightPx * 1.6 || b.width > b.height * 0.45 || b.width < 4) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const topFirst = first[1] < last[1];
  const top = topFirst ? first : last;
  const bottom = topFirst ? last : first;
  if (top[1] - b.minY > b.height * 0.25 || b.maxY - bottom[1] > b.height * 0.25) return null;
  // The spine: where the middle half of the stroke runs.
  const middle = points
    .filter(([, y]) => y > b.minY + b.height * 0.25 && y < b.maxY - b.height * 0.25)
    .map(([x]) => x)
    .sort((p, q) => p - q);
  if (middle.length < 2) return null;
  const spine = middle[Math.floor(middle.length / 2)];
  // The spine is straight…
  if (middle[middle.length - 1] - middle[0] > Math.max(b.width * 0.6, lineHeightPx * 0.5)) return null;
  // …and both hooks go off it the same way, far enough to be hooks.
  const hookTop = top[0] - spine;
  const hookBottom = bottom[0] - spine;
  const reach = Math.max(4, b.width * 0.3);
  if (Math.sign(hookTop) !== Math.sign(hookBottom) || Math.abs(hookTop) < reach || Math.abs(hookBottom) < reach) return null;
  const hook = spine + Math.sign(hookTop) * Math.max(Math.abs(hookTop), Math.abs(hookBottom));
  return [[hook, b.minY], [spine, b.minY], [spine, b.maxY], [hook, b.maxY]];
}

export function recognizeAsFreehand(
  points: Point[],
  root: HTMLElement,
  confidence: number,
  drawn?: 'arrow' | 'bracket',
): Extract<RecognizedShape, { kind: 'freehand' }> {
  const b = bbox(points);
  const cx = b.minX + b.width / 2;
  const cy = b.minY + b.height / 2;
  const block = findBlockAtPoint(cx, cy, root) ??
    root.querySelector<HTMLElement>('[data-block-id]');
  const blockId = block?.dataset.blockId ?? 'p:1';
  const r = block?.getBoundingClientRect();
  const rem = remPx();
  const emPoints: Array<[number, number]> = r
    ? points.map(([x, y]) => [(x - r.left) / rem, (y - r.top) / rem])
    : points.map(([x, y]) => [x / rem, y / rem]);
  return {
    kind: 'freehand',
    anchor: { blockId },
    points: emPoints,
    recognitionConfidence: confidence,
    ...(drawn ? { drawn } : {}),
  };
}
