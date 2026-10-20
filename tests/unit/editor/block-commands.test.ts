import { describe, it, expect, afterEach } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { serializeDocToMarkdown } from '../../../src/lib/editor/serializer';
import {
  currentBlockStyle,
  setBlockStyle,
  insertDivider,
  insertFormula,
  insertImage,
  blockInputRules,
  blockStyleKeys,
} from '../../../src/lib/editor/block-commands';
import { keymap } from 'prosemirror-keymap';
import { imageSrcFor, resolveImageSrc, joinPath } from '../../../src/lib/image-paths';

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

// A view on `md` with the cursor at the first occurrence of `at` (or the end of it).
function edit(md: string, at: string, end = false): EditorView {
  const doc = parseMarkdownToDoc(md);
  let pos = -1;
  doc.descendants((n, p) => {
    if (pos >= 0 || !n.isText) return pos < 0;
    const i = n.text!.indexOf(at);
    if (i >= 0) pos = p + i + (end ? at.length : 0);
    return false;
  });
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  view = new EditorView(parent, {
    state: EditorState.create({ doc, selection: TextSelection.create(doc, pos), plugins: [blockInputRules(), keymap(blockStyleKeys)] }),
  });
  return view;
}

const md = (v: EditorView) => serializeDocToMarkdown(v.state.doc);
const apply = (v: EditorView, cmd: Command) => cmd(v.state, v.dispatch, v);

// Typing as a person does, so input rules run.
function type(v: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = v.state.selection;
    const handled = v.someProp('handleTextInput', (f) => f(v, from, to, ch));
    if (!handled) v.dispatch(v.state.tr.insertText(ch, from, to));
  }
}

describe('Text style', () => {
  it('knows the style where the cursor is', () => {
    expect(currentBlockStyle(edit('# Title\n', 'Title').state)).toBe('h1');
    expect(currentBlockStyle(edit('### Small\n', 'Small').state)).toBe('h3');
    expect(currentBlockStyle(edit('- one\n- two\n', 'two').state)).toBe('bullet');
    expect(currentBlockStyle(edit('1. one\n', 'one').state)).toBe('ordered');
    expect(currentBlockStyle(edit('> said\n', 'said').state)).toBe('quote');
    expect(currentBlockStyle(edit('Plain.\n', 'Plain').state)).toBe('paragraph');
    expect(currentBlockStyle(edit('```js\ncode\n```\n', 'code').state)).toBeNull();
  });

  it('makes headings, and back to normal text', () => {
    const v = edit('Hello there.\n', 'Hello');
    apply(v, setBlockStyle('h2'));
    expect(md(v)).toBe('## Hello there.\n');
    apply(v, setBlockStyle('paragraph'));
    expect(md(v)).toBe('Hello there.\n');
  });

  it('makes lists, switches their kind, and takes them away again', () => {
    const v = edit('First.\n', 'First');
    apply(v, setBlockStyle('bullet'));
    expect(md(v)).toBe('* First.\n');
    apply(v, setBlockStyle('ordered'));
    expect(md(v)).toBe('1. First.\n');
    apply(v, setBlockStyle('ordered'));
    expect(md(v)).toBe('First.\n');
  });

  it('a heading inside a list leaves the list first', () => {
    const v = edit('- one\n- two\n', 'two');
    apply(v, setBlockStyle('h1'));
    expect(md(v)).toBe('- one\n\n# two\n');
  });

  it('quotes and unquotes', () => {
    const v = edit('Wise words.\n', 'Wise');
    apply(v, setBlockStyle('quote'));
    expect(md(v)).toBe('> Wise words.\n');
    apply(v, setBlockStyle('quote'));
    expect(md(v)).toBe('Wise words.\n');
  });

  it('normal text takes a block out of a list and a quote', () => {
    const v = edit('> - deep\n', 'deep');
    apply(v, setBlockStyle('paragraph'));
    expect(md(v)).toBe('deep\n');
  });

  it('keyboard shortcuts', () => {
    const v = edit('Line\n', 'Line');
    const key = (k: string) => blockStyleKeys[k](v.state, v.dispatch, v);
    key('Mod-Alt-1');
    expect(md(v)).toBe('# Line\n');
    key('Mod-Shift-8');
    expect(md(v)).toBe('* Line\n');
  });
});

describe('typing markdown at the start of a line', () => {
  it('# , - , 1. and > make headings, lists and quotes', () => {
    for (const [typed, out] of [
      ['## ', '## x\n'],
      ['- ', '- x\n'],
      ['1. ', '1. x\n'],
      ['> ', '> x\n'],
    ]) {
      const v = edit('\n\nstart\n', 'start');
      v.dispatch(v.state.tr.delete(1, v.state.doc.child(0).nodeSize - 1));
      type(v, `${typed}x`);
      expect(md(v), typed).toBe(out);
      v.destroy();
      view = null;
    }
  });

  it('--- makes a divider line', () => {
    const v = edit('start\n', 'start');
    v.dispatch(v.state.tr.delete(1, 6));
    type(v, '---');
    expect(v.state.doc.child(0).type.name).toBe('horizontal_rule');
    type(v, 'after');
    expect(md(v)).toBe('---\n\nafter\n');
  });
});

describe('inserting', () => {
  it('a divider after the block, cursor below it', () => {
    const v = edit('Above.\n', 'Above', true);
    apply(v, insertDivider);
    type(v, 'Below');
    expect(md(v)).toBe('Above.\n\n---\n\nBelow\n');
  });

  it('a formula: selected text becomes one; an empty line gets a block', () => {
    const v = edit('Area is pi r^2 here.\n', 'pi r^2');
    const from = v.state.selection.from;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, from + 'pi r^2'.length)));
    let opened = -1;
    apply(v, insertFormula((p) => (opened = p)));
    expect(md(v)).toBe('Area is $pi r^2$ here.\n');
    expect(v.state.doc.nodeAt(opened)?.type.name).toBe('math_inline');

    const w = edit('One\n\n\n\nTwo\n', 'One', true);
    w.dispatch(w.state.tr.split(w.state.selection.from));
    apply(w, insertFormula());
    expect(w.state.doc.child(1).type.name).toBe('math_block');
  });

  it('a picture at the cursor', () => {
    const v = edit('See here.\n', 'here', false);
    apply(v, insertImage('pics/cat%20one.png', 'cat one'));
    expect(md(v)).toBe('See ![cat one](pics/cat%20one.png)here.\n');
  });
});

describe('picture paths', () => {
  it('relative to the document, link-safe', () => {
    expect(imageSrcFor('C:\\Docs\\Notes', 'C:\\Docs\\Notes\\pics\\My cat.png')).toBe('pics/My%20cat.png');
    expect(imageSrcFor('C:\\Docs\\Notes', 'c:\\docs\\Images\\a (1).png')).toBe('../Images/a%20%281%29.png');
    expect(imageSrcFor('/home/me/notes', '/home/me/notes/a.png')).toBe('a.png');
  });

  it('on another drive: the full path', () => {
    expect(imageSrcFor('C:\\Docs', 'D:\\Pics\\a b.png')).toBe('D:/Pics/a%20b.png');
  });

  it('back to a URL the window can load', () => {
    const asset = (p: string) => `asset://${p}`;
    expect(resolveImageSrc('pics/My%20cat.png', 'C:\\Docs\\Notes', asset)).toBe('asset://C:/Docs/Notes/pics/My cat.png');
    expect(resolveImageSrc('../a.png', '/home/me/notes', asset)).toBe('asset:///home/me/a.png');
    expect(resolveImageSrc('D:/Pics/a%20b.png', 'C:\\Docs', asset)).toBe('asset://D:/Pics/a b.png');
    expect(resolveImageSrc('https://x.org/a.png', 'C:\\Docs', asset)).toBe('https://x.org/a.png');
    expect(joinPath('C:\\a\\b', '..\\c.png')).toBe('C:/a/c.png');
  });
});
