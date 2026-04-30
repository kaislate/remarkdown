import { describe, it, expect } from 'vitest';
import { parseMarkdown, serializeToMarkdown } from '../../../src/lib/editor/markdown';

function roundTrip(md: string): string {
  return serializeToMarkdown(parseMarkdown(md));
}

describe('markdown round-trip', () => {
  it('plain paragraph survives unchanged', () => {
    const src = 'Hello world.\n';
    expect(roundTrip(src)).toBe(src);
  });

  it('preserves bold and italic', () => {
    const src = 'A **bold** and *italic* sentence.\n';
    expect(roundTrip(src)).toBe(src);
  });

  it('preserves heading levels', () => {
    const src = '# H1\n\n## H2\n\n### H3\n';
    expect(roundTrip(src)).toBe(src);
  });

  it('preserves bullet lists', () => {
    const src = '* one\n* two\n* three\n';
    expect(roundTrip(src)).toBe(src);
  });

  it('preserves links', () => {
    const src = 'Visit [example](https://example.com).\n';
    expect(roundTrip(src)).toBe(src);
  });

  it('preserves code spans', () => {
    const src = 'Use `npm install` to install.\n';
    expect(roundTrip(src)).toBe(src);
  });

  it('preserves blockquotes', () => {
    const src = '> A quoted line.\n';
    expect(roundTrip(src)).toBe(src);
  });
});
