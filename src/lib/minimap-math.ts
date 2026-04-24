// Pure geometry for the minimap. Isolated from DOM so it can be unit-tested.

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
): MinimapLayout {
  const scale = viewerContentWidth > 0 ? minimapWidth / viewerContentWidth : 1;
  const scaledContentHeight = viewerScrollHeight * scale;
  const indicatorHeight = Math.max(MIN_INDICATOR_PX, viewerClientHeight * scale);

  const maxScroll = Math.max(0, viewerScrollHeight - viewerClientHeight);
  const clampedScrollTop = Math.max(0, Math.min(viewerScrollTop, maxScroll));
  const pct = maxScroll > 0 ? clamp01(clampedScrollTop / maxScroll) : 0;

  if (scaledContentHeight <= minimapHeight) {
    return {
      scale,
      translateY: 0,
      indicatorTop: clampedScrollTop * scale,
      indicatorHeight,
    };
  }

  // Tall-doc branch: content translates up by excess*pct so the current region stays visible.
  // The indicator's position within the minimap is the scroll position in scaled content
  // minus the amount the content has been translated up.
  const excess = scaledContentHeight - minimapHeight;
  return {
    scale,
    translateY: pct === 0 ? 0 : -excess * pct,
    indicatorTop: clampedScrollTop * scale - excess * pct,
    indicatorHeight,
  };
}

export function minimapClickToScrollTop(
  clickY: number,
  translateY: number,
  scale: number,
  viewerClientHeight: number,
  viewerScrollHeight: number,
): number {
  if (scale <= 0) return 0;
  const posInScaledContent = clickY - translateY;
  const posInContent = posInScaledContent / scale;
  const target = posInContent - viewerClientHeight / 2;
  const maxScroll = Math.max(0, viewerScrollHeight - viewerClientHeight);
  return Math.max(0, Math.min(maxScroll, target));
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
