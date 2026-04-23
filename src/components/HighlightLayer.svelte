<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { ulid } from 'ulid';
  import { tool, HIGHLIGHT_COLORS } from '../stores/tool';
  import {
    addAnnotation,
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

    return () => {
      unsubAnnots();
      document.removeEventListener('mouseup', onMouseUp);
    };
  });
</script>
