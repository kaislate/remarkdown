import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSidecar, serializeSidecar, emptySidecar, MAX_ANNOTATIONS, MAX_DRAWN_POINTS } from '../../src/lib/sidecar';
import type { Drawing } from '../../src/lib/schema';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures', name), 'utf-8');

describe('sidecar', () => {
  it('loads a valid sidecar JSON string', () => {
    const result = loadSidecar(fixture('sidecar-valid.json'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.annotations).toHaveLength(3);
    }
  });

  it('returns an error for malformed JSON', () => {
    const result = loadSidecar('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('parse');
    }
  });

  it('returns an error for schema-invalid sidecar', () => {
    const result = loadSidecar(fixture('sidecar-malformed.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('schema');
    }
  });

  it('round-trips valid sidecar without losing unknown fields', () => {
    const original = JSON.parse(fixture('sidecar-valid.json'));
    original.futureField = { flavor: 'strawberry' };
    const loaded = loadSidecar(JSON.stringify(original));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const reserialized = JSON.parse(serializeSidecar(loaded.value));
      expect(reserialized.futureField).toEqual({ flavor: 'strawberry' });
    }
  });

  it('still loads an older sidecar that recorded the full path', () => {
    const old = JSON.parse(fixture('sidecar-valid.json'));
    old.document.path = 'C:\\Users\\someone\\Documents\\notes.md';
    const result = loadSidecar(JSON.stringify(old));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.annotations).toHaveLength(3);
  });

  const withHighlights = (n: number) => {
    const s = emptySidecar({ path: 'a.md', sha256: 'abc', lastSeenBytes: 42 });
    for (let i = 0; i < n; i++) {
      (s.annotations as unknown[]).push({
        id: `h${i}`, type: 'highlight', color: '#ffd25a',
        anchor: { text: 'e', prefix: '', suffix: '', blockHint: 'p:1', endBlockHint: 'p:2' },
        createdAt: 'now', updatedAt: 'now',
      });
    }
    return JSON.stringify(s);
  };

  it('loads a sidecar with as many annotations as the limit allows', () => {
    const result = loadSidecar(withHighlights(MAX_ANNOTATIONS));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.annotations).toHaveLength(MAX_ANNOTATIONS);
  });

  it('refuses a sidecar with more annotations than the limit, without trimming it', () => {
    const result = loadSidecar(withHighlights(MAX_ANNOTATIONS + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('too-many');
  });

  it('keeps the limit far above anything a person makes', () => {
    expect(MAX_ANNOTATIONS).toBeGreaterThanOrEqual(20_000);
  });

  // One annotation can hold any number of points, and every one of them is
  // drawn: the count of annotations alone doesn't bound the work.
  const withDrawnPoints = (perDrawing: number[], legacy = false) => {
    const s = emptySidecar({ path: 'a.md', sha256: 'abc', lastSeenBytes: 42 });
    perDrawing.forEach((n, i) => {
      const points = Array.from({ length: n }, (_, j) => [j, j]);
      (s.annotations as unknown[]).push(
        legacy
          ? { id: `d${i}`, type: 'drawing', anchorBlock: 'p:1', strokes: [{ color: '#000', width: 2, points }], createdAt: 'now', updatedAt: 'now' }
          : { id: `d${i}`, type: 'drawing', shape: { kind: 'freehand', anchor: { blockId: 'p:1' }, points, color: '#000', width: 2 }, createdAt: 'now', updatedAt: 'now' },
      );
    });
    return JSON.stringify(s);
  };

  it('loads drawings with as many points as the limit allows', () => {
    const half = MAX_DRAWN_POINTS / 2;
    expect(loadSidecar(withDrawnPoints([half, half])).ok).toBe(true);
  });

  it('refuses a sidecar whose drawings hold more points than the limit, in total', () => {
    const half = MAX_DRAWN_POINTS / 2;
    const result = loadSidecar(withDrawnPoints([half, half + 1]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('too-many');
  });

  it('counts the points of old-style drawings too', () => {
    const result = loadSidecar(withDrawnPoints([MAX_DRAWN_POINTS + 1], true));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('too-many');
  });

  it('counts a point stuffed with extra numbers by its size', () => {
    const s = JSON.parse(withDrawnPoints([1], true));
    s.annotations[0].strokes[0].points = [[0, 0, ...new Array(MAX_DRAWN_POINTS * 2).fill(1)]];
    const result = loadSidecar(JSON.stringify(s));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('too-many');
  });

  // What a drawing costs to draw isn't only its points: each line, and each
  // drawing, costs something however few points it has, and an ellipse
  // more the bigger it is. These sidecars are a few MB each and took 2 to
  // 12 seconds to draw on every redraw when only points were counted.
  const drawings = (n: number, shape: (i: number) => object) => {
    const s = emptySidecar({ path: 'a.md', sha256: 'abc', lastSeenBytes: 42 });
    for (let i = 0; i < n; i++) {
      (s.annotations as unknown[]).push({ id: `d${i}`, type: 'drawing', shape: shape(i), createdAt: 'now', updatedAt: 'now' });
    }
    return s;
  };
  const scribble = (points: number) => () => ({
    kind: 'freehand', anchor: { blockId: 'p:1' }, color: '#000', width: 2,
    points: Array.from({ length: points }, (_, j) => [j * 0.5, (j % 7) * 0.3]),
  });
  const emptyCircle = (radiusEm: number) => () => ({
    kind: 'circle-empty', anchor: { blockId: 'p:1', xEm: 3, yEm: 1 },
    radiusXEm: radiusEm, radiusYEm: radiusEm, color: '#000', width: 2,
  });
  const circleRound = (text: string) => () => ({
    kind: 'circle', anchor: { text, prefix: '', suffix: '', blockHint: 'p:1' }, color: '#000', width: 2,
  });
  const twoPointStrokes = (n: number) => {
    const s = emptySidecar({ path: 'a.md', sha256: 'abc', lastSeenBytes: 42 });
    const strokes = Array.from({ length: n }, (_, j) => ({ color: '#000', width: 2, points: [[j % 300, 0], [j % 300, 9]] }));
    (s.annotations as unknown[]).push({ id: 'd0', type: 'drawing', anchorBlock: 'p:1', strokes, createdAt: 'now', updatedAt: 'now' });
    return s;
  };
  const refused = (s: object) => {
    const result = loadSidecar(JSON.stringify(s));
    return !result.ok && result.error.kind === 'too-many';
  };

  it('refuses sidecars that are small on disk but slow to draw', () => {
    expect(refused(drawings(20_000, scribble(25)))).toBe(true);
    expect(refused(twoPointStrokes(250_000))).toBe(true);
    expect(refused(drawings(20_000, emptyCircle(2)))).toBe(true);
  });

  it('counts each line, and each drawing, as a few points at least', () => {
    const lines = MAX_DRAWN_POINTS / 8;
    expect(loadSidecar(JSON.stringify(twoPointStrokes(lines))).ok).toBe(true);
    expect(refused(twoPointStrokes(lines + 1))).toBe(true);
    const empty = twoPointStrokes(lines + 1);
    (empty as { annotations: Array<{ strokes: Array<{ points: unknown[] }> }> }).annotations[0].strokes.forEach((s) => (s.points = []));
    expect(refused(empty)).toBe(true);
    const shapes = MAX_DRAWN_POINTS / 16;
    expect(loadSidecar(JSON.stringify(drawings(shapes, emptyCircle(0.5)))).ok).toBe(true);
    expect(refused(drawings(shapes + 1, emptyCircle(0.5)))).toBe(true);
    expect(refused(drawings(shapes + 1, scribble(2)))).toBe(true);
  });

  it('counts an ellipse by its size', () => {
    expect(refused(drawings(1, emptyCircle(1e9)))).toBe(true);
    expect(refused(drawings(251, circleRound('x'.repeat(10_000))))).toBe(true);
    expect(loadSidecar(JSON.stringify(drawings(251, circleRound('the')))).ok).toBe(true);
  });

  it('lets in only what draws in about a second', async () => {
    // The worst cases the limit lets in, drawn as the drawing layer draws
    // them, at the largest zoom (an em is 32 px) and in a narrow column.
    const { renderDrawing } = await import('../../src/lib/drawing-render');
    const rough = (await import('roughjs')).default;
    const root = document.createElement('div');
    root.innerHTML = '<p data-block-id="p:1">the sample text</p>';
    document.body.appendChild(root);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const style = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ fontSize: '32px' } as CSSStyleDeclaration);
    const textBox = (chars: number) =>
      ({ getBoundingClientRect: () => new DOMRect(0, 0, 15 * 19, Math.ceil(chars / 15) * 54) }) as unknown as Range;

    const cap = MAX_DRAWN_POINTS;
    const worst: Array<[string, object, number]> = [
      ['long lines', drawings(cap / 1000, scribble(1000)), 0],
      ['short lines', drawings(cap / 16, scribble(2)), 0],
      ['two-point strokes', twoPointStrokes(cap / 8), 0],
      ['brackets', drawings(cap / 2000, () => ({ ...scribble(1000)(), drawn: 'bracket' })), 0],
      ['small ellipses', drawings(cap / 16, emptyCircle(0.5)), 0],
      ['a few huge ellipses', drawings(10, emptyCircle(((cap / 10 - 1) / 9) ** 2)), 0],
      ['ellipses round long text', drawings(cap / 400, circleRound('x'.repeat(40_000))), 40_000],
    ];
    try {
      for (const [name, sidecar, textLength] of worst) {
        const loaded = loadSidecar(JSON.stringify(sidecar));
        expect(loaded.ok, name).toBe(true);
        if (!loaded.ok) continue;
        const rc = rough.svg(svg);
        const start = performance.now();
        for (const d of loaded.value.annotations) {
          renderDrawing(rc, d as Drawing, root, 2, svg, 1.4, textLength ? textBox(textLength) : null);
        }
        // Each takes a quarter to half a second here; when only points were
        // counted, the worst took over ten.
        expect(performance.now() - start, name).toBeLessThan(2_000);
      }
    } finally {
      style.mockRestore();
      root.remove();
    }
  });

  it('emptySidecar produces a valid, minimal sidecar', () => {
    const s = emptySidecar({ path: 'a.md', sha256: 'abc', lastSeenBytes: 42 });
    const json = serializeSidecar(s);
    const reloaded = loadSidecar(json);
    expect(reloaded.ok).toBe(true);
  });
});
