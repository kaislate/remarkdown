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

  it('mirrors diagrams without duplicating their ids in the document', () => {
    render(Minimap);
    flushSync(() => doc.set(docState('<p data-block-id="p:1">x</p>')));
    const article = document.createElement('article');
    article.innerHTML =
      '<div class="mermaid-block" data-block-id="div:1"><svg id="rmd-mermaid-1x">' +
      '<style>#rmd-mermaid-1x .node{}</style>' +
      '<marker id="rmd-mermaid-1x_end"></marker><path marker-end="url(#rmd-mermaid-1x_end)"></path>' +
      '</svg></div>';
    document.body.appendChild(article);
    flushSync(() => currentViewerRoot.set(article));

    const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    // The clone's marker reference points at the clone's own marker.
    const clonePath = document.querySelector('.minimap-content path')!;
    const ref = /url\(#([^)]+)\)/.exec(clonePath.getAttribute('marker-end') ?? '')![1];
    expect(document.querySelector('.minimap-content')!.querySelector(`[id="${ref}"]`)).not.toBeNull();
    // The article itself is untouched.
    expect(article.querySelector('svg')!.id).toBe('rmd-mermaid-1x');
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

// The minimap mirrors the page. A change to the page (typing in edit mode,
// a diagram drawn) used to clone, re-parse and lay out the WHOLE document
// again, even while the minimap was hidden.
describe('Minimap keeping up with changes', () => {
  const settle = () => new Promise((r) => setTimeout(r, 200)); // past the debounce
  const content = () => document.querySelector('.minimap-content') as HTMLElement;

  function mountWith(html: string): HTMLElement {
    render(Minimap);
    flushSync(() => doc.set(docState('<p>x</p>')));
    const article = document.createElement('article');
    article.innerHTML = html;
    document.body.appendChild(article);
    flushSync(() => currentViewerRoot.set(article));
    return article;
  }

  it('a change inside one block redraws that block only, and the copy matches the page', async () => {
    const article = mountWith(
      '<h2 id="intro">Intro</h2><p>first</p><p>second</p>' +
      '<div class="mermaid-block"><svg id="d1"><marker id="d1_end"></marker><path marker-end="url(#d1_end)"></path></svg></div>',
    );
    const [h2Copy, p1Copy] = Array.from(content().children);
    article.children[2].textContent = 'second, edited';
    await settle();
    expect(content().textContent).toContain('second, edited');
    // Untouched blocks are the very same nodes as before.
    expect(content().children[0]).toBe(h2Copy);
    expect(content().children[1]).toBe(p1Copy);
    // A redrawn block's ids are kept apart from the page's, like a full copy.
    const svg = article.querySelector('svg')!;
    svg.setAttribute('data-x', '1');
    await settle();
    const ids = Array.from(document.querySelectorAll('[id]')).map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    const ref = /url\(#([^)]+)\)/.exec(content().querySelector('path')!.getAttribute('marker-end') ?? '')![1];
    expect(content().querySelector(`[id="${ref}"]`)).not.toBeNull();
    // The heading's own id too.
    expect(content().querySelector('h2')!.id).toBe('minimap-intro');
  });

  it('blocks added or removed redraw the whole copy', async () => {
    const article = mountWith('<p>one</p><p>two</p>');
    const extra = document.createElement('p');
    extra.textContent = 'three';
    article.appendChild(extra);
    await settle();
    expect(Array.from(content().children).map((e) => e.textContent)).toEqual(['one', 'two', 'three']);
    article.firstElementChild!.remove();
    await settle();
    expect(Array.from(content().children).map((e) => e.textContent)).toEqual(['two', 'three']);
  });

  it('while hidden it does no copying, and catches up the moment it is shown', async () => {
    const article = mountWith('<p>one</p><p>two</p>');
    flushSync(() => minimapShown.set(false));
    const before = content().innerHTML;
    article.children[1].textContent = 'two, edited while hidden';
    await settle();
    expect(content().innerHTML).toBe(before);
    minimapShown.set(true);
    // Already there as it starts to slide in.
    expect(content().textContent).toContain('two, edited while hidden');
  });

  it('measures: one edit in a 3000-block document', async () => {
    const blocks = Array.from({ length: 3000 }, (_, i) =>
      `<p>Paragraph ${i} with <em>some</em> words and a <a href="#fn${i}">link</a> to go on.</p>`).join('');
    const article = mountWith(blocks);
    const copy0 = content().children[0];
    const target = article.children[1500];
    // Count the elements copied, and time the whole wait (the copy runs
    // inside it, after the 120 ms debounce).
    let copied = 0;
    const clone = Node.prototype.cloneNode;
    Node.prototype.cloneNode = function (this: Node, deep?: boolean) {
      const c = clone.call(this, deep);
      if (deep && c.nodeType === 1) copied += 1 + (c as Element).getElementsByTagName('*').length;
      return c;
    };
    const runs: number[] = [];
    try {
      for (let k = 0; k < 5; k++) {
        target.textContent = `edit ${k}`;
        const t0 = performance.now();
        await settle();
        runs.push(performance.now() - t0);
      }
    } finally {
      Node.prototype.cloneNode = clone;
    }
    // eslint-disable-next-line no-console
    console.log(`[perf] minimap: one edit in 3000 blocks copies ${copied / 5} elements; 200 ms wait took ${Math.min(...runs).toFixed(0)} ms (best of 5)`);
    expect(content().children[1500].textContent).toBe('edit 4');
    expect(content().children[0]).toBe(copy0);
    expect(copied / 5).toBeLessThan(10);
  });
});
