import { SidecarSchema, type Sidecar, type DocumentMeta } from './schema';
import { migrateDrawing } from './drawing-migration';

// Every annotation is found again in the article on each change, so a
// crafted sidecar with a huge number of them could freeze the app. Nobody
// marks up one document 20,000 times. A sidecar over the limit is refused
// whole rather than trimmed: the caller offers to back it up, and nothing
// in the file is lost.
export const MAX_ANNOTATIONS = 20_000;

// One drawing can hold any number of points and every point is drawn, so the
// points are capped too, across all drawings. Half a million is about 70
// minutes of drawing without lifting the pen; a sidecar that size is ten
// times past the size save.ts already warns about. Refused whole, as above.
export const MAX_DRAWN_POINTS = 500_000;

// Points in the parsed (not yet validated) drawings: new-style shape.points
// and old-style strokes[].points. A point is counted by its size, two
// numbers to a point, so stuffing one with extra numbers doesn't get past.
function drawnPoints(annotations: unknown[]): number {
  let numbers = 0;
  const addLine = (points: unknown) => {
    if (!Array.isArray(points)) return;
    for (const p of points) numbers += Array.isArray(p) ? Math.max(p.length, 2) : 2;
  };
  const addStrokes = (strokes: unknown) => {
    if (!Array.isArray(strokes)) return;
    for (const s of strokes) addLine((s as { points?: unknown } | null)?.points);
  };
  for (const a of annotations) {
    if (!a || typeof a !== 'object' || (a as { type?: unknown }).type !== 'drawing') continue;
    const d = a as { strokes?: unknown; shape?: { points?: unknown; strokes?: unknown } | null };
    addStrokes(d.strokes);
    addLine(d.shape?.points);
    addStrokes(d.shape?.strokes);
  }
  return Math.ceil(numbers / 2);
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
