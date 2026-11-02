// Re-use the Anchor type from the Zod schema so sidecar round-trips and anchor
// creation share a single source of truth.
import type { Anchor } from './schema';
export type { Anchor };

const CONTEXT_LEN = 32;
const SCORE_THRESHOLD = 0.7;
const MIN_GAP = 0.08; // winning candidate must beat runner-up by this margin
// Every place an anchor's text occurs is scored, so a one-letter anchor in a
// long article costs thousands of scores, and a crafted sidecar holds
// thousands of such anchors. Past this many places the text is too common to
// tell them apart by scoring anyway; only its whole saved context, found
// word for word in exactly one place, still places it (see uniqueInContext).
const MAX_CANDIDATES = 1000;
// And each anchor still searches the article up to three times, so 20,000
// anchors (the most a sidecar may hold) over a long article took minutes. One
// pass may look at this many characters in all, a scored place counting as
// the context it compares: about half a second on prose, four on the slowest
// text to search (every character the start of a near-match), which the time
// limit below stops first. An anchor whose block moved looks near it before
// searching the whole article (see NEARBY), so a heavy reader's thousand
// highlights in a 600 KB article with a paragraph added at the top take a
// few million; each searched for in the whole article (had the words around
// each been edited too), 600 million. Past it, the pass's remaining anchors are
// left unplaced: their annotations aren't changed (they're saved back as
// they are), and the next pass tries them again. The searches check it too,
// as one anchor can run far past it alone: text that's half of a long
// paragraph is found at a thousand places, and each find reads it all.
const PASS_BUDGET = 1_000_000_000;
// The characters a search passes over are only a guess at what it costs: a
// browser's search can compare a long text at each place it passes, and
// how often it does differs between browsers. So a pass also stops at this
// many milliseconds, whatever it has counted: twice what the budget takes on
// prose, as a pass cut short shows the rest of its annotations as unplaced,
// and the next pass, cut at the same place, would too.
const PASS_TIME = 1_000;
// A text longer than this is searched for by its first this-many
// characters, and each place they're found is checked for the rest. Given
// the whole of a long text, Chromium's search compares up to all of it at
// each place when its last 250 characters are found there and what's
// before them isn't: 80 ns a character with 250 of them, 2 µs with 5,000,
// against the 4 ns the cap allows. Checking a place is counted as the
// length of the text, which is what it costs at most.
const SEARCH_HEAD = 64;

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

// The text nodes that make up a scope's plain text. Across the whole article
// (cross-block anchors) diagrams are left out: their svg text — inline
// styles, generated ids — changes on every render and isn't reading text,
// so an anchor that included it could never be found again.
function textWalker(scope: HTMLElement, skipDiagrams: boolean): TreeWalker {
  if (!skipDiagrams) return document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  return document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      return (n as Element).classList.contains('mermaid-block') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    },
  });
}

// A scope's text nodes, and the offset in its text at which each one starts.
interface TextNodes { nodes: Text[]; starts: number[] }

// An article's blocks, in order and by id; and, once an anchor has needed
// to search all of them, their texts joined (see blockHits). And, once an
// anchor has missed its block, where each block is in the list, and how far
// the blocks of the anchors found since had moved (see nearbyBlocks).
interface Blocks {
  list: HTMLElement[];
  byId: Map<string, HTMLElement>;
  joined?: { text: string; starts: number[] };
  order?: { ofBlock: Map<HTMLElement, number>; ofNumber: Map<number, number> };
  moves: { at: Map<number, number>; last: number };
}

// What the current resolvingPass has built already: per scope, its text and
// its text nodes; per article, its blocks.
interface ScopeCache { text: Map<HTMLElement, string>; nodes: Map<HTMLElement, TextNodes> }
let pass: { plain: ScopeCache; noDiagrams: ScopeCache; blocks: Map<HTMLElement, Blocks>; budget: number; deadline: number } | null =
  null;

const scopeCache = (skipDiagrams: boolean): ScopeCache | null =>
  pass && (skipDiagrams ? pass.noDiagrams : pass.plain);

// Runs `fn` with the text of each block (and of the whole article) built
// once and shared by every anchor resolved inside it, instead of once per
// anchor. Only for synchronous work that doesn't change the DOM.
export function resolvingPass<T>(fn: () => T): T {
  if (pass) return fn();
  const fresh = (): ScopeCache => ({ text: new Map(), nodes: new Map() });
  pass = { plain: fresh(), noDiagrams: fresh(), blocks: new Map(), budget: PASS_BUDGET, deadline: performance.now() + PASS_TIME };
  try {
    return fn();
  } finally {
    pass = null;
  }
}

// Counts work against the pass's budget (see PASS_BUDGET); outside a pass,
// one anchor at a time, nothing is counted.
function spend(chars: number): void {
  if (pass) pass.budget -= chars;
}

// Whether the pass has looked at all it may, or taken all the time it may.
function spent(): boolean {
  return !!pass && (pass.budget <= 0 || performance.now() > pass.deadline);
}

// `hay.indexOf(needle, from)`, counting the characters it went through. A
// long needle is found by its head, each place checked for the rest (see
// SEARCH_HEAD); a pass that runs out while it checks gets -1.
function find(hay: string, needle: string, from = 0): number {
  if (needle.length <= SEARCH_HEAD) {
    const i = hay.indexOf(needle, from);
    spend(Math.max(0, (i < 0 ? hay.length : i + needle.length) - from));
    return i;
  }
  const head = needle.slice(0, SEARCH_HEAD);
  for (let at = from; !spent(); at += 1) {
    at = find(hay, head, at);
    if (at < 0) return -1;
    spend(needle.length);
    if (hay.startsWith(needle, at)) return at;
  }
  return -1;
}

function blocksOf(viewerRoot: HTMLElement): Blocks {
  let blocks = pass?.blocks.get(viewerRoot);
  if (!blocks) {
    const list = Array.from(viewerRoot.querySelectorAll<HTMLElement>('[data-block-id]'));
    const byId = new Map<string, HTMLElement>();
    // The first of any two with one id, as querySelector finds it.
    for (const b of list) if (!byId.has(b.dataset.blockId!)) byId.set(b.dataset.blockId!, b);
    blocks = { list, byId, moves: { at: new Map(), last: 0 } };
    pass?.blocks.set(viewerRoot, blocks);
  }
  return blocks;
}

// The block with this id. Inside a pass, from the list of blocks it built
// once, rather than a search of the page for each lookup.
export function blockById(viewerRoot: HTMLElement, id: string): HTMLElement | null {
  if (pass) return blocksOf(viewerRoot).byId.get(id) ?? null;
  return viewerRoot.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
}

function blockText(block: HTMLElement, skipDiagrams = false): string {
  const cache = scopeCache(skipDiagrams);
  const cached = cache?.text.get(block);
  if (cached !== undefined) return cached;
  let out = '';
  if (!skipDiagrams) {
    out = block.textContent ?? '';
  } else {
    // The same walk lists the nodes, for turning offsets back into places.
    for (const n of cachedTextNodes(block, true)) out += n.data;
  }
  cache?.text.set(block, out);
  return out;
}

// Convert a DOM position (node + offset) to a plaintext offset within a block.
function posToPlaintextOffset(block: HTMLElement, node: Node, offset: number, skipDiagrams = false): number {
  let acc = 0;
  const walker = textWalker(block, skipDiagrams);
  let tn: Node | null = walker.nextNode();
  while (tn) {
    if (tn === node) return acc + offset;
    acc += (tn as Text).data.length;
    tn = walker.nextNode();
  }
  return acc;
}

function textNodes(block: HTMLElement, skipDiagrams: boolean): TextNodes {
  const out: TextNodes = { nodes: [], starts: [] };
  let acc = 0;
  const walker = textWalker(block, skipDiagrams);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    out.nodes.push(n);
    out.starts.push(acc);
    acc += n.data.length;
  }
  return out;
}

// Walking the article for each anchor's two ends is the cost a pass over
// thousands of anchors can't pay, so inside one each scope is walked once.
function cachedTextNodes(block: HTMLElement, skipDiagrams: boolean): Text[] {
  return cachedTextIndex(block, skipDiagrams).nodes;
}

function cachedTextIndex(block: HTMLElement, skipDiagrams: boolean): TextNodes {
  const cache = scopeCache(skipDiagrams);
  let list = cache?.nodes.get(block);
  if (!list) {
    list = textNodes(block, skipDiagrams);
    cache?.nodes.set(block, list);
  }
  return list;
}

// Convert a plaintext offset within a block back to a DOM (node, offset)
// pair: the first text node that reaches the offset, so an offset on the
// edge between two nodes lands at the end of the earlier one. Found by
// halves in the scope's list of nodes.
function plaintextOffsetToPos(block: HTMLElement, target: number, skipDiagrams = false): { node: Text; offset: number } | null {
  const { nodes, starts } = cachedTextIndex(block, skipDiagrams);
  let lo = 0;
  let hi = nodes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (target <= starts[mid] + nodes[mid].data.length) hi = mid;
    else lo = mid + 1;
  }
  if (lo === nodes.length) return null;
  return { node: nodes[lo], offset: target - starts[lo] };
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

  // A selection over several blocks includes the text between them (the
  // newlines separating paragraphs), so it only exists in the article's
  // full text. Anchor it there — without any diagrams it passes over — and
  // remember both ends.
  const crossBlock = startBlock !== endBlock;
  const scope = crossBlock ? viewerRoot : startBlock;
  const startOffset = posToPlaintextOffset(scope, range.startContainer, range.startOffset, crossBlock);
  const endOffset = posToPlaintextOffset(scope, range.endContainer, range.endOffset, crossBlock);

  const full = blockText(scope, crossBlock);
  const text = crossBlock ? full.slice(startOffset, endOffset) : range.toString();
  if (!text) return null;
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

// Find all plaintext offsets of `needle` in `hay`, stopping after `limit`
// of them. Linear scan.
function allIndexOf(hay: string, needle: string, limit = Infinity): number[] {
  if (!needle) return [];
  const out: number[] = [];
  let from = 0;
  while (out.length < limit && from <= hay.length - needle.length && !spent()) {
    const i = find(hay, needle, from);
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
// The candidate's context `b` is the `bLen` characters of `full` that end
// (trailMatch) or start (headMatch) at `at`, read in place rather than
// sliced out, as up to a thousand candidates are scored for each anchor.
function trailMatch(a: string, full: string, at: number, bLen: number): number {
  if (!a && !bLen) return 1;
  if (!a || !bLen) return 0;
  const lim = Math.min(a.length, bLen);
  let n = 0;
  while (n < lim && a.charCodeAt(a.length - 1 - n) === full.charCodeAt(at - 1 - n)) n += 1;
  return n / Math.max(a.length, bLen);
}

function headMatch(a: string, full: string, at: number, bLen: number): number {
  if (!a && !bLen) return 1;
  if (!a || !bLen) return 0;
  const lim = Math.min(a.length, bLen);
  let n = 0;
  while (n < lim && a.charCodeAt(n) === full.charCodeAt(at + n)) n += 1;
  return n / Math.max(a.length, bLen);
}

function scoreCandidate(anchor: Anchor, full: string, index: number): number {
  spend(2 * CONTEXT_LEN);
  const end = index + anchor.text.length;
  const prefixLen = Math.min(CONTEXT_LEN, index);
  const suffixLen = Math.max(0, Math.min(CONTEXT_LEN, full.length - end));
  return (trailMatch(anchor.prefix, full, index, prefixLen) + headMatch(anchor.suffix, full, end, suffixLen)) / 2;
}

// The best-scoring candidate, and the score of the next best.
function bestOf(anchor: Anchor, full: string, indices: number[]): { i: number; s: number; next: number } {
  let best = { i: indices[0], s: -1, next: 0 };
  for (const i of indices) {
    const s = scoreCandidate(anchor, full, i);
    if (s > best.s) best = { i, s, next: Math.max(best.next, best.s) };
    else if (s > best.next) best.next = s;
  }
  return best;
}

// Where the anchor's text is, if its saved prefix, text and suffix occur
// together in exactly one place in `full`; otherwise -1. Two plain searches,
// so it costs the same however common the text is.
function uniqueInContext(anchor: Anchor, full: string): number {
  const needle = anchor.prefix + anchor.text + anchor.suffix;
  const at = find(full, needle);
  if (at < 0 || find(full, needle, at + 1) >= 0) return -1;
  return at + anchor.prefix.length;
}

function rangeFromBlockOffsets(block: HTMLElement, start: number, end: number, skipDiagrams = false): Range | null {
  const s = plaintextOffsetToPos(block, start, skipDiagrams);
  const e = plaintextOffsetToPos(block, end, skipDiagrams);
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
  // Same text createAnchor used: the article without its diagrams. (This
  // also keeps the lenient fallback from landing in diagram labels.)
  const full = blockText(viewerRoot, true);
  const indices = allIndexOf(full, anchor.text, MAX_CANDIDATES + 1);
  if (indices.length === 0) return null;
  if (indices.length > MAX_CANDIDATES) {
    const i = uniqueInContext(anchor, full);
    return i < 0 ? null : rangeFromBlockOffsets(viewerRoot, i, i + anchor.text.length, true);
  }
  if (indices.length === 1) {
    const score = scoreCandidate(anchor, full, indices[0]);
    if (lenient || score >= SCORE_THRESHOLD / 2) {
      return rangeFromBlockOffsets(viewerRoot, indices[0], indices[0] + anchor.text.length, true);
    }
    return null;
  }
  const best = bestOf(anchor, full, indices);
  if (best.s >= SCORE_THRESHOLD && best.s - best.next >= MIN_GAP) {
    return rangeFromBlockOffsets(viewerRoot, best.i, best.i + anchor.text.length, true);
  }
  return null;
}

// Every place `needle` occurs inside a block, in block order, up to `limit`
// of them. The blocks' texts are joined with a NUL between them and searched
// once, instead of block by block: thousands of searches an anchor, in a
// long article, which a crafted sidecar repeats for each of its anchors. A
// match that runs past the end of its block's text isn't in the block, and
// is skipped.
function blockHits(blocks: Blocks, needle: string, limit: number): { block: HTMLElement; i: number }[] {
  if (!needle) return [];
  if (!blocks.joined) {
    const texts = blocks.list.map((b) => blockText(b));
    const starts: number[] = [];
    let at = 0;
    for (const t of texts) {
      starts.push(at);
      at += t.length + 1;
    }
    blocks.joined = { text: texts.join('\0'), starts };
  }
  const { text, starts } = blocks.joined;
  const out: { block: HTMLElement; i: number }[] = [];
  for (let h = find(text, needle); h >= 0 && out.length < limit && !spent(); h = find(text, needle, h + 1)) {
    // The last block starting at or before the match.
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= h) lo = mid;
      else hi = mid - 1;
    }
    const block = blocks.list[lo];
    const i = h - starts[lo];
    if (i + needle.length <= blockText(block).length) out.push({ block, i });
  }
  return out;
}

// uniqueInContext over every block: the one block, and place in it, where
// the anchor's whole context occurs, if there is exactly one.
function uniqueInContextOfBlocks(anchor: Anchor, blocks: Blocks): Range | null {
  const found = blockHits(blocks, anchor.prefix + anchor.text + anchor.suffix, 2);
  if (found.length !== 1) return null;
  const i = found[0].i + anchor.prefix.length;
  return rangeFromBlockOffsets(found[0].block, i, i + anchor.text.length);
}

export function resolveAnchor(anchor: Anchor, viewerRoot: HTMLElement): Range | null {
  if (spent()) return null;
  const range = place(anchor, viewerRoot);
  // A search the cap cut short may have missed places the text is, so what
  // was made of the places it found can't be trusted.
  return spent() ? null : range;
}

// A block's id is its kind and its place in the article (`p:12`, the
// twelfth block), so a block added or removed above an anchor's block
// renumbers it: the anchor's hint then names another block, and each of a
// heavy reader's thousand highlights would search the whole article (see
// PASS_BUDGET). Blocks don't go far, though, and
// the ones above an edit all move by the same amount. So before the whole
// article, an anchor looks for itself in the blocks this many places either
// side of where its block was, of where it would be had it moved as far as
// the blocks of the anchors found nearest to it in the pass, and of where it
// would be had it moved as far as the last one found.
const NEARBY = 3;
// How many places either side of an anchor's block the pass looks for an
// anchor found already, to learn how far blocks there have moved.
const MOVES_SEEN = 64;

function blockNumber(id: string): number | null {
  const m = /:(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

function orderOf(blocks: Blocks): NonNullable<Blocks['order']> {
  if (!blocks.order) {
    const ofBlock = new Map<HTMLElement, number>();
    const ofNumber = new Map<number, number>();
    blocks.list.forEach((b, i) => {
      ofBlock.set(b, i);
      const n = blockNumber(b.dataset.blockId!);
      if (n !== null && !ofNumber.has(n)) ofNumber.set(n, i);
    });
    blocks.order = { ofBlock, ofNumber };
  }
  return blocks.order;
}

// Where in the article's blocks the anchor's block was, or null if its id
// doesn't say. Past the article's end when the article now ends sooner.
function hintPosition(blocks: Blocks, hint: string): number | null {
  const n = blockNumber(hint);
  if (n === null) return null;
  return orderOf(blocks).ofNumber.get(n) ?? n - 1;
}

function learnMove(blocks: Blocks, hintAt: number, block: HTMLElement | null): void {
  const at = block ? orderOf(blocks).ofBlock.get(block) : undefined;
  if (at === undefined) return;
  blocks.moves.at.set(hintAt, at - hintAt);
  blocks.moves.last = at - hintAt;
}

// The anchor in a block near where its block was (see NEARBY). Only where
// its whole saved context is found, word for word, in one place in the
// block, and nothing more of the block before or after it than when it was
// saved: what the whole article's search would score highest, so this only
// finds sooner what that would, or picks the nearest of places that read the
// same, which that would refuse.
function nearbyBlocks(anchor: Anchor, blocks: Blocks, hintAt: number, searched: HTMLElement | null): Range | null {
  const { list, moves } = blocks;
  let learned: number | undefined;
  for (let d = 0; d <= MOVES_SEEN && learned === undefined; d++) {
    learned = moves.at.get(hintAt - d) ?? moves.at.get(hintAt + d);
  }
  const tried = new Set<number>();
  for (const shift of [learned ?? moves.last, moves.last, 0]) {
    for (let d = 0; d <= NEARBY; d++) {
      for (const at of d ? [hintAt + shift - d, hintAt + shift + d] : [hintAt + shift]) {
        if (at < 0 || at >= list.length || tried.has(at)) continue;
        tried.add(at);
        const block = list[at];
        if (block === searched) continue;
        const full = blockText(block);
        const i = uniqueInContext(anchor, full);
        if (spent()) return null;
        if (i >= 0 && scoreCandidate(anchor, full, i) === 1) {
          learnMove(blocks, hintAt, block);
          return rangeFromBlockOffsets(block, i, i + anchor.text.length);
        }
      }
    }
  }
  return null;
}

function place(anchor: Anchor, viewerRoot: HTMLElement): Range | null {
  if (anchor.endBlockHint) return resolveInRoot(anchor, viewerRoot, false);

  const hinted = blockById(viewerRoot, anchor.blockHint);
  if (hinted) {
    const full = blockText(hinted);
    const indices = allIndexOf(full, anchor.text, MAX_CANDIDATES + 1);
    if (indices.length === 1) {
      return rangeFromBlockOffsets(hinted, indices[0], indices[0] + anchor.text.length);
    }
    if (indices.length > MAX_CANDIDATES) {
      const i = uniqueInContext(anchor, full);
      if (i >= 0) return rangeFromBlockOffsets(hinted, i, i + anchor.text.length);
    } else if (indices.length > 1) {
      const best = bestOf(anchor, full, indices);
      if (best.s >= SCORE_THRESHOLD && best.s - best.next >= MIN_GAP) {
        return rangeFromBlockOffsets(hinted, best.i, best.i + anchor.text.length);
      }
    }
  }

  const blocks = blocksOf(viewerRoot);
  const hintAt = hintPosition(blocks, anchor.blockHint);
  if (hintAt === null) return scanBlocks(anchor, viewerRoot, blocks);
  const near = nearbyBlocks(anchor, blocks, hintAt, hinted);
  if (near || spent()) return near;
  const range = scanBlocks(anchor, viewerRoot, blocks);
  if (range) learnMove(blocks, hintAt, findContainingBlock(range.startContainer));
  return range;
}

// Slow path: scan every block.
function scanBlocks(anchor: Anchor, viewerRoot: HTMLElement, blocks: Blocks): Range | null {
  const hits = blockHits(blocks, anchor.text, MAX_CANDIDATES + 1);
  if (hits.length > MAX_CANDIDATES) return uniqueInContextOfBlocks(anchor, blocks);
  let best: { block: HTMLElement; i: number; score: number } | null = null;
  let secondBest = 0;
  for (const { block, i } of hits) {
    const s = scoreCandidate(anchor, blockText(block), i);
    if (!best || s > best.score) {
      if (best) secondBest = Math.max(secondBest, best.score);
      best = { block, i, score: s };
    } else if (s > secondBest) {
      secondBest = s;
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
