// Node views for the parts of a document the editor keeps as their own
// text, exactly as written: formulas (math_inline, math_block) and a
// file's document details (front_matter). Each shows what the reader
// shows — the formula drawn by KaTeX, the details as a quiet list — and
// clicking it opens SourcePopover.svelte to change the text, with a
// live preview for formulas. Atoms: the cursor steps over them whole.

import { mount, unmount } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import katex from 'katex';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import SourcePopover, { type SourcePopoverState } from '../../components/SourcePopover.svelte';
import { frontMatterFields } from '../markdown-it-frontmatter';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A formula as HTML; a mistake in it shows as the TeX, marked, with the
// reason on hover — never an exception.
export function formulaHtml(tex: string, display: boolean): string {
  if (!tex.trim()) return '<span class="math-empty">Empty formula</span>';
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: true });
  } catch (e) {
    return `<span class="math-error" title="${escapeHtml(String((e as Error).message ?? e))}">${escapeHtml(tex)}</span>`;
  }
}

abstract class SourceNodeView implements NodeView {
  dom: HTMLElement;
  protected node: PMNode;
  private popoverHost: HTMLElement | null = null;
  private popoverApp: ReturnType<typeof mount> | null = null;
  private popoverState: Writable<SourcePopoverState>;

  constructor(
    node: PMNode,
    protected view: EditorView,
    protected getPos: () => number | undefined,
    tag: string,
    className: string,
  ) {
    this.node = node;
    this.popoverState = writable({ open: false, title: '', text: '', x: 0, y: 0 });
    this.dom = document.createElement(tag);
    this.dom.className = className;
    this.dom.contentEditable = 'false';
    this.dom.tabIndex = -1;
    this.dom.setAttribute('role', 'button');
    this.dom.addEventListener('mousedown', (e) => e.preventDefault());
    this.dom.addEventListener('click', (e) => {
      e.preventDefault();
      this.open();
    });
    this.render();
  }

  protected abstract title: string;
  protected abstract text(): string;
  protected abstract attrsFor(text: string): Record<string, unknown>;
  protected abstract render(): void;
  protected preview(_text: string): string | null {
    return null;
  }
  protected placeholder = '';
  protected hint = '';

  open(): void {
    const r = this.dom.getBoundingClientRect();
    this.popoverState.set({
      open: true,
      title: this.title,
      text: this.text(),
      x: Math.max(8, Math.min(r.left, window.innerWidth - 380)) + window.scrollX,
      y: r.bottom + window.scrollY + 6,
    });
    if (this.popoverApp) return;
    this.popoverHost = document.createElement('div');
    document.body.appendChild(this.popoverHost);
    this.popoverApp = mount(SourcePopover, {
      target: this.popoverHost,
      props: {
        stateStore: this.popoverState,
        preview: (t: string) => this.preview(t),
        placeholder: this.placeholder,
        hint: this.hint,
        onSave: (t: string) => this.save(t),
        onDelete: () => this.remove(),
        onClose: () => this.close(),
      },
    });
  }

  private close(): void {
    this.popoverState.update((s) => ({ ...s, open: false }));
    this.view.focus();
  }

  private save(text: string): void {
    const pos = this.getPos();
    if (pos !== undefined && text !== this.text()) {
      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...this.attrsFor(text) }));
    }
    this.close();
  }

  private remove(): void {
    const pos = this.getPos();
    if (pos !== undefined) this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.close();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs !== this.node.attrs;
    this.node = node;
    if (changed) this.render();
    return true;
  }

  // Shown as selected when the cursor lands on it.
  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
  }
  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  destroy(): void {
    if (this.popoverApp) unmount(this.popoverApp);
    this.popoverApp = null;
    this.popoverHost?.remove();
    this.popoverHost = null;
  }

  stopEvent(): boolean {
    return false;
  }
  ignoreMutation(): boolean {
    return true;
  }
}

export class MathInlineView extends SourceNodeView {
  protected title = 'Formula';
  protected placeholder = 'e.g. a^2 + b^2 = c^2';
  protected hint = 'TeX · Ctrl+Enter to save';
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    super(node, view, getPos, 'span', 'math-inline');
  }
  protected text() {
    return String(this.node.attrs.tex);
  }
  protected attrsFor(text: string) {
    return { tex: text.replace(/\n+/g, ' ') };
  }
  protected preview(text: string) {
    return formulaHtml(text, !!this.node.attrs.display);
  }
  protected render() {
    this.dom.innerHTML = formulaHtml(this.text(), !!this.node.attrs.display);
    this.dom.title = 'Formula — click to change';
  }
}

export class MathBlockView extends SourceNodeView {
  protected title = 'Formula';
  protected placeholder = 'e.g. \\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}';
  protected hint = 'TeX · Ctrl+Enter to save';
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    super(node, view, getPos, 'div', 'math-block');
  }
  protected text() {
    return String(this.node.attrs.tex);
  }
  protected attrsFor(text: string) {
    return { tex: text };
  }
  protected preview(text: string) {
    return formulaHtml(text, true);
  }
  protected render() {
    this.dom.innerHTML = formulaHtml(this.text(), true);
    this.dom.title = 'Formula — click to change';
  }
}

export class FrontMatterView extends SourceNodeView {
  protected title = 'Document details';
  protected hint = 'One “name: value” per line';
  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    super(node, view, getPos, 'div', 'front-matter front-matter-block');
  }
  protected text() {
    return String(this.node.attrs.content).replace(/\n$/, '');
  }
  protected attrsFor(text: string) {
    return { content: text.endsWith('\n') || !text ? text : `${text}\n` };
  }
  protected render() {
    const rows = frontMatterFields(String(this.node.attrs.content))
      .map((f) => `<dt>${escapeHtml(f.key)}</dt><dd>${escapeHtml(f.value)}</dd>`)
      .join('');
    this.dom.innerHTML = `<div class="front-matter-summary">Document details</div><dl>${rows}</dl>`;
    this.dom.title = 'Document details — click to change';
  }
}

// A picture: shown as it will read (its file found next to the document);
// clicking it lets the user describe it — the words a screen reader says
// and the reader shows if the file goes missing — or take it out.
export class ImageView extends SourceNodeView {
  protected title = 'Picture description';
  protected placeholder = 'What the picture shows';
  protected hint = 'Read aloud by screen readers';
  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    private resolve: (src: string) => string = (s) => s,
  ) {
    super(node, view, getPos, 'span', 'editor-image');
    this.render(); // again, now that `resolve` is set
  }
  protected text() {
    return String(this.node.attrs.alt ?? '');
  }
  protected attrsFor(text: string) {
    return { alt: text.replace(/\n+/g, ' ').trim() };
  }
  protected render() {
    // Before the subclass's own fields exist (the first render runs in
    // the base constructor), fall back to the src as written.
    const resolve = this.resolve ?? ((s: string) => s);
    let img = this.dom.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.draggable = false;
      this.dom.appendChild(img);
    }
    img.src = resolve(String(this.node.attrs.src));
    img.alt = this.text();
    if (this.node.attrs.title) img.title = String(this.node.attrs.title);
    this.dom.title = 'Picture — click to describe it';
  }
}
