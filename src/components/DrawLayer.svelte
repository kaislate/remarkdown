<script lang="ts">
  import { ulid } from 'ulid';
  import rough from 'roughjs';
  import { tool } from '../stores/tool';
  import { settings } from '../stores/settings';
  import {
    addAnnotation,
    removeAnnotation,
    resolvedAnnots,
    currentViewerRoot,
  } from '../stores/annots';
  import { recognize } from '../lib/drawing-recognize';
  import { renderDrawing } from '../lib/drawing-render';
  import { resolveAnchor } from '../lib/anchoring';
  import { hitTestDrawing } from '../lib/drawing-hit-test';
  import { zoomLevel } from '../stores/ui';
  import type { Drawing, Stroke } from '../lib/schema';

  // Idle finalize duration is sourced from the settings store so the user can
  // tune it. Read at the moment startIdle() schedules its timer — changing the
  // setting affects the next idle cycle.

  type Point = [number, number];
  let drawSvg = $state<SVGSVGElement | null>(null);
  let resizeTick = $state(0);
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
    const root = $currentViewerRoot;
    if (!root) return false;
    for (const d of existingDrawings) {
      if (hitTestDrawing(d, clientX, clientY, root, $zoomLevel)) {
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

  // Existing drawings rendered from resolved annotations.
  const existingDrawings = $derived(
    $resolvedAnnots
      .filter((r) => r.annotation.type === 'drawing')
      .map((r) => r.annotation as Drawing),
  );

  function labelPositionFor(d: Drawing, root: HTMLElement): { x: number; y: number } | null {
    const root_r = root.getBoundingClientRect();
    let r: DOMRect | null = null;
    switch (d.shape.kind) {
      case 'circle':
      case 'rectangle':
      case 'underline':
      case 'strikethrough': {
        const range = resolveAnchor(d.shape.anchor, root);
        if (range) r = range.getBoundingClientRect();
        break;
      }
      case 'circle-empty':
      case 'margin-bar':
      case 'freehand': {
        const block = root.querySelector<HTMLElement>(`[data-block-id="${d.shape.anchor.blockId}"]`);
        if (block) r = block.getBoundingClientRect();
        break;
      }
      case 'freehand-legacy': {
        const block = root.querySelector<HTMLElement>(`[data-block-id="${(d.shape as { anchorBlock: string }).anchorBlock}"]`);
        if (block) r = block.getBoundingClientRect();
        break;
      }
    }
    if (!r) return null;
    // Small offset above the anchor's right edge — same coordinate system
    // as renderDrawing's output (root-relative).
    return { x: r.right - root_r.left + 4, y: r.top - root_r.top - 2 };
  }

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

  $effect(() => {
    void $zoomLevel;
    void $resolvedAnnots;
    void resizeTick;
    void $tool.drawColor;
    void drawing;
    void currentStroke;
    void pendingStrokes;
    void $settings.showDrawingRecognitionConfidence;

    const svg = drawSvg;
    const root = $currentViewerRoot;
    if (!svg || !root) return;

    // Defer one frame so any --zoom CSS variable change has flowed through
    // layout before getBoundingClientRect reads.
    const id = requestAnimationFrame(() => {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const rc = rough.svg(svg);

      for (const d of existingDrawings) {
        try {
          const els = renderDrawing(rc, d, root, $zoomLevel);
          els.forEach((el) => svg.appendChild(el));
        } catch {
          // Swallow render errors per-drawing so one broken drawing
          // doesn't blank the whole canvas. Orphaned drawings already
          // return [] from renderDrawing, so this only catches
          // unexpected exceptions.
        }
        if ($settings.showDrawingRecognitionConfidence && d.recognitionConfidence != null) {
          const pos = labelPositionFor(d, root);
          if (pos) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(pos.x));
            text.setAttribute('y', String(pos.y));
            text.setAttribute('class', 'confidence-overlay');
            text.textContent = d.recognitionConfidence.toFixed(2);
            svg.appendChild(text);
          }
        }
      }

      // In-progress strokes (still being captured this session — not yet
      // recognized + saved). Use rough.js curve so the live preview matches
      // the final aesthetic.
      for (const s of pendingStrokes) {
        const pts = s.points as Array<[number, number]>;
        if (pts.length < 2) continue;
        const node = rc.curve(pts, {
          stroke: s.color, strokeWidth: s.width, roughness: 1.4, bowing: 1.2,
        });
        svg.appendChild(node);
      }

      if (drawing && currentStroke.length >= 2) {
        const node = rc.curve(currentStroke as Array<[number, number]>, {
          stroke: $tool.drawColor, strokeWidth: 2, roughness: 1.4, bowing: 1.2,
        });
        svg.appendChild(node);
      }
    });
    return () => cancelAnimationFrame(id);
  });

  function onContextMenu(e: MouseEvent): void {
    if ($tool.mode !== 'draw' && $tool.mode !== 'eraser') return;
    const root = $currentViewerRoot;
    if (!root) return;
    for (const d of existingDrawings) {
      if (hitTestDrawing(d, e.clientX, e.clientY, root, $zoomLevel)) {
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
></svg>

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
