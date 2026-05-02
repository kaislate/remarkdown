import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { tasksPlugin } from '../../../src/lib/markdown-it-tasks';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { serializeDocToMarkdown } from '../../../src/lib/editor/serializer';

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
