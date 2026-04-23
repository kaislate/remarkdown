import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
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

// Helper: synthesize a pointer event.
function pe(type: string, x: number, y: number): PointerEvent {
  const e = new Event(type, { bubbles: true, cancelable: true }) as any;
  e.clientX = x; e.clientY = y; e.pointerId = 1; e.pointerType = 'mouse';
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
          id: '01A', type: 'drawing', anchorBlock: 'p:1',
          strokes: [{ color: '#d6336c', width: 2, points: [[10, 10], [20, 20], [30, 30]] }],
          createdAt: 'now', updatedAt: 'now',
        },
      ]);
    });
    const paths = document.querySelectorAll('svg.draw-overlay path');
    expect(paths.length).toBeGreaterThan(0);
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
    expect(drawings).toHaveLength(1);
    expect((drawings[0] as any).strokes).toHaveLength(1);
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
});
