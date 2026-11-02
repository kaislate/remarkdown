import type { BBox } from './drawing-geometry';

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

// The area the text a finder wants must reach (viewport coordinates).
interface Area { minX: number; maxX: number; minY: number; maxY: number }

// How far outside an area a measured box may be and still be looked at: an
// empty box (collapsed whitespace), which a block's measured contents leave
// out, sits at the edge of one of the lines they include.
const SLACK_EM = 2;

const reaches = (r: DOMRect, a: Area, slack: number): boolean =>
  r.right >= a.minX - slack && r.left <= a.maxX + slack && r.bottom >= a.minY - slack && r.top <= a.maxY + slack;

// The article's text nodes that may have text in `area`, in document order.
// A block (any [data-block-id] element) whose contents measure clear of the
// area is passed over whole, with every text node inside it: measuring a
// block's contents is one call, measuring its text node by node is one per
// node (hundreds in a highlighted code block). The contents' box, unlike
// the block element's own, takes in text that overflows the block. Every
// other text node is passed on, to be measured as before.
function textNodesNear(root: HTMLElement, area: Area, slack: number): TreeWalker {
  const probe = document.createRange();
  return document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      if (!(n as HTMLElement).dataset?.blockId) return NodeFilter.FILTER_SKIP;
      probe.selectNodeContents(n);
      return reaches(probe.getBoundingClientRect(), area, slack) ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
    },
  });
}

export function findEnclosedText(bbox: BBox, root: HTMLElement): Range | null {
  // Text with no layout (inside something hidden) measures as an empty box
  // at the viewport's top-left corner, which a box over that corner
  // encloses: only there is every character still measured.
  if (bbox.minX <= 0 && bbox.maxX >= 0 && bbox.minY <= 0 && bbox.maxY >= 0) return enclosedByEveryChar(bbox, root);
  const slack = SLACK_EM * remPx();
  const walker = textNodesNear(root, bbox, slack);
  let firstNode: Text | null = null;
  let firstOffset = -1;
  let lastNode: Text | null = null;
  let lastOffset = -1;

  const lines = document.createRange();
  const range = document.createRange();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    if (!t.textContent || !t.textContent.trim()) continue;
    // A character inside the box is on one of its node's lines, so a node
    // none of whose lines reach the box has none: one measurement instead
    // of one per character.
    lines.selectNodeContents(t);
    if (!Array.from(lines.getClientRects()).some((r) => reaches(r, bbox, slack))) continue;
    for (let i = 0; i < t.length; i++) {
      range.setStart(t, i);
      range.setEnd(t, i + 1);
      const r = range.getBoundingClientRect();
      const inX = r.left >= bbox.minX && r.right <= bbox.maxX;
      const inY = r.top  >= bbox.minY && r.bottom <= bbox.maxY;
      if (inX && inY) {
        if (firstNode === null) {
          firstNode = t;
          firstOffset = i;
        }
        lastNode = t;
        lastOffset = i + 1;
      }
    }
  }

  if (firstNode === null || lastNode === null) return null;
  const out = document.createRange();
  out.setStart(firstNode, firstOffset);
  out.setEnd(lastNode, lastOffset);
  return out;
}

function enclosedByEveryChar(bbox: BBox, root: HTMLElement): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let firstNode: Text | null = null;
  let firstOffset = -1;
  let lastNode: Text | null = null;
  let lastOffset = -1;

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    if (!t.textContent || !t.textContent.trim()) continue;
    const range = document.createRange();
    for (let i = 0; i < t.length; i++) {
      range.setStart(t, i);
      range.setEnd(t, i + 1);
      const r = range.getBoundingClientRect();
      const inX = r.left >= bbox.minX && r.right <= bbox.maxX;
      const inY = r.top  >= bbox.minY && r.bottom <= bbox.maxY;
      if (inX && inY) {
        if (firstNode === null) {
          firstNode = t;
          firstOffset = i;
        }
        lastNode = t;
        lastOffset = i + 1;
      }
    }
  }

  if (firstNode === null || lastNode === null) return null;
  const out = document.createRange();
  out.setStart(firstNode, firstOffset);
  out.setEnd(lastNode, lastOffset);
  return out;
}

// Find the text-line range whose bounding rect's BOTTOM is within
// TEXT_PROXIMITY_EM of the bbox's TOP, on the same horizontal span as the bbox.
// Used for underline detection: "what text does this stroke sit just below?"
const TEXT_PROXIMITY_EM = 0.5;
export function findTextLineAbove(bbox: BBox, root: HTMLElement): Range | null {
  const tolPx = TEXT_PROXIMITY_EM * remPx();
  // A line that qualifies has its bottom between these, so it reaches here.
  const area = { minX: bbox.minX, maxX: bbox.maxX, minY: bbox.minY - tolPx, maxY: bbox.minY + 2 };
  const walker = textNodesNear(root, area, SLACK_EM * remPx());
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
  // A line that qualifies has its middle between these, so it reaches here.
  const area = { minX: bbox.minX, maxX: bbox.maxX, minY: bboxMid - tolPx, maxY: bboxMid + tolPx };
  const walker = textNodesNear(root, area, SLACK_EM * remPx());
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
