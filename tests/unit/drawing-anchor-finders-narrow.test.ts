import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  findEnclosedText,
  findTextLineAbove,
  findTextLineThrough,
} from '../../src/lib/drawing-anchor-finders';
import type { BBox } from '../../src/lib/drawing-geometry';

// jsdom has no layout, so these tests give the article a simple one: blocks
// stacked down the page, each one's characters 8px wide on lines of 60, 20px
// apart. Ranges are measured from it. That's enough to count how much a
// finder measures, and to check it finds exactly what measuring every
// character (and every text node) of the article finds.

const CHAR_W = 8;
const LINE_H = 20;
const PER_LINE = 60;
const LEFT = 100;

let charRects: Map<Text, DOMRect[]>;
let textList: Text[];
// The text nodes inside blocks (the words), in order.
let words: Text[];
let measured = 0;
const saved = {
  bcr: Range.prototype.getBoundingClientRect,
  rects: Range.prototype.getClientRects,
  elBcr: Element.prototype.getBoundingClientRect,
};

function textNodesUnder(node: Node): Text[] {
  if (node.nodeType === Node.TEXT_NODE) return [node as Text];
  const out: Text[] = [];
  const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
}

function layOut(root: HTMLElement): void {
  charRects = new Map();
  textList = textNodesUnder(root);
  words = [];
  let top = 50;
  for (const block of Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'))) {
    let at = 0;
    for (const t of textNodesUnder(block)) {
      const rects: DOMRect[] = [];
      for (let i = 0; i < t.length; i++, at++) {
        const line = Math.floor(at / PER_LINE);
        rects.push(new DOMRect(LEFT + (at % PER_LINE) * CHAR_W, top + line * LINE_H, CHAR_W, LINE_H - 4));
      }
      charRects.set(t, rects);
      words.push(t);
    }
    top += Math.max(1, Math.ceil(at / PER_LINE)) * LINE_H + 12;
  }
}

// Per text node and line, the box of the characters the range covers.
function rangeRects(range: Range): DOMRect[] {
  const out: DOMRect[] = [];
  const one = range.startContainer === range.endContainer;
  const nodes = one && range.startContainer.nodeType === Node.TEXT_NODE
    ? [range.startContainer as Text]
    : one && range.startOffset === 0 && range.endOffset === range.startContainer.childNodes.length
      ? textNodesUnder(range.startContainer) // an element's contents
      : textNodesUnder(range.commonAncestorContainer).filter((t) => range.intersectsNode(t));
  for (const t of nodes) {
    const s = t === range.startContainer ? range.startOffset : 0;
    const e = t === range.endContainer ? range.endOffset : t.length;
    const chars = (charRects.get(t) ?? []).slice(s, e);
    let line: DOMRect | null = null;
    for (const c of chars) {
      if (line && line.top === c.top) {
        line = new DOMRect(line.left, line.top, c.right - line.left, line.height);
        out[out.length - 1] = line;
      } else {
        line = new DOMRect(c.left, c.top, c.width, c.height);
        out.push(line);
      }
    }
  }
  return out;
}

function union(rects: DOMRect[]): DOMRect {
  const r = rects.filter((x) => x.width || x.height);
  if (!r.length) return new DOMRect(0, 0, 0, 0);
  const left = Math.min(...r.map((x) => x.left));
  const top = Math.min(...r.map((x) => x.top));
  const right = Math.max(...r.map((x) => x.right));
  const bottom = Math.max(...r.map((x) => x.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

beforeEach(() => {
  document.body.innerHTML = '';
  measured = 0;
  Range.prototype.getClientRects = function (this: Range) {
    measured++;
    return rangeRects(this) as unknown as DOMRectList;
  };
  Range.prototype.getBoundingClientRect = function (this: Range) {
    measured++;
    return union(rangeRects(this));
  };
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const r = document.createRange();
    r.selectNodeContents(this);
    return union(rangeRects(r));
  };
});

afterEach(() => {
  Range.prototype.getBoundingClientRect = saved.bcr;
  Range.prototype.getClientRects = saved.rects;
  Element.prototype.getBoundingClientRect = saved.elBcr;
});

// An article of `blocks` paragraphs, each `spans` words in their own span
// (as a highlighted code block or a heavily formatted paragraph has).
function article(blocks: number, spans: number): HTMLElement {
  const root = document.createElement('article');
  const html: string[] = [];
  for (let b = 0; b < blocks; b++) {
    const words: string[] = [];
    for (let s = 0; s < spans; s++) words.push(`<span>w${b}x${s} </span>`);
    html.push(`<p data-block-id="p:${b + 1}">${words.join('')}</p>`);
  }
  root.innerHTML = html.join('\n');
  document.body.appendChild(root);
  layOut(root);
  return root;
}

function boxAround(t: Text, from: number, to: number, pad = 2): BBox {
  const r = union(charRects.get(t)!.slice(from, to));
  return {
    minX: r.left - pad, maxX: r.right + pad, minY: r.top - pad, maxY: r.bottom + pad,
    width: r.width + 2 * pad, height: r.height + 2 * pad,
  };
}

// The finders as they were: every character / every text node measured.
function enclosedByEveryChar(bbox: BBox): string | null {
  let first: [Text, number] | null = null;
  let last: [Text, number] | null = null;
  for (const t of textList) {
    if (!t.textContent || !t.textContent.trim()) continue;
    charRects.get(t)!.forEach((r, i) => {
      if (r.left >= bbox.minX && r.right <= bbox.maxX && r.top >= bbox.minY && r.bottom <= bbox.maxY) {
        if (!first) first = [t, i];
        last = [t, i + 1];
      }
    });
  }
  if (!first || !last) return null;
  const out = document.createRange();
  out.setStart(first[0], first[1]);
  out.setEnd(last[0], last[1]);
  return out.toString();
}

function lineByEveryNode(bbox: BBox, kind: 'above' | 'through'): string | null {
  const rem = 16;
  let best: { t: Text; v: number } | null = null;
  for (const t of textList) {
    if (!t.textContent || !t.textContent.trim()) continue;
    const r = document.createRange();
    r.selectNodeContents(t);
    for (const line of rangeRects(r)) {
      if (!(line.right >= bbox.minX && line.left <= bbox.maxX)) continue;
      let v: number;
      if (kind === 'above') {
        v = bbox.minY - line.bottom;
        if (v < -2 || v > 0.5 * rem) continue;
      } else {
        v = Math.abs((bbox.minY + bbox.maxY) / 2 - (line.top + line.bottom) / 2);
        if (v > 0.4 * rem) continue;
      }
      if (!best || v < best.v) best = { t, v };
    }
  }
  return best ? best.t.data : null;
}

describe('findEnclosedText on a long article', () => {
  it('measures the characters near the stroke, not every character of the article', () => {
    const root = article(200, 30); // ~45,000 characters
    const t = words[100 * 30 + 7]; // a word in the middle of block 101
    const bbox = boxAround(t, 0, t.length - 1);
    measured = 0;
    const found = findEnclosedText(bbox, root);
    expect(found?.toString()).toBe(t.data.trimEnd());
    // Measuring every character took ~45,000.
    expect(measured).toBeLessThan(1500);
  });

  it('finds what measuring every character finds, wherever the stroke is', () => {
    const root = article(40, 12);
    const boxes: BBox[] = [];
    // Around single words, across several words and lines, across blocks,
    // over nothing, and half over a word.
    for (const i of [0, 5, 13, 77, 200, 333, words.length - 1]) {
      const t = words[i];
      boxes.push(boxAround(t, 0, t.length - 1));
      boxes.push(boxAround(t, 1, t.length - 2, 0));
    }
    for (const [a, b] of [[3, 9], [20, 40], [100, 160], [12, 24]]) {
      const ra = union(charRects.get(words[a])!);
      const rb = union(charRects.get(words[b])!);
      const minX = Math.min(ra.left, rb.left) - 1;
      const maxX = Math.max(ra.right, rb.right) + 1;
      boxes.push({ minX, maxX, minY: ra.top - 1, maxY: rb.bottom + 1, width: maxX - minX, height: rb.bottom - ra.top + 2 });
    }
    boxes.push({ minX: 0, maxX: 90, minY: 0, maxY: 5000, width: 90, height: 5000 });
    boxes.push({ minX: 5000, maxX: 6000, minY: 5000, maxY: 6000, width: 1000, height: 1000 });
    boxes.push({ minX: -10, maxX: 300, minY: -10, maxY: 120, width: 310, height: 130 });
    for (const bbox of boxes) {
      expect(findEnclosedText(bbox, root)?.toString() ?? null).toBe(enclosedByEveryChar(bbox));
    }
  });
});

describe('finding the line a stroke underlines or strikes through', () => {
  it('measures the blocks near the stroke, not every text node of the article', () => {
    const root = article(200, 30); // 6,000 text nodes
    const t = words[150 * 30 + 3];
    const r = union(charRects.get(t)!);
    const under: BBox = { minX: r.left, maxX: r.right, minY: r.bottom + 2, maxY: r.bottom + 4, width: r.width, height: 2 };
    measured = 0;
    expect(findTextLineAbove(under, root)?.toString()).toBe(lineByEveryNode(under, 'above'));
    expect(measured).toBeLessThan(1000);
    const mid = (r.top + r.bottom) / 2;
    const through: BBox = { minX: r.left, maxX: r.right, minY: mid - 1, maxY: mid + 1, width: r.width, height: 2 };
    measured = 0;
    expect(findTextLineThrough(through, root)?.toString()).toBe(lineByEveryNode(through, 'through'));
    expect(measured).toBeLessThan(1000);
  });

  it('finds what measuring every text node finds', () => {
    const root = article(40, 12);
    for (const i of [0, 7, 50, 199, 300, words.length - 1]) {
      const r = union(charRects.get(words[i])!);
      for (const dy of [-3, 0, 1, 3, 7, 12]) {
        const under: BBox = { minX: r.left, maxX: r.right + 30, minY: r.bottom + dy, maxY: r.bottom + dy + 2, width: r.width + 30, height: 2 };
        expect(findTextLineAbove(under, root)?.toString() ?? null).toBe(lineByEveryNode(under, 'above'));
        const mid = (r.top + r.bottom) / 2 + dy;
        const through: BBox = { minX: r.left - 20, maxX: r.right, minY: mid - 1, maxY: mid + 1, width: r.width + 20, height: 2 };
        expect(findTextLineThrough(through, root)?.toString() ?? null).toBe(lineByEveryNode(through, 'through'));
      }
    }
  });
});
