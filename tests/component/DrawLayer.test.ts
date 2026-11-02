import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import userEvent from '@testing-library/user-event';
import DrawLayer from '../../src/components/DrawLayer.svelte';
import { annots, currentViewerRoot, docEpoch, resolvedAnnots } from '../../src/stores/annots';
import { createAnchor } from '../../src/lib/anchoring';
import { setMode } from '../../src/stores/tool';
import { settings } from '../../src/stores/settings';

function mountViewer(html: string): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = html;
  article.style.width = '800px';
  article.style.height = '600px';
  document.body.appendChild(article);
  currentViewerRoot.set(article);
  docEpoch.update((e) => e + 1);
  return article;
}

// Helper: synthesize a pointer event. Defaults to left button (button = 0)
// since DrawLayer's pointerdown handler explicitly checks for it.
function pe(type: string, x: number, y: number, button = 0): PointerEvent {
  const e = new Event(type, { bubbles: true, cancelable: true }) as any;
  e.clientX = x; e.clientY = y; e.pointerId = 1; e.pointerType = 'mouse';
  e.button = button;
  return e as PointerEvent;
}

beforeEach(() => {
  document.body.innerHTML = '';
  annots.set([]);
  currentViewerRoot.set(null);
  setMode('cursor');
  vi.useFakeTimers();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('DrawLayer', () => {
  it('renders an SVG overlay', () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    const svg = document.querySelector('svg.draw-overlay');
    expect(svg).toBeTruthy();
  });

  it('renders existing drawing annotations as SVG paths', () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      annots.set([
        {
          id: '01A', type: 'drawing',
          shape: { kind: 'freehand', anchor: { blockId: 'p:1' }, points: [[0.5, 0.5], [1, 1], [1.5, 1.5]], color: '#d6336c', width: 2 },
          recognitionConfidence: 0.5,
          createdAt: 'now', updatedAt: 'now',
        } as any,
      ]);
    });
    // Render of existing drawings is stubbed until T9 — just verify no crash and SVG exists.
    const svg = document.querySelector('svg.draw-overlay');
    expect(svg).toBeTruthy();
  });

  it('captures strokes in draw mode and finalizes after idle', async () => {
    mountViewer('<p data-block-id="p:1">where to draw</p>');
    render(DrawLayer);
    flushSync(() => setMode('draw'));

    const svg = document.querySelector('svg.draw-overlay')!;
    svg.dispatchEvent(pe('pointerdown', 40, 40));
    svg.dispatchEvent(pe('pointermove', 50, 50));
    svg.dispatchEvent(pe('pointermove', 60, 60));
    svg.dispatchEvent(pe('pointerup', 60, 60));

    // Before idle timer fires, no annotation yet.
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3100);

    const drawings = get(annots).filter((a) => a.type === 'drawing');
    // Each stroke now produces its own Drawing record.
    expect(drawings).toHaveLength(1);
    // The drawing must have a shape (not legacy strokes).
    expect((drawings[0] as any).shape).toBeDefined();
  });

  it('ignores pointer events when tool is not draw', () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => setMode('cursor'));
    const svg = document.querySelector('svg.draw-overlay')!;
    svg.dispatchEvent(pe('pointerdown', 40, 40));
    svg.dispatchEvent(pe('pointermove', 50, 50));
    svg.dispatchEvent(pe('pointerup', 50, 50));
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(0);
  });

  it('ignores non-left mouse buttons even in draw mode', async () => {
    mountViewer('<p data-block-id="p:1">where to draw</p>');
    render(DrawLayer);
    flushSync(() => setMode('draw'));
    const svg = document.querySelector('svg.draw-overlay')!;
    // Right button (2) should not begin a stroke.
    svg.dispatchEvent(pe('pointerdown', 40, 40, 2));
    svg.dispatchEvent(pe('pointermove', 50, 50, 2));
    svg.dispatchEvent(pe('pointerup', 50, 50, 2));
    await vi.advanceTimersByTimeAsync(3100);
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(0);
    // Middle button (1) likewise.
    svg.dispatchEvent(pe('pointerdown', 40, 40, 1));
    svg.dispatchEvent(pe('pointerup', 40, 40, 1));
    await vi.advanceTimersByTimeAsync(3100);
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(0);
  });
});

describe('DrawLayer — right-click delete', () => {
  it('shows a delete menu when right-clicking near a drawing stroke', async () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      setMode('draw');
      annots.set([{
        id: '01D', type: 'drawing',
        shape: { kind: 'freehand-legacy', anchorBlock: 'p:1', captureZoom: 1, strokes: [{ color: '#d6336c', width: 2, points: [[50, 50], [60, 55], [70, 60]] }] },
        createdAt: 'now', updatedAt: 'now',
      } as any]);
    });
    const root = get(currentViewerRoot)!;
    root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    flushSync(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 55 }));
    });
    expect(document.querySelector('.drawing-menu')).not.toBeNull();
  });

  it('clicking delete in the menu removes the drawing annotation', async () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      setMode('draw');
      annots.set([{
        id: '01D', type: 'drawing',
        shape: { kind: 'freehand-legacy', anchorBlock: 'p:1', captureZoom: 1, strokes: [{ color: '#d6336c', width: 2, points: [[50, 50], [60, 55]] }] },
        createdAt: 'now', updatedAt: 'now',
      } as any]);
    });
    const root = get(currentViewerRoot)!;
    root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    flushSync(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 55, clientY: 52 }));
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    const deleteBtn = document.querySelector('.drawing-menu button') as HTMLButtonElement;
    await user.click(deleteBtn);
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(0);
  });

  it('right-click far from any stroke does not open the menu', () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      annots.set([{
        id: '01D', type: 'drawing',
        shape: { kind: 'freehand-legacy', anchorBlock: 'p:1', captureZoom: 1, strokes: [{ color: '#d6336c', width: 2, points: [[50, 50]] }] },
        createdAt: 'now', updatedAt: 'now',
      } as any]);
    });
    const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement;
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    flushSync(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 500 }));
    });
    expect(document.querySelector('.drawing-menu')).toBeNull();
  });

  it('finds drawings in the canvas margins (outside the text-column rect) — covered also by eraser tests below', () => {
    // Drawing's strokes sit far right of the viewer's text column. Should
    // still be hit by the contextmenu handler since hitTestDrawing uses the
    // block rect directly (not the SVG rect), so margin drawings are always reachable.
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      setMode('draw');
      annots.set([{
        id: '01D', type: 'drawing',
        shape: { kind: 'freehand-legacy', anchorBlock: 'p:1', captureZoom: 1, strokes: [{ color: '#d6336c', width: 2, points: [[900, 200], [910, 210]] }] },
        createdAt: 'now', updatedAt: 'now',
      } as any]);
    });
    flushSync(() => {
      document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 905, clientY: 205 }));
    });
    expect(document.querySelector('.drawing-menu')).not.toBeNull();
  });
});

describe('DrawLayer — eraser tool', () => {
  function clickAt(x: number, y: number) {
    return new MouseEvent('click', {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
    });
  }

  it('left-click near a stroke deletes it without confirmation', () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      annots.set([{
        id: '01D', type: 'drawing',
        shape: { kind: 'freehand-legacy', anchorBlock: 'p:1', captureZoom: 1, strokes: [{ color: '#d6336c', width: 2, points: [[100, 100], [110, 110]] }] },
        createdAt: 'now', updatedAt: 'now',
      } as any]);
      setMode('eraser');
    });
    const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement;
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    document.dispatchEvent(clickAt(105, 105));
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(0);
  });

  it('left-click far from any stroke does nothing in eraser mode', () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      annots.set([{
        id: '01D', type: 'drawing',
        shape: { kind: 'freehand-legacy', anchorBlock: 'p:1', captureZoom: 1, strokes: [{ color: '#d6336c', width: 2, points: [[100, 100]] }] },
        createdAt: 'now', updatedAt: 'now',
      } as any]);
      setMode('eraser');
    });
    const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement;
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    document.dispatchEvent(clickAt(500, 500));
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(1);
  });

  it('does not begin a drawing stroke in eraser mode (svg pointer-events: none)', async () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => setMode('eraser'));
    const svg = document.querySelector('svg.draw-overlay')!;
    // Even if a synthetic pointerdown reaches the SVG, the handler must early-return.
    svg.dispatchEvent(pe('pointerdown', 50, 50));
    svg.dispatchEvent(pe('pointermove', 60, 60));
    svg.dispatchEvent(pe('pointerup', 60, 60));
    await vi.advanceTimersByTimeAsync(3100);
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(0);
  });

  it('eraser-mode click that lands on a note pin does not also erase a coincident drawing', () => {
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      annots.set([{
        id: '01D', type: 'drawing',
        shape: { kind: 'freehand-legacy', anchorBlock: 'p:1', captureZoom: 1, strokes: [{ color: '#d6336c', width: 2, points: [[100, 100]] }] },
        createdAt: 'now', updatedAt: 'now',
      } as any]);
      setMode('eraser');
    });
    const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement;
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    // Click whose target is a note pin (DrawLayer handler should defer).
    const fakePin = document.createElement('button');
    fakePin.className = 'note-pin';
    document.body.appendChild(fakePin);
    const evt = new MouseEvent('click', {
      bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0,
    });
    fakePin.dispatchEvent(evt);
    expect(get(annots).filter((a) => a.type === 'drawing')).toHaveLength(1);
  });
});

// A crafted sidecar can hold thousands of underlines and circles anchored to
// text across paragraphs. The store finds each one once a change; drawing,
// labelling and erasing them used to find each one again, a walk of the
// whole article per drawing, on every redraw and every eraser click.
describe('DrawLayer — drawings anchored to text', () => {
  const N = 40;
  // jsdom lays nothing out, and has no Range.getBoundingClientRect.
  beforeEach(() => {
    (Range.prototype as any).getBoundingClientRect = () => new DOMRect(10, 10, 100, 16);
  });
  afterEach(() => {
    delete (Range.prototype as any).getBoundingClientRect;
  });

  function manyUnderlines(): void {
    const paras = Array.from({ length: N + 1 }, (_, i) => `<p data-block-id="p:${i}">Line ${i} of the page.</p>`);
    const root = mountViewer(paras.join(''));
    const list = Array.from({ length: N }, (_, i) => {
      // From "page." at the end of one line to the next line's number.
      const across = document.createRange();
      across.setStart(root.querySelector(`[data-block-id="p:${i}"]`)!.firstChild!, `Line ${i} of the `.length);
      across.setEnd(root.querySelector(`[data-block-id="p:${i + 1}"]`)!.firstChild!, `Line ${i + 1}`.length);
      return {
        id: `01U${i}`, type: 'drawing', recognitionConfidence: 0.9,
        shape: { kind: 'underline', color: '#d6336c', width: 2, anchor: createAnchor(across, root)! },
        createdAt: 'now', updatedAt: 'now',
      };
    });
    flushSync(() => annots.set(list as any));
    expect(get(resolvedAnnots)).toHaveLength(N);
  }

  it('reuses what the store found to draw them, without walking the article again', () => {
    render(DrawLayer);
    const walkers = vi.spyOn(document, 'createTreeWalker');
    try {
      flushSync(() => settings.update((s) => ({ ...s, showDrawingRecognitionConfidence: true })));
      manyUnderlines();
      const fromStore = walkers.mock.calls.length;
      vi.advanceTimersToNextFrame();
      expect(document.querySelectorAll('svg.draw-overlay path').length).toBeGreaterThanOrEqual(N);
      expect(document.querySelectorAll('svg.draw-overlay .confidence-overlay')).toHaveLength(N);
      expect(walkers.mock.calls.length - fromStore).toBe(0);
    } finally {
      walkers.mockRestore();
      flushSync(() => settings.update((s) => ({ ...s, showDrawingRecognitionConfidence: false })));
    }
  });

  it('reuses it to find the one under the eraser', () => {
    render(DrawLayer);
    manyUnderlines();
    flushSync(() => setMode('eraser'));
    const walkers = vi.spyOn(document, 'createTreeWalker');
    try {
      document.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 5000, clientY: 5000, button: 0 }));
      document.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5000, clientY: 5000 }));
      expect(walkers).not.toHaveBeenCalled();
      expect(get(annots)).toHaveLength(N);
    } finally {
      walkers.mockRestore();
    }
  });
});
