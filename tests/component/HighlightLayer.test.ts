import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { flushSync } from 'svelte';
import userEvent from '@testing-library/user-event';
import HighlightLayer from '../../src/components/HighlightLayer.svelte';
import { annots, currentViewerRoot, docEpoch } from '../../src/stores/annots';
import { setMode, HIGHLIGHT_COLORS } from '../../src/stores/tool';

function mountViewer(html: string): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = html;
  document.body.appendChild(article);
  currentViewerRoot.set(article);
  docEpoch.update((e) => e + 1);
  return article;
}

beforeEach(() => {
  document.body.innerHTML = '';
  annots.set([]);
  currentViewerRoot.set(null);
  setMode('cursor');
  (CSS.highlights as unknown as Map<string, unknown>).clear();
});

afterEach(() => { document.body.innerHTML = ''; });

describe('HighlightLayer — rendering existing highlights', () => {
  it('registers a Highlight for each resolved highlight annotation', () => {
    mountViewer('<p data-block-id="p:1">Hello the world here.</p>');
    render(HighlightLayer);
    annots.set([
      {
        id: '01A', type: 'highlight', color: HIGHLIGHT_COLORS[0],
        anchor: { text: 'the world', prefix: 'Hello ', suffix: ' here.', blockHint: 'p:1' },
        createdAt: 'now', updatedAt: 'now',
      },
    ]);
    const hl = (CSS.highlights as any).get('rmd-hl-0');
    expect(hl).toBeDefined();
    expect(hl.ranges.size).toBe(1);
  });

  it('uses the right named highlight per color', () => {
    mountViewer('<p data-block-id="p:1">aaaa bbbb cccc</p>');
    render(HighlightLayer);
    annots.set([
      {
        id: '01A', type: 'highlight', color: HIGHLIGHT_COLORS[0],
        anchor: { text: 'aaaa', prefix: '', suffix: ' bbbb', blockHint: 'p:1' },
        createdAt: 'now', updatedAt: 'now',
      },
      {
        id: '01B', type: 'highlight', color: HIGHLIGHT_COLORS[3],
        anchor: { text: 'cccc', prefix: 'bbbb ', suffix: '', blockHint: 'p:1' },
        createdAt: 'now', updatedAt: 'now',
      },
    ]);
    expect((CSS.highlights as any).get('rmd-hl-0').ranges.size).toBe(1);
    expect((CSS.highlights as any).get('rmd-hl-3').ranges.size).toBe(1);
  });
});

describe('HighlightLayer — creating highlights from selection', () => {
  it('adds a highlight annotation when user finishes a selection in highlight mode', async () => {
    const root = mountViewer('<p data-block-id="p:1">select me now</p>');
    render(HighlightLayer);
    setMode('highlight');

    const tn = root.querySelector('p')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(tn, tn.data.indexOf('select me'));
    range.setEnd(tn, tn.data.indexOf('select me') + 'select me'.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    const list = get(annots);
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('highlight');
    expect((list[0] as any).anchor.text).toBe('select me');
  });

  it('does not add a highlight when tool mode is not highlight', () => {
    const root = mountViewer('<p data-block-id="p:1">nothing happens</p>');
    render(HighlightLayer);
    setMode('cursor');

    const tn = root.querySelector('p')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 7);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(get(annots)).toHaveLength(0);
  });

  it('ignores an empty selection', () => {
    const root = mountViewer('<p data-block-id="p:1">nothing</p>');
    render(HighlightLayer);
    setMode('highlight');
    window.getSelection()!.removeAllRanges();
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(get(annots)).toHaveLength(0);
  });
});

describe('HighlightLayer — right-click delete', () => {
  it('shows a delete menu when right-clicking on a highlighted range', async () => {
    const root = mountViewer('<p data-block-id="p:1">Hello the world here.</p>');
    render(HighlightLayer);
    annots.set([{
      id: '01A', type: 'highlight', color: HIGHLIGHT_COLORS[0],
      anchor: { text: 'the world', prefix: 'Hello ', suffix: ' here.', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);

    // Mock caretPositionFromPoint to land inside "the world".
    const tn = root.querySelector('p')!.firstChild as Text;
    const idx = tn.data.indexOf('the world') + 2; // middle of "the world"
    (document as any).caretPositionFromPoint = () => ({ offsetNode: tn, offset: idx });

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 });
    flushSync(() => root.dispatchEvent(evt));

    const menu = document.querySelector('.highlight-menu');
    expect(menu).not.toBeNull();
  });

  it('clicking the delete menu item removes the highlight', async () => {
    const root = mountViewer('<p data-block-id="p:1">Hello the world here.</p>');
    render(HighlightLayer);
    annots.set([{
      id: '01A', type: 'highlight', color: HIGHLIGHT_COLORS[0],
      anchor: { text: 'the world', prefix: 'Hello ', suffix: ' here.', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);

    const tn = root.querySelector('p')!.firstChild as Text;
    const idx = tn.data.indexOf('the world') + 2;
    (document as any).caretPositionFromPoint = () => ({ offsetNode: tn, offset: idx });

    flushSync(() => root.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
    const user = userEvent.setup();
    const deleteBtn = document.querySelector('.highlight-menu button') as HTMLButtonElement;
    await user.click(deleteBtn);
    expect(get(annots)).toHaveLength(0);
  });

  it('right-click outside any highlight does nothing', () => {
    const root = mountViewer('<p data-block-id="p:1">nothing highlighted here.</p>');
    render(HighlightLayer);
    annots.set([]);
    (document as any).caretPositionFromPoint = () => null;
    root.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    expect(document.querySelector('.highlight-menu')).toBeNull();
  });
});
