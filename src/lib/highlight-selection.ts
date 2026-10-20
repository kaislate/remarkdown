// Highlighting the selected text in the current highlight colour — the
// highlighter tool does it when the selection ends (HighlightLayer), the
// right-click menu on request. Overlaps: same colour merges into one
// highlight, a different colour is replaced; a selection already inside a
// same-colour highlight changes nothing.
import { get } from 'svelte/store';
import { ulid } from 'ulid';
import { tool } from '../stores/tool';
import { addAnnotation, removeAnnotation, resolvedAnnots, currentViewerRoot } from '../stores/annots';
import { createAnchor, rangeTouchesDiagram, DIAGRAM_ANNOTATION_HINT } from './anchoring';
import { addToast } from '../stores/toasts';
import type { Highlight } from './schema';

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
export function rangesOverlap(a: Range, b: Range): boolean {
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

// Highlights the window's selection if it lies in the article. True if it
// did (or the text was already highlighted in that colour).
export function highlightSelection(): boolean {
  const root = get(currentViewerRoot);
  if (!root) return false;
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false;
  // Diagram text can't hold a highlight (see rangeTouchesDiagram).
  if (rangeTouchesDiagram(range)) {
    sel.removeAllRanges();
    addToast({ kind: 'info', message: DIAGRAM_ANNOTATION_HINT });
    return false;
  }

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
    return true;
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
  if (!anchor) return false;
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
  return true;
}
