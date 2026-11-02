// After an edit, code colouring only redoes the code blocks the edit
// touched: typing in a paragraph tokenizes nothing, typing in one code block
// tokenizes that block. The colours are always the ones a full rebuild of
// the document gives.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView, type DecorationSet } from 'prosemirror-view';
import type { HighlighterCore as Highlighter } from 'shiki/core';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { editorSchema } from '../../../src/lib/editor/schema';

let tokenizeCalls: string[] = [];
const fakeHl = {
  codeToTokensWithThemes: (text: string) => {
    tokenizeCalls.push(text);
    // One token per word, so positions inside a line matter.
    return text.split('\n').map((line) =>
      line.split(/(?<= )/).filter(Boolean).map((w, i) => ({
        content: w,
        offset: 0,
        variants: { dark: { color: i % 2 ? '#0f0' : '#f00' }, light: { color: '#090' } },
      })),
    );
  },
} as unknown as Highlighter;

vi.mock('../../../src/lib/shiki-highlighter', () => ({
  getHighlighter: () => Promise.resolve(fakeHl),
  ensureLanguages: () => Promise.resolve(fakeHl),
}));

import {
  createCodeBlockHighlightPlugin,
  codeBlockHighlightKey,
  buildDecorations,
} from '../../../src/lib/editor/code-block-highlight';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decoList(set: DecorationSet) {
  return set
    .find()
    .map((d) => `${d.from}-${d.to}:${JSON.stringify((d as unknown as { type: { attrs: unknown } }).type.attrs)}`)
    .sort();
}

function mount(md: string): EditorView {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let view: EditorView;
  view = new EditorView(host, {
    state: EditorState.create({ doc: parseMarkdownToDoc(md), plugins: [createCodeBlockHighlightPlugin()] }),
    dispatchTransaction(tr: Transaction) {
      view.updateState(view.state.apply(tr));
    },
  });
  return view;
}

const decorations = (v: EditorView) => codeBlockHighlightKey.getState(v.state)!.decorations;

function bigDoc(code: number, diagrams: number): string {
  const parts = ['# API', 'Intro paragraph here.'];
  for (let i = 0; i < code; i++) parts.push(`Call ${i}:`, '```js\nconst v' + i + ' = call(' + i + ');\nreturn v' + i + ';\n```');
  for (let i = 0; i < diagrams; i++) parts.push('```mermaid\nflowchart LR\n  A' + i + ' --> B' + i + '\n```');
  return parts.join('\n\n') + '\n';
}

function posInText(v: EditorView, needle: string): number {
  let at = -1;
  v.state.doc.descendants((n, pos) => {
    if (at >= 0) return false;
    if (n.isText && n.text!.includes(needle)) at = pos + n.text!.indexOf(needle);
    return true;
  });
  expect(at).toBeGreaterThanOrEqual(0);
  return at;
}

function typeAt(v: EditorView, pos: number, text: string) {
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)).insertText(text));
}

describe('code colouring after an edit', () => {
  beforeEach(() => { tokenizeCalls = []; });

  it('typing in a paragraph of a document with 350 code blocks and 50 diagrams tokenizes nothing', async () => {
    const v = mount(bigDoc(350, 50));
    await wait(10);
    // The first colouring: every code block once, no diagram source.
    expect(tokenizeCalls.length).toBe(350);
    expect(tokenizeCalls.some((t) => t.startsWith('flowchart'))).toBe(false);
    tokenizeCalls = [];
    typeAt(v, posInText(v, 'Intro'), 'Very ');
    await wait(250);
    expect(tokenizeCalls).toEqual([]);
    expect(decoList(decorations(v))).toEqual(decoList(buildDecorations(v.state.doc, fakeHl)));
    v.destroy();
  });

  it('typing in one code block tokenizes that block only', async () => {
    const v = mount(bigDoc(350, 0));
    await wait(10);
    tokenizeCalls = [];
    typeAt(v, posInText(v, 'call(200)'), 'await ');
    await wait(250);
    expect(tokenizeCalls).toEqual(['const v200 = await call(200);\nreturn v200;']);
    expect(decoList(decorations(v))).toEqual(decoList(buildDecorations(v.state.doc, fakeHl)));
    v.destroy();
  });

  it('a full colouring of more than 300 blocks keeps them all for the next one', () => {
    const doc = parseMarkdownToDoc(bigDoc(400, 0));
    tokenizeCalls = [];
    buildDecorations(doc, fakeHl);
    buildDecorations(doc, fakeHl);
    expect(tokenizeCalls.length).toBeLessThanOrEqual(400);
  });

  it('after edits in a document with 400 code blocks, opening it again tokenizes nothing', async () => {
    // Its own text, so nothing another test cached helps it.
    const md = bigDoc(400, 0).replace(/call\(/g, 'reopen(');
    const v1 = mount(md);
    await wait(10);
    expect(tokenizeCalls.length).toBe(400);
    // A few separate pauses in typing, in different blocks, each followed
    // by the debounced colouring of just that block.
    for (const n of [1, 2, 3, 150, 399]) {
      tokenizeCalls = [];
      typeAt(v1, posInText(v1, `reopen(${n})`), 'await ');
      await wait(250);
      expect(tokenizeCalls.length).toBe(1);
    }
    const doc = v1.state.doc;
    v1.destroy();
    // Back to the tab, or Done then Edit: the same document, a new editor.
    tokenizeCalls = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const v2 = new EditorView(host, {
      state: EditorState.create({ doc, plugins: [createCodeBlockHighlightPlugin()] }),
    });
    await wait(10);
    expect(tokenizeCalls).toEqual([]);
    expect(decoList(decorations(v2))).toEqual(decoList(buildDecorations(doc, fakeHl)));
    v2.destroy();
  });
});

describe('code colouring stays exactly what a full rebuild gives', () => {
  // Small deterministic PRNG so a failure reproduces.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }

  it('through random typing, deletions, language changes and block changes', async () => {
    const md = [
      'Intro.',
      '```js\nlet a = 1;\nlet b = 2;\n```',
      '- item\n\n  ```ts\n  type T = string;\n  ```',
      '> [!note]\n> ```py\n> print(1)\n> ```',
      'Middle.',
      '```mermaid\nflowchart LR\n  A --> B\n```',
      '```\nplain words here\n```',
      'End.',
    ].join('\n\n') + '\n';
    const v = mount(md);
    await wait(10);
    const rand = rng(42);
    for (let i = 0; i < 60; i++) {
      const size = v.state.doc.content.size;
      const pos = Math.max(1, Math.floor(rand() * size));
      const kind = rand();
      try {
        const sel = TextSelection.near(v.state.doc.resolve(pos));
        let tr = v.state.tr.setSelection(sel);
        if (kind < 0.4) {
          tr = tr.insertText(['x', ' ', 'let ', '\n', '1'][Math.floor(rand() * 5)]);
        } else if (kind < 0.6) {
          tr = tr.delete(pos, Math.min(size, pos + 1 + Math.floor(rand() * 8)));
        } else if (kind < 0.75) {
          // Change a code block's language (both ways steps can do it).
          let cb = -1;
          v.state.doc.descendants((n, p) => { if (cb < 0 && n.type.name === 'code_block' && p >= pos - 40) cb = p; });
          if (cb < 0) continue;
          const lang = ['js', 'ts', '', 'python', 'mermaid'][Math.floor(rand() * 5)];
          tr = rand() < 0.5
            ? tr.setNodeMarkup(cb, undefined, { language: lang })
            : tr.setNodeAttribute(cb, 'language', lang);
        } else if (kind < 0.9) {
          // Code block <-> paragraph.
          const $p = sel.$from;
          if (!$p.parent.isTextblock) continue;
          const to = $p.parent.type.name === 'code_block' ? editorSchema.nodes.paragraph : editorSchema.nodes.code_block;
          tr = tr.setBlockType($p.before(), $p.after(), to);
        } else {
          tr = tr.insert(0, editorSchema.nodes.code_block.create({ language: 'js' }, editorSchema.text('let z = 3;')));
        }
        v.dispatch(tr);
      } catch {
        continue;
      }
      if (rand() < 0.5) {
        await wait(180);
        expect(decoList(decorations(v)), `after step ${i}`).toEqual(decoList(buildDecorations(v.state.doc, fakeHl)));
      }
    }
    await wait(250);
    expect(decoList(decorations(v))).toEqual(decoList(buildDecorations(v.state.doc, fakeHl)));
    v.destroy();
  });
});
