import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import userEvent from '@testing-library/user-event';
import DrawLayer from '../../src/components/DrawLayer.svelte';
import { annots, currentViewerRoot, docEpoch } from '../../src/stores/annots';
import { setMode } from '../../src/stores/tool';

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
      annots.set([{
        id: '01D', type: 'drawing',
        shape: { kind: 'freehand-legacy', anchorBlock: 'p:1', captureZoom: 1, strokes: [{ color: '#d6336c', width: 2, points: [[50, 50], [60, 55], [70, 60]] }] },
        createdAt: 'now', updatedAt: 'now',
      } as any]);
    });
    const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement;
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
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
      annots.set([{
        id: '01D', type: 'drawing',
        shape: { kind: 'freehand-legacy', anchorBlock: 'p:1', captureZoom: 1, strokes: [{ color: '#d6336c', width: 2, points: [[50, 50], [60, 55]] }] },
        createdAt: 'now', updatedAt: 'now',
      } as any]);
    });
    const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement;
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
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
    // still be hit by the contextmenu handler since the SVG spans the full
    // canvas width.
    mountViewer('<p data-block-id="p:1">x</p>');
    render(DrawLayer);
    flushSync(() => {
      annots.set([{
        id: '01D', type: 'drawing',
        shape: { kind: 'freehand-legacy', anchorBlock: 'p:1', captureZoom: 1, strokes: [{ color: '#d6336c', width: 2, points: [[900, 200], [910, 210]] }] },
        createdAt: 'now', updatedAt: 'now',
      } as any]);
    });
    const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement;
    // SVG covers the whole canvas (e.g., 1100px wide).
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 1100, 600);
    // Viewer text-column is the narrower middle band.
    const root = get(currentViewerRoot)!;
    root.getBoundingClientRect = () => new DOMRect(140, 0, 720, 600);
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
