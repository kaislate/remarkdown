export interface PinPosition { top: number; left: number; }

export function pinPosition(rootRect: DOMRect, rangeRect: DOMRect): PinPosition {
  return {
    top: rangeRect.top - rootRect.top,
    left: rangeRect.right - rootRect.left,
  };
}
