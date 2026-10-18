// Text-anchored annotations (highlights, notes) can't be anchored to a
// diagram's text: the svg is re-generated on every render (theme
// switch, reload), so the anchor never resolves again — and the
// anchor's context used to capture the svg's inline CSS. The tools now
// decline with a hint pointing at the pen, which does work on diagrams.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { flushSync } from 'svelte';
import userEvent from '@testing-library/user-event';
import HighlightLayer from '../../src/components/HighlightLayer.svelte';
import NoteLayer from '../../src/components/NoteLayer.svelte';
import { annots, currentViewerRoot, docEpoch } from '../../src/stores/annots';
import { setMode } from '../../src/stores/tool';
import { toasts, clearToasts } from '../../src/stores/toasts';
import { rangeTouchesDiagram } from '../../src/lib/anchoring';

const HTML =
  '<p data-block-id="p:1">Before the diagram.</p>' +
  '<div class="mermaid-block" data-block-id="div:2" data-mermaid="flowchart TD">' +
  '<svg><style>#x{fill:red}</style><g class="node"><foreignObject><span>Ship it</span></foreignObject></g></svg>' +
  '</div>' +
  '<p data-block-id="p:3">After the diagram.</p>';

function mountViewer(): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = HTML;
  document.body.appendChild(article);
  currentViewerRoot.set(article);
  docEpoch.update((e) => e + 1);
  return article;
}

function textRange(root: HTMLElement, selector: string, needle: string): Range {
  const el = root.querySelector(selector)!;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const i = (n as Text).data.indexOf(needle);
    if (i >= 0) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      return r;
    }
  }
  throw new Error(`no ${needle}`);
}

function select(range: Range): void {
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

beforeEach(() => {
  document.body.innerHTML = '';
  annots.set([]);
  currentViewerRoot.set(null);
  setMode('cursor');
  clearToasts();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('rangeTouchesDiagram', () => {
  it('is true when a range starts or ends inside a diagram', () => {
    const root = mountViewer();
    expect(rangeTouchesDiagram(textRange(root, '.mermaid-block', 'Ship it'))).toBe(true);
    const intoDiagram = document.createRange();
    intoDiagram.setStart(root.querySelector('p')!.firstChild!, 0);
    intoDiagram.setEnd(textRange(root, '.mermaid-block', 'Ship it').endContainer, 3);
    expect(rangeTouchesDiagram(intoDiagram)).toBe(true);
  });

  // Review finding: selecting several paragraphs with a diagram between
  // them was refused too, which main allowed.
  it('is false for a range that merely spans across a diagram', () => {
    const root = mountViewer();
    const span = document.createRange();
    span.setStart(root.querySelector('p')!.firstChild!, 0);
    span.setEnd(root.querySelectorAll('p')[1].firstChild!, 5);
    expect(rangeTouchesDiagram(span)).toBe(false);
  });

  it('is false for ordinary text', () => {
    const root = mountViewer();
    expect(rangeTouchesDiagram(textRange(root, 'p', 'Before'))).toBe(false);
  });
});

describe('highlight tool on a diagram', () => {
  it('creates no annotation and shows the pen hint', () => {
    const root = mountViewer();
    render(HighlightLayer);
    setMode('highlight');
    select(textRange(root, '.mermaid-block', 'Ship it'));
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(get(annots)).toEqual([]);
    expect(get(toasts).map((t) => t.message)).toEqual(['Use the pen to mark up diagrams.']);
    expect(window.getSelection()!.isCollapsed || window.getSelection()!.rangeCount === 0).toBe(true);
  });

  it('still highlights ordinary text', () => {
    const root = mountViewer();
    render(HighlightLayer);
    setMode('highlight');
    select(textRange(root, 'p', 'Before'));
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    expect(get(annots).length).toBe(1);
    expect(get(toasts)).toEqual([]);
  });
});

describe('note tool on a diagram', () => {
  it('creates no note and shows the pen hint', async () => {
    const root = mountViewer();
    render(NoteLayer);
    flushSync(() => setMode('note'));
    const user = userEvent.setup();
    await user.click(root.querySelector('.mermaid-block span')!);
    expect(get(annots)).toEqual([]);
    expect(get(toasts).map((t) => t.message)).toEqual(['Use the pen to mark up diagrams.']);
  });
});
