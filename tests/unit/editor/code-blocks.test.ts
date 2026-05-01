import { describe, it, expect } from 'vitest';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { serializeDocToMarkdown } from '../../../src/lib/editor/serializer';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import {
  createCodeBlockHighlightPlugin,
  codeBlockHighlightKey,
  buildDecorations,
} from '../../../src/lib/editor/code-block-highlight';
import type { Highlighter } from 'shiki';

describe('code-block parsing', () => {
  it('parses a fenced code block with a language', () => {
    const md = '```typescript\nconst x = 1;\n```\n';
    const doc = parseMarkdownToDoc(md);
    const first = doc.firstChild!;
    expect(first.type.name).toBe('code_block');
    expect(first.attrs.language).toBe('typescript');
    expect(first.textContent).toBe('const x = 1;');
  });

  it('parses a plain (no-language) fenced code block', () => {
    const md = '```\nplain text\n```\n';
    const doc = parseMarkdownToDoc(md);
    const first = doc.firstChild!;
    expect(first.type.name).toBe('code_block');
    expect(first.attrs.language).toBe('');
    expect(first.textContent).toBe('plain text');
  });
});

describe('code-block round-trip', () => {
  function rt(md: string): string {
    return serializeDocToMarkdown(parseMarkdownToDoc(md));
  }

  it('round-trips a typescript fence', () => {
    const src = '```typescript\nconst x = 1;\n```\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips a no-language fence', () => {
    const src = '```\nplain text\n```\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips a multi-line fence with markdown-looking content', () => {
    const src = '```python\n# This looks like a heading\n**not bold**\n```\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips an empty fence', () => {
    const src = '```\n```\n';
    expect(rt(src)).toBe(src);
  });
});

describe('code-block highlight plugin', () => {
  it('contributes an empty decoration set on init', () => {
    const plugin = createCodeBlockHighlightPlugin();
    const state = EditorState.create({ schema: editorSchema, plugins: [plugin] });
    const pluginState = codeBlockHighlightKey.getState(state);
    expect(pluginState).toBeDefined();
    expect(pluginState!.decorations.find().length).toBe(0);
  });

  it('decoration set is preserved as a no-op through irrelevant transactions', () => {
    const plugin = createCodeBlockHighlightPlugin();
    const state = EditorState.create({ schema: editorSchema, plugins: [plugin] });
    const tr = state.tr.insertText('hello');
    const next = state.apply(tr);
    const pluginState = codeBlockHighlightKey.getState(next);
    expect(pluginState).toBeDefined();
  });

  it('buildDecorations places color spans at correct PM positions', () => {
    // Stub: one red token per non-empty line. tok.offset is line-local (0)
    // because buildDecorations sums tok.content.length manually rather than
    // trusting tok.offset; the stub mirrors that contract.
    const fakeHl = {
      codeToTokensBase: (text: string) => {
        return text.split('\n').map((line) =>
          line.length > 0
            ? [{ content: line, color: '#ff0000', offset: 0 }]
            : [],
        );
      },
    } as unknown as Highlighter;
    // doc has a single code_block at pos 0; its content "ab\ncd" lives
    // at positions 1..6 (1=a, 2=b, 3=\n, 4=c, 5=d, 6=end-of-text).
    const doc = parseMarkdownToDoc('```text\nab\ncd\n```\n');
    const set = buildDecorations(doc, fakeHl);
    const decs = set.find();
    // Two decorations: line 1 ("ab") at 1..3, line 2 ("cd") at 4..6.
    expect(decs.length).toBe(2);
    expect(decs[0].from).toBe(1);
    expect(decs[0].to).toBe(3);
    expect(decs[1].from).toBe(4);
    expect(decs[1].to).toBe(6);
  });
});
