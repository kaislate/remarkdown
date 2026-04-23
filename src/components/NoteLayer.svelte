<script lang="ts">
  import { onMount } from 'svelte';
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
  import { mount, unmount } from 'svelte';
  import NotePopover from './NotePopover.svelte';
  import type { Note } from '../lib/schema';

  // Container element for the notes layer (bound from the template).
  let layerEl: HTMLDivElement;

  // Track mounted popovers so we can unmount them.
  const mountedPopovers = new Map<string, ReturnType<typeof mount>>();
  // Track pin buttons so we can remove them.
  const pinElements = new Map<string, HTMLButtonElement>();

  let openPinId: string | null = null;

  function safeRangeRect(range: Range): DOMRect {
    // jsdom does not implement Range.getBoundingClientRect — return a zero rect as fallback.
    if (typeof range.getBoundingClientRect !== 'function') {
      return new DOMRect(0, 0, 0, 0);
    }
    return range.getBoundingClientRect();
  }

  function closePopover(id: string) {
    const existing = mountedPopovers.get(id);
    if (existing) {
      unmount(existing);
      mountedPopovers.delete(id);
    }
    const wrap = layerEl?.querySelector<HTMLElement>(`.popover-wrap[data-pin-id="${CSS.escape(id)}"]`);
    if (wrap) wrap.remove();
    if (openPinId === id) openPinId = null;
  }

  function openPopover(note: Note, top: number, left: number) {
    closePopover(note.id);

    const wrap = document.createElement('div');
    wrap.className = 'popover-wrap';
    wrap.dataset.pinId = note.id;
    wrap.style.cssText = `position:absolute;top:${top + 18}px;left:${left + 18}px;z-index:200;pointer-events:auto;`;
    layerEl.appendChild(wrap);

    const instance = mount(NotePopover, {
      target: wrap,
      props: {
        body: note.body,
        onUpdate: (next: string) => {
          updateAnnotation(note.id, (a) => ({ ...(a as Note), body: next }));
        },
        onDelete: () => {
          removeAnnotation(note.id);
          closePopover(note.id);
        },
      },
    });
    mountedPopovers.set(note.id, instance);
    openPinId = note.id;
  }

  function rebuildPins(resolved: typeof $resolvedAnnots) {
    if (!layerEl) return;
    const root = get(currentViewerRoot);

    // Remove pins whose annotations are no longer resolved.
    const resolvedIds = new Set(
      resolved.filter((r) => r.annotation.type === 'note').map((r) => r.annotation.id)
    );
    for (const [id, btn] of pinElements) {
      if (!resolvedIds.has(id)) {
        btn.remove();
        pinElements.delete(id);
        closePopover(id);
      }
    }

    if (!root) return;
    const rootRect = root.getBoundingClientRect();

    for (const r of resolved) {
      if (r.annotation.type !== 'note') continue;
      const note = r.annotation as Note;
      const { top, left } = pinPosition(rootRect, safeRangeRect(r.range));

      let btn = pinElements.get(note.id);
      if (!btn) {
        btn = document.createElement('button');
        btn.className = 'note-pin';
        btn.setAttribute('aria-label', 'Open note');
        btn.textContent = '●';
        btn.style.cssText = [
          'position:absolute',
          `top:${top}px`,
          `left:${left}px`,
          'width:18px',
          'height:18px',
          'border-radius:999px',
          'background:#ffca4a',
          'border:1.5px solid rgba(0,0,0,0.15)',
          'color:transparent',
          'cursor:pointer',
          'pointer-events:auto',
          'box-shadow:0 2px 6px rgba(255,202,74,0.5)',
        ].join(';');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (openPinId === note.id) {
            closePopover(note.id);
          } else {
            openPopover(note, top, left);
          }
        });
        layerEl.appendChild(btn);
        pinElements.set(note.id, btn);
      } else {
        btn.style.top = `${top}px`;
        btn.style.left = `${left}px`;
      }

      // If this popover is open, update its position too.
      const wrap = layerEl.querySelector<HTMLElement>(`.popover-wrap[data-pin-id="${CSS.escape(note.id)}"]`);
      if (wrap) {
        wrap.style.top = `${top + 18}px`;
        wrap.style.left = `${left + 18}px`;
      }
    }
  }

  function createNoteAt(target: HTMLElement, clientX: number, clientY: number): void {
    const root = get(currentViewerRoot);
    if (!root) return;
    const block = target.closest<HTMLElement>('[data-block-id]');
    if (!block) return;

    // Try caretPositionFromPoint, fall back to first word of block.
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
      // Fallback: anchor to the first text node's first word.
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

  onMount(() => {
    // Subscribe synchronously so pin DOM updates immediately when store changes —
    // important for test synchronicity (same pattern as HighlightLayer).
    const unsubAnnots = resolvedAnnots.subscribe((resolved) => {
      rebuildPins(resolved);
    });

    document.addEventListener('click', onClickViewer);

    return () => {
      unsubAnnots();
      document.removeEventListener('click', onClickViewer);
      // Clean up all mounted popovers.
      for (const instance of mountedPopovers.values()) {
        unmount(instance);
      }
      mountedPopovers.clear();
      pinElements.clear();
    };
  });
</script>

<div class="notes-layer" bind:this={layerEl}></div>

<style>
  .notes-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>
