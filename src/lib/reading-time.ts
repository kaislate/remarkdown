// "N min left" for reader mode's meta line: the words still below the
// bottom of the viewport, read at an average adult pace.

export const READING_WPM = 230;

export interface BlockExtent {
  // Viewport-relative edges, in px.
  top: number;
  bottom: number;
  words: number;
}

// A word is any run of non-space characters with at least one letter or
// digit in it — a lone dash or bullet isn't something anyone reads.
export function countWords(text: string): number {
  let n = 0;
  for (const token of text.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) n += 1;
  }
  return n;
}

// Words below `fold` (the viewport's bottom edge). A block that straddles
// the fold counts the share of its height that is still below it.
export function wordsBelow(blocks: readonly BlockExtent[], fold: number): number {
  let total = 0;
  for (const b of blocks) {
    if (b.top >= fold) {
      total += b.words;
    } else if (b.bottom > fold) {
      total += b.words * ((b.bottom - fold) / (b.bottom - b.top));
    }
  }
  return Math.round(total);
}

export function minutesLeft(words: number, wpm: number = READING_WPM): number {
  return words <= 0 ? 0 : Math.ceil(words / wpm);
}
