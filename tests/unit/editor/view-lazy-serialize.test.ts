// Typing never serializes the document: the editor hands out a reader for
// the new text, and the markdown is only written when something (the
// debounced save, a flush, a tab switch) asks for it.
import { describe, it, expect } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { createEditorView } from '../../../src/lib/editor/view';
import { serializerWork, serializeWholeDocForTests } from '../../../src/lib/editor/serializer';
import { createSession } from '../../../src/stores/sessions';

describe('editor changes are serialized on demand', () => {
  it('typing twenty characters renders no markdown; reading it once does', () => {
    const host = document.createElement('div');
    const reads: Array<() => string> = [];
    const md = Array.from({ length: 200 }, (_, i) => `Paragraph ${i}.`).join('\n\n') + '\n';
    const v = createEditorView(host, md, (read) => reads.push(read));
    v.dispatch(v.state.tr.setSelection(TextSelection.near(v.state.doc.resolve(3))));
    const before = serializerWork.blocksRendered;
    for (let i = 0; i < 20; i++) v.dispatch(v.state.tr.insertText('k'));
    expect(reads).toHaveLength(20);
    expect(serializerWork.blocksRendered).toBe(before);

    const last = reads.at(-1)!;
    const text = last();
    expect(text).toBe(serializeWholeDocForTests(v.state.doc));
    expect(text.startsWith('Pakkkkkkkkkkkkkkkkkkkkragraph 0.')).toBe(true);
    // A second read is the same string, not a second serialize.
    const after = serializerWork.blocksRendered;
    expect(last()).toBe(text);
    expect(serializerWork.blocksRendered).toBe(after);
    v.destroy();
  });
});

describe('a tab\'s edited markdown can be handed over unread', () => {
  it('reads the text only when asked, once', () => {
    const s = createSession();
    let calls = 0;
    s.deferEditedMarkdown(() => { calls += 1; return 'typed\n'; });
    expect(calls).toBe(0);
    expect(s.editedMarkdown).toBe('typed\n');
    expect(s.editedMarkdown).toBe('typed\n');
    expect(calls).toBe(1);
  });

  it('setting it (or clearing it) drops a reader not yet read', () => {
    const s = createSession();
    let calls = 0;
    s.deferEditedMarkdown(() => { calls += 1; return 'stale\n'; });
    s.editedMarkdown = null;
    expect(s.editedMarkdown).toBeNull();
    s.deferEditedMarkdown(() => { calls += 1; return 'stale\n'; });
    s.editedMarkdown = 'kept\n';
    expect(s.editedMarkdown).toBe('kept\n');
    expect(calls).toBe(0);
  });
});
