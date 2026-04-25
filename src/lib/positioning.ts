export interface PinPosition { top: number; left: number; }

// Subscript-marker positioning. The pin's anchor point is the
// bottom-right corner of the anchored text's bounding rect — the end
// of the last word — and CSS in NoteLayer.svelte pulls the pin both
// upward (subscript) and leftward (so the pin centres on the anchor
// rather than extending past the word into the next word's first
// character). Both shifts are in em so they scale with zoom.

export function pinPosition(rootRect: DOMRect, rangeRect: DOMRect): PinPosition {
  return {
    top: rangeRect.bottom - rootRect.top,
    left: rangeRect.right - rootRect.left,
  };
}
