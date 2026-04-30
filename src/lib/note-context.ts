// Shared sentence-context computation for re.mark surfaces (marginalia
// column + bottom-left popover panel). Keeps the two views in lockstep
// for the same re.mark.

import { buildSentenceContext } from './sentence-context';

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

  const blocks = options.stopAtParagraph
    ? [block]
    : (() => {
        const all = Array.from(root.querySelectorAll<HTMLElement>('[data-block-id]'));
        const idx = all.indexOf(block);
        return idx < 0 ? [block] : all.slice(0, idx + 1);
      })();
  const blockTexts = blocks.map((b) => b.textContent ?? '');

  return buildSentenceContext(
    blockTexts,
    offset,
    options.sentences,
    options.stopAtParagraph,
  );
}
