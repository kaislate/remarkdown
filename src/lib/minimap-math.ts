// Pure geometry for the minimap. Isolated from DOM so it can be unit-tested.
//
// Coordinates: the scroll container's content runs from 0 to scrollHeight;
// the article (which the minimap mirrors as a scaled clone) starts at
// `articleTop` within it and is `articleHeight` tall. The clone is drawn at
// `scale` and shifted up by `-translateY` so the current region stays in
// view. A scroll-content y maps to map y = (y - articleTop) * scale +
// translateY — the viewport box is the visible range pushed through it.

export interface MinimapLayout {
  scale: number;
  translateY: number;
  indicatorTop: number;
  indicatorHeight: number;
}

const MIN_INDICATOR_PX = 20;

export function computeMinimapLayout(
  viewerScrollTop: number,
  viewerScrollHeight: number,
  viewerClientHeight: number,
  viewerContentWidth: number,
  minimapWidth: number,
  minimapHeight: number,
  articleTop = 0,
  articleHeight = viewerScrollHeight,
): MinimapLayout {
  const scale = viewerContentWidth > 0 ? minimapWidth / viewerContentWidth : 1;
  const scaledContentHeight = articleHeight * scale;
  // Exact unless the page is so long the box would be a sliver.
  const indicatorHeight = Math.max(MIN_INDICATOR_PX, viewerClientHeight * scale);

  const maxScroll = Math.max(0, viewerScrollHeight - viewerClientHeight);
  const clampedScrollTop = Math.max(0, Math.min(viewerScrollTop, maxScroll));
  const pct = maxScroll > 0 ? clamp01(clampedScrollTop / maxScroll) : 0;

  // Tall-doc: the clone translates up by excess*pct so the current region
  // stays visible (top of the page at the top, bottom at the bottom).
  const excess = Math.max(0, scaledContentHeight - minimapHeight);
  const translateY = pct === 0 || excess === 0 ? 0 : -excess * pct;
  return {
    scale,
    translateY,
    indicatorTop: (clampedScrollTop - articleTop) * scale + translateY,
    indicatorHeight,
  };
}

// The scroll-content range the viewport box stands for — the inverse of
// the mapping above. Equals [scrollTop, scrollTop + clientHeight] when the
// box is exact.
export function indicatorRange(layout: MinimapLayout, articleTop = 0): [number, number] {
  const toContent = (y: number) => (y - layout.translateY) / layout.scale + articleTop;
  return [toContent(layout.indicatorTop), toContent(layout.indicatorTop + layout.indicatorHeight)];
}

export function minimapClickToScrollTop(
  clickY: number,
  translateY: number,
  scale: number,
  viewerClientHeight: number,
  viewerScrollHeight: number,
  articleTop = 0,
): number {
  if (scale <= 0) return 0;
  const posInScaledContent = clickY - translateY;
  const posInContent = posInScaledContent / scale + articleTop;
  const target = posInContent - viewerClientHeight / 2;
  const maxScroll = Math.max(0, viewerScrollHeight - viewerClientHeight);
  return Math.max(0, Math.min(maxScroll, target));
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
