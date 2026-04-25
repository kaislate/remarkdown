export interface PinPosition { top: number; left: number; }

// Distance from the right edge of the article (rootRect) where the
// pin's left edge is placed. Tuned so the 14px pin sits comfortably in
// the article's 48px right padding — clear of the text column on every
// reasonable column width — while staying vertically aligned with the
// anchored line so the user can still scan top-to-bottom for which
// line is annotated.
const PIN_RIGHT_MARGIN_OFFSET = 28;
// Vertical nudge that centres the 14px pin against the leading of a
// 1.6 line-height paragraph. Approximate; exact alignment isn't worth
// measuring per-line at runtime.
const PIN_LINE_VERTICAL_OFFSET = 4;

export function pinPosition(rootRect: DOMRect, rangeRect: DOMRect): PinPosition {
  return {
    // Vertically aligned with the first line of the anchored range so
    // the pin sits beside the text rather than spanning it.
    top: rangeRect.top - rootRect.top + PIN_LINE_VERTICAL_OFFSET,
    // Right-margin alignment: pin always lives in the article's right
    // padding, never on top of prose, even if the anchored passage
    // extends to the right edge of the column.
    left: rootRect.width - PIN_RIGHT_MARGIN_OFFSET,
  };
}
