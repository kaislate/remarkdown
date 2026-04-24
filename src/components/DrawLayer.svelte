<script lang="ts">
  import { ulid } from 'ulid';
  import { tool } from '../stores/tool';
  import {
    addAnnotation,
    removeAnnotation,
    resolvedAnnots,
    currentViewerRoot,
  } from '../stores/annots';
  import type { Drawing, Stroke } from '../lib/schema';

  const IDLE_MS = 3000;
  const HIT_TOLERANCE_PX = 12;

  type Point = [number, number];
  let drawing = $state(false);
  let currentStroke = $state<Point[]>([]);
  let pendingStrokes = $state<Stroke[]>([]);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  let menuForId = $state<string | null>(null);
  let menuPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

  function startIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(finalize, IDLE_MS);
  }

  function finalize(): void {
    if (pendingStrokes.length === 0) return;
    const root = $currentViewerRoot;
    if (!root) { pendingStrokes = []; return; }

    // Compute centroid of all points across all strokes.
    let sx = 0, sy = 0, n = 0;
    for (const s of pendingStrokes) for (const [x, y] of s.points) { sx += x; sy += y; n += 1; }
    const cx = n > 0 ? sx / n : 0;
    const cy = n > 0 ? sy / n : 0;

    // Find the block under the centroid by walking from the point. The SVG
    // now spans the full canvas (wider than the text viewer), so convert the
    // stroke-local centroid using the SVG's own bounding rect, not the viewer's.
    const svgEl = document.querySelector<SVGSVGElement>('svg.draw-overlay');
    const sourceRect = svgEl ? svgEl.getBoundingClientRect() : root.getBoundingClientRect();
    let el: Element | null = null;
    try { el = document.elementFromPoint(cx + sourceRect.left, cy + sourceRect.top); } catch {}
    const block = el?.closest?.<HTMLElement>('[data-block-id]') ??
      root.querySelector<HTMLElement>('[data-block-id]');
    const blockId = block?.dataset.blockId ?? 'p:1';

    const now = new Date().toISOString();
    const drawingAnnot: Drawing = {
      id: ulid(),
      type: 'drawing',
      anchorBlock: blockId,
      strokes: pendingStrokes,
      createdAt: now,
      updatedAt: now,
    };
    addAnnotation(drawingAnnot);
    pendingStrokes = [];
  }

  function eraseAt(e: PointerEvent | MouseEvent): boolean {
    const svg = document.querySelector<SVGSVGElement>('svg.draw-overlay');
    if (!svg) return false;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (const d of existingDrawings) {
      for (const s of d.strokes) {
        if (strokePointDistance(x, y, s.points as [number, number, ...number[]][]) <= HIT_TOLERANCE_PX) {
          removeAnnotation(d.id);
          return true;
        }
      }
    }
    return false;
  }

  function onPointerDown(e: PointerEvent): void {
    // Left-button only. Right-click reaches the contextmenu handler for delete;
    // middle-click is reserved for browsers/users.
    if (e.button !== 0) return;

    if ($tool.mode === 'eraser') {
      eraseAt(e);
      return;
    }

    if ($tool.mode !== 'draw') return;
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    try { (svg as unknown as Element).setPointerCapture(e.pointerId); } catch {}
    drawing = true;
    currentStroke = [[e.clientX - rect.left, e.clientY - rect.top]];
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drawing) return;
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    currentStroke = [...currentStroke, [e.clientX - rect.left, e.clientY - rect.top]];
  }

  function onPointerUp(_e: PointerEvent): void {
    if (!drawing) return;
    drawing = false;
    if (currentStroke.length >= 2) {
      pendingStrokes = [
        ...pendingStrokes,
        { color: $tool.drawColor, width: 2, points: currentStroke },
      ];
    }
    currentStroke = [];
    startIdle();
  }

  // Re-finalize if tool changes away from draw while strokes pending.
  $effect(() => {
    if ($tool.mode !== 'draw' && pendingStrokes.length > 0) {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      finalize();
    }
  });

  function pathD(points: Point[]): string {
    if (points.length === 0) return '';
    const [first, ...rest] = points;
    return `M ${first[0]} ${first[1]} ` + rest.map(([x, y]) => `L ${x} ${y}`).join(' ');
  }

  // Existing drawings rendered from resolved annotations.
  const existingDrawings = $derived(
    $resolvedAnnots
      .filter((r) => r.annotation.type === 'drawing')
      .map((r) => r.annotation as Drawing),
  );

  function strokePointDistance(px: number, py: number, points: [number, number, ...number[]][]): number {
    let min = Infinity;
    for (const [x, y] of points) {
      const d = Math.hypot(px - x, py - y);
      if (d < min) min = d;
    }
    return min;
  }

  function onContextMenu(e: MouseEvent): void {
    const svg = document.querySelector('svg.draw-overlay') as SVGSVGElement | null;
    if (!svg) return;
    // Bound the search to the SVG's full extent — drawings can sit anywhere
    // on the canvas (including margins that aren't part of the text column),
    // and they should still be deletable from there.
    const rect = svg.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right ||
        e.clientY < rect.top || e.clientY > rect.bottom) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (const d of existingDrawings) {
      for (const s of d.strokes) {
        if (strokePointDistance(x, y, s.points as [number, number, ...number[]][]) <= HIT_TOLERANCE_PX) {
          e.preventDefault();
          menuForId = d.id;
          menuPos = { x: e.clientX, y: e.clientY };
          return;
        }
      }
    }
  }

  function closeMenu(): void { menuForId = null; }

  function deleteDrawing(): void {
    if (!menuForId) return;
    removeAnnotation(menuForId);
    menuForId = null;
  }

  $effect(() => {
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('click', closeMenu);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('click', closeMenu);
    };
  });
</script>

<svg
  class="draw-overlay"
  class:active={$tool.mode === 'draw'}
  class:eraser={$tool.mode === 'eraser'}
  role="presentation"
  aria-hidden="true"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  {#each existingDrawings as d (d.id)}
    {#each d.strokes as s, i (i)}
      <path d={pathD(s.points as Point[])} stroke={s.color} stroke-width={s.width} fill="none" stroke-linecap="round" stroke-linejoin="round" />
    {/each}
  {/each}
  {#each pendingStrokes as s, i (i)}
    <path d={pathD(s.points as Point[])} stroke={s.color} stroke-width={s.width} fill="none" stroke-linecap="round" stroke-linejoin="round" />
  {/each}
  {#if drawing}
    <path d={pathD(currentStroke)} stroke={$tool.drawColor} stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
  {/if}
</svg>

{#if menuForId}
  <div
    class="drawing-menu glass"
    role="menu"
    style="top:{menuPos.y}px; left:{menuPos.x}px"
  >
    <button role="menuitem" onclick={deleteDrawing}>Delete drawing</button>
  </div>
{/if}

<style>
  .draw-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .draw-overlay.active {
    pointer-events: auto;
    cursor: crosshair;
  }
  .draw-overlay.eraser {
    pointer-events: auto;
    /* `cell` reads as a precise targeting cursor — appropriate for picking
       individual strokes to delete. */
    cursor: cell;
  }
  .drawing-menu {
    position: fixed;
    padding: 4px;
    min-width: 160px;
    z-index: 250;
  }
  .drawing-menu button {
    background: transparent;
    border: 0;
    color: var(--fg-0);
    font-family: var(--font-sans);
    font-size: 13px;
    padding: 8px 10px;
    text-align: left;
    width: 100%;
    border-radius: 6px;
    cursor: pointer;
  }
  .drawing-menu button:hover { background: var(--accent-soft); }
</style>
