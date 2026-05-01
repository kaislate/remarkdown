import { describe, it, expect } from 'vitest';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { serializeDocToMarkdown } from '../../../src/lib/editor/serializer';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import { insertCallout } from '../../../src/lib/editor/view';

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

  // Regression: previously the serializer suppressed any title that
  // matched the auto-derived default (capitalized type), so a user
  // who explicitly typed `Note` after `[!note]` would see it dropped
  // on round-trip. The parser now stores empty when no title was
  // typed and the literal title otherwise, so this case round-trips.
  it('round-trips an explicit title that equals the default', () => {
    const src = '> [!note] Note\n> Body.\n';
    expect(rt(src)).toBe(src);
  });

  // Empty-body callout: header-only, no content lines under it. The
  // parser still produces a callout node (with at least one empty
  // paragraph child to satisfy `block+`) and the serializer emits
  // a blank `>` continuation line, NOT a malformed doc.
  it('handles a callout with no body lines', () => {
    const src = '> [!info]\n';
    const doc = parseMarkdownToDoc(src);
    const first = doc.firstChild!;
    expect(first.type.name).toBe('callout');
    expect(first.attrs.type).toBe('info');
    // Content satisfies `block+` — exactly one empty paragraph is fine.
    expect(first.childCount).toBeGreaterThanOrEqual(1);
    // Round-trip should not crash; output must contain the header.
    const out = rt(src);
    expect(out).toContain('[!info]');
  });
});

describe('insertCallout command', () => {
  it('wraps the current selection in a callout node when called on a paragraph', () => {
    const doc = parseMarkdownToDoc('Hello world.\n');
    let state = EditorState.create({ doc, schema: editorSchema });
    let dispatched = false;
    insertCallout('info')(state, (tr) => {
      state = state.apply(tr);
      dispatched = true;
    });
    expect(dispatched).toBe(true);
    const first = state.doc.firstChild!;
    expect(first.type.name).toBe('callout');
    expect(first.attrs.type).toBe('info');
  });

  it('round-trip after inserting a callout produces [!info]', () => {
    const doc = parseMarkdownToDoc('Hello world.\n');
    let state = EditorState.create({ doc, schema: editorSchema });
    insertCallout('info')(state, (tr) => { state = state.apply(tr); });
    const md = serializeDocToMarkdown(state.doc);
    expect(md).toContain('[!info]');
    expect(md).toContain('Hello world.');
  });
});
