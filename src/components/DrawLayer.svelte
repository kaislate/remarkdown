<script lang="ts">
  import { ulid } from 'ulid';
  import { tool } from '../stores/tool';
  import { settings } from '../stores/settings';
  import {
    addAnnotation,
    removeAnnotation,
    resolvedAnnots,
    currentViewerRoot,
  } from '../stores/annots';
  import { recognize } from '../lib/drawing-recognize';
  import type { Drawing, Stroke } from '../lib/schema';

  // Idle finalize duration is sourced from the settings store so the user can
  // tune it. Read at the moment startIdle() schedules its timer — changing the
  // setting affects the next idle cycle.
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
    idleTimer = setTimeout(finalize, $settings.drawIdleFinalizeMs);
  }

  function finalize(): void {
    if (pendingStrokes.length === 0) return;
    const root = $currentViewerRoot;
    if (!root) { pendingStrokes = []; return; }

    // Stroke points are captured in SVG-LOCAL coordinates. recognize() needs
    // VIEWPORT coordinates (because it queries getBoundingClientRect on text
    // ranges + blocks, which return viewport coords). Translate via the SVG's
    // own bounding rect.
    const svgEl = document.querySelector<SVGSVGElement>('svg.draw-overlay');
    const svgRect = svgEl ? svgEl.getBoundingClientRect() : root.getBoundingClientRect();

    const now = new Date().toISOString();
    for (const stroke of pendingStrokes) {
      const viewportPoints: Array<[number, number]> = stroke.points.map(
        ([x, y]) => [x + svgRect.left, y + svgRect.top],
      );
      const result = recognize(viewportPoints, root);

      let shape: Drawing['shape'];
      switch (result.kind) {
        case 'circle':
        case 'rectangle':
        case 'underline':
        case 'strikethrough':
          shape = { kind: result.kind, anchor: result.anchor, color: stroke.color, width: stroke.width };
          break;
        case 'circle-empty':
          shape = {
            kind: 'circle-empty',
            anchor: result.anchor,
            radiusXEm: result.radiusXEm,
            radiusYEm: result.radiusYEm,
            color: stroke.color,
            width: stroke.width,
          };
          break;
        case 'margin-bar':
          shape = { kind: 'margin-bar', anchor: result.anchor, color: stroke.color, width: stroke.width };
          break;
        case 'freehand':
          shape = {
            kind: 'freehand',
            anchor: result.anchor,
            points: result.points,
            color: stroke.color,
            width: stroke.width,
          };
          break;
      }

      const drawingAnnot: Drawing = {
        id: ulid(),
        type: 'drawing',
        shape,
        recognitionConfidence: result.recognitionConfidence,
        createdAt: now,
        updatedAt: now,
      };
      addAnnotation(drawingAnnot);
    }
    pendingStrokes = [];
  }

  function eraseStrokeAt(clientX: number, clientY: number): boolean {
    const svg = document.querySelector<SVGSVGElement>('svg.draw-overlay');
    if (!svg) return false;
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    for (const d of existingDrawings) {
      // T10 will replace this with shape-aware hit testing. For now, only
      // freehand-legacy drawings (pre-migration) are erasable here.
      if (d.shape.kind === 'freehand-legacy') {
        for (const s of d.shape.strokes) {
          if (strokePointDistance(x, y, s.points as [number, number, ...number[]][]) <= HIT_TOLERANCE_PX) {
            removeAnnotation(d.id);
            return true;
          }
        }
      }
    }
    return false;
  }

  function onPointerDown(e: PointerEvent): void {
    // Left-button only. Right-click reaches the contextmenu handler for delete;
    // middle-click is reserved for browsers/users.
    if (e.button !== 0) return;
    // Eraser mode: SVG is pointer-events:none — handled by the document-level
    // capture handler below so pin clicks and highlight clicks aren't blocked.
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
      // T10 will replace this with shape-aware hit testing. For now, only
      // freehand-legacy drawings (pre-migration) support right-click delete here.
      if (d.shape.kind === 'freehand-legacy') {
        for (const s of d.shape.strokes) {
          if (strokePointDistance(x, y, s.points as [number, number, ...number[]][]) <= HIT_TOLERANCE_PX) {
            e.preventDefault();
            menuForId = d.id;
            menuPos = { x: e.clientX, y: e.clientY };
            return;
          }
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

  function onDocClickEraser(e: MouseEvent): void {
    if ($tool.mode !== 'eraser') return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // Defer to the pin's own onclick (NoteLayer handles note erasure).
    if (target?.closest?.('.note-pin')) return;
    if (eraseStrokeAt(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  $effect(() => {
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('click', closeMenu);
    document.addEventListener('click', onDocClickEraser, true);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('click', onDocClickEraser, true);
    };
  });
</script>

<svg
  class="draw-overlay"
  class:active={$tool.mode === 'draw'}
  role="presentation"
  aria-hidden="true"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  <!-- render moved to T9: existing drawings will be rendered via rough.js per shape kind -->
  {#each existingDrawings as _d (_d.id)}{/each}
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
  /* In eraser mode the SVG stays pointer-events: none so clicks reach pins,
     text, and other layers. Eraser-mode stroke deletion is handled by a
     document-level capture listener (see onDocClickEraser in the script). */
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
