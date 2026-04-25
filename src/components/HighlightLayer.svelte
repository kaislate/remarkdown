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

  // compareBoundaryPoints returns the position of THIS range's boundary
  // relative to the SOURCE range's boundary:
  //   −1: this's boundary is BEFORE source's boundary
  //    0: equal
  //    1: this's boundary is AFTER source's boundary
  // The four `how` values pick which boundary on each side:
  //   START_TO_START: this.start vs source.start
  //   START_TO_END:   this.end   vs source.start
  //   END_TO_END:     this.end   vs source.end
  //   END_TO_START:   this.start vs source.end

  // Two ranges overlap iff a.end > b.start AND a.start < b.end.
  // Touching boundaries (a.end == b.start) return 0 and are treated as
  // non-overlapping.
  function rangesOverlap(a: Range, b: Range): boolean {
    try {
      // a.end vs b.start: > 0 means a.end after b.start
      const aEndAfterBStart = a.compareBoundaryPoints(Range.START_TO_END, b);
      // a.start vs b.end: < 0 means a.start before b.end
      const aStartBeforeBEnd = a.compareBoundaryPoints(Range.END_TO_START, b);
      return aEndAfterBStart > 0 && aStartBeforeBEnd < 0;
    } catch {
      return false;
    }
  }

  // True iff `outer` fully contains `inner` (touching boundaries OK).
  // outer.start <= inner.start AND outer.end >= inner.end.
  function rangeContainsRange(outer: Range, inner: Range): boolean {
    try {
      // outer.start vs inner.start: <= 0 means outer.start at or before inner.start
      const outerStartAtOrBeforeInnerStart = outer.compareBoundaryPoints(Range.START_TO_START, inner) <= 0;
      // outer.end vs inner.end: >= 0 means outer.end at or after inner.end
      const outerEndAtOrAfterInnerEnd = outer.compareBoundaryPoints(Range.END_TO_END, inner) >= 0;
      return outerStartAtOrBeforeInnerStart && outerEndAtOrAfterInnerEnd;
    } catch {
      return false;
    }
  }

  // Smallest range that covers both `a` and `b`. Used to merge two
  // same-colour highlights into a single annotation.
  function unionRanges(a: Range, b: Range): Range | null {
    try {
      // a.start vs b.start: > 0 means a.start AFTER b.start (b's start is earlier).
      const startCompare = a.compareBoundaryPoints(Range.START_TO_START, b);
      const useB_start = startCompare > 0;
      const startContainer = useB_start ? b.startContainer : a.startContainer;
      const startOffset = useB_start ? b.startOffset : a.startOffset;

      // a.end vs b.end: < 0 means a.end BEFORE b.end (b's end is later).
      const endCompare = a.compareBoundaryPoints(Range.END_TO_END, b);
      const useB_end = endCompare < 0;
      const endContainer = useB_end ? b.endContainer : a.endContainer;
      const endOffset = useB_end ? b.endOffset : a.endOffset;

      const merged = document.createRange();
      merged.setStart(startContainer, startOffset);
      merged.setEnd(endContainer, endOffset);
      return merged;
    } catch {
      return null;
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

  function onDocClickEraser(e: MouseEvent): void {
    if (get(tool).mode !== 'eraser') return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // Defer to NoteLayer for note pin clicks.
    if (target?.closest?.('.note-pin')) return;
    const cp = (document as any).caretPositionFromPoint?.(e.clientX, e.clientY);
    if (!cp || !cp.offsetNode) return;
    for (const r of get(resolvedAnnots)) {
      if (r.annotation.type !== 'highlight') continue;
      if (rangeContains(r.range, cp.offsetNode, cp.offset)) {
        e.preventDefault();
        e.stopPropagation();
        removeAnnotation(r.annotation.id);
        return;
      }
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

      // Decide what to do with overlapping highlights:
      //   - SAME colour overlap → MERGE into one highlight whose range is
      //     the union of every overlapping same-colour mark plus the
      //     new selection. Single annotation record, single delete.
      //   - DIFFERENT colour overlap → replace (delete the old, the new
      //     selection wins).
      // Special case: if the new selection is fully contained in any
      // existing same-colour highlight, skip everything — the highlight
      // already covers this text and a no-op preserves the original
      // createdAt.
      const newColor = get(tool).highlightColor;
      const overlapping = get(resolvedAnnots).filter(
        (r) => r.annotation.type === 'highlight' && rangesOverlap(range, r.range),
      );
      const fullyContained = overlapping.find(
        (r) =>
          (r.annotation as Highlight).color === newColor &&
          rangeContainsRange(r.range, range),
      );
      if (fullyContained) {
        sel.removeAllRanges();
        return;
      }

      let mergedRange: Range = range;
      for (const r of overlapping) {
        if ((r.annotation as Highlight).color === newColor) {
          mergedRange = unionRanges(mergedRange, r.range) ?? mergedRange;
        }
      }
      // Re-scan with the (possibly expanded) merged range — additional
      // same-colour highlights might overlap the union but not the
      // original selection.
      if (mergedRange !== range) {
        for (const r of get(resolvedAnnots)) {
          if (r.annotation.type !== 'highlight') continue;
          if (overlapping.some((o) => o.annotation.id === r.annotation.id)) continue;
          if ((r.annotation as Highlight).color !== newColor) continue;
          if (rangesOverlap(mergedRange, r.range)) {
            mergedRange = unionRanges(mergedRange, r.range) ?? mergedRange;
            overlapping.push(r);
          }
        }
      }

      // Delete every overlapping highlight (same-colour merges + any
      // different-colour replacements).
      for (const r of overlapping) {
        removeAnnotation(r.annotation.id);
      }

      const anchor = createAnchor(mergedRange, root);
      if (!anchor) return;
      const now = new Date().toISOString();
      const hl: Highlight = {
        id: ulid(),
        type: 'highlight',
        color: newColor,
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
    document.addEventListener('click', onDocClickEraser, true);

    return () => {
      unsubAnnots();
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('click', onDocClickEraser, true);
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
