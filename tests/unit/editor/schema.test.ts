import { describe, it, expect } from 'vitest';
import { editorSchema } from '../../../src/lib/editor/schema';

describe('editorSchema', () => {
  it('has a callout node', () => {
    expect(editorSchema.nodes.callout).toBeDefined();
  });

  it('callout node has type/title/fold attrs', () => {
    const callout = editorSchema.nodes.callout;
    expect(callout.spec.attrs).toBeDefined();
    expect(callout.spec.attrs?.type).toBeDefined();
    expect(callout.spec.attrs?.title).toBeDefined();
    expect(callout.spec.attrs?.fold).toBeDefined();
  });

  it('callout node accepts block content', () => {
    const callout = editorSchema.nodes.callout;
    expect(callout.spec.content).toBe('block+');
  });

  it('callout node toDOM renders the .callout container', () => {
    const callout = editorSchema.nodes.callout;
    const node = editorSchema.node('callout',
      { type: 'info', title: 'Info', fold: '' },
      [editorSchema.node('paragraph', null, [editorSchema.text('Hello.')])],
    );
    const out = callout.spec.toDOM!(node);
    expect(Array.isArray(out)).toBe(true);
    const arr = out as unknown as [string, Record<string, string>, ...unknown[]];
    expect(arr[0]).toBe('div');
    expect(arr[1].class).toContain('callout');
    expect(arr[1].class).toContain('callout-info');
  });

  it('still has the default paragraph + heading + blockquote nodes', () => {
    expect(editorSchema.nodes.paragraph).toBeDefined();
    expect(editorSchema.nodes.heading).toBeDefined();
    expect(editorSchema.nodes.blockquote).toBeDefined();
  });

  it('has a code_block node with a language attr defaulting to empty string', () => {
    const cb = editorSchema.nodes.code_block;
    expect(cb).toBeDefined();
    expect(cb.spec.attrs?.language).toBeDefined();
    const node = editorSchema.node('code_block', null, [editorSchema.text('hi')]);
    expect(node.attrs.language).toBe('');
  });

  it('preserves a non-empty language on a code_block node', () => {
    const node = editorSchema.node(
      'code_block',
      { language: 'typescript' },
      [editorSchema.text('const x = 1;')],
    );
    expect(node.attrs.language).toBe('typescript');
  });

  it('toDOM emits <pre><code class="language-X"> when a language is set', () => {
    const node = editorSchema.node(
      'code_block',
      { language: 'rust' },
      [editorSchema.text('fn main() {}')],
    );
    const out = node.type.spec.toDOM!(node) as unknown[];
    // ['pre', {'data-language': 'rust'}, ['code', {class: 'language-rust'}, 0]]
    expect(out[0]).toBe('pre');
    expect((out[1] as Record<string, string>)['data-language']).toBe('rust');
    const codeArr = out[2] as unknown[];
    expect(codeArr[0]).toBe('code');
    expect((codeArr[1] as Record<string, string>).class).toBe('language-rust');
    expect(codeArr[2]).toBe(0);
  });

  it('toDOM emits a bare <pre><code> when no language is set', () => {
    const node = editorSchema.node('code_block', null, [editorSchema.text('x')]);
    const out = node.type.spec.toDOM!(node) as unknown[];
    expect(out[0]).toBe('pre');
    // No data-language attr should be present (empty attr object).
    expect(Object.keys(out[1] as Record<string, string>).length).toBe(0);
    const codeArr = out[2] as unknown[];
    // Same for the inner code's class.
    expect(Object.keys(codeArr[1] as Record<string, string>).length).toBe(0);
  });

  it('parseDOM getAttrs reads language from inner <code class="language-foo">', () => {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = 'language-rust';
    code.textContent = 'fn main() {}';
    pre.appendChild(code);
    const rule = editorSchema.nodes.code_block.spec.parseDOM![0];
    const attrs = (rule.getAttrs as (dom: HTMLElement) => Record<string, unknown>)(pre);
    expect(attrs.language).toBe('rust');
  });

  it('parseDOM getAttrs falls back to data-language on the <pre>', () => {
    const pre = document.createElement('pre');
    pre.setAttribute('data-language', 'python');
    pre.appendChild(document.createElement('code'));
    const rule = editorSchema.nodes.code_block.spec.parseDOM![0];
    const attrs = (rule.getAttrs as (dom: HTMLElement) => Record<string, unknown>)(pre);
    expect(attrs.language).toBe('python');
  });

  it('list_item has a checked attr defaulting to null', () => {
    const li = editorSchema.nodes.list_item;
    expect(li.spec.attrs?.checked).toBeDefined();
    const node = editorSchema.node('list_item', null, [
      editorSchema.node('paragraph', null, [editorSchema.text('a')]),
    ]);
    expect(node.attrs.checked).toBe(null);
  });

  it('list_item preserves a non-null checked attr (true / false)', () => {
    const t = editorSchema.node('list_item', { checked: true }, [
      editorSchema.node('paragraph', null, [editorSchema.text('a')]),
    ]);
    const f = editorSchema.node('list_item', { checked: false }, [
      editorSchema.node('paragraph', null, [editorSchema.text('a')]),
    ]);
    expect(t.attrs.checked).toBe(true);
    expect(f.attrs.checked).toBe(false);
  });

  it('toDOM emits a plain <li> when checked is null', () => {
    const node = editorSchema.node('list_item', null, [
      editorSchema.node('paragraph', null, [editorSchema.text('a')]),
    ]);
    const out = node.type.spec.toDOM!(node) as unknown[];
    expect(out[0]).toBe('li');
    // Plain list item: second element is the content hole `0`.
    expect(out[1]).toBe(0);
  });

  it('toDOM emits a task-list-item <li> with checkbox when checked is set', () => {
    const node = editorSchema.node('list_item', { checked: true }, [
      editorSchema.node('paragraph', null, [editorSchema.text('a')]),
    ]);
    const out = node.type.spec.toDOM!(node) as unknown[];
    // ['li', { class: 'task-list-item' }, ['input', { ... checked: '' }], 0]
    expect(out[0]).toBe('li');
    expect((out[1] as Record<string, string>).class).toBe('task-list-item');
    const input = out[2] as unknown[];
    expect(input[0]).toBe('input');
    const inputAttrs = input[1] as Record<string, string>;
    expect(inputAttrs.type).toBe('checkbox');
    expect(inputAttrs.checked).toBeDefined();
    expect(out[3]).toBe(0);
  });

  it('parseDOM reads task-list-item class + input.checked into the attr', () => {
    const li = document.createElement('li');
    li.className = 'task-list-item';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    li.appendChild(input);
    const rule = editorSchema.nodes.list_item.spec.parseDOM!.find(
      (r) => r.tag === 'li',
    )!;
    const attrs = (rule.getAttrs as (dom: HTMLElement) => Record<string, unknown>)(
      li,
    );
    expect(attrs.checked).toBe(true);
  });

  it('has table, table_row, table_cell, table_header nodes', () => {
    expect(editorSchema.nodes.table).toBeDefined();
    expect(editorSchema.nodes.table_row).toBeDefined();
    expect(editorSchema.nodes.table_cell).toBeDefined();
    expect(editorSchema.nodes.table_header).toBeDefined();
  });

  it('table_cell content is inline-only (no nested blocks)', () => {
    const cell = editorSchema.nodes.table_cell;
    // GFM tables don't support multi-paragraph cells; constraining the
    // schema to inline content matches that and keeps serialization
    // simple.
    expect(cell.spec.content).toBe('inline*');
  });

  it('a 1x1 table can be constructed and contains the cell text', () => {
    const cell = editorSchema.node('table_cell', null, [
      editorSchema.text('hello'),
    ]);
    const row = editorSchema.node('table_row', null, [cell]);
    const table = editorSchema.node('table', null, [row]);
    expect(table.firstChild!.firstChild!.textContent).toBe('hello');
  });

  it('defines sub and sup marks', () => {
    expect(editorSchema.marks.sub).toBeDefined();
    expect(editorSchema.marks.sup).toBeDefined();
  });

  it('sub mark serializes to <sub> via toDOM', () => {
    const sub = editorSchema.marks.sub.spec.toDOM!({} as never, false);
    expect(sub).toEqual(['sub', 0]);
  });

  it('sup mark serializes to <sup> via toDOM', () => {
    const sup = editorSchema.marks.sup.spec.toDOM!({} as never, false);
    expect(sup).toEqual(['sup', 0]);
  });
});
