// NodeView for `list_item`. When `attrs.checked` is non-null, renders
// the checkbox prefix and a click handler that toggles the attribute
// via a setNodeMarkup transaction. When `attrs.checked` is null, falls
// back to a plain <li> so we don't pollute non-task lists with extra
// DOM. Mirrors the established CalloutNodeView / CodeBlockNodeView
// pattern: the checkbox is OUTSIDE contentDOM, so PM still owns the
// editable text.
import type { Node } from 'prosemirror-model';
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from 'prosemirror-view';

export class TaskItemNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private node: Node;
  private checkbox: HTMLInputElement | null = null;

  constructor(
    node: Node,
    view: EditorView,
    getPos: () => number | undefined,
  ) {
    this.node = node;
    const li = document.createElement('li');
    const checked = node.attrs.checked;

    if (checked === null) {
      // Plain list item — no checkbox, just contentDOM.
      this.dom = li;
      this.contentDOM = li;
      return;
    }

    li.className = 'task-list-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.contentEditable = 'false';
    checkbox.checked = checked === true;
    checkbox.addEventListener('mousedown', (e) => e.preventDefault());
    checkbox.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos == null) return;
      const currentNode = view.state.doc.nodeAt(pos);
      if (!currentNode || currentNode.type.name !== 'list_item') return;
      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...currentNode.attrs,
        checked: !currentNode.attrs.checked,
      });
      view.dispatch(tr);
    });

    // Wrap the editable content in its own span so the checkbox sits
    // OUTSIDE contentDOM. PM treats only the wrapper's interior as the
    // node's text region for cursor positioning and selection.
    const content = document.createElement('span');
    content.className = 'task-content';

    li.appendChild(checkbox);
    li.appendChild(content);

    this.dom = li;
    this.contentDOM = content;
    this.checkbox = checkbox;
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    const wasTask = this.node.attrs.checked !== null;
    const isTask = node.attrs.checked !== null;
    if (wasTask !== isTask) {
      // Structural change (task ↔ plain) — let PM recreate the view.
      return false;
    }
    if (isTask && this.checkbox) {
      this.checkbox.checked = node.attrs.checked === true;
    }
    this.node = node;
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    return target.tagName === 'INPUT' && target.closest('li.task-list-item') !== null;
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    const target = mutation.target;
    if (!target) return false;
    const targetEl =
      target.nodeType === 1
        ? (target as Element)
        : target.parentElement;
    // Mutations on the checkbox input itself (state we set in update)
    // are not content edits.
    if (targetEl?.tagName === 'INPUT' && targetEl.closest('li.task-list-item')) {
      return true;
    }
    return false;
  }
}
