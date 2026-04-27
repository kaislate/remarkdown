// Convert legacy `{ id, type, anchorBlock, strokes, ... }` Drawing JSON into
// the new `{ id, type, shape: { kind: 'freehand-legacy', ... }, ... }` shape.
// Idempotent — already-migrated drawings pass through.

type Maybe = Record<string, unknown>;

export function migrateDrawing(d: Maybe): Maybe {
  if (!d || typeof d !== 'object') return d;
  if (d.type !== 'drawing') return d;
  // Already in new shape.
  if ('shape' in d) return d;
  // Legacy shape.
  if ('strokes' in d && 'anchorBlock' in d) {
    const { anchorBlock, strokes, ...rest } = d as { anchorBlock: string; strokes: unknown[]; [k: string]: unknown };
    return {
      ...rest,
      shape: {
        kind: 'freehand-legacy',
        anchorBlock,
        captureZoom: 1.0,
        strokes,
      },
    };
  }
  return d;
}
