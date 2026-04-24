import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import Minimap from '../../src/components/Minimap.svelte';
import { doc } from '../../src/stores/doc';
import { viewerScroll } from '../../src/stores/viewport';

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
});
afterEach(() => { document.body.innerHTML = ''; });

describe('Minimap', () => {
  it('does not render when no doc is loaded', () => {
    render(Minimap);
    expect(document.querySelector('.minimap')).toBeNull();
  });

  it('renders the minimap container when a doc is loaded', () => {
    render(Minimap);
    flushSync(() => doc.set(docState('<p data-block-id="p:1">hello world</p>')));
    expect(document.querySelector('.minimap')).not.toBeNull();
  });

  it('renders a scaled clone of the doc html inside the minimap', () => {
    render(Minimap);
    flushSync(() => doc.set(docState('<p data-block-id="p:1">this is visible in minimap</p>')));
    const content = document.querySelector('.minimap-content') as HTMLElement;
    expect(content).not.toBeNull();
    expect(content.textContent).toContain('this is visible in minimap');
  });

  it('renders the viewport indicator', () => {
    render(Minimap);
    flushSync(() => doc.set(docState('<p data-block-id="p:1">x</p>')));
    expect(document.querySelector('.viewport-indicator')).not.toBeNull();
  });

  it('clicking the minimap sets the viewer scrollTop', () => {
    // Seed a fake scroll element with mocked layout properties.
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
    // Set doc first so the {#if} renders the minimap and bind:this captures the element,
    // THEN set the scroll element so the subscribe runs against a non-null minimapEl.
    flushSync(() => doc.set(docState('<p data-block-id="p:1">x</p>')));

    const map = document.querySelector('.minimap') as HTMLElement;
    map.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 100, bottom: 800, width: 100, height: 800, x: 0, y: 0 } as DOMRect);
    Object.defineProperty(map, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(map, 'clientHeight', { value: 800, configurable: true });

    // Now set the scroll element; the subscribe callback fires updateLayout against minimapEl.
    flushSync(() => viewerScroll.set(scrollEl));

    // jsdom lacks PointerEvent — synthesize one via a plain Event with pointer properties.
    const evt = new Event('pointerdown', { bubbles: true, cancelable: true }) as any;
    evt.clientX = 50;
    evt.clientY = 100;
    evt.pointerId = 1;
    evt.pointerType = 'mouse';
    map.dispatchEvent(evt);

    // scrollTop should have been written to something non-zero.
    expect(scrollTopValue).toBeGreaterThan(0);
  });
});
