import { describe, it, expect } from 'vitest';
import {
  findSentenceSplits,
  countSentences,
  sentenceIndexAt,
  sentenceSliceBounds,
  buildSentenceContext,
} from '../../src/lib/sentence-context';

describe('findSentenceSplits', () => {
  it('returns empty for a single-sentence string', () => {
    expect(findSentenceSplits('Hello world.')).toEqual([]);
  });

  it('finds split positions after period+space', () => {
    const text = 'One. Two. Three.';
    const splits = findSentenceSplits(text);
    // First split after "One. " (position 5), second after "Two. " (position 10)
    expect(splits).toEqual([5, 10]);
  });

  it('handles question marks and exclamation points', () => {
    const text = 'Really? Yes! Of course.';
    expect(findSentenceSplits(text)).toEqual([8, 13]);
  });

  it('handles multi-character terminators (..!)', () => {
    const text = 'Wait... Now? Yes.';
    expect(findSentenceSplits(text)).toEqual([8, 13]);
  });

  it('does not split on a period followed by no whitespace', () => {
    const text = 'See www.example.com today.';
    expect(findSentenceSplits(text)).toEqual([]);
  });
});

describe('countSentences', () => {
  it('returns 0 for empty string', () => {
    expect(countSentences('')).toBe(0);
  });

  it('returns 1 for a single sentence', () => {
    expect(countSentences('Hello world.')).toBe(1);
  });

  it('returns N for N sentences separated by terminators', () => {
    expect(countSentences('A. B. C.')).toBe(3);
  });
});

describe('sentenceIndexAt', () => {
  it('returns 0 for an offset within the first sentence', () => {
    expect(sentenceIndexAt('Hello. World.', 2)).toBe(0);
  });

  it('returns 1 for an offset within the second sentence', () => {
    expect(sentenceIndexAt('Hello. World.', 8)).toBe(1);
  });

  it('handles offsets at the very start', () => {
    expect(sentenceIndexAt('A. B. C.', 0)).toBe(0);
  });
});

describe('sentenceSliceBounds', () => {
  it('returns the bounds of a single sentence with trailing whitespace trimmed', () => {
    const text = 'One. Two. Three.';
    const b = sentenceSliceBounds(text, 0, 0);
    expect(text.slice(b.start, b.end)).toBe('One.');
  });

  it('returns the bounds of a span of sentences', () => {
    const text = 'One. Two. Three.';
    const b = sentenceSliceBounds(text, 0, 1);
    expect(text.slice(b.start, b.end)).toBe('One. Two.');
  });

  it('handles the last sentence even without a trailing terminator', () => {
    const text = 'One. Two. Three';
    const b = sentenceSliceBounds(text, 2, 2);
    expect(text.slice(b.start, b.end)).toBe('Three');
  });
});

describe('buildSentenceContext', () => {
  it('returns the single anchor sentence with count=1', () => {
    expect(
      buildSentenceContext(['One. Two. Three.'], 7 /* in "Two." */, 1, true),
    ).toBe('Two.');
  });

  it('returns 2 sentences ending at the anchor with count=2', () => {
    expect(
      buildSentenceContext(['One. Two. Three.'], 11 /* in "Three" */, 2, true),
    ).toBe('Two. Three.');
  });

  it('caps at the start of the block when count exceeds available sentences', () => {
    expect(
      buildSentenceContext(['One. Two.'], 1 /* in "One" */, 5, true),
    ).toBe('One.');
  });

  it('stops at the paragraph boundary when stopAtParagraph is true', () => {
    expect(
      buildSentenceContext(
        ['Para A first. Para A second.', 'Para B only.'],
        6 /* in "only" */,
        5,
        true,
      ),
    ).toBe('Para B only.');
  });

  it('walks across paragraphs when stopAtParagraph is false', () => {
    expect(
      buildSentenceContext(
        ['Para A first. Para A second.', 'Para B only.'],
        6,
        3,
        false,
      ),
    ).toBe('Para A first. Para A second. Para B only.');
  });

  it('takes the LAST sentences from earlier blocks (closest to anchor)', () => {
    expect(
      buildSentenceContext(
        ['Earliest. Middle. Latest of A.', 'B only.'],
        4,
        2,
        false,
      ),
    ).toBe('Latest of A. B only.');
  });
});
