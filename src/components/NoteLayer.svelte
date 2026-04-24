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

  // Recompute pin positions whenever resolved notes change.
  const pins = $derived.by(() => {
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
        };
      });
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
      <div class="popover-wrap" style="top:{p.position.top + 18}px; left:{p.position.left + 18}px">
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
  .popover-wrap {
    position: absolute;
    z-index: 200;
    pointer-events: auto;
  }
</style>
