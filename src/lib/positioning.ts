export interface PinPosition { top: number; left: number; }

// Footnote-marker positioning. The pin's anchor point is the immediate
// end of the highlighted text — the same place a printed book would
// drop a footnote reference. Two small fixed-pixel nudges keep it from
// sitting flush against the last character. The pin's SIZE is set in
// em (see NoteLayer.svelte) so the marker scales with text zoom; the
// position offsets stay in px because they only matter at a single-px
// scale regardless of zoom.
const PIN_TOP_OFFSET = 1;
const PIN_LEFT_OFFSET = 2;

export function pinPosition(rootRect: DOMRect, rangeRect: DOMRect): PinPosition {
  return {
    top: rangeRect.top - rootRect.top + PIN_TOP_OFFSET,
    left: rangeRect.right - rootRect.left + PIN_LEFT_OFFSET,
  };
}
