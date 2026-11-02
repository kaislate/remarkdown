// Shared sentence-context computation for re.mark surfaces (marginalia
// column + bottom-left popover panel). Keeps the two views in lockstep
// for the same re.mark.

import { buildSentenceContext, sentenceContextOf } from './sentence-context';
import { domVersion } from './dom-version';

export interface ContextOptions {
  /** Number of sentences of context to include (the anchor's sentence
   *  plus N-1 preceding ones). 1..5. */
  sentences: number;
  /** Stop walking back past the anchor's containing block (paragraph,
   *  heading, etc.). When false, walks across earlier blocks to fill
   *  the sentence budget. */
  stopAtParagraph: boolean;
  /** Cap context to the bullet item the anchor lives in, regardless
   *  of stopAtParagraph. Without this, an anchor inside an <li> would
   *  walk across other list items + earlier paragraphs. */
  stopAtListItem: boolean;
}

// Walk text nodes inside `el` until we hit `range.startContainer`,
// returning the cumulative character offset of the range's start
// within el. Returns null if the range's start isn't found inside.
function anchorOffsetWithin(range: Range, el: HTMLElement): number | null {
  let acc = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n) {
    if (n === range.startContainer) {
      return acc + range.startOffset;
    }
    acc += (n as Text).data.length;
    n = walker.nextNode();
  }
  return null;
}

// Find the nearest enclosing <li> for the range's start, or null if
// the range isn't inside any list item.
function findListItem(range: Range): HTMLElement | null {
  const startEl = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : (range.startContainer as Element);
  return startEl?.closest('li') ?? null;
}

/**
 * Build the display context for one re.mark — the anchor's sentence
 * plus options.sentences-1 preceding ones.
 *
 * Stops at:
 *   - The enclosing <li> if stopAtListItem is true and the anchor is
 *     inside one. This always wins over stopAtParagraph since a
 *     bulleted item is the natural unit even when the user has
 *     'cross paragraph boundaries' on.
 *   - The anchor's containing block if stopAtParagraph is true.
 *   - Otherwise walks back across earlier [data-block-id] blocks to
 *     fill the sentence budget.
 */
export function contextFor(
  range: Range,
  root: HTMLElement | null,
  options: ContextOptions,
): string {
  if (!root) return '';
  // Kept per range while the article (see dom-version.ts), the range's
  // ends and the settings are what they were: the margin cards are laid
  // out again on every change, resize and zoom, and the re.marks panel
  // shows the same contexts.
  const version = domVersion(root);
  const key = `${options.sentences}|${options.stopAtParagraph}|${options.stopAtListItem}`;
  const kept = keptContexts.get(range);
  if (
    kept && kept.root === root && kept.version === version && kept.key === key
    && kept.start === range.startContainer && kept.startOffset === range.startOffset
  ) {
    return kept.value;
  }
  const value = contextAfresh(range, root, options);
  // Only what's read from inside the article, which is what the version
  // follows.
  const block = startElement(range)?.closest('[data-block-id]');
  if (root.contains(range.startContainer) && (!block || root.contains(block))) {
    keptContexts.set(range, { root, version, key, start: range.startContainer, startOffset: range.startOffset, value });
  }
  return value;
}

const startElement = (range: Range): Element | null =>
  range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : (range.startContainer as Element);

interface Kept {
  root: HTMLElement;
  version: number;
  key: string;
  start: Node;
  startOffset: number;
  value: string;
}
const keptContexts = new WeakMap<Range, Kept>();

// The article's blocks in order, and where each is in it, kept while the
// article doesn't change.
const keptBlocks = new WeakMap<HTMLElement, { version: number; list: HTMLElement[]; at: Map<HTMLElement, number> }>();

function blocksOf(root: HTMLElement): { list: HTMLElement[]; at: Map<HTMLElement, number> } {
  const version = domVersion(root);
  let kept = keptBlocks.get(root);
  if (!kept || kept.version !== version) {
    const list = Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'));
    const at = new Map<HTMLElement, number>();
    list.forEach((b, i) => { if (!at.has(b)) at.set(b, i); });
    kept = { version, list, at };
    keptBlocks.set(root, kept);
  }
  return kept;
}

function contextAfresh(
  range: Range,
  root: HTMLElement,
  options: ContextOptions,
): string {
  // List-item path: cap context to the bullet text alone.
  if (options.stopAtListItem) {
    const li = findListItem(range);
    if (li && root.contains(li)) {
      const liText = li.textContent ?? '';
      const offset = anchorOffsetWithin(range, li);
      if (offset === null) return liText;
      return buildSentenceContext(
        [liText],
        offset,
        options.sentences,
        true, // force single-block behaviour for the bullet
      );
    }
  }

  // Block path: find the nearest [data-block-id] block.
  const startEl = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : (range.startContainer as Element);
  const block = startEl?.closest<HTMLElement>('[data-block-id]');
  if (!block) return '';

  const offset = anchorOffsetWithin(range, block);
  if (offset === null) return block.textContent ?? '';

  if (options.stopAtParagraph) {
    return buildSentenceContext([block.textContent ?? ''], offset, options.sentences, true);
  }
  // The blocks up to the anchor's, whose texts are read back from it only
  // as far as the sentences go.
  const { list, at } = blocksOf(root);
  const idx = at.get(block) ?? -1;
  if (idx < 0) return buildSentenceContext([block.textContent ?? ''], offset, options.sentences, false);
  return sentenceContextOf(idx + 1, (i) => list[i].textContent ?? '', offset, options.sentences, false);
}
