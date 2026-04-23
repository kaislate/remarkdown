<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { ulid } from 'ulid';
  import { tool, HIGHLIGHT_COLORS } from '../stores/tool';
  import {
    addAnnotation,
    removeAnnotation,
    resolvedAnnots,
    currentViewerRoot,
  } from '../stores/annots';
  import { createAnchor } from '../lib/anchoring';
  import type { Highlight } from '../lib/schema';

  function colorIndex(color: string): number {
    const i = HIGHLIGHT_COLORS.indexOf(color as (typeof HIGHLIGHT_COLORS)[number]);
    return i >= 0 ? i : 0;
  }

  function rebuildHighlights(resolved: typeof $resolvedAnnots) {
    if (typeof CSS === 'undefined' || !(CSS as any).highlights) return;
    // Clear all named highlights we might own.
    for (let i = 0; i < HIGHLIGHT_COLORS.length; i++) {
      (CSS as any).highlights.delete(`rmd-hl-${i}`);
    }
    // Group ranges by color index.
    const byColor = new Map<number, Range[]>();
    for (const r of resolved) {
      if (r.annotation.type !== 'highlight') continue;
      const idx = colorIndex((r.annotation as Highlight).color);
      if (!byColor.has(idx)) byColor.set(idx, []);
      byColor.get(idx)!.push(r.range);
    }
    for (const [idx, ranges] of byColor) {
      const name = `rmd-hl-${idx}`;
      const hl = new (window as any).Highlight(...ranges);
      (CSS as any).highlights.set(name, hl);
    }
  }

  let menuForId = $state<string | null>(null);
  let menuPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });

  function rangeContains(range: Range, node: Node, offset: number): boolean {
    try {
      return range.isPointInRange(node, offset);
    } catch {
      return false;
    }
  }

  function onContextMenu(e: MouseEvent): void {
    const root = get(currentViewerRoot);
    if (!root) return;
    const target = e.target as Node | null;
    if (!target || !root.contains(target)) return;

    const cp = (document as any).caretPositionFromPoint?.(e.clientX, e.clientY);
    if (!cp || !cp.offsetNode) return;

    // Find which resolved highlight's range contains the caret position.
    for (const r of get(resolvedAnnots)) {
      if (r.annotation.type !== 'highlight') continue;
      if (rangeContains(r.range, cp.offsetNode, cp.offset)) {
        e.preventDefault();
        menuForId = r.annotation.id;
        menuPos = { x: e.clientX, y: e.clientY };
        return;
      }
    }
  }

  function closeMenu(): void { menuForId = null; }

  function deleteHighlight(): void {
    if (!menuForId) return;
    removeAnnotation(menuForId);
    menuForId = null;
  }

  onMount(() => {
    // Subscribe to resolved annotations synchronously so CSS.highlights updates
    // immediately when the store changes (important for test synchronicity).
    const unsubAnnots = resolvedAnnots.subscribe((resolved) => {
      rebuildHighlights(resolved);
    });

    // Create: listen for selection end while tool=highlight.
    const onMouseUp = () => {
      if (get(tool).mode !== 'highlight') return;
      const root = get(currentViewerRoot);
      if (!root) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
      const anchor = createAnchor(range, root);
      if (!anchor) return;
      const now = new Date().toISOString();
      const hl: Highlight = {
        id: ulid(),
        type: 'highlight',
        color: get(tool).highlightColor,
        anchor,
        createdAt: now,
        updatedAt: now,
      };
      addAnnotation(hl);
      sel.removeAllRanges();
    };

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('click', closeMenu);

    return () => {
      unsubAnnots();
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('click', closeMenu);
    };
  });
</script>

{#if menuForId}
  <div
    class="highlight-menu glass"
    role="menu"
    style="top:{menuPos.y}px; left:{menuPos.x}px"
  >
    <button role="menuitem" onclick={deleteHighlight}>Delete highlight</button>
  </div>
{/if}

<style>
  .highlight-menu {
    position: fixed;
    padding: 4px;
    min-width: 160px;
    z-index: 250;
  }
  .highlight-menu button {
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
  .highlight-menu button:hover { background: var(--accent-soft); }
</style>
