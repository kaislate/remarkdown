import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tick } from 'svelte';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { doc } from '../../src/stores/doc';
import { currentViewerRoot } from '../../src/stores/annots';
import TocButton from '../../src/components/TocButton.svelte';
import { viewerScroll } from '../../src/stores/viewport';

beforeEach(() => {
  doc.set(null);
  currentViewerRoot.set(null);
  document.body.innerHTML = '';
});

function makeRootWithHeadings(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  // Tag headings with synthetic block ids the way the renderer would.
  root.querySelectorAll('h1, h2, h3, h4').forEach((el, i) => {
    el.setAttribute('data-block-id', `h:${i + 1}`);
  });
  currentViewerRoot.set(root);
  return root;
}

describe('TocButton', () => {
  it('button is disabled when there are no headings', () => {
    currentViewerRoot.set(document.createElement('div'));
    const { container } = render(TocButton);
    const btn = container.querySelector('.toc-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('lists each heading at its level after the popover opens', async () => {
    makeRootWithHeadings(`
      <h1>One</h1>
      <h2>Two</h2>
      <h3>Three</h3>
    `);
    const { container } = render(TocButton);
    const user = userEvent.setup();
    const btn = container.querySelector('.toc-button') as HTMLButtonElement;
    await user.click(btn);
    const items = document.querySelectorAll('.toc-popover li');
    expect(items.length).toBe(3);
    expect((items[0] as HTMLElement).className).toContain('level-1');
    expect((items[1] as HTMLElement).className).toContain('level-2');
    expect((items[2] as HTMLElement).className).toContain('level-3');
  });

  it('shows the heading count in the header', async () => {
    makeRootWithHeadings(`<h1>A</h1><h2>B</h2>`);
    const { container } = render(TocButton);
    const user = userEvent.setup();
    await user.click(container.querySelector('.toc-button') as HTMLButtonElement);
    const count = document.querySelector('.toc-count');
    expect(count?.textContent?.trim()).toBe('2');
  });

  // While open, the list marks the section being read on every scroll
  // event. It used to look each heading up in the document again, per
  // heading, per event.
  it('follows the scroll without searching the document for its headings again', async () => {
    const N = 60;
    const root = makeRootWithHeadings(
      Array.from({ length: N }, (_, i) => `<h2>Part ${i + 1}</h2><p>Text</p>`).join(''),
    );
    const scroller = document.createElement('div');
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
    document.body.appendChild(scroller);
    // Each heading 100px apart, moving with the scroll.
    root.querySelectorAll('h2').forEach((el, i) => {
      el.getBoundingClientRect = () => {
        const top = i * 100 - scroller.scrollTop;
        return { top, bottom: top + 30, height: 30, left: 0, right: 0, width: 0, x: 0, y: top, toJSON() {} } as DOMRect;
      };
    });
    viewerScroll.set(scroller);
    const { container } = render(TocButton);
    const user = userEvent.setup();
    await user.click(container.querySelector('.toc-button') as HTMLButtonElement);
    const current = () => document.querySelector('.toc-entry[aria-current]')?.textContent;
    // The reading line is at 200: Part 3's heading (at 200) has reached it.
    expect(current()).toBe('Part 3');

    const lookups = vi.spyOn(root, 'querySelector');
    for (let y = 10; y <= 1000; y += 10) {
      scroller.scrollTop = y;
      scroller.dispatchEvent(new Event('scroll'));
    }
    await tick();
    // eslint-disable-next-line no-console
    console.log(`[perf] TocButton: document searches over 100 scroll events with ${N} headings: ${lookups.mock.calls.length}`);
    expect(lookups).not.toHaveBeenCalled();
    // Line at 1200: Part 13.
    expect(current()).toBe('Part 13');
    lookups.mockRestore();
    viewerScroll.set(null);
  });

  it('still jumps to a heading picked from the list', async () => {
    const root = makeRootWithHeadings(`<h1>A</h1><h2>B</h2>`);
    const scroller = document.createElement('div');
    document.body.appendChild(scroller);
    viewerScroll.set(scroller);
    const b = root.querySelector('h2') as HTMLElement;
    const into = vi.fn();
    b.scrollIntoView = into;
    const { container } = render(TocButton);
    const user = userEvent.setup();
    await user.click(container.querySelector('.toc-button') as HTMLButtonElement);
    await user.click(screen.getByRole('button', { name: 'B' }));
    await tick();
    expect(document.querySelector('.toc-entry[aria-current]')?.textContent).toBe('B');
    viewerScroll.set(null);
  });
});
