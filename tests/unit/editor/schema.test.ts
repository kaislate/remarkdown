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
});
