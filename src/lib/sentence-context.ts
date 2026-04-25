// Helpers for showing the sentence(s) of context around an annotation
// in the re.marks panel. Operates on plain text from the rendered DOM
// — sentence detection is the lightweight `[.!?]+` + whitespace
// heuristic, not a full NLP tokeniser, which is more than good enough
// for the brief excerpts shown in the panel.

// Returns the offsets where each sentence ENDS (exclusive of the
// terminator + whitespace). Sentence i runs [splits[i-1] || 0, splits[i]).
export function findSentenceSplits(text: string): number[] {
  const splits: number[] = [];
  const re = /[.!?]+\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    splits.push(m.index + m[0].length);
  }
  return splits;
}

// Total sentence count in `text` (always ≥ 1 if non-empty).
export function countSentences(text: string): number {
  if (!text.trim()) return 0;
  return findSentenceSplits(text).length + 1;
}

// Find the sentence-index that contains a given character offset.
export function sentenceIndexAt(text: string, charOffset: number): number {
  const splits = findSentenceSplits(text);
  let idx = 0;
  for (const s of splits) {
    if (charOffset < s) return idx;
    idx += 1;
  }
  return idx;
}

// Return the [start, end) bounds of sentences i..j (inclusive of both)
// in `text`, with whitespace trimmed from the end.
export function sentenceSliceBounds(
  text: string,
  startIdx: number,
  endIdx: number,
): { start: number; end: number } {
  const splits = findSentenceSplits(text);
  const start = startIdx === 0 ? 0 : (splits[startIdx - 1] ?? 0);
  let end = endIdx >= splits.length ? text.length : splits[endIdx];
  while (end > start && /\s/.test(text[end - 1] ?? '')) end -= 1;
  return { start, end };
}

// Build the context string for a re.marks entry.
//   blockTexts: ordered list of block plaintexts. blockTexts[0] is the
//               EARLIEST block (oldest), blockTexts[blockTexts.length-1]
//               is the block CONTAINING the anchor.
//   anchorOffset: char offset of the anchor within the LAST block.
//   count: how many sentences to include (the anchor's sentence plus
//          count-1 preceding ones).
//   stopAtParagraph: when true, never cross a block boundary.
//
// Sentences from earlier blocks are joined with a single space so
// the output reads as continuous prose. The end of the result is the
// END of the anchor's sentence.
export function buildSentenceContext(
  blockTexts: string[],
  anchorOffset: number,
  count: number,
  stopAtParagraph: boolean,
): string {
  if (blockTexts.length === 0) return '';
  const last = blockTexts[blockTexts.length - 1];
  const anchorSentenceIdx = sentenceIndexAt(last, anchorOffset);

  // First, take sentences from the anchor's own block, walking
  // backward from the anchor's sentence.
  let needed = count;
  const fromLastStart = Math.max(0, anchorSentenceIdx - needed + 1);
  const lastBounds = sentenceSliceBounds(last, fromLastStart, anchorSentenceIdx);
  needed -= anchorSentenceIdx - fromLastStart + 1;
  const pieces: string[] = [last.slice(lastBounds.start, lastBounds.end).trim()];

  if (stopAtParagraph) return pieces[0];

  // Walk earlier blocks for the remaining sentence budget.
  for (let i = blockTexts.length - 2; i >= 0 && needed > 0; i--) {
    const prev = blockTexts[i];
    const total = countSentences(prev);
    if (total === 0) continue;
    const take = Math.min(needed, total);
    const fromIdx = total - take;
    const bounds = sentenceSliceBounds(prev, fromIdx, total - 1);
    pieces.unshift(prev.slice(bounds.start, bounds.end).trim());
    needed -= take;
  }

  return pieces.filter(Boolean).join(' ');
}
