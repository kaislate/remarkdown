import { describe, it, expect, vi } from 'vitest';
import * as anchoring from '../../src/lib/anchoring';
import { replaceAll, resolvedAnnots, orphanedAnnots, currentViewerRoot } from '../../src/stores/annots';
import type { Highlight } from '../../src/lib/schema';

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
});
