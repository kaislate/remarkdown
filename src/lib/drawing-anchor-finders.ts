import type { BBox } from './drawing-geometry';

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

// Walk every text node inside `root` and return a Range covering the longest
// contiguous run that lies fully within the bbox. Returns null if no text is
// inside or every text node only partially overlaps.
export function findEnclosedText(bbox: BBox, root: HTMLElement): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const inside: Array<{ node: Text; start: number; end: number }> = [];

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    if (!t.textContent || !t.textContent.trim()) continue;
    const range = document.createRange();
    let runStart = -1;
    for (let i = 0; i < t.length; i++) {
      range.setStart(t, i);
      range.setEnd(t, i + 1);
      const r = range.getBoundingClientRect();
      const inX = r.left >= bbox.minX && r.right <= bbox.maxX;
      const inY = r.top  >= bbox.minY && r.bottom <= bbox.maxY;
      if (inX && inY) {
        if (runStart === -1) runStart = i;
      } else if (runStart !== -1) {
        inside.push({ node: t, start: runStart, end: i });
        runStart = -1;
      }
    }
    if (runStart !== -1) inside.push({ node: t, start: runStart, end: t.length });
  }

  if (inside.length === 0) return null;
  // Pick the longest run.
  inside.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const best = inside[0];
  const out = document.createRange();
  out.setStart(best.node, best.start);
  out.setEnd(best.node, best.end);
  return out;
}

// Find the text-line range whose bounding rect's BOTTOM is within
// TEXT_PROXIMITY_EM of the bbox's TOP, on the same horizontal span as the bbox.
// Used for underline detection: "what text does this stroke sit just below?"
const TEXT_PROXIMITY_EM = 0.5;
export function findTextLineAbove(bbox: BBox, root: HTMLElement): Range | null {
  const tolPx = TEXT_PROXIMITY_EM * remPx();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let best: { range: Range; gap: number } | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    if (!t.textContent || !t.textContent.trim()) continue;
    const r = document.createRange();
    r.selectNodeContents(t);
    for (const lineRect of Array.from(r.getClientRects())) {
      const horizOverlap =
        lineRect.right >= bbox.minX && lineRect.left <= bbox.maxX;
      if (!horizOverlap) continue;
      const gap = bbox.minY - lineRect.bottom;
      // Allow up to 2px of overlap (gap < 0) so a slightly-too-high
      // underline still matches; reject if gap exceeds the proximity
      // tolerance.
      if (gap < -2 || gap > tolPx) continue;
      if (!best || gap < best.gap) {
        const out = document.createRange();
        out.setStart(t, 0);
        out.setEnd(t, t.length);
        best = { range: out, gap };
      }
    }
  }
  return best ? best.range : null;
}

// Find the text-line range whose bounding rect VERTICAL CENTRE lies within
// STRIKETHROUGH_BAND_EM of the bbox's vertical centre. Used for strikethrough:
// "what text does this stroke pass through?"
const STRIKETHROUGH_BAND_EM = 0.4;
export function findTextLineThrough(bbox: BBox, root: HTMLElement): Range | null {
  const tolPx = STRIKETHROUGH_BAND_EM * remPx();
  const bboxMid = (bbox.minY + bbox.maxY) / 2;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let best: { range: Range; offset: number } | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    if (!t.textContent || !t.textContent.trim()) continue;
    const r = document.createRange();
    r.selectNodeContents(t);
    for (const lineRect of Array.from(r.getClientRects())) {
      const horizOverlap =
        lineRect.right >= bbox.minX && lineRect.left <= bbox.maxX;
      if (!horizOverlap) continue;
      const lineMid = (lineRect.top + lineRect.bottom) / 2;
      const offset = Math.abs(bboxMid - lineMid);
      if (offset > tolPx) continue;
      if (!best || offset < best.offset) {
        const out = document.createRange();
        out.setStart(t, 0);
        out.setEnd(t, t.length);
        best = { range: out, offset };
      }
    }
  }
  return best ? best.range : null;
}

// Find the [data-block-id] element whose LEFT edge is within
// MARGIN_PROXIMITY_EM of the bbox's RIGHT edge (i.e., bbox sits in the
// margin to the LEFT of the block).
const MARGIN_PROXIMITY_EM = 1.5;
export function findBlockBeside(bbox: BBox, root: HTMLElement): HTMLElement | null {
  const tolPx = MARGIN_PROXIMITY_EM * remPx();
  let best: { el: HTMLElement; gap: number } | null = null;
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'))) {
    const r = el.getBoundingClientRect();
    const verticalOverlap =
      r.bottom >= bbox.minY && r.top <= bbox.maxY;
    if (!verticalOverlap) continue;
    const gap = r.left - bbox.maxX;
    // Allow up to 2px of overlap (gap < 0) so a slightly-too-far-right
    // margin stroke still matches; reject if gap exceeds tolerance.
    if (gap < -2 || gap > tolPx) continue;
    if (!best || gap < best.gap) best = { el, gap };
  }
  return best ? best.el : null;
}

// Find the smallest [data-block-id] that contains the centroid point.
export function findBlockAtPoint(x: number, y: number, root: HTMLElement): HTMLElement | null {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'));
  let best: { el: HTMLElement; area: number } | null = null;
  for (const el of blocks) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const area = r.width * r.height;
    if (!best || area < best.area) best = { el, area };
  }
  return best ? best.el : null;
}
