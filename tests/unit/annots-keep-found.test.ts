import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  resolvedAnnots,
  orphanedAnnots,
  currentViewerRoot,
  replaceAll,
  updateAnnotation,
  addAnnotation,
  annots,
} from '../../src/stores/annots';
import { resolveAnchor, resolvingPass } from '../../src/lib/anchoring';
import type { Annotation, Anchor } from '../../src/lib/schema';

// Typing in a re.mark changes one annotation per keystroke. Every other
// annotation's anchor is the same object as before, in an article that
// hasn't changed, so it is where it was: these check it isn't searched
// for again, and that what's found is what searching afresh finds.

const now = '2026-01-01T00:00:00.000Z';
let root: HTMLElement;
let unsub: (() => void) | null = null;

function article(n: number): HTMLElement {
  const el = document.createElement('article');
  el.innerHTML = Array.from({ length: n }, (_, i) =>
    `<p data-block-id="p:${i + 1}">Paragraph alpha${i} opens here. It has beta${i} inside it, and <em>gamma${i}</em> near the end.</p>`).join('\n');
  document.body.appendChild(el);
  return el;
}

function anchor(word: string, prefix: string, suffix: string, blockHint: string): Anchor {
  return { text: word, prefix, suffix, blockHint };
}

function annotations(n: number): Annotation[] {
  const out: Annotation[] = [];
  for (let i = 0; i < n; i++) {
    const b = `p:${i + 1}`;
    out.push({ id: `H${i}`, type: 'highlight', color: '#fff200', anchor: anchor(`alpha${i}`, 'Paragraph ', ' opens here.', b), createdAt: now, updatedAt: now });
    out.push({ id: `N${i}`, type: 'note', body: `note ${i}`, anchor: anchor(`beta${i}`, 'It has ', ' inside it', b), createdAt: now, updatedAt: now });
    // Its block's number is off by three (paragraphs added above since).
    out.push({ id: `M${i}`, type: 'highlight', color: '#c2ff66', anchor: anchor(`gamma${i}`, ' inside it, and ', ' near the end.', `p:${i + 4}`), createdAt: now, updatedAt: now });
    if (i % 3 === 0) out.push({ id: `D${i}`, type: 'drawing', shape: { kind: 'freehand', anchor: { blockId: b }, points: [[0, 0], [1, 1]], color: '#000', width: 2 }, createdAt: now, updatedAt: now });
  }
  for (let k = 0; k < 20; k++) out.push({ id: `O${k}`, type: 'highlight', color: '#fff200', anchor: anchor(`nowhere${k}`, '', '', `p:${k + 1}`), createdAt: now, updatedAt: now });
  return out;
}

// Where each annotation is, searched for afresh (copies of its anchor).
function afresh(list: Annotation[]): Array<[string, string | null]> {
  return resolvingPass(() => list.filter((a) => a.type !== 'drawing').map((a) => {
    const r = resolveAnchor({ ...a.anchor }, root);
    return [a.id, r ? `${r.startOffset}:${r.toString()}:${r.endOffset}` : null] as [string, string | null];
  }));
}

function shown(): Array<[string, string | null]> {
  const placed = new Map(get(resolvedAnnots).map((r) => [r.annotation.id, r.range]));
  const ids = [...placed.keys(), ...get(orphanedAnnots).map((a) => a.id)].filter((id) => !id.startsWith('D'));
  return ids.map((id) => {
    const r = placed.get(id);
    return [id, r ? `${r.startOffset}:${r.toString()}:${r.endOffset}` : null] as [string, string | null];
  }).sort((a, b) => a[0].localeCompare(b[0]));
}

beforeEach(() => {
  document.body.innerHTML = '';
  replaceAll([]);
  root = article(300);
  currentViewerRoot.set(root);
  unsub = resolvedAnnots.subscribe(() => {});
});

afterEach(() => {
  unsub?.();
  currentViewerRoot.set(null);
  vi.restoreAllMocks();
});

describe('an annotation change', () => {
  it("doesn't search again for the annotations it didn't change", () => {
    const list = annotations(300);
    replaceAll(list);
    expect(get(resolvedAnnots).length).toBe(list.length - 20);

    const ranges = vi.spyOn(document, 'createRange');
    const walks = vi.spyOn(document, 'createTreeWalker');
    for (const ch of 'hello') {
      updateAnnotation('N150', (a) => ({ ...a, body: (a as { body: string }).body + ch }) as Annotation);
    }
    // Each keystroke searched for all ~1,200 anchors again.
    expect(ranges.mock.calls.length).toBe(0);
    expect(walks.mock.calls.length).toBe(0);
    expect(get(resolvedAnnots).find((r) => r.annotation.id === 'N150')?.annotation).toMatchObject({ body: 'note 150hello' });
  });

  it('places everything where searching afresh does, as annotations and the article change', () => {
    const list = annotations(120);
    replaceAll(list);
    const sorted = (x: Array<[string, string | null]>) => [...x].sort((a, b) => a[0].localeCompare(b[0]));
    expect(shown()).toEqual(sorted(afresh(get(annots))));

    // A new highlight, a moved one, a recoloured one.
    addAnnotation({ id: 'X1', type: 'highlight', color: '#fff200', anchor: anchor('beta7', 'It has ', ' inside it', 'p:8'), createdAt: now, updatedAt: now });
    updateAnnotation('H3', (a) => ({ ...a, anchor: anchor('alpha5', 'Paragraph ', ' opens here.', 'p:6') }) as Annotation);
    updateAnnotation('H4', (a) => ({ ...a, color: '#ff7ba1' }) as Annotation);
    const all = () => get(annots);
    expect(shown()).toEqual(sorted(afresh(all())));

    // The article changes under them (a paragraph rewritten, one removed,
    // one added at the top): what was found before is searched for again.
    root.querySelector('[data-block-id="p:10"]')!.textContent = 'Rewritten: nothing to find.';
    root.querySelector('[data-block-id="p:20"]')!.remove();
    const top = document.createElement('p');
    top.dataset.blockId = 'p:0';
    top.textContent = 'A new first paragraph with alpha7 in it.';
    root.prepend(top);
    updateAnnotation('N1', (a) => ({ ...a, body: 'changed' }) as Annotation);
    expect(get(orphanedAnnots).map((a) => a.id)).toEqual(expect.arrayContaining(['H9', 'N9', 'H19', 'N19']));
    expect(shown()).toEqual(sorted(afresh(all())));

    // A block's id changes (the article was rendered again).
    root.querySelector('[data-block-id="p:30"]')!.setAttribute('data-block-id', 'p:999');
    updateAnnotation('N2', (a) => ({ ...a, body: 'changed' }) as Annotation);
    expect(shown()).toEqual(sorted(afresh(all())));
  });
});
