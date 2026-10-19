import { describe, it, expect } from 'vitest';
import {
  countWords,
  wordsBelow,
  minutesLeft,
  sectionAt,
  READING_WPM,
} from '../../src/lib/reading-time';

describe('reading time', () => {
  it('reads at about 230 words a minute', () => {
    expect(READING_WPM).toBe(230);
  });

  it('counts words, ignoring extra whitespace and punctuation-only tokens', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('The reader who would  truly\nunderstand — must read.')).toBe(8);
  });

  it('counts only what is below the bottom of the viewport', () => {
    const blocks = [
      { top: 0, bottom: 100, words: 50 },     // on screen
      { top: 100, bottom: 300, words: 100 },  // straddles the fold at 200: half below
      { top: 300, bottom: 400, words: 70 },   // fully below
    ];
    expect(wordsBelow(blocks, 200)).toBe(50 + 70);
    expect(wordsBelow(blocks, 400)).toBe(0);
    expect(wordsBelow(blocks, 0)).toBe(220);
  });

  it('a block with no height counts as below once its top is below the fold', () => {
    expect(wordsBelow([{ top: 500, bottom: 500, words: 9 }], 200)).toBe(9);
    expect(wordsBelow([{ top: 100, bottom: 100, words: 9 }], 200)).toBe(0);
  });

  it('names the section once its heading has scrolled off the top', () => {
    const heads = [
      { text: 'Intro', bottom: -400 },
      { text: 'Chapter 3', bottom: -20 },
      { text: 'Later', bottom: 300 },
    ];
    expect(sectionAt(heads, 0)).toBe('Chapter 3');
    expect(sectionAt(heads, -500)).toBeNull();
    expect(sectionAt([], 0)).toBeNull();
    // The heading still on screen doesn't need repeating above itself.
    expect(sectionAt([{ text: 'Title', bottom: 120 }], 0)).toBeNull();
  });

  it('rounds the remaining time up to whole minutes; nothing left is 0', () => {
    expect(minutesLeft(0)).toBe(0);
    expect(minutesLeft(1)).toBe(1);
    expect(minutesLeft(230)).toBe(1);
    expect(minutesLeft(231)).toBe(2);
    expect(minutesLeft(6 * 230)).toBe(6);
  });
});
