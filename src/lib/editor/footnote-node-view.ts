// Footnote NodeView. Renders the inline reference as a clickable <sup>;
// opens a Svelte popover (FootnotePopover.svelte) on click; dispatches
// PM transactions on save/delete.
//
// Atom node — no contentDOM, no editable inner content. The popover is
// the SOLE edit surface for label and body.

import { mount, unmount } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import FootnotePopover, { type FootnotePopoverState } from '../../components/FootnotePopover.svelte';

export class FootnoteNodeView implements NodeView {
  dom: HTMLElement;
  private view: EditorView;
  private getPos: () => number | undefined;
  private node: PMNode;
  private popoverHost: HTMLElement | null = null;
  private popoverApp: ReturnType<typeof mount> | null = null;
  private popoverState: Writable<FootnotePopoverState>;

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.popoverState = writable({ open: false, label: '', body: '', x: 0, y: 0 });

    const sup = document.createElement('sup');
    sup.className = 'footnote-ref';
    sup.setAttribute('data-label', String(node.attrs.label));
    sup.setAttribute('data-body', String(node.attrs.body));

    const a = document.createElement('a');
    a.href = `#fn-${String(node.attrs.label)}`;
    a.textContent = `[${String(node.attrs.label)}]`;
    sup.appendChild(a);

    sup.addEventListener('mousedown', (e) => {
      // Prevent PM's default click-handling from collapsing the
      // selection out of the inline footnote.
      e.preventDefault();
    });
    sup.addEventListener('click', (e) => {
      e.preventDefault();
      this.openPopover();
    });

    this.dom = sup;
  }

  private openPopover(): void {
    const rect = this.dom.getBoundingClientRect();
    this.popoverState.set({
      open: true,
      label: String(this.node.attrs.label),
      body: String(this.node.attrs.body),
      x: rect.left + window.scrollX,
      y: rect.bottom + window.scrollY + 6,
    });
    if (!this.popoverApp) {
      this.popoverHost = document.createElement('div');
      document.body.appendChild(this.popoverHost);
      this.popoverApp = mount(FootnotePopover, {
        target: this.popoverHost,
        props: {
          stateStore: this.popoverState,
          onSave: (next: { label: string; body: string }) => this.onSave(next),
          onDelete: () => this.onDelete(),
        },
      });
    }
  }

  private closePopover(): void {
    this.popoverState.update(s => ({ ...s, open: false }));
  }

  private onSave(next: { label: string; body: string }): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      label: next.label,
      body: next.body,
    });
    this.view.dispatch(tr);
    this.closePopover();
  }

  private onDelete(): void {
    const pos = this.getPos();
    if (pos === undefined) return;
    const tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
    this.view.dispatch(tr);
    this.closePopover();
  }

  // Update the visible <sup> when the node's attrs change.
  update(node: PMNode): boolean {
    if (node.type.name !== 'footnote') return false;
    if (node.attrs.label !== this.node.attrs.label || node.attrs.body !== this.node.attrs.body) {
      this.node = node;
      this.dom.setAttribute('data-label', String(node.attrs.label));
      this.dom.setAttribute('data-body', String(node.attrs.body));
      const a = this.dom.querySelector('a');
      if (a) {
        a.textContent = `[${String(node.attrs.label)}]`;
        a.href = `#fn-${String(node.attrs.label)}`;
      }
    }
    return true;
  }

  destroy(): void {
    if (this.popoverApp) {
      unmount(this.popoverApp);
      this.popoverApp = null;
    }
    if (this.popoverHost && this.popoverHost.parentNode) {
      this.popoverHost.parentNode.removeChild(this.popoverHost);
      this.popoverHost = null;
    }
  }

  // Atom — no content edits to take.
  stopEvent(): boolean { return false; }
  ignoreMutation(): boolean { return true; }
}
