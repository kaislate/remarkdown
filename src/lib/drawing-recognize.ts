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

export function recognizeAsFreehand(points: Point[], root: HTMLElement, confidence: number): RecognizedShape {
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
  };
}
