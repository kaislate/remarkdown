// Re-use the Anchor type from the Zod schema so sidecar round-trips and anchor
// creation share a single source of truth.
import type { Anchor } from './schema';
export type { Anchor };

const CONTEXT_LEN = 32;
const SCORE_THRESHOLD = 0.7;
const MIN_GAP = 0.08; // winning candidate must beat runner-up by this margin

function findContainingBlock(node: Node): HTMLElement | null {
  let n: Node | null = node;
  while (n && n !== document) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      if (el.dataset && el.dataset.blockId) return el;
    }
    n = n.parentNode;
  }
  return null;
}

function blockText(block: HTMLElement): string {
  return block.textContent ?? '';
}

// Convert a DOM position (node + offset) to a plaintext offset within a block.
function posToPlaintextOffset(block: HTMLElement, node: Node, offset: number): number {
  let acc = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let tn: Node | null = walker.nextNode();
  while (tn) {
    if (tn === node) return acc + offset;
    acc += (tn as Text).data.length;
    tn = walker.nextNode();
  }
  return acc;
}

// Convert a plaintext offset within a block back to a DOM (node, offset) pair.
function plaintextOffsetToPos(block: HTMLElement, target: number): { node: Text; offset: number } | null {
  let acc = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let tn = walker.nextNode() as Text | null;
  while (tn) {
    const next = acc + tn.data.length;
    if (target <= next) {
      return { node: tn, offset: target - acc };
    }
    acc = next;
    tn = walker.nextNode() as Text | null;
  }
  return null;
}

export function createAnchor(range: Range, _viewerRoot: HTMLElement): Anchor | null {
  const startBlock = findContainingBlock(range.startContainer);
  const endBlock = findContainingBlock(range.endContainer);
  if (!startBlock || !endBlock) return null;
  // Clamp cross-block ranges by anchoring to the start block only.
  const block = startBlock;
  const text = range.toString();
  if (!text) return null;

  const startOffset = posToPlaintextOffset(block, range.startContainer, range.startOffset);
  const endOffset = startBlock === endBlock
    ? posToPlaintextOffset(block, range.endContainer, range.endOffset)
    : Math.min(startOffset + text.length, blockText(block).length);

  const full = blockText(block);
  const prefix = full.slice(Math.max(0, startOffset - CONTEXT_LEN), startOffset);
  const suffix = full.slice(endOffset, endOffset + CONTEXT_LEN);

  return {
    text,
    prefix,
    suffix,
    blockHint: block.dataset.blockId!,
  };
}

// Find all plaintext offsets of `needle` in `hay`. Linear scan.
function allIndexOf(hay: string, needle: string): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  while (from <= hay.length - needle.length) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    out.push(i);
    from = i + 1;
  }
  return out;
}

// Similarity measures in [0, 1] — trailing-char overlap for prefix, leading for suffix.
// We normalize by the comparable window (min of the two lengths) so that
// edge-of-block context (one side shorter than the other) isn't unfairly
// penalized. Perfect match over the comparable window is 1.0; a tie between
// two candidates at 1.0 is then correctly ambiguous.
function trailMatch(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const lim = Math.min(a.length, b.length);
  let n = 0;
  while (n < lim && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n / lim;
}

function headMatch(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const lim = Math.min(a.length, b.length);
  let n = 0;
  while (n < lim && a[n] === b[n]) n += 1;
  return n / lim;
}

function scoreCandidate(anchor: Anchor, full: string, index: number): number {
  const cPrefix = full.slice(Math.max(0, index - CONTEXT_LEN), index);
  const cSuffix = full.slice(index + anchor.text.length, index + anchor.text.length + CONTEXT_LEN);
  return (trailMatch(anchor.prefix, cPrefix) + headMatch(anchor.suffix, cSuffix)) / 2;
}

function rangeFromBlockOffsets(block: HTMLElement, start: number, end: number): Range | null {
  const s = plaintextOffsetToPos(block, start);
  const e = plaintextOffsetToPos(block, end);
  if (!s || !e) return null;
  const range = document.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  return range;
}

export function resolveAnchor(anchor: Anchor, viewerRoot: HTMLElement): Range | null {
  const hinted = viewerRoot.querySelector(`[data-block-id="${CSS.escape(anchor.blockHint)}"]`) as HTMLElement | null;
  if (hinted) {
    const full = blockText(hinted);
    const indices = allIndexOf(full, anchor.text);
    if (indices.length === 1) {
      return rangeFromBlockOffsets(hinted, indices[0], indices[0] + anchor.text.length);
    }
    if (indices.length > 1) {
      const scored = indices.map((i) => ({ i, s: scoreCandidate(anchor, full, i) }));
      scored.sort((a, b) => b.s - a.s);
      if (scored[0].s >= SCORE_THRESHOLD && scored[0].s - (scored[1]?.s ?? 0) >= MIN_GAP) {
        return rangeFromBlockOffsets(hinted, scored[0].i, scored[0].i + anchor.text.length);
      }
    }
  }

  // Slow path: scan every block.
  const blocks = Array.from(viewerRoot.querySelectorAll<HTMLElement>('[data-block-id]'));
  let best: { block: HTMLElement; i: number; score: number } | null = null;
  let secondBest = 0;
  for (const block of blocks) {
    const full = blockText(block);
    for (const i of allIndexOf(full, anchor.text)) {
      const s = scoreCandidate(anchor, full, i);
      if (!best || s > best.score) {
        if (best) secondBest = Math.max(secondBest, best.score);
        best = { block, i, score: s };
      } else if (s > secondBest) {
        secondBest = s;
      }
    }
  }
  if (!best) return null;
  if (best.score < SCORE_THRESHOLD) return null;
  if (best.score - secondBest < MIN_GAP) return null;
  return rangeFromBlockOffsets(best.block, best.i, best.i + anchor.text.length);
}
