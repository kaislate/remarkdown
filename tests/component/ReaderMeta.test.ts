import { describe, it, expect, beforeEach } from 'vitest';
import { tick } from 'svelte';
import { render, waitFor } from '@testing-library/svelte';
import ReaderMeta from '../../src/components/ReaderMeta.svelte';
import { viewerScroll } from '../../src/stores/viewport';
import { currentViewerRoot } from '../../src/stores/annots';

// jsdom has no layout: each block gets a fake vertical extent, shifted by
// the scroller's scrollTop like real viewport-relative rects would be.
// The article itself moves the same way (it starts at the top of the
// scrolled content).
const VIEW_H = 600;
let scroller: HTMLElement;
let article: HTMLElement;
// How many times a block (an article child) was measured.
let blockReads = 0;

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
}

function layout(el: HTMLElement, docTop: number, height: number) {
  el.getBoundingClientRect = () => {
    if (el.parentElement === article) blockReads += 1;
    const top = docTop - scroller.scrollTop;
    return { top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON() {} } as DOMRect;
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  scroller = document.createElement('div');
  scroller.getBoundingClientRect = () =>
    ({ top: 0, bottom: VIEW_H, left: 0, right: 0, width: 0, height: VIEW_H, x: 0, y: 0, toJSON() {} }) as DOMRect;
  article = document.createElement('article');
  article.innerHTML = `
    <h1>On reading slowly</h1>
    <p>${words(230)}</p>
    <h2>Chapter 3</h2>
    <p>${words(460)}</p>
    <div class="mermaid-block"><svg><text>${words(500)}</text></svg></div>
    <p>${words(688)}</p>`;
  const [h1, p1, h2, p2, diagram, p3] = Array.from(article.children) as HTMLElement[];
  layout(h1, 100, 50);
  layout(p1, 150, 400);     // ends at 550: on screen
  layout(h2, 700, 50);
  layout(p2, 750, 400);
  layout(diagram, 1150, 300);
  layout(p3, 1450, 400);
  layout(article, 0, 1850);
  blockReads = 0;
  scroller.appendChild(article);
  document.body.appendChild(scroller);
  viewerScroll.set(scroller);
  currentViewerRoot.set(article);
});

const meta = () => document.querySelector('.reader-meta');

describe('ReaderMeta', () => {
  it('shows the reading time left below the viewport (diagrams are not read word by word)', async () => {
    render(ReaderMeta);
    // Below the fold at 600: 2 + 460 + 688 words (the diagram's text doesn't count).
    await waitFor(() => expect(meta()?.textContent?.trim()).toBe('5 min left'));
  });

  it('updates on scroll, naming the section once its heading has gone by', async () => {
    render(ReaderMeta);
    await waitFor(() => expect(meta()).not.toBeNull());
    scroller.scrollTop = 900; // fold now at doc 1500: 350/400 of p3 left ≈ 604 words
    scroller.dispatchEvent(new Event('scroll'));
    await waitFor(() => {
      const t = meta()?.textContent?.replace(/\s+/g, ' ').trim();
      expect(t).toBe('Chapter 3 · 3 min left');
    });
  });

  it('hides once nothing is left to read', async () => {
    render(ReaderMeta);
    await waitFor(() => expect(meta()).not.toBeNull());
    scroller.scrollTop = 1400;
    scroller.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(meta()).toBeNull());
  });

  it('measures the blocks once per layout, not on every scroll frame', async () => {
    render(ReaderMeta);
    await waitFor(() => expect(meta()).not.toBeNull());
    const afterFirst = blockReads;
    expect(afterFirst).toBeGreaterThan(0);
    for (let y = 20; y <= 900; y += 20) {
      scroller.scrollTop = y;
      scroller.dispatchEvent(new Event('scroll'));
      await new Promise((r) => requestAnimationFrame(r));
    }
    await tick();
    // eslint-disable-next-line no-console
    console.log(`[perf] ReaderMeta: block measurements over 45 scroll frames: ${blockReads - afterFirst}`);
    expect(blockReads - afterFirst).toBe(0);
    // Still right where it ended up.
    await waitFor(() => expect(meta()?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Chapter 3 · 3 min left'));
    // A layout change (the window resized) measures again.
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => requestAnimationFrame(r));
    expect(blockReads).toBeGreaterThan(afterFirst);
  });
});
