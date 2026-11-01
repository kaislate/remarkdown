import { SidecarSchema, type Sidecar, type DocumentMeta } from './schema';
import { migrateDrawing } from './drawing-migration';

// Every annotation is found again in the article on each change, so a
// crafted sidecar with a huge number of them could freeze the app. Nobody
// marks up one document 20,000 times. A sidecar over the limit is refused
// whole rather than trimmed: the caller offers to back it up, and nothing
// in the file is lost.
export const MAX_ANNOTATIONS = 20_000;

// Drawing is the slow part of showing a sidecar: every drawing is drawn
// again whenever an annotation changes, the window is resized or the zoom
// changes. So what its drawings cost to draw is capped too, counted in
// points along a line (each about 10 µs to draw). A line counts as a short
// line at least, and a drawing as two, as it's found on the page and laid
// out as well as drawn: so empty lines and shapes with no points (an
// ellipse, a box) don't get in free. An ellipse counts by its size.
// The limit is about half a second of drawing on a fast machine. It is 7 to
// 14 minutes of pen on the page in one document; save.ts warns the file is
// getting large well before, at about 24,000 points. Refused whole, as above.
export const MAX_DRAWN_POINTS = 50_000;
const SHORT_LINE = 8;

// rough.js draws an ellipse of radius r px through about 1.6√r points. At
// the largest zoom an em is 32 px: 9√r for r in em. An ellipse round text
// is as tall as the text: at that zoom, in a column 15 letters wide, about
// 3.6 px a letter, so 2√n points for n letters.
const ellipsePoints = (radiusEm: number) => 9 * Math.sqrt(radiusEm);
const ellipseRoundText = (letters: number) => 2 * Math.sqrt(letters);
const size = (n: unknown) => (typeof n === 'number' ? Math.abs(n) : 0);

// What the parsed (not yet validated) drawings cost to draw, in points:
// new-style shapes and old-style strokes[]. A point is counted by its size,
// two numbers to a point, so stuffing one with extra numbers doesn't get
// past. A bracket's points count twice: it's drawn as straight lines, each
// with its own wobble, which takes twice as long as a curve through them.
function drawnPoints(annotations: unknown[]): number {
  const line = (points: unknown): number => {
    let numbers = 0;
    if (Array.isArray(points)) {
      for (const p of points) numbers += Array.isArray(p) ? Math.max(p.length, 2) : 2;
    }
    return Math.max(Math.ceil(numbers / 2), SHORT_LINE);
  };
  const strokes = (list: unknown): number => {
    let sum = 0;
    if (Array.isArray(list)) for (const s of list) sum += line((s as { points?: unknown } | null)?.points);
    return sum;
  };
  let total = 0;
  for (const a of annotations) {
    if (!a || typeof a !== 'object' || (a as { type?: unknown }).type !== 'drawing') continue;
    const d = a as { strokes?: unknown; shape?: Record<string, unknown> | null };
    const shape = d.shape && typeof d.shape === 'object' ? d.shape : {};
    let cost = strokes(d.strokes) + strokes(shape.strokes);
    if ('points' in shape) cost += line(shape.points) * (shape.drawn === 'bracket' ? 2 : 1);
    if (shape.kind === 'circle-empty') cost += ellipsePoints(Math.max(size(shape.radiusXEm), size(shape.radiusYEm)));
    const text = (shape.anchor as { text?: unknown } | null)?.text;
    if (shape.kind === 'circle' && typeof text === 'string') cost += ellipseRoundText(text.length);
    total += Math.max(Math.ceil(cost), 2 * SHORT_LINE);
  }
  return total;
}

export type LoadError =
  | { kind: 'parse'; message: string }
  | { kind: 'schema'; message: string }
  | { kind: 'too-many'; message: string };

export type LoadResult =
  | { ok: true; value: Sidecar }
  | { ok: false; error: LoadError };

export function loadSidecar(json: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: { kind: 'parse', message: (e as Error).message } };
  }
  // Counted before migrating and validating, which cost time per annotation.
  const list = (parsed as { annotations?: unknown } | null)?.annotations;
  if (Array.isArray(list) && list.length > MAX_ANNOTATIONS) {
    return {
      ok: false,
      error: { kind: 'too-many', message: `${list.length} annotations (the limit is ${MAX_ANNOTATIONS})` },
    };
  }
  const points = Array.isArray(list) ? drawnPoints(list) : 0;
  if (points > MAX_DRAWN_POINTS) {
    return {
      ok: false,
      error: { kind: 'too-many', message: `${points} drawn points (the limit is ${MAX_DRAWN_POINTS})` },
    };
  }
  // Migrate legacy drawings before schema validation.
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { annotations?: unknown[] }).annotations)) {
    const obj = parsed as { annotations: unknown[] };
    obj.annotations = obj.annotations.map((a) => {
      if (a && typeof a === 'object' && (a as { type?: string }).type === 'drawing') {
        return migrateDrawing(a as Record<string, unknown>);
      }
      return a;
    });
  }
  const validated = SidecarSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: { kind: 'schema', message: validated.error.message },
    };
  }
  return { ok: true, value: validated.data };
}

export function serializeSidecar(sidecar: Sidecar): string {
  return JSON.stringify(sidecar, null, 2) + '\n';
}

export function emptySidecar(doc: DocumentMeta): Sidecar {
  return {
    _comment: `remarkdown annotations for: ${doc.path}`,
    $schema: 'remarkdown/v1',
    document: doc,
    annotations: [],
  };
}
