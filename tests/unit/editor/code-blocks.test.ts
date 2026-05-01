import { describe, it, expect } from 'vitest';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { serializeDocToMarkdown } from '../../../src/lib/editor/serializer';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import {
  createCodeBlockHighlightPlugin,
  codeBlockHighlightKey,
} from '../../../src/lib/editor/code-block-highlight';

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
});
