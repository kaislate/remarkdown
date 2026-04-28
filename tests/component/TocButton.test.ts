import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { doc } from '../../src/stores/doc';
import { currentViewerRoot } from '../../src/stores/annots';
import TocButton from '../../src/components/TocButton.svelte';

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
});
