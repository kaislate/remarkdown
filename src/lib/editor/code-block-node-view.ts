// NodeView for code_block. Mirrors the read-mode <pre><code> structure
// (so article.css's .md-rendered pre rules apply) and adds a language
// pill in the top-right that opens a picker. The pill is rendered
// OUTSIDE contentDOM (PM still treats the <code> as the editable
// area). stopEvent + ignoreMutation keep the pill's clicks and DOM
// from confusing PM — same pattern as CalloutNodeView.
import type { Node } from 'prosemirror-model';
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from 'prosemirror-view';
import {
  SUPPORTED_LANGUAGES,
  languageLabel,
} from './code-block-languages';

export class CodeBlockNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: Node;
  private pill: HTMLButtonElement;
  private picker: HTMLElement | null = null;
  private onDocClick: ((e: MouseEvent) => void) | null = null;

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.node = node;
    const lang = String(node.attrs.language || '');

    const pre = document.createElement('pre');
    pre.className = 'code-block-editor';
    if (lang) pre.setAttribute('data-language', lang);

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'code-block-lang-pill';
    pill.contentEditable = 'false';
    pill.setAttribute('aria-label', 'Change language');
    pill.textContent = languageLabel(lang);
    pill.addEventListener('mousedown', (e) => e.preventDefault());
    pill.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.togglePicker(view, getPos);
    });

    const code = document.createElement('code');
    if (lang) code.className = `language-${lang}`;

    pre.appendChild(pill);
    pre.appendChild(code);

    this.dom = pre;
    this.contentDOM = code;
    this.pill = pill;
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    const lang = String(node.attrs.language || '');
    this.pill.textContent = languageLabel(lang);
    if (lang) {
      this.dom.setAttribute('data-language', lang);
      this.contentDOM.className = `language-${lang}`;
    } else {
      this.dom.removeAttribute('data-language');
      this.contentDOM.removeAttribute('class');
    }
    this.node = node;
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    return (
      target.closest('.code-block-lang-pill') !== null ||
      target.closest('.code-block-lang-picker') !== null
    );
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    const target = mutation.target;
    if (!target) return false;
    const targetEl =
      target.nodeType === 1
        ? (target as Element)
        : target.parentElement;
    if (
      targetEl?.closest('.code-block-lang-pill') ||
      targetEl?.closest('.code-block-lang-picker')
    ) {
      return true;
    }
    if (mutation.type === 'attributes' && target === this.dom) {
      // Our own data-language updates — not a content edit.
      return true;
    }
    return false;
  }

  destroy(): void {
    this.closePicker();
  }

  private togglePicker(
    view: EditorView,
    getPos: () => number | undefined,
  ): void {
    if (this.picker) {
      this.closePicker();
      return;
    }
    const pos = getPos();
    if (pos == null) return;

    const picker = document.createElement('div');
    picker.className = 'code-block-lang-picker';
    picker.setAttribute('role', 'menu');

    const items = ['text', ...SUPPORTED_LANGUAGES];
    for (const lang of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-block-lang-option';
      btn.textContent = languageLabel(lang);
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentNode = view.state.doc.nodeAt(pos);
        if (!currentNode || currentNode.type.name !== 'code_block') {
          this.closePicker();
          return;
        }
        const newLang = lang === 'text' ? '' : lang;
        const tr = view.state.tr.setNodeMarkup(pos, undefined, {
          ...currentNode.attrs,
          language: newLang,
        });
        view.dispatch(tr);
        this.closePicker();
      });
      picker.appendChild(btn);
    }

    // Anchor the picker just below the pill, in document coordinates.
    const rect = this.pill.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = `${rect.bottom + 4}px`;
    picker.style.left = `${rect.left}px`;
    picker.style.zIndex = '100';

    document.body.appendChild(picker);
    this.picker = picker;

    // Click-outside dismissal. Note: `Node` here is the DOM Node, not
    // prosemirror-model's Node (which we've imported as `Node` for the
    // schema-side typings). Use globalThis.Node to disambiguate.
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as globalThis.Node | null;
      if (!target) return;
      if (picker.contains(target) || this.pill.contains(target)) return;
      this.closePicker();
    };
    this.onDocClick = onDocClick;
    setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
  }

  private closePicker(): void {
    if (this.picker) {
      this.picker.remove();
      this.picker = null;
    }
    if (this.onDocClick) {
      document.removeEventListener('mousedown', this.onDocClick);
      this.onDocClick = null;
    }
  }
}
