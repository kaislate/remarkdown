import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { tasksPlugin } from '../../../src/lib/markdown-it-tasks';

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
