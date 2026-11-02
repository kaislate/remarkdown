import { describe, it, expect } from 'vitest';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { resolveAnchor, resolvingPass } from '../../src/lib/anchoring';
import type { Anchor } from '../../src/lib/schema';

// A tab's annotations stay in memory while another tab is shown, but its
// article is unmounted. Where each anchor was found is kept to spare the
// next pass a search; that must not keep the old article (its text, its
// diagrams, the ranges into it) alive along with the annotations.

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the anchor cache and a hidden tab', () => {
  it('lets an unmounted article go while its annotations are still held', async () => {
    const kept: Anchor[][] = [];
    const hidden: WeakRef<HTMLElement>[] = [];
    // Three tabs are opened and left in turn; a fourth is shown. Each time
    // the old article goes and its tab's annotations stay.
    let shown: HTMLElement | null = null;
    for (let t = 0; t < 4; t++) {
      const anchors: Anchor[] = Array.from({ length: 20 }, (_, i) => (
        { text: `alpha${i}`, prefix: 'Paragraph ', suffix: ' opens here', blockHint: `p:${i + 1}` }));
      kept.push(anchors);
      if (shown) {
        hidden.push(new WeakRef(shown));
        shown.remove();
      }
      const el = document.createElement('article');
      el.innerHTML = Array.from({ length: 40 }, (_, i) =>
        `<p data-block-id="p:${i + 1}">Paragraph alpha${i} opens here.</p>`).join('');
      document.body.appendChild(el);
      expect(resolvingPass(() => anchors.filter((a) => resolveAnchor(a, el)).length)).toBe(20);
      shown = el;
    }
    for (let i = 0; i < 4; i++) { await tick(); gc(); }
    expect(hidden.map((r) => r.deref() !== undefined)).toEqual([false, false, false]);
    expect(kept.length).toBe(4);
    shown?.remove();
  });
});
