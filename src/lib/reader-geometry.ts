// Where each top-level block of the reading article sits, measured once
// per layout instead of on every scroll frame. Reader mode's meta line
// (ReaderMeta) and its contents column (ReaderContents) both follow the
// scroll position; measuring every block on each frame, twice, made long
// documents (thousands of blocks) stutter while scrolling.
//
// Positions are kept relative to the article's own top. On scroll only
// the article moves, so one getBoundingClientRect of the article puts
// every block back in viewport coordinates. Anything that moves blocks
// inside the article (a diagram drawn, an image loaded, fonts, the window
// width, a new document) changes the article's size, and the components
// call invalidateReaderGeometry from their ResizeObserver / resize / doc
// triggers; the next measure re-reads the blocks.
import { countWords } from './reading-time';

export interface ReaderGeometry {
  // The article's top-level blocks, in document order.
  els: Element[];
  // Edges relative to the article's top, in px.
  tops: number[];
  bottoms: number[];
  words: number[];
  // Block index of each element.
  index: Map<Element, number>;
}

const cache = new WeakMap<HTMLElement, ReaderGeometry>();

// Word counts per block, computed once per element. Diagrams are looked
// at, not read word by word, so their labels don't count.
const wordCache = new WeakMap<Element, number>();
export function wordsIn(el: Element): number {
  let n = wordCache.get(el);
  if (n === undefined) {
    n = el.matches('.mermaid-block, .mermaid-error') ? 0 : countWords(el.textContent ?? '');
    wordCache.set(el, n);
  }
  return n;
}

export function invalidateReaderGeometry(article: HTMLElement): void {
  cache.delete(article);
}

// Measured in this same task (both components mount together in one
// flush): the second one to start up can use the first one's measures.
const justMeasured = new WeakSet<ReaderGeometry>();

// For a component starting up: the layout may have changed since the
// last measure (reader mode left and re-entered, the window resized in
// between), so measure afresh, unless that was just done.
export function refreshReaderGeometry(article: HTMLElement): void {
  const g = cache.get(article);
  if (!g || !justMeasured.has(g)) cache.delete(article);
}

// The article's blocks, measured now if the layout changed since last time.
export function readerGeometry(article: HTMLElement): ReaderGeometry {
  let g = cache.get(article);
  // Still the same blocks (a re-render replaces them all)?
  if (
    g &&
    g.els.length === article.children.length &&
    g.els[0] === article.firstElementChild &&
    g.els[g.els.length - 1] === article.lastElementChild
  ) return g;
  const origin = article.getBoundingClientRect().top;
  const els = Array.from(article.children);
  const tops: number[] = [];
  const bottoms: number[] = [];
  const words: number[] = [];
  const index = new Map<Element, number>();
  els.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    tops.push(r.top - origin);
    bottoms.push(r.bottom - origin);
    words.push(wordsIn(el));
    index.set(el, i);
  });
  g = { els, tops, bottoms, words, index };
  cache.set(article, g);
  const measured = g;
  justMeasured.add(measured);
  queueMicrotask(() => justMeasured.delete(measured));
  return g;
}

// Words below `fold` (viewport px), the article's top being at
// `articleTop` now: wordsBelow (reading-time.ts) over the cached blocks,
// without building a list of them on every frame.
export function wordsBelowFold(g: ReaderGeometry, articleTop: number, fold: number): number {
  let total = 0;
  for (let i = 0; i < g.els.length; i++) {
    const top = g.tops[i] + articleTop;
    const bottom = g.bottoms[i] + articleTop;
    if (top >= fold) {
      total += g.words[i];
    } else if (bottom > fold) {
      total += g.words[i] * ((bottom - fold) / (bottom - top));
    }
  }
  return Math.round(total);
}

// Viewport top of one of the article's top-level blocks (null: not one).
export function blockTop(g: ReaderGeometry, el: Element, articleTop: number): number | null {
  const i = g.index.get(el);
  return i === undefined ? null : g.tops[i] + articleTop;
}
