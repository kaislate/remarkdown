export interface PinPosition { top: number; left: number; }

// Subscript-marker positioning. The pin's anchor point is the BOTTOM
// of the anchored text's line — like a subscript reference rather than
// a superscript one. CSS in NoteLayer.svelte pulls the pin up by half
// its em-sized height so the dot centres on the baseline and straddles
// the descender / inter-line leading area. Both the pin size and the
// vertical offset scale with text zoom because they're in em.
const PIN_LEFT_OFFSET = 2;

export function pinPosition(rootRect: DOMRect, rangeRect: DOMRect): PinPosition {
  return {
    top: rangeRect.bottom - rootRect.top,
    left: rangeRect.right - rootRect.left + PIN_LEFT_OFFSET,
  };
}
