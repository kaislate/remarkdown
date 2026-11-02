<script lang="ts">
  import { ulid } from 'ulid';
  import rough from 'roughjs';
  import { get } from 'svelte/store';
  import { tool } from '../stores/tool';
  import { settings } from '../stores/settings';
  import { addToast } from '../stores/toasts';
  import {
    annots,
    addAnnotation,
    removeAnnotation,
    resolvedAnnots,
    currentViewerRoot,
  } from '../stores/annots';
  import { withinLoadLimits } from '../lib/sidecar';
  import { recognize, recognizeAsFreehand, arrowFromStrokes } from '../lib/drawing-recognize';
  import { createDrawingPainter } from '../lib/drawing-layer';
  import { hitTestDrawing } from '../lib/drawing-hit-test';
  import { zoomLevel } from '../stores/ui';
  import { readerMode } from '../stores/reader-mode';
  import type { Drawing, Stroke } from '../lib/schema';

  // Idle finalize duration is sourced from the settings store so the user can
  // tune it. Read at the moment startIdle() schedules its timer — changing the
  // setting affects the next idle cycle.

  type Point = [number, number];
  let drawSvg = $state<SVGSVGElement | null>(null);
  let stableLayer = $state<SVGGElement | null>(null);
  let liveLayer = $state<SVGGElement | null>(null);
  let resizeTick = $state(0);
  let drawing = $state(false);
  // The stroke being drawn: a plain array, its points added in place, with
  // a counter that says it grew (copying a long stroke's points, deep in
  // reactive state, on every pointer move made each move slower than the
  // last). Points aren't changed once added, and a finished stroke's array
  // is handed on whole: the next stroke starts a new one.
  let currentStroke = $state.raw<Point[]>([]);
  let strokeGrew = $state(0);
  // Only ever replaced, never changed in place.
  let pendingStrokes = $state.raw<Stroke[]>([]);
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
    const toViewport = (stroke: Stroke): Array<[number, number]> =>
      stroke.points.map(([x, y]) => [x + svgRect.left, y + svgRect.top]);
    // An arrow drawn in several strokes (a shaft, then its head) becomes one
    // drawing; the strokes it used aren't recognised on their own.
    const jobs: Array<{ stroke: Stroke; result: ReturnType<typeof recognize> }> = [];
    let rest = [...pendingStrokes];
    while ($settings.autoTransformDrawings && rest.length > 1) {
      const arrow = arrowFromStrokes(rest.map(toViewport));
      if (!arrow) break;
      jobs.push({ stroke: rest[arrow.used[0]], result: recognizeAsFreehand([arrow.tail, arrow.tip], root, 0.7, 'arrow') });
      rest = rest.filter((_, i) => !arrow.used.includes(i));
    }
    for (const stroke of rest) {
      const viewportPoints = toViewport(stroke);
      jobs.push({
        stroke,
        result: $settings.autoTransformDrawings
          ? recognize(viewportPoints, root)
          : recognizeAsFreehand(viewportPoints, root, 1.0),
      });
    }

    let full = false;
    for (const { stroke, result } of jobs) {

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
            ...(result.drawn ? { drawn: result.drawn } : {}),
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
      // A sidecar with more drawing than this wouldn't load again, and a
      // refused one hides every highlight and note with it.
      if (!withinLoadLimits([...get(annots), drawingAnnot])) {
        full = true;
        continue;
      }
      addAnnotation(drawingAnnot);
    }
    pendingStrokes = [];
    if (full) {
      addToast({ kind: 'warning', message: 'This document has as much drawing as it can hold. Erase some to draw more.' });
    }
  }

  function eraseStrokeAt(clientX: number, clientY: number): boolean {
    const root = $currentViewerRoot;
    if (!root) return false;
    for (const { d, range } of existingDrawings) {
      if (hitTestDrawing(d, clientX, clientY, root, $zoomLevel, range)) {
        removeAnnotation(d.id);
        return true;
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
    currentStroke.push([e.clientX - rect.left, e.clientY - rect.top]);
    strokeGrew += 1;
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

  // Existing drawings rendered from resolved annotations, with the range the
  // store found for those anchored to text (null for the others), so they
  // aren't searched for again on every redraw and eraser click.
  const existingDrawings = $derived(
    $resolvedAnnots
      .filter((r) => r.annotation.type === 'drawing')
      .map((r) => ({ d: r.annotation as Drawing, range: r.range as Range | null })),
  );

  // Paints the stable layer, keeping each drawing's shapes until what
  // they're drawn from changes (see lib/drawing-layer.ts).
  const paintStable = createDrawingPainter();

  // Re-finalize if tool changes away from draw while strokes pending.
  $effect(() => {
    if ($tool.mode !== 'draw' && pendingStrokes.length > 0) {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      finalize();
    }
  });

  $effect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => { resizeTick += 1; };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // Stable layer: existing drawings + pending (already-released) strokes.
  // Re-renders only when these or layout-affecting state changes.
  $effect(() => {
    void $zoomLevel;
    void $settings.articleWidth;
    void $readerMode; // reader typography reflows the column
    void $settings.showDrawingRecognitionConfidence;
    void $settings.drawingRoughness;
    void $resolvedAnnots;
    void resizeTick;
    void pendingStrokes;
    const svg = drawSvg;
    const layer = stableLayer;
    const root = $currentViewerRoot;
    if (!svg || !layer || !root) return;
    const id = requestAnimationFrame(() => {
      paintStable(layer, svg, root, existingDrawings, pendingStrokes, {
        zoom: $zoomLevel,
        roughness: $settings.drawingRoughness,
        showConfidence: $settings.showDrawingRecognitionConfidence,
      });
    });
    return () => cancelAnimationFrame(id);
  });

  // Live layer: in-progress stroke only. Re-renders on every pointermove
  // (which is what we want for the live preview), but doesn't touch the
  // stable layer.
  $effect(() => {
    void drawing;
    void currentStroke;
    void strokeGrew;
    void $tool.drawColor;
    void $settings.drawingRoughness;
    const svg = drawSvg;
    const layer = liveLayer;
    if (!svg || !layer) return;
    const id = requestAnimationFrame(() => {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      if (drawing && currentStroke.length >= 2) {
        const rc = rough.svg(svg);
        const node = rc.curve(currentStroke as Array<[number, number]>, {
          stroke: $tool.drawColor, strokeWidth: 2,
          roughness: $settings.drawingRoughness,
          bowing: Math.min(1.4, $settings.drawingRoughness),
          seed: 1,
        });
        layer.appendChild(node);
      }
    });
    return () => cancelAnimationFrame(id);
  });

  function onContextMenu(e: MouseEvent): void {
    if ($tool.mode !== 'draw' && $tool.mode !== 'eraser') return;
    const root = $currentViewerRoot;
    if (!root) return;
    for (const { d, range } of existingDrawings) {
      if (hitTestDrawing(d, e.clientX, e.clientY, root, $zoomLevel, range)) {
        e.preventDefault();
        e.stopPropagation();
        menuForId = d.id;
        menuPos = { x: e.clientX, y: e.clientY };
        return;
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
  bind:this={drawSvg}
  class="draw-overlay"
  class:active={$tool.mode === 'draw'}
  role="presentation"
  aria-hidden="true"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  <g bind:this={stableLayer}></g>
  <g bind:this={liveLayer}></g>
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
  :global(.confidence-overlay) {
    font-family: var(--font-mono);
    font-size: 9px;
    fill: rgba(255, 255, 255, 0.4);
    pointer-events: none;
  }
</style>
