// The editor colours its code with only the grammars its code blocks use,
// like the reader. Turning edit mode on for a document whose code the reader
// already coloured shows it coloured from the first frame (nothing to load);
// a block switched to, or added in, a language not loaded yet is coloured
// once that grammar arrives. The colours are always the ones the old
// highlighter — every supported grammar loaded up front — gave.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSingletonHighlighter } from 'shiki';
import type { HighlighterCore } from 'shiki/core';
import type { EditorView, DecorationSet } from 'prosemirror-view';
import { SUPPORTED_LANGUAGES } from '../../../src/lib/editor/code-block-languages';

let reference: HighlighterCore | null = null;
async function referenceHighlighter(): Promise<HighlighterCore> {
  reference ??= (await getSingletonHighlighter({
    themes: ['github-dark', 'github-light'],
    langs: [...SUPPORTED_LANGUAGES],
  })) as unknown as HighlighterCore;
  return reference;
}

function decoList(set: DecorationSet) {
  return set
    .find()
    .map((d) => `${d.from}-${d.to}:${JSON.stringify((d as unknown as { type: { attrs: unknown } }).type.attrs)}`)
    .sort();
}

// Settles promises only: no timer, no I/O. What is shown in the first frame.
async function microtasks(n = 200): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

async function until(check: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const TS = 'const hello = (name: string): string => `hello, ${name}`;\nexport type A = { a?: number };';
const CPP = '#include <vector>\nint main() { std::vector<int> v; return 0; }';
const PY = 'def f(x: int) -> str:\n    return f"{x!r}"';

async function fresh() {
  vi.resetModules();
  const renderer = await import('../../../src/lib/MarkdownRenderer');
  const shiki = await import('../../../src/lib/shiki-highlighter');
  const { createEditorView } = await import('../../../src/lib/editor/view');
  const hl = await import('../../../src/lib/editor/code-block-highlight');
  const { editorSchema } = await import('../../../src/lib/editor/schema');
  const mounted: EditorView[] = [];
  const mount = (md: string) => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = createEditorView(parent, md, () => {});
    mounted.push(view);
    return view;
  };
  const decorations = (v: EditorView) => hl.codeBlockHighlightKey.getState(v.state)!.decorations;
  const expected = async (v: EditorView) => decoList(hl.buildDecorations(v.state.doc, await referenceHighlighter()));
  const done = () => mounted.forEach((v) => v.destroy());
  return { renderer, shiki, mount, decorations, expected, done, editorSchema };
}

describe('editor code colouring with grammars loaded on demand', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a document the reader coloured is coloured in the editor\'s first frame, as before', async () => {
    const t = await fresh();
    const md = '# Code\n\n```ts\n' + TS + '\n```\n\nText.\n\n```\nplain\n```\n';
    await t.renderer.render(md);
    const v = t.mount(md);
    await microtasks();
    const got = decoList(t.decorations(v));
    expect(got.length).toBeGreaterThan(0);
    expect(got).toEqual(await t.expected(v));
    // Only what the document uses was loaded, for the reader and the editor.
    expect(t.shiki.loadedLanguageCount()).toBeLessThan(SUPPORTED_LANGUAGES.length);
    t.done();
  });

  it('a document opened straight in the editor is coloured as before, loading only its grammars', async () => {
    const t = await fresh();
    const md = '```py\n' + PY + '\n```\n\n```rust\nfn main() {}\n```\n';
    const v = t.mount(md);
    await until(() => t.decorations(v).find().length > 0);
    expect(decoList(t.decorations(v))).toEqual(await t.expected(v));
    expect(t.shiki.loadedLanguageCount()).toBeLessThan(SUPPORTED_LANGUAGES.length);
    t.done();
  });

  it('a block switched to a language not loaded yet is coloured in it, as before', async () => {
    const t = await fresh();
    const md = '```ts\n' + TS + '\n```\n\n```ts\n' + CPP + '\n```\n';
    await t.renderer.render(md);
    const v = t.mount(md);
    await microtasks();
    const before = decoList(t.decorations(v));
    let second = -1;
    v.state.doc.forEach((n, pos, i) => { if (i === 1) second = pos; });
    v.dispatch(v.state.tr.setNodeAttribute(second, 'language', 'cpp'));
    const want = await t.expected(v);
    expect(want).not.toEqual(before);
    await until(() => JSON.stringify(decoList(t.decorations(v))) === JSON.stringify(want));
    t.done();
  });

  it('a new block in a language not loaded yet is coloured, and the others keep theirs', async () => {
    const t = await fresh();
    const md = '```ts\n' + TS + '\n```\n';
    await t.renderer.render(md);
    const v = t.mount(md);
    await microtasks();
    const end = v.state.doc.content.size;
    v.dispatch(v.state.tr.insert(end, t.editorSchema.nodes.code_block.create({ language: 'python' }, t.editorSchema.text(PY))));
    const want = await t.expected(v);
    await until(() => JSON.stringify(decoList(t.decorations(v))) === JSON.stringify(want));
    t.done();
  });

  it('a document without code never starts Shiki, until a code block is added', async () => {
    let started = 0;
    vi.doMock('shiki/core', async (importOriginal) => {
      const real = await importOriginal<typeof import('shiki/core')>();
      return {
        ...real,
        createHighlighterCore: (...args: Parameters<typeof real.createHighlighterCore>) => {
          started++;
          return real.createHighlighterCore(...args);
        },
      };
    });
    try {
      const t = await fresh();
      const md = '# Plain\n\nJust words.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n';
      await t.renderer.render(md);
      const v = t.mount(md);
      await microtasks();
      await new Promise((r) => setTimeout(r, 50));
      expect(started).toBe(0);
      expect(t.decorations(v).find()).toEqual([]);
      // Typing in prose still needs nothing.
      v.dispatch(v.state.tr.insertText('More ', 1));
      await new Promise((r) => setTimeout(r, 250));
      expect(started).toBe(0);
      // The first code block starts it, and is coloured as before.
      const end = v.state.doc.content.size;
      v.dispatch(v.state.tr.insert(end, t.editorSchema.nodes.code_block.create({ language: 'ts' }, t.editorSchema.text(TS))));
      const want = await t.expected(v);
      expect(want.length).toBeGreaterThan(0);
      await until(() => JSON.stringify(decoList(t.decorations(v))) === JSON.stringify(want));
      expect(started).toBe(1);
      t.done();
    } finally {
      vi.doUnmock('shiki/core');
    }
  });

  it('a code block turned into a paragraph loses its colours', async () => {
    const t = await fresh();
    const md = 'Intro.\n\n```ts\n' + TS + '\n```\n';
    await t.renderer.render(md);
    const v = t.mount(md);
    await microtasks();
    expect(t.decorations(v).find().length).toBeGreaterThan(0);
    let block = -1;
    v.state.doc.forEach((n, pos) => { if (n.type.name === 'code_block') block = pos; });
    v.dispatch(v.state.tr.setBlockType(block + 1, block + 1, t.editorSchema.nodes.paragraph));
    await until(() => t.decorations(v).find().length === 0);
    t.done();
  });

  it('a markdown block brings every grammar for the code inside it, as before', async () => {
    const t = await fresh();
    const md = '````markdown\n# T\n\n~~~cpp\nint main() { return 0; }\n~~~\n````\n';
    const v = t.mount(md);
    await until(() => t.decorations(v).find().length > 0);
    expect(decoList(t.decorations(v))).toEqual(await t.expected(v));
    t.done();
  });
});
