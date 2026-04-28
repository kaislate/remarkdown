import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import Minimap from '../../src/components/Minimap.svelte';
import { doc } from '../../src/stores/doc';
import { viewerScroll } from '../../src/stores/viewport';
import { minimapShown } from '../../src/stores/ui';
import { currentViewerRoot } from '../../src/stores/annots';

function docState(html: string) {
  return {
    path: '/tmp/a.md',
    dir: '/tmp',
    sha256: 'abc',
    bytes: 0,
    markdown: '',
    html,
    plaintext: 'x',
    blocks: ['p:1'],
    sidecarRaw: null,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  doc.set(null);
  viewerScroll.set(null);
  minimapShown.set(true);
  currentViewerRoot.set(null);
});
afterEach(() => { document.body.innerHTML = ''; currentViewerRoot.set(null); });

describe('Minimap', () => {
  it('does not render when no doc is loaded', () => {
    render(Minimap);
    expect(document.querySelector('.minimap')).toBeNull();
    expect(document.querySelector('.minimap-toggle')).toBeNull();
  });

  it('renders the minimap container and toggle when a doc is loaded', () => {
    render(Minimap);
    flushSync(() => doc.set(docState('<p data-block-id="p:1">hello world</p>')));
    expect(document.querySelector('.minimap')).not.toBeNull();
    expect(document.querySelector('.minimap-toggle')).not.toBeNull();
  });

  it('renders a scaled clone of the doc html inside the minimap', () => {
    render(Minimap);
    flushSync(() => doc.set(docState('<p data-block-id="p:1">this is visible in minimap</p>')));

    // The minimap mirrors the live article DOM (post mermaid + other
    // JS-driven transforms), not raw $doc.html. Stand up a dummy article
    // element and point the currentViewerRoot store at it; the snapshot
    // runs synchronously inside the store's subscribe callback.
    const article = document.createElement('article');
    article.innerHTML = '<p data-block-id="p:1">this is visible in minimap</p>';
    document.body.appendChild(article);
    flushSync(() => currentViewerRoot.set(article));

    const content = document.querySelector('.minimap-content') as HTMLElement;
    expect(content).not.toBeNull();
    expect(content.textContent).toContain('this is visible in minimap');
  });

  it('renders the viewport indicator', () => {
    render(Minimap);
    flushSync(() => doc.set(docState('<p data-block-id="p:1">x</p>')));
    expect(document.querySelector('.viewport-indicator')).not.toBeNull();
  });

  it('applies the hidden class to the minimap when minimapShown is false', () => {
    render(Minimap);
    flushSync(() => doc.set(docState('<p data-block-id="p:1">x</p>')));
    flushSync(() => minimapShown.set(false));
    const map = document.querySelector('.minimap') as HTMLElement;
    expect(map.classList.contains('hidden')).toBe(true);
  });

  it('applies the collapsed class to the toggle when hidden', () => {
    render(Minimap);
    flushSync(() => doc.set(docState('<p data-block-id="p:1">x</p>')));
    flushSync(() => minimapShown.set(false));
    const toggle = document.querySelector('.minimap-toggle') as HTMLElement;
    expect(toggle.classList.contains('collapsed')).toBe(true);
  });

  it('clicking the toggle flips minimapShown', async () => {
    const user = userEvent.setup();
    render(Minimap);
    flushSync(() => doc.set(docState('<p data-block-id="p:1">x</p>')));
    expect(get(minimapShown)).toBe(true);
    const toggle = document.querySelector('.minimap-toggle') as HTMLButtonElement;
    await user.click(toggle);
    expect(get(minimapShown)).toBe(false);
    await user.click(toggle);
    expect(get(minimapShown)).toBe(true);
  });

  it('clicking the minimap body sets the viewer scrollTop', () => {
    const scrollEl = document.createElement('div');
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollEl, 'clientHeight', { value: 600, configurable: true });
    let scrollTopValue = 0;
    Object.defineProperty(scrollEl, 'scrollTop', {
      get: () => scrollTopValue,
      set: (v) => { scrollTopValue = v; },
      configurable: true,
    });
    document.body.appendChild(scrollEl);

    render(Minimap);
    flushSync(() => doc.set(docState('<p data-block-id="p:1">x</p>')));

    const map = document.querySelector('.minimap') as HTMLElement;
    map.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 140, bottom: 800, width: 140, height: 800, x: 0, y: 0 } as DOMRect);
    Object.defineProperty(map, 'clientWidth', { value: 140, configurable: true });
    Object.defineProperty(map, 'clientHeight', { value: 800, configurable: true });

    flushSync(() => viewerScroll.set(scrollEl));

    const evt = new Event('pointerdown', { bubbles: true, cancelable: true }) as any;
    evt.clientX = 70;
    evt.clientY = 100;
    evt.pointerId = 1;
    evt.pointerType = 'mouse';
    map.dispatchEvent(evt);

    expect(scrollTopValue).toBeGreaterThan(0);
  });
});
