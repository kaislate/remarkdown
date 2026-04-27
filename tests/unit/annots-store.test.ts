import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  annots,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  replaceAll,
  resolvedAnnots,
  orphanedAnnots,
  currentViewerRoot,
} from '../../src/stores/annots';
import type { Annotation, Highlight, Drawing } from '../../src/lib/schema';

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? '01HP8XYZABCDEFGHJKMNPQRSTV',
    type: 'highlight',
    color: overrides.color ?? '#ffd25a',
    anchor: overrides.anchor ?? {
      text: 'sample',
      prefix: 'the ',
      suffix: ' text',
      blockHint: 'p:1',
    },
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

describe('annots store CRUD', () => {
  beforeEach(() => { replaceAll([]); currentViewerRoot.set(null); });

  it('starts empty', () => {
    expect(get(annots)).toEqual([]);
  });

  it('addAnnotation appends to list', () => {
    const h = makeHighlight({ id: '01A' });
    addAnnotation(h);
    expect(get(annots)).toHaveLength(1);
    expect(get(annots)[0].id).toBe('01A');
  });

  it('updateAnnotation patches by id and bumps updatedAt', async () => {
    const h = makeHighlight({ id: '01A', updatedAt: '2020-01-01T00:00:00Z' });
    addAnnotation(h);
    updateAnnotation('01A', (a) => ({ ...a, color: '#82d99c' }));
    const after = get(annots)[0] as Highlight;
    expect(after.color).toBe('#82d99c');
    expect(after.updatedAt).not.toBe('2020-01-01T00:00:00Z');
  });

  it('removeAnnotation removes by id', () => {
    addAnnotation(makeHighlight({ id: '01A' }));
    addAnnotation(makeHighlight({ id: '01B' }));
    removeAnnotation('01A');
    const list = get(annots);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('01B');
  });

  it('replaceAll swaps the whole list', () => {
    addAnnotation(makeHighlight({ id: '01A' }));
    const fresh: Annotation[] = [
      makeHighlight({ id: '01X' }),
      makeHighlight({ id: '01Y' }),
    ];
    replaceAll(fresh);
    expect(get(annots).map((a) => a.id)).toEqual(['01X', '01Y']);
  });
});

function makeDrawingFreehand(overrides: { id?: string; blockId?: string } = {}): Drawing {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? '01DRAWING000001',
    type: 'drawing',
    shape: {
      kind: 'freehand',
      anchor: { blockId: overrides.blockId ?? 'p:1' },
      points: [[0, 0], [1, 1]],
      color: '#000',
      width: 2,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function makeDrawingCircle(overrides: { id?: string; text?: string; blockHint?: string } = {}): Drawing {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? '01DRAWING000002',
    type: 'drawing',
    shape: {
      kind: 'circle',
      anchor: {
        text: overrides.text ?? 'sample',
        prefix: 'the ',
        suffix: ' text',
        blockHint: overrides.blockHint ?? 'p:1',
      },
      color: '#f00',
      width: 2,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function makeDrawingFreehandLegacy(overrides: { id?: string; anchorBlock?: string } = {}): Drawing {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? '01DRAWING000003',
    type: 'drawing',
    shape: {
      kind: 'freehand-legacy',
      anchorBlock: overrides.anchorBlock ?? 'p:1',
      captureZoom: 1.0,
      strokes: [],
    },
    createdAt: now,
    updatedAt: now,
  };
}

describe('annots derived partitions', () => {
  beforeEach(() => { replaceAll([]); currentViewerRoot.set(null); });

  it('with no viewer root, everything is orphaned', () => {
    replaceAll([makeHighlight({ id: '01A' })]);
    expect(get(resolvedAnnots)).toEqual([]);
    expect(get(orphanedAnnots)).toHaveLength(1);
  });

  it('with a matching viewer root, resolvable annotations appear in resolved', () => {
    const root = document.createElement('article');
    root.innerHTML = '<p data-block-id="p:1">the sample text</p>';
    document.body.appendChild(root);
    currentViewerRoot.set(root);

    replaceAll([
      makeHighlight({
        id: '01A',
        anchor: { text: 'sample', prefix: 'the ', suffix: ' text', blockHint: 'p:1' },
      }),
    ]);

    expect(get(resolvedAnnots)).toHaveLength(1);
    expect(get(orphanedAnnots)).toHaveLength(0);
    expect(get(resolvedAnnots)[0].range.toString()).toBe('sample');
  });

  it('puts unresolvable annotations into orphaned', () => {
    const root = document.createElement('article');
    root.innerHTML = '<p data-block-id="p:1">nothing interesting here</p>';
    document.body.appendChild(root);
    currentViewerRoot.set(root);

    replaceAll([
      makeHighlight({
        id: '01A',
        anchor: { text: 'missing', prefix: 'xxx', suffix: 'yyy', blockHint: 'p:1' },
      }),
    ]);

    expect(get(resolvedAnnots)).toHaveLength(0);
    expect(get(orphanedAnnots)).toHaveLength(1);
  });
});

describe('drawing orphan detection', () => {
  beforeEach(() => { replaceAll([]); currentViewerRoot.set(null); });

  it('freehand drawing whose anchor.blockId exists → resolvedAnnots', () => {
    const root = document.createElement('article');
    root.innerHTML = '<p data-block-id="p:1">content</p>';
    document.body.appendChild(root);
    currentViewerRoot.set(root);

    replaceAll([makeDrawingFreehand({ id: '01D1', blockId: 'p:1' })]);

    expect(get(resolvedAnnots)).toHaveLength(1);
    expect(get(orphanedAnnots)).toHaveLength(0);
  });

  it('freehand drawing whose anchor.blockId is missing → orphanedAnnots', () => {
    const root = document.createElement('article');
    root.innerHTML = '<p data-block-id="p:1">content</p>';
    document.body.appendChild(root);
    currentViewerRoot.set(root);

    replaceAll([makeDrawingFreehand({ id: '01D2', blockId: 'p:GONE' })]);

    expect(get(resolvedAnnots)).toHaveLength(0);
    expect(get(orphanedAnnots)).toHaveLength(1);
    expect(get(orphanedAnnots)[0].id).toBe('01D2');
  });

  it('circle drawing whose anchor.text is not in the document → orphanedAnnots', () => {
    const root = document.createElement('article');
    root.innerHTML = '<p data-block-id="p:1">nothing matches here</p>';
    document.body.appendChild(root);
    currentViewerRoot.set(root);

    replaceAll([makeDrawingCircle({ id: '01D3', text: 'vanished text', blockHint: 'p:1' })]);

    expect(get(resolvedAnnots)).toHaveLength(0);
    expect(get(orphanedAnnots)).toHaveLength(1);
    expect(get(orphanedAnnots)[0].id).toBe('01D3');
  });

  it('freehand-legacy drawing whose anchorBlock is missing → orphanedAnnots', () => {
    const root = document.createElement('article');
    root.innerHTML = '<p data-block-id="p:1">content</p>';
    document.body.appendChild(root);
    currentViewerRoot.set(root);

    replaceAll([makeDrawingFreehandLegacy({ id: '01D4', anchorBlock: 'p:DELETED' })]);

    expect(get(resolvedAnnots)).toHaveLength(0);
    expect(get(orphanedAnnots)).toHaveLength(1);
    expect(get(orphanedAnnots)[0].id).toBe('01D4');
  });
});
