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
});
