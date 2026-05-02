import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { tasksPlugin } from '../../../src/lib/markdown-it-tasks';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { serializeDocToMarkdown } from '../../../src/lib/editor/serializer';
import { TaskItemNodeView } from '../../../src/lib/editor/task-item-node-view';
import { EditorView } from 'prosemirror-view';
import { EditorState, TextSelection } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import { createEditorView, insertTaskList, splitTaskOrListItem } from '../../../src/lib/editor/view';

describe('tasksPlugin', () => {
  function tokenize(md: string) {
    const it = MarkdownIt('commonmark').use(tasksPlugin);
    return it.parse(md, {});
  }

  it('marks an unchecked task list_item_open with data-task-state="unchecked"', () => {
    const tokens = tokenize('- [ ] thing\n');
    const open = tokens.find((t) => t.type === 'list_item_open')!;
    expect(open.attrGet('data-task-state')).toBe('unchecked');
  });

  it('marks a checked task list_item_open with data-task-state="checked"', () => {
    const tokens = tokenize('- [x] thing\n');
    const open = tokens.find((t) => t.type === 'list_item_open')!;
    expect(open.attrGet('data-task-state')).toBe('checked');
  });

  it('strips the [ ] / [x] marker from the inline content', () => {
    const tokens = tokenize('- [ ] thing\n');
    const inline = tokens.find((t) => t.type === 'inline')!;
    expect(inline.content.trim()).toBe('thing');
  });

  it('leaves non-task list items untouched', () => {
    const tokens = tokenize('- plain item\n');
    const open = tokens.find((t) => t.type === 'list_item_open')!;
    expect(open.attrGet('data-task-state')).toBeNull();
    const inline = tokens.find((t) => t.type === 'inline')!;
    expect(inline.content.trim()).toBe('plain item');
  });

  it('case-insensitive on the X', () => {
    const lower = tokenize('- [x] a\n');
    const upper = tokenize('- [X] b\n');
    expect(lower.find((t) => t.type === 'list_item_open')!.attrGet('data-task-state')).toBe('checked');
    expect(upper.find((t) => t.type === 'list_item_open')!.attrGet('data-task-state')).toBe('checked');
  });
});

describe('task-list parsing', () => {
  it('parses an unchecked task into list_item with checked: false', () => {
    const doc = parseMarkdownToDoc('- [ ] thing\n');
    let item: { attrs: { checked: unknown } } | null = null;
    doc.descendants((n) => {
      if (n.type.name === 'list_item') item = n as never;
    });
    expect(item).not.toBeNull();
    expect(item!.attrs.checked).toBe(false);
  });

  it('parses a checked task into list_item with checked: true', () => {
    const doc = parseMarkdownToDoc('- [x] done\n');
    let item: { attrs: { checked: unknown } } | null = null;
    doc.descendants((n) => {
      if (n.type.name === 'list_item') item = n as never;
    });
    expect(item!.attrs.checked).toBe(true);
  });

  it('parses a plain bullet item with checked: null', () => {
    const doc = parseMarkdownToDoc('- plain\n');
    let item: { attrs: { checked: unknown } } | null = null;
    doc.descendants((n) => {
      if (n.type.name === 'list_item') item = n as never;
    });
    expect(item!.attrs.checked).toBe(null);
  });

  it('parses a mixed list (plain + task) preserving each items state', () => {
    const doc = parseMarkdownToDoc('- plain\n- [ ] todo\n- [x] done\n');
    const checks: unknown[] = [];
    doc.descendants((n) => {
      if (n.type.name === 'list_item') checks.push(n.attrs.checked);
    });
    expect(checks).toEqual([null, false, true]);
  });

  it('strips the marker from the parsed text content', () => {
    const doc = parseMarkdownToDoc('- [ ] thing\n');
    let text = '';
    doc.descendants((n) => {
      if (n.type.name === 'text') text += n.text;
    });
    expect(text).toBe('thing');
  });
});

describe('task-list round-trip', () => {
  function rt(md: string): string {
    return serializeDocToMarkdown(parseMarkdownToDoc(md));
  }

  it('round-trips a single unchecked task', () => {
    const src = '* [ ] thing\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips a single checked task', () => {
    const src = '* [x] done\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips a mixed list (plain + tasks)', () => {
    const src = '* plain\n* [ ] todo\n* [x] done\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips a multi-paragraph task item', () => {
    const src = '* [ ] first paragraph\n\n  second paragraph\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips a plain bullet list unchanged', () => {
    const src = '* one\n* two\n';
    expect(rt(src)).toBe(src);
  });
});

describe('TaskItemNodeView', () => {
  it('renders a <li.task-list-item> with a leading checkbox', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = parseMarkdownToDoc('- [ ] hello\n');
    const view = new EditorView(parent, {
      state: EditorState.create({ doc, schema: editorSchema }),
      nodeViews: {
        list_item: (node, editorView, getPos) =>
          new TaskItemNodeView(node, editorView, getPos),
      },
    });
    const li = parent.querySelector('li.task-list-item');
    expect(li).not.toBeNull();
    const input = li!.querySelector('input[type="checkbox"]');
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).checked).toBe(false);
    view.destroy();
    parent.remove();
  });

  it('reflects the checked state in the rendered input', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = parseMarkdownToDoc('- [x] done\n');
    const view = new EditorView(parent, {
      state: EditorState.create({ doc, schema: editorSchema }),
      nodeViews: {
        list_item: (node, editorView, getPos) =>
          new TaskItemNodeView(node, editorView, getPos),
      },
    });
    const input = parent.querySelector<HTMLInputElement>(
      'li.task-list-item input[type="checkbox"]',
    );
    expect(input!.checked).toBe(true);
    view.destroy();
    parent.remove();
  });

  it('renders a plain <li> when the item is not a task (checked: null)', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = parseMarkdownToDoc('- plain\n');
    const view = new EditorView(parent, {
      state: EditorState.create({ doc, schema: editorSchema }),
      nodeViews: {
        list_item: (node, editorView, getPos) =>
          new TaskItemNodeView(node, editorView, getPos),
      },
    });
    const taskLi = parent.querySelector('li.task-list-item');
    expect(taskLi).toBeNull();
    const li = parent.querySelector('li');
    expect(li).not.toBeNull();
    expect(li!.querySelector('input[type="checkbox"]')).toBeNull();
    view.destroy();
    parent.remove();
  });
});

describe('createEditorView with task lists', () => {
  it('mounts the TaskItemNodeView for a task source', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = createEditorView(parent, '- [ ] thing\n', () => {});
    const cb = parent.querySelector('li.task-list-item input[type="checkbox"]');
    expect(cb).not.toBeNull();
    view.destroy();
    parent.remove();
  });

  it('insertTaskList wraps the current paragraph as a bullet_list with one unchecked task', () => {
    const doc = parseMarkdownToDoc('hello\n');
    let state = EditorState.create({ doc, schema: editorSchema });
    let dispatched = false;
    insertTaskList()(state, (tr) => {
      state = state.apply(tr);
      dispatched = true;
    });
    expect(dispatched).toBe(true);
    let firstItem: { attrs: { checked: unknown } } | null = null;
    state.doc.descendants((n) => {
      if (n.type.name === 'list_item' && firstItem === null) {
        firstItem = n as never;
      }
    });
    expect(firstItem).not.toBeNull();
    expect(firstItem!.attrs.checked).toBe(false);
  });

  it('splitTaskOrListItem creates a new task with checked: false from a checked task', () => {
    // Caret at end of a checked task — Enter should split into a new
    // UNCHECKED task (matches Notion / GitHub UX).
    const doc = parseMarkdownToDoc('- [x] done\n');
    let state = EditorState.create({ doc, schema: editorSchema });
    // Move cursor inside the paragraph of the checked task. We walk to
    // the first paragraph and place the selection at the end of its
    // content — this is more robust than computing positions from
    // doc.content.size, which depends on closing-token sizing.
    let paraEnd: number | null = null;
    state.doc.descendants((n, pos) => {
      if (paraEnd === null && n.type.name === 'paragraph') {
        paraEnd = pos + 1 + n.content.size;
        return false;
      }
      return undefined;
    });
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, paraEnd!)
      )
    );
    let dispatched = false;
    splitTaskOrListItem(state, (tr) => {
      state = state.apply(tr);
      dispatched = true;
    });
    expect(dispatched).toBe(true);
    const checks: unknown[] = [];
    state.doc.descendants((n) => {
      if (n.type.name === 'list_item') checks.push(n.attrs.checked);
    });
    // Original task is still checked: true; new sibling is checked: false.
    expect(checks).toEqual([true, false]);
  });
});
