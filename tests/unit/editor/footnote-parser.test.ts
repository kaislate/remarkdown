import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import { footnoteAttachBodyPlugin } from '../../../src/lib/editor/parser-footnote';

function tokenize(src: string) {
  const md = MarkdownIt();
  md.use(footnote);
  md.use(footnoteAttachBodyPlugin);
  return md.parse(src, {});
}

describe('footnoteAttachBodyPlugin', () => {
  it('annotates footnote_ref tokens with body text', () => {
    const tokens = tokenize('Claim.[^1]\n\n[^1]: Citation here.\n');
    const refTokens = collectFootnoteRefs(tokens);
    expect(refTokens).toHaveLength(1);
    expect(refTokens[0].meta?.body).toBe('Citation here.');
    expect(refTokens[0].meta?.label).toBe('1');
  });

  it('strips footnote_block tokens from the stream', () => {
    const tokens = tokenize('Claim.[^1]\n\n[^1]: Citation.\n');
    const blockTokens = tokens.filter(t =>
      t.type.startsWith('footnote_block_') ||
      t.type === 'footnote_open' ||
      t.type === 'footnote_close' ||
      t.type === 'footnote_anchor',
    );
    expect(blockTokens).toEqual([]);
  });

  it('handles multi-paragraph footnote bodies', () => {
    const src = 'See[^p].\n\n[^p]: First paragraph.\n\n    Second paragraph.\n';
    const tokens = tokenize(src);
    const refs = collectFootnoteRefs(tokens);
    expect(refs[0].meta?.body).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('handles multiple references to the same footnote', () => {
    const src = 'A[^x] and B[^x].\n\n[^x]: Shared body.\n';
    const tokens = tokenize(src);
    const refs = collectFootnoteRefs(tokens);
    expect(refs).toHaveLength(2);
    expect(refs[0].meta?.body).toBe('Shared body.');
    expect(refs[1].meta?.body).toBe('Shared body.');
  });

  it('preserves markdown markup verbatim in body text', () => {
    const tokens = tokenize('Hi.[^1]\n\n[^1]: With **bold** and *italic*.\n');
    const refs = collectFootnoteRefs(tokens);
    expect(refs[0].meta?.body).toBe('With **bold** and *italic*.');
  });
});

function collectFootnoteRefs(tokens: ReturnType<MarkdownIt['parse']>) {
  const out = [];
  for (const tok of tokens) {
    if (tok.type === 'inline' && tok.children) {
      for (const c of tok.children) {
        if (c.type === 'footnote_ref') out.push(c);
      }
    }
  }
  return out;
}
