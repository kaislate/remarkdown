import { describe, it, expect, vi } from 'vitest';
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

import { createEditorView } from '../../../src/lib/editor/view';

describe('createEditorView', () => {
  it('mounts a PM view in the supplied parent', () => {
    const parent = document.createElement('div');
    const onChange = vi.fn();
    const view = createEditorView(parent, '# Hello\n', onChange);
    expect(parent.querySelector('.ProseMirror')).not.toBeNull();
    view.destroy();
  });

  it('seeds with the initial markdown', () => {
    const parent = document.createElement('div');
    const view = createEditorView(parent, '# Hello\n', () => {});
    expect(parent.querySelector('h1')?.textContent).toBe('Hello');
    view.destroy();
  });

  it('calls onChange with serialized markdown after a doc update', () => {
    const parent = document.createElement('div');
    const onChange = vi.fn();
    const view = createEditorView(parent, 'a\n', onChange);
    // Replace the document with one paragraph containing 'b'.
    const tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      view.state.schema.node('paragraph', null, view.state.schema.text('b')),
    );
    view.dispatch(tr);
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0]).toBe('b\n');
    view.destroy();
  });
});
