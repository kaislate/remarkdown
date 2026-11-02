import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import ReaderContents from '../../src/components/ReaderContents.svelte';
import ReaderMeta from '../../src/components/ReaderMeta.svelte';
import { viewerScroll } from '../../src/stores/viewport';
import { currentViewerRoot } from '../../src/stores/annots';

// Reader mode's contents column follows the scroll: the section being
// read is marked, the minutes left shown under it. jsdom has no layout:
// each block gets a fake extent, shifted by the scroller's scrollTop like
// real viewport-relative rects, and the article moves the same way.
// jsdom has no scrollIntoView (the column keeps its marked entry in view).
Element.prototype.scrollIntoView ??= function () {};

const VIEW_H = 600;
let scroller: HTMLElement;
let article: HTMLElement;
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

// A long document: 40 sections of a heading and three paragraphs.
const SECTIONS = 40;
const BLOCK_H = 100;

beforeEach(() => {
  document.body.innerHTML = '';
  scroller = document.createElement('div');
  scroller.getBoundingClientRect = () =>
    ({ top: 0, bottom: VIEW_H, left: 0, right: 0, width: 0, height: VIEW_H, x: 0, y: 0, toJSON() {} }) as DOMRect;
  article = document.createElement('article');
  const parts: string[] = [];
  for (let s = 0; s < SECTIONS; s++) {
    parts.push(`<h2 id="s${s}">Section ${s + 1}</h2>`);
    for (let p = 0; p < 3; p++) parts.push(`<p>${words(115)}</p>`);
  }
  article.innerHTML = parts.join('');
  Array.from(article.children).forEach((el, i) => layout(el as HTMLElement, i * BLOCK_H, BLOCK_H));
  layout(article, 0, article.children.length * BLOCK_H);
  blockReads = 0;
  scroller.appendChild(article);
  document.body.appendChild(scroller);
  viewerScroll.set(scroller);
  currentViewerRoot.set(article);
});

const currentEntry = () => document.querySelector('.reader-contents a[aria-current]')?.textContent;
const left = () => document.querySelector('.reader-contents .left')?.textContent;

async function scrollTo(y: number) {
  scroller.scrollTop = y;
  scroller.dispatchEvent(new Event('scroll'));
  await new Promise((r) => requestAnimationFrame(r));
}

describe('ReaderContents', () => {
  it('marks the section being read and the minutes left, following the scroll', async () => {
    render(ReaderContents);
    await waitFor(() => expect(document.querySelectorAll('.reader-contents li')).toHaveLength(SECTIONS));
    // Reading line at 200 (a third of 600): Section 1's heading is at 0.
    expect(currentEntry()).toBe('Section 1');
    // Below the fold at 600: everything from block 6 on. 160 blocks, 40 of
    // them headings of 2 words, 120 paragraphs of 115: (40*2 + 120*115)
    // minus the first 6 blocks (2 headings, 4 paragraphs).
    const below = (40 * 2 + 120 * 115) - (2 * 2 + 4 * 115);
    expect(left()).toBe(`${Math.ceil(below / 230)} min left`);

    await scrollTo(4000); // the line at 4200: block 42 = section 11's heading
    await tick();
    await waitFor(() => expect(currentEntry()).toBe('Section 11'));
  });

  it('measures the blocks once per layout, shared with the meta line, not on every scroll frame', async () => {
    render(ReaderContents);
    render(ReaderMeta);
    await waitFor(() => expect(document.querySelectorAll('.reader-contents li')).toHaveLength(SECTIONS));
    const blocks = article.children.length;
    const afterFirst = blockReads;
    for (let y = 50; y <= 5000; y += 50) await scrollTo(y);
    await tick();
    // eslint-disable-next-line no-console
    console.log(`[perf] reader mode (contents + meta line), ${blocks} blocks: ${afterFirst} block measurements on open, ${blockReads - afterFirst} over 100 scroll frames`);
    expect(blockReads - afterFirst).toBe(0);
    // Opening measured each block once, for both.
    expect(afterFirst).toBe(blocks);
    // The line at 5200: block 52, section 14's heading.
    await waitFor(() => expect(currentEntry()).toBe('Section 14'));
  });

  it('measures again when the layout changes', async () => {
    render(ReaderContents);
    await waitFor(() => expect(currentEntry()).toBe('Section 1'));
    // Everything moves down 1000px (say, a tall diagram drew at the top).
    Array.from(article.children).forEach((el, i) => layout(el as HTMLElement, 1000 + i * BLOCK_H, BLOCK_H));
    const before = blockReads;
    window.dispatchEvent(new Event('resize'));
    await new Promise((r) => requestAnimationFrame(r));
    await tick();
    expect(blockReads).toBeGreaterThan(before);
    await waitFor(() => expect(currentEntry()).toBeUndefined());
  });
});
