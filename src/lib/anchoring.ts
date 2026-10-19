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

// Text inside a rendered diagram can't carry a text anchor: the svg is
// regenerated on every render (theme switch, reload, re-open), so an
// anchor made against it never resolves again, and its prefix/suffix
// context picks up the svg's inline <style> text. Highlight / note
// creation checks this and declines (the pen tool still works there).
export const DIAGRAM_ANNOTATION_HINT = 'Use the pen to mark up diagrams.';

// Only the range's ENDS matter: a selection across several paragraphs
// that happens to pass over a diagram is anchored to the article's text
// between its ends (see createAnchor), so it can still be highlighted.
export function rangeTouchesDiagram(range: Range): boolean {
  const inDiagram = (n: Node): boolean => {
    const el = n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement;
    return !!el?.closest('.mermaid-block');
  };
  return inDiagram(range.startContainer) || inDiagram(range.endContainer);
}

export function createAnchor(range: Range, viewerRoot: HTMLElement): Anchor | null {
  const startBlock = findContainingBlock(range.startContainer);
  const endBlock = findContainingBlock(range.endContainer);
  if (!startBlock || !endBlock) return null;
  const text = range.toString();
  if (!text) return null;

  // A selection over several blocks includes the text between them (the
  // newlines separating paragraphs), so it only exists in the article's
  // full text. Anchor it there and remember both ends.
  const crossBlock = startBlock !== endBlock;
  const scope = crossBlock ? viewerRoot : startBlock;
  const startOffset = posToPlaintextOffset(scope, range.startContainer, range.startOffset);
  const endOffset = posToPlaintextOffset(scope, range.endContainer, range.endOffset);

  const full = blockText(scope);
  const prefix = full.slice(Math.max(0, startOffset - CONTEXT_LEN), startOffset);
  const suffix = full.slice(endOffset, endOffset + CONTEXT_LEN);

  const anchor: Anchor = {
    text,
    prefix,
    suffix,
    blockHint: startBlock.dataset.blockId!,
  };
  if (crossBlock) anchor.endBlockHint = endBlock.dataset.blockId!;
  return anchor;
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
// We normalize by max(a.length, b.length) so a candidate whose context is shorter
// than the anchor's window pays a length penalty rather than scoring 1.0 on a single
// matching character. This prevents any short candidate context from silently
// scoring a perfect match and resolving to the wrong position.
function trailMatch(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const lim = Math.min(a.length, b.length);
  let n = 0;
  while (n < lim && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n / Math.max(a.length, b.length);
}

function headMatch(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const lim = Math.min(a.length, b.length);
  let n = 0;
  while (n < lim && a[n] === b[n]) n += 1;
  return n / Math.max(a.length, b.length);
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

// Search the article's full text (what a cross-block selection's text is
// part of). `lenient` accepts a single exact match even when the context
// scores low — used to recover highlights saved by versions that anchored
// cross-block text to its first block with clipped context.
function resolveInRoot(anchor: Anchor, viewerRoot: HTMLElement, lenient: boolean): Range | null {
  const full = blockText(viewerRoot);
  const indices = allIndexOf(full, anchor.text);
  if (indices.length === 0) return null;
  if (indices.length === 1) {
    const score = scoreCandidate(anchor, full, indices[0]);
    if (lenient || score >= SCORE_THRESHOLD / 2) {
      return rangeFromBlockOffsets(viewerRoot, indices[0], indices[0] + anchor.text.length);
    }
    return null;
  }
  const scored = indices.map((i) => ({ i, s: scoreCandidate(anchor, full, i) }));
  scored.sort((a, b) => b.s - a.s);
  if (scored[0].s >= SCORE_THRESHOLD && scored[0].s - scored[1].s >= MIN_GAP) {
    return rangeFromBlockOffsets(viewerRoot, scored[0].i, scored[0].i + anchor.text.length);
  }
  return null;
}

export function resolveAnchor(anchor: Anchor, viewerRoot: HTMLElement): Range | null {
  if (anchor.endBlockHint) return resolveInRoot(anchor, viewerRoot, false);

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
  if (!best) {
    // Text that no single block contains may span blocks — an anchor saved
    // before cross-block anchors recorded their end. Only a unique match.
    return resolveInRoot(anchor, viewerRoot, true);
  }
  if (best.score < SCORE_THRESHOLD) return null;
  if (best.score - secondBest < MIN_GAP) return null;
  return rangeFromBlockOffsets(best.block, best.i, best.i + anchor.text.length);
}
