import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { contextFor, type ContextOptions } from '../../src/lib/note-context';
import { buildSentenceContext } from '../../src/lib/sentence-context';

// A re.mark's sentence of context is shown on its margin card and in the
// re.marks panel, and the cards are laid out again on every annotation
// change, resize and zoom: the context, which doesn't depend on layout,
// shouldn't be worked out again each time, nor read the whole article
// before the re.mark to find a sentence or two.

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('article');
  root.innerHTML = Array.from({ length: 300 }, (_, i) =>
    i % 25 === 7
      ? `<ul data-block-id="ul:${i}"><li>Item one of list ${i}. Still item one.</li><li>Item two has word${i} in it. More.</li></ul>`
      : i % 40 === 3
        ? `<p data-block-id="p:${i}"></p>`
        : `<p data-block-id="p:${i}">First sentence of paragraph ${i}. Second has word${i} in it! Third? Last one.</p>`).join('\n');
  document.body.appendChild(root);
});

afterEach(() => vi.restoreAllMocks());

function rangeOf(word: string): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const at = (n as Text).data.indexOf(word);
    if (at >= 0) {
      const r = document.createRange();
      r.setStart(n, at);
      r.setEnd(n, at + word.length);
      return r;
    }
  }
  throw new Error(word);
}

// The old way: every earlier block's text, then the sentences from them.
function everyBlockBefore(range: Range, o: ContextOptions): string {
  if (o.stopAtListItem) {
    const li = (range.startContainer as Text).parentElement!.closest('li');
    if (li) {
      const w = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      let acc = 0;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n === range.startContainer) return buildSentenceContext([li.textContent!], acc + range.startOffset, o.sentences, true);
        acc += (n as Text).data.length;
      }
    }
  }
  const block = (range.startContainer as Text).parentElement!.closest<HTMLElement>('[data-block-id]')!;
  const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let acc = 0;
  for (let n = w.nextNode(); n !== range.startContainer; n = w.nextNode()) acc += (n as Text).data.length;
  const all = Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'));
  const blocks = o.stopAtParagraph ? [block] : all.slice(0, all.indexOf(block) + 1);
  return buildSentenceContext(blocks.map((b) => b.textContent ?? ''), acc + range.startOffset, o.sentences, o.stopAtParagraph);
}

const OPTIONS: ContextOptions[] = [
  { sentences: 1, stopAtParagraph: true, stopAtListItem: true },
  { sentences: 3, stopAtParagraph: false, stopAtListItem: false },
  { sentences: 5, stopAtParagraph: false, stopAtListItem: true },
  { sentences: 2, stopAtParagraph: true, stopAtListItem: false },
];

describe("a re.mark's context", () => {
  it('is worked out once while the article and the settings stay the same', () => {
    const ranges = Array.from({ length: 300 }, (_, i) => i).filter((i) => i % 40 !== 3).map((i) => rangeOf(`word${i} `));
    const o = OPTIONS[1];
    const first = ranges.map((r) => contextFor(r, root, o));
    const walks = vi.spyOn(document, 'createTreeWalker');
    const lists = vi.spyOn(root, 'querySelectorAll');
    const again = ranges.map((r) => contextFor(r, root, o));
    expect(again).toEqual(first);
    expect(walks).not.toHaveBeenCalled();
    expect(lists).not.toHaveBeenCalled();
  });

  it('reads the blocks before the re.mark only as far back as its sentences go', () => {
    const text = vi.spyOn(Node.prototype, 'textContent', 'get');
    contextFor(rangeOf('word290 '), root, OPTIONS[1]);
    // It read all 290 blocks before it.
    expect(text.mock.calls.length).toBeLessThan(10);
  });

  it('is what reading every block before it gives, whatever the settings', () => {
    for (const o of OPTIONS) {
      for (const i of [0, 1, 4, 7, 32, 57, 150, 299]) {
        const r = rangeOf(`word${i} `);
        expect(contextFor(r, root, o)).toBe(everyBlockBefore(r, o));
      }
      const first = rangeOf('First sentence of paragraph 2.');
      expect(contextFor(first, root, o)).toBe(everyBlockBefore(first, o));
    }
  });

  it('follows the article and the settings when they change', () => {
    const r = rangeOf('word150 ');
    const o = OPTIONS[1];
    expect(contextFor(r, root, o)).toBe(everyBlockBefore(r, o));
    root.querySelector('[data-block-id="p:149"]')!.textContent = 'A rewritten paragraph. With two sentences.';
    expect(contextFor(r, root, o)).toBe(everyBlockBefore(r, o));
    expect(contextFor(r, root, o)).toContain('With two sentences.');
    expect(contextFor(r, root, OPTIONS[0])).toBe(everyBlockBefore(r, OPTIONS[0]));
    // The range itself moved.
    const other = rangeOf('word200 ');
    r.setStart(other.startContainer, other.startOffset);
    r.setEnd(other.endContainer, other.endOffset);
    expect(contextFor(r, root, o)).toBe(everyBlockBefore(r, o));
  });
});
