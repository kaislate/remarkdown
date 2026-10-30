import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classify, menuFor, selectionToKeep, type ClickContext, type MenuActions } from '../../src/lib/app-context-menu';

const actions = (): MenuActions => ({
  cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), selectAll: vi.fn(), highlight: vi.fn(), addNote: vi.fn(),
  copyLink: vi.fn(), goToSection: vi.fn(), toggleEdit: vi.fn(), enterReader: vi.fn(), leaveReader: vi.fn(),
  showInFolder: vi.fn(), copyPath: vi.fn(), undo: vi.fn(), redo: vi.fn(),
});
const labels = (ctx: ClickContext) => (menuFor(ctx, actions()) ?? []).map((i) => (i === 'separator' ? '—' : i.label));

describe('what a right-click is on', () => {
  document.body.innerHTML = `
    <div class="scroll"><article class="viewer"><p id="p">Text <a id="a" href="https://x.org">link</a></p>
      <button id="b">diagram button</button></article>
      <div contenteditable="true"><p id="e">editing</p></div></div>
    <input id="i" type="text" /><textarea id="t"></textarea><input id="c" type="checkbox" />
    <div class="minimap" id="m"></div>`;
  const $ = (id: string) => document.getElementById(id);

  it('tells fields, the editor, links, the page and chrome apart', () => {
    expect(classify($('i')).kind).toBe('field');
    expect(classify($('t')).kind).toBe('field');
    expect(classify($('e')).kind).toBe('editor');
    expect(classify($('a'))).toMatchObject({ kind: 'link', href: 'https://x.org' });
    expect(classify($('p')).kind).toBe('page');
    expect(classify($('b')).kind).toBe('chrome');
    expect(classify($('c')).kind).toBe('chrome');
    expect(classify($('m')).kind).toBe('chrome');
  });
});

describe('the menu for it', () => {
  it('reader mode: just leaving it, with Copy when text is selected', () => {
    expect(labels({ kind: 'page', readerMode: true, hasSelection: false })).toEqual(['Leave reader mode']);
    expect(labels({ kind: 'page', readerMode: true, hasSelection: true })).toEqual(['Copy', '—', 'Leave reader mode']);
    expect(labels({ kind: 'link', readerMode: true, hasSelection: false, href: 'https://x.org' })).toEqual(['Leave reader mode']);
  });

  it('text fields: cut, copy, paste, select all (paste and cut off when read-only)', () => {
    const m = menuFor({ kind: 'field', readerMode: false, hasSelection: false, readOnly: true }, actions())!;
    expect(m.map((i) => (i === 'separator' ? '—' : `${i.label}${i.disabled ? ' (off)' : ''}`))).toEqual([
      'Cut (off)', 'Copy (off)', 'Paste (off)', '—', 'Select all',
    ]);
  });

  it('the editor: editing commands and done editing', () => {
    expect(labels({ kind: 'editor', readerMode: false, hasSelection: true })).toEqual(['Cut', 'Copy', 'Paste', '—', 'Select all', '—', 'Done editing']);
  });

  it('selected text on the page: copy, highlight, re.mark', () => {
    expect(labels({ kind: 'page', readerMode: false, hasSelection: true })).toEqual(['Copy', '—', 'Highlight', 'Add a re.mark', '—', 'Select all']);
  });

  it('the page with nothing selected: what to do with the document', () => {
    expect(labels({ kind: 'page', readerMode: false, hasSelection: false, path: 'C:\\d\\a.md' })).toEqual([
      'Edit', 'Reader mode', '—', 'Show in folder', 'Copy file path', '—', 'Select all',
    ]);
  });

  it('undo and redo come first when there are annotation changes to undo or redo', () => {
    expect(labels({ kind: 'page', readerMode: false, hasSelection: false, canUndo: true })).toEqual([
      'Undo', '—', 'Edit', 'Reader mode', '—', 'Select all',
    ]);
    expect(labels({ kind: 'page', readerMode: false, hasSelection: false, canUndo: true, canRedo: true }).slice(0, 3)).toEqual(['Undo', 'Redo', '—']);
  });

  it('links: copy the address, or go to a section inside the document', () => {
    expect(labels({ kind: 'link', readerMode: false, hasSelection: false, href: 'https://x.org' })).toEqual(['Copy link address']);
    const a = actions();
    const m = menuFor({ kind: 'link', readerMode: false, hasSelection: false, href: '#part-2' }, a)!;
    (m[0] as { onSelect: () => void }).onSelect();
    expect(a.goToSection).toHaveBeenCalledWith('#part-2');
  });

  it('buttons and panels: no menu (and no browser menu either)', () => {
    expect(menuFor({ kind: 'chrome', readerMode: false, hasSelection: false }, actions())).toBeNull();
  });
});

describe('the selection the menu puts back', () => {
  beforeEach(() => {
    document.body.innerHTML = `<article id="page"><p id="pp">Some words on the page.</p></article>
      <div id="ed" contenteditable="true"><p id="ep">Some words being edited.</p></div>`;
  });
  const $ = (id: string) => document.getElementById(id)!;
  const place = (id: string, from: number, to = from) => {
    const text = $(id).firstChild!;
    const r = document.createRange();
    r.setStart(text, from);
    r.setEnd(text, to);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    return sel;
  };

  it('selected words, on the page or in the editor', () => {
    const page = selectionToKeep('page', place('pp', 5, 10), $('page'));
    expect(page?.toString()).toBe('words');
    expect(selectionToKeep('editor', place('ep', 5, 10), $('ed'))?.toString()).toBe('words');
  });

  // Opening the menu takes focus, and WebKit then drops the editor's
  // caret: without it Paste would land at the top of the document.
  it('the bare caret too, in the editor', () => {
    const r = selectionToKeep('editor', place('ep', 4), $('ed'));
    expect(r?.collapsed).toBe(true);
    expect(r?.startContainer).toBe($('ep').firstChild);
    expect(r?.startOffset).toBe(4);
  });

  it('but not a bare caret on the page, nor a selection somewhere else', () => {
    expect(selectionToKeep('page', place('pp', 4), $('page'))).toBeNull();
    expect(selectionToKeep('editor', place('pp', 5, 10), $('ed'))).toBeNull();
    window.getSelection()!.removeAllRanges();
    expect(selectionToKeep('editor', window.getSelection(), $('ed'))).toBeNull();
  });

  it('a copy, so later changes to the selection leave it alone', () => {
    const sel = place('ep', 5, 10);
    const r = selectionToKeep('editor', sel, $('ed'))!;
    place('ep', 0, 2);
    expect(r.toString()).toBe('words');
  });
});
