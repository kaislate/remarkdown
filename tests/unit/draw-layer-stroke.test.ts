import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DrawLayer from '../../src/components/DrawLayer.svelte';
import { setMode } from '../../src/stores/tool';

// A pen stroke's points arrive one pointer move at a time, 120-240 a
// second. Each move should cost the same however long the stroke already
// is: copying every point so far on each move made a long stroke's moves
// cost quadratic time, and the ink lagged the pen toward its end.

let app: ReturnType<typeof mount> | null = null;

beforeEach(() => {
  app = mount(DrawLayer, { target: document.body });
  setMode('draw');
  flushSync();
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  setMode('cursor');
  document.body.innerHTML = '';
});

function pointer(svg: Element, type: string, x: number, y: number): void {
  svg.dispatchEvent(new MouseEvent(type, { button: 0, buttons: 1, clientX: x, clientY: y, bubbles: true }));
}

// Milliseconds the moves of one stroke of `n` points take.
function stroke(n: number): number {
  const svg = document.querySelector('svg.draw-overlay')!;
  pointer(svg, 'pointerdown', 10, 10);
  const t = performance.now();
  for (let i = 1; i < n; i++) pointer(svg, 'pointermove', 10 + (i % 300), 10 + i / 10);
  const took = performance.now() - t;
  pointer(svg, 'pointerup', 10, 10);
  flushSync();
  return took;
}

describe('a long pen stroke', () => {
  it('costs the same per point however long the stroke is', () => {
    stroke(200); // warm up
    const short = stroke(500);
    const long = stroke(2000);
    // Four times the points: about four times the time (it was ~16x).
    expect(long).toBeLessThan(Math.max(8 * short, 200));
  });
});
