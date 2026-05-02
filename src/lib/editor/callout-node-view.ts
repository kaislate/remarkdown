// NodeView for the callout block in the editor.
//
// The schema's toDOM is sufficient for read-only rendering (used by PM
// when no NodeView is registered). In the editor we need two extra
// behaviours:
//   1. Clicking the chevron button must dispatch a transaction that
//      toggles the `fold` attribute (`+` ↔ `-`) so the change survives
//      serialization to markdown.
//   2. Clicks/keypresses inside the non-content header (icon, title,
//      chevron) must not be treated by PM as cursor-positioning events
//      that walk into the document.
//
// Structure mirrors the schema's toDOM exactly so the article CSS
// (callout-{type} colours, header layout, body padding) lights up
// without any duplicated rules. The body element is exposed as
// `contentDOM` so PM renders the callout's children there.
import type { Node } from 'prosemirror-model';
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import { CALLOUT_ICONS, calloutIcon } from './callout-icons';

export class CalloutNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: Node;
  private foldBtn: HTMLButtonElement | null = null;

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.node = node;

    const type = String(node.attrs.type || 'note');
    const title = String(
      node.attrs.title || type.charAt(0).toUpperCase() + type.slice(1),
    );
    const fold = String(node.attrs.fold || '');
    const foldable = fold === '+' || fold === '-';
    const startsClosed = fold === '-';

    const root = document.createElement('div');
    root.className = `callout callout-${type}`;
    root.setAttribute('data-callout', type);

    const header = document.createElement('div');
    header.className = 'callout-header';
    if (foldable) header.setAttribute('data-foldable', '1');
    // PM's contentEditable detection treats anything inside the editor
    // surface as editable by default. Mark the header non-editable so
    // the cursor can't land in the icon/title and the chevron behaves
    // like a real button.
    header.setAttribute('contenteditable', 'false');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'callout-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = calloutIcon(type);
    header.appendChild(iconSpan);

    const titleSpan = document.createElement('span');
    titleSpan.className = 'callout-title';
    titleSpan.textContent = title;
    header.appendChild(titleSpan);

    if (foldable) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'callout-fold';
      btn.setAttribute('aria-label', startsClosed ? 'Expand' : 'Collapse');
      btn.textContent = startsClosed ? '▸' : '▾';
      // Prevent the editor surface from stealing focus on mousedown,
      // which would otherwise blur the editor and (in some browsers)
      // collapse the selection before the click handler runs.
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = getPos();
        if (pos == null) return;
        const currentNode = view.state.doc.nodeAt(pos);
        if (!currentNode || currentNode.type.name !== 'callout') return;
        const currentFold = String(currentNode.attrs.fold || '');
        // Only toggle when the callout is foldable (`+` or `-`). A
        // non-foldable callout doesn't render a chevron, so this guard
        // is defensive against future state-mutation paths.
        if (currentFold !== '+' && currentFold !== '-') return;
        const newFold = currentFold === '+' ? '-' : '+';
        const tr = view.state.tr.setNodeMarkup(pos, undefined, {
          ...currentNode.attrs,
          fold: newFold,
        });
        view.dispatch(tr);
      });
      header.appendChild(btn);
      this.foldBtn = btn;
    }

    const body = document.createElement('div');
    body.className = 'callout-body';
    if (startsClosed) body.setAttribute('hidden', '');

    root.appendChild(header);
    root.appendChild(body);

    this.dom = root;
    this.contentDOM = body;
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;

    const prev = this.node.attrs;
    const next = node.attrs;

    // type / title / foldability changes are structural — let PM
    // recreate the NodeView so the header re-renders cleanly.
    if (
      prev.type !== next.type ||
      prev.title !== next.title ||
      foldability(prev.fold) !== foldability(next.fold)
    ) {
      return false;
    }

    // Common case: just the open/closed state changed. Patch in place
    // so the user's selection in the body survives.
    const startsClosed = String(next.fold || '') === '-';
    if (startsClosed) {
      this.contentDOM.setAttribute('hidden', '');
    } else {
      this.contentDOM.removeAttribute('hidden');
    }
    if (this.foldBtn) {
      this.foldBtn.textContent = startsClosed ? '▸' : '▾';
      this.foldBtn.setAttribute(
        'aria-label',
        startsClosed ? 'Expand' : 'Collapse',
      );
    }

    this.node = node;
    return true;
  }

  // Stop PM from interpreting clicks on the chevron / header chrome as
  // cursor-positioning events. Without this, clicking the chevron also
  // moves the selection into the callout's first paragraph and PM may
  // dispatch its own click handler over the top of ours.
  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    return target.closest('.callout-header') !== null;
  }

  // The header isn't part of the PM document, so any DOM mutation
  // inside it is non-content and must not trigger PM's "DOM mutated
  // unexpectedly, redraw" path. Attribute changes on the body itself
  // (our `hidden` toggle) are likewise driven by us, not by content
  // edits, so we ignore those too.
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    const target = mutation.target;
    if (!target) return false;
    // Element ancestors: header is non-content, ignore.
    const targetEl =
      target.nodeType === 1
        ? (target as Element)
        : target.parentElement;
    if (targetEl?.closest('.callout-header')) return true;
    // Body's own attribute changes (our `hidden` toggle) are not
    // content edits.
    if (mutation.type === 'attributes' && target === this.contentDOM) {
      return true;
    }
    return false;
  }
}

function foldability(fold: unknown): 'foldable' | 'static' {
  const f = String(fold || '');
  return f === '+' || f === '-' ? 'foldable' : 'static';
}

// Re-export for callers that want the icon set without importing two
// modules. (The shared module is the source of truth.)
export { CALLOUT_ICONS };
