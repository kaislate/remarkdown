import { describe, it, expect } from 'vitest';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { serializeDocToMarkdown } from '../../../src/lib/editor/serializer';

describe('callout parsing', () => {
  it('parses [!info] blockquote as a callout node', () => {
    const md = '> [!info]\n> Hello world.\n';
    const doc = parseMarkdownToDoc(md);
    const first = doc.firstChild!;
    expect(first.type.name).toBe('callout');
    expect(first.attrs.type).toBe('info');
    expect(first.attrs.fold).toBe('');
  });

  it('parses [!warning]+ as foldable callout', () => {
    const md = '> [!warning]+\n> Be careful.\n';
    const doc = parseMarkdownToDoc(md);
    const first = doc.firstChild!;
    expect(first.type.name).toBe('callout');
    expect(first.attrs.type).toBe('warning');
    expect(first.attrs.fold).toBe('+');
  });

  it('parses [!tip] with custom title', () => {
    const md = '> [!tip] My custom title\n> Body text.\n';
    const doc = parseMarkdownToDoc(md);
    const first = doc.firstChild!;
    expect(first.type.name).toBe('callout');
    expect(first.attrs.title).toBe('My custom title');
  });

  it('plain blockquotes (no [!type]) parse as regular blockquote', () => {
    const md = '> Just a quote.\n';
    const doc = parseMarkdownToDoc(md);
    const first = doc.firstChild!;
    expect(first.type.name).toBe('blockquote');
  });

  it('callout body is editable as block+ content', () => {
    const md = '> [!note]\n> First paragraph.\n>\n> Second paragraph.\n';
    const doc = parseMarkdownToDoc(md);
    const callout = doc.firstChild!;
    expect(callout.type.name).toBe('callout');
    expect(callout.childCount).toBeGreaterThanOrEqual(2);
  });
});

describe('callout round-trip', () => {
  function rt(md: string): string {
    return serializeDocToMarkdown(parseMarkdownToDoc(md));
  }

  it('round-trips a basic [!info]', () => {
    const src = '> [!info]\n> Hello world.\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips [!warning]+ (foldable, open)', () => {
    const src = '> [!warning]+\n> Be careful.\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips [!tip]- (foldable, closed)', () => {
    const src = '> [!tip]-\n> Click to expand.\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips [!note] with custom title', () => {
    const src = '> [!note] Custom Title\n> Body text.\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips a multi-paragraph callout', () => {
    const src = '> [!info]\n> First paragraph.\n>\n> Second paragraph.\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips a plain blockquote unchanged', () => {
    const src = '> Just a quote.\n';
    expect(rt(src)).toBe(src);
  });
});
