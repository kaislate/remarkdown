import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import * as anchoring from '../../src/lib/anchoring';
import { replaceAll, resolvedAnnots, orphanedAnnots, currentViewerRoot } from '../../src/stores/annots';
import type { Drawing, Highlight } from '../../src/lib/schema';

// Counts resolveAnchor calls, and checks the store wraps them in one pass.
vi.mock('../../src/lib/anchoring', async (original) => {
  const actual = await original<typeof import('../../src/lib/anchoring')>();
  let inPass = false;
  return {
    ...actual,
    resolvingPass: vi.fn(<T,>(fn: () => T): T => {
      inPass = true;
      try { return actual.resolvingPass(fn); } finally { inPass = false; }
    }),
    resolveAnchor: vi.fn((...args: Parameters<typeof actual.resolveAnchor>) => {
      if (!inPass) throw new Error('resolveAnchor called outside a resolving pass');
      return actual.resolveAnchor(...args);
    }),
  };
});

const highlight = (id: string, text: string): Highlight => ({
  id, type: 'highlight', color: '#ffd25a',
  anchor: { text, prefix: 'the ', suffix: ' text', blockHint: 'p:1' },
  createdAt: 'now', updatedAt: 'now',
});

// Every annotation is found again in the article on every change; with
// thousands of them that's the expensive part, so it happens once a change.
describe('resolving annotations', () => {
  it('finds each annotation once per change, in one pass, for both lists', () => {
    const root = document.createElement('article');
    root.innerHTML = '<p data-block-id="p:1">the sample text</p>';
    document.body.appendChild(root);
    currentViewerRoot.set(root);
    const stop = [resolvedAnnots.subscribe(() => {}), orphanedAnnots.subscribe(() => {})];

    vi.mocked(anchoring.resolveAnchor).mockClear();
    replaceAll([highlight('01A', 'sample'), highlight('01B', 'missing')]);
    expect(anchoring.resolveAnchor).toHaveBeenCalledTimes(2);

    stop.forEach((f) => f());
    currentViewerRoot.set(null);
  });

  // A sidecar may hold 20,000 of them; looking each block up in the page
  // searched the whole article once per drawing.
  it('finds the block of a drawing anchored to one from the pass, not by searching the page', () => {
    const root = document.createElement('article');
    root.innerHTML = '<p data-block-id="p:1">the sample text</p>';
    document.body.appendChild(root);
    currentViewerRoot.set(root);
    const bar = (id: string, blockId: string): Drawing => ({
      id, type: 'drawing',
      shape: { kind: 'margin-bar', anchor: { blockId }, color: '#ff0', width: 2 },
      createdAt: 'now', updatedAt: 'now',
    });
    const lookups = vi.spyOn(root, 'querySelector');
    const stop = [resolvedAnnots.subscribe(() => {}), orphanedAnnots.subscribe(() => {})];

    replaceAll([bar('01A', 'p:1'), bar('01B', 'p:1'), bar('01C', 'gone')]);
    expect(get(resolvedAnnots).map((r) => r.annotation.id)).toEqual(['01A', '01B']);
    expect(get(orphanedAnnots).map((a) => a.id)).toEqual(['01C']);
    expect(lookups).not.toHaveBeenCalled();

    stop.forEach((f) => f());
    lookups.mockRestore();
    currentViewerRoot.set(null);
    root.remove();
  });
});
