<script lang="ts">
  import { ulid } from 'ulid';
  import { tool } from '../stores/tool';
  import {
    addAnnotation,
    resolvedAnnots,
    currentViewerRoot,
  } from '../stores/annots';
  import type { Drawing, Stroke } from '../lib/schema';

  const IDLE_MS = 3000;

  type Point = [number, number];
  let drawing = $state(false);
  let currentStroke = $state<Point[]>([]);
  let pendingStrokes = $state<Stroke[]>([]);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Find the block under the centroid by walking from the point.
    const rootRect = root.getBoundingClientRect();
    let el: Element | null = null;
    try { el = document.elementFromPoint(cx + rootRect.left, cy + rootRect.top); } catch {}
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

  function onPointerDown(e: PointerEvent): void {
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
</script>

<svg
  class="draw-overlay"
  class:active={$tool.mode === 'draw'}
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
</style>
