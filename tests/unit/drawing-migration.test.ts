import { describe, it, expect } from 'vitest';
import { migrateDrawing } from '../../src/lib/drawing-migration';

describe('migrateDrawing', () => {
  it('passes through new-format drawings unchanged', () => {
    const fresh = {
      id: '01HABC',
      type: 'drawing',
      shape: {
        kind: 'circle',
        anchor: { text: 'foo', prefix: '', suffix: '', blockHint: 'p:1' },
        color: '#ff0',
        width: 2,
      },
      createdAt: '2026-04-25T00:00:00Z',
      updatedAt: '2026-04-25T00:00:00Z',
    };
    expect(migrateDrawing(fresh)).toEqual(fresh);
  });

  it('wraps legacy {strokes} drawings in freehand-legacy variant', () => {
    const legacy = {
      id: '01HABC',
      type: 'drawing',
      anchorBlock: 'p:3',
      strokes: [
        { color: '#00f', width: 2, points: [[10, 10], [20, 20]] },
      ],
      createdAt: '2026-04-25T00:00:00Z',
      updatedAt: '2026-04-25T00:00:00Z',
    };
    const migrated = migrateDrawing(legacy);
    expect(migrated.shape).toEqual({
      kind: 'freehand-legacy',
      anchorBlock: 'p:3',
      captureZoom: 1.0,
      strokes: legacy.strokes,
    });
    expect(migrated.id).toBe(legacy.id);
    expect(migrated.createdAt).toBe(legacy.createdAt);
  });

  it('returns input untouched if neither shape format matches', () => {
    const weird = { id: 'x', type: 'drawing', foo: 'bar' };
    expect(migrateDrawing(weird as never)).toBe(weird);
  });
});
