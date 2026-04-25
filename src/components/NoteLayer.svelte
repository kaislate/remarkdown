<script lang="ts">
  import { get } from 'svelte/store';
  import { ulid } from 'ulid';
  import { tool } from '../stores/tool';
  import {
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    resolvedAnnots,
    currentViewerRoot,
  } from '../stores/annots';
  import { createAnchor } from '../lib/anchoring';
  import { pinPosition } from '../lib/positioning';
  import NotePopover from './NotePopover.svelte';
  import type { Note } from '../lib/schema';

  let openPinId = $state<string | null>(null);

  // Used to keep clamped popover positions current when the window resizes
  // — bumping this forces the $derived block below to re-run.
  let resizeTick = $state(0);

  // Approximate maximum dimensions of NotePopover.svelte. Used to clamp the
  // popover within the viewport so the Delete button can't disappear off
  // the right edge on narrow windows. A tighter measurement (via a bind
  // ref + getBoundingClientRect) would be exact, but the popover's chrome
  // is stable enough that hard-coded bounds work.
  const POPOVER_W = 280;
  const POPOVER_H = 180;
  const VIEWPORT_MARGIN = 8;

  // Recompute pin positions whenever resolved notes change.
  const pins = $derived.by(() => {
    void resizeTick; // re-evaluate on window resize
    const root = $currentViewerRoot;
    if (!root) return [];
    const rootRect = root.getBoundingClientRect();
    return $resolvedAnnots
      .filter((r) => r.annotation.type === 'note')
      .map((r) => {
        // jsdom's Range doesn't implement getBoundingClientRect fully; default to zero.
        let rangeRect: DOMRect;
        try {
          rangeRect = r.range.getBoundingClientRect();
        } catch {
          rangeRect = new DOMRect(0, 0, 0, 0);
        }
        return {
          note: r.annotation as Note,
          position: pinPosition(rootRect, rangeRect),
          popover: clampedPopoverPos(rootRect, pinPosition(rootRect, rangeRect)),
        };
      });
  });

  // Compute the popover's viewport-fixed position from the pin's
  // root-relative position. Default offset is below-and-right of the pin
  // (matching the previous behaviour); when that would push the popover
  // past the viewport's right edge we flip it to the LEFT of the pin
  // instead, then clamp to the visible area as a last resort.
  function clampedPopoverPos(rootRect: DOMRect, pin: { top: number; left: number }) {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const h = typeof window !== 'undefined' ? window.innerHeight : 800;

    const pinViewportLeft = rootRect.left + pin.left;
    const pinViewportTop = rootRect.top + pin.top;

    let left = pinViewportLeft + 18;
    let top = pinViewportTop + 18;

    const maxLeft = w - POPOVER_W - VIEWPORT_MARGIN;
    if (left > maxLeft) {
      // Try positioning to the LEFT of the pin first (popover's right
      // edge sits a few px left of the pin).
      const flippedLeft = pinViewportLeft - POPOVER_W - 6;
      left = flippedLeft >= VIEWPORT_MARGIN ? flippedLeft : maxLeft;
    }
    left = Math.max(VIEWPORT_MARGIN, left);

    const maxTop = h - POPOVER_H - VIEWPORT_MARGIN;
    if (top > maxTop) top = Math.max(VIEWPORT_MARGIN, maxTop);

    return { top, left };
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => { resizeTick += 1; };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  function createNoteAt(target: HTMLElement, clientX: number, clientY: number): void {
    const root = get(currentViewerRoot);
    if (!root) return;
    const block = target.closest<HTMLElement>('[data-block-id]');
    if (!block) return;

    let range: Range | null = null;
    const cp = (document as any).caretPositionFromPoint?.(clientX, clientY);
    if (cp && cp.offsetNode && cp.offsetNode.nodeType === Node.TEXT_NODE) {
      const tn = cp.offsetNode as Text;
      const off = cp.offset as number;
      const data = tn.data;
      let start = off;
      let end = off;
      while (start > 0 && /\S/.test(data[start - 1])) start -= 1;
      while (end < data.length && /\S/.test(data[end])) end += 1;
      if (start === end) { start = 0; end = Math.min(data.length, 8); }
      range = document.createRange();
      range.setStart(tn, start);
      range.setEnd(tn, end);
    } else {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const tn = walker.nextNode() as Text | null;
      if (!tn) return;
      const m = tn.data.match(/\S+/);
      if (!m) return;
      range = document.createRange();
      range.setStart(tn, m.index!);
      range.setEnd(tn, m.index! + m[0].length);
    }

    const anchor = createAnchor(range, root);
    if (!anchor) return;
    const now = new Date().toISOString();
    const note: Note = {
      id: ulid(),
      type: 'note',
      anchor,
      body: '',
      createdAt: now,
      updatedAt: now,
    };
    addAnnotation(note);
    openPinId = note.id;
  }

  function onClickViewer(e: MouseEvent): void {
    if (get(tool).mode !== 'note') return;
    const target = e.target as HTMLElement;
    const root = get(currentViewerRoot);
    if (!root?.contains(target)) return;
    if ((target as HTMLElement).closest?.('.note-pin, .popover')) return;
    createNoteAt(target, e.clientX, e.clientY);
  }

  $effect(() => {
    document.addEventListener('click', onClickViewer);
    return () => document.removeEventListener('click', onClickViewer);
  });
</script>

<div class="notes-layer" class:eraser={$tool.mode === 'eraser'}>
  {#each pins as p (p.note.id)}
    <button
      class="note-pin"
      class:eraser={$tool.mode === 'eraser'}
      style="top:{p.position.top}px; left:{p.position.left}px"
      aria-label={$tool.mode === 'eraser' ? 'Erase note' : 'Open note'}
      onclick={(e) => {
        e.stopPropagation();
        if (get(tool).mode === 'eraser') {
          if (openPinId === p.note.id) openPinId = null;
          removeAnnotation(p.note.id);
          return;
        }
        openPinId = openPinId === p.note.id ? null : p.note.id;
      }}
    >●</button>
    {#if openPinId === p.note.id}
      <div class="popover-wrap" style="top:{p.popover.top}px; left:{p.popover.left}px">
        <NotePopover
          body={p.note.body}
          onUpdate={(next) => updateAnnotation(p.note.id, (a) => ({ ...(a as Note), body: next }))}
          onDelete={() => { removeAnnotation(p.note.id); openPinId = null; }}
        />
      </div>
    {/if}
  {/each}
</div>

<style>
  .notes-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .note-pin {
    position: absolute;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    background: #ffca4a;
    border: 1.5px solid rgba(0,0,0,0.15);
    color: transparent;
    cursor: pointer;
    pointer-events: auto;
    /* Sit above the DrawLayer SVG so pin clicks aren't intercepted by it.
       (DrawLayer's stacking is at z-index: auto inside the same .content
       stacking context; any positive z here wins.) */
    z-index: 5;
    box-shadow: 0 2px 6px rgba(255, 202, 74, 0.5);
    transition: background 0.15s, box-shadow 0.15s;
  }
  .note-pin.eraser {
    cursor: cell;
  }
  .note-pin.eraser:hover {
    background: #ff6e6e;
    box-shadow: 0 2px 8px rgba(255, 110, 110, 0.6);
  }
  /* Popover uses fixed positioning so the clamped-to-viewport coordinates
     in clampedPopoverPos() are applied directly without further offset
     from a positioned ancestor. */
  .popover-wrap {
    position: fixed;
    z-index: 200;
    pointer-events: auto;
  }
</style>
