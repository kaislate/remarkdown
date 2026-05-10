// markdown-it core rule that pairs every `footnote_ref` token with the
// raw text of its definition body and removes the auto-emitted footnote
// block (the trailing <ol class="footnotes-list"> stuff). Run AFTER
// `footnote_tail` (the markdown-it-footnote rule that builds the
// definition block from collected references).
//
// We do this so the prosemirror-markdown parser handler for footnote_ref
// can read the body off `tok.meta.body` and store it on the inline
// `footnote` node's attrs. The PM doc never needs a block-level
// "footnote definitions" zone — definitions live inside their refs
// and the serializer re-emits them at the bottom of the doc.

import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

type TokenWithMeta = Token & { meta?: { id?: number; subId?: number; label?: string; body?: string } };

export function footnoteAttachBodyPlugin(md: MarkdownIt): void {
  md.core.ruler.after('footnote_tail', 'footnote_attach_body', (state) => {
    const tokens = state.tokens as TokenWithMeta[];

    // 1) Walk top-level tokens to find each footnote_open ... footnote_close
    //    range, build label -> body string. The body is the joined `.content`
    //    of any nested `inline` tokens (paragraph wrappers around prose).
    const bodyByLabel = new Map<string, string>();
    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      if (tok.type === 'footnote_open') {
        const label = String(tok.meta?.label ?? '');
        const paragraphs: string[] = [];
        let j = i + 1;
        while (j < tokens.length && tokens[j].type !== 'footnote_close') {
          if (tokens[j].type === 'inline') {
            paragraphs.push(tokens[j].content);
          }
          j += 1;
        }
        bodyByLabel.set(label, paragraphs.join('\n\n'));
        i = j; // jump past close
      }
      i += 1;
    }

    // 2) Annotate every nested `footnote_ref` (inside `inline` tokens'
    //    children arrays) with meta.body looked up by label.
    for (const tok of tokens) {
      if (tok.type !== 'inline' || !tok.children) continue;
      for (const child of tok.children as TokenWithMeta[]) {
        if (child.type !== 'footnote_ref') continue;
        const label = String(child.meta?.label ?? '');
        if (!child.meta) child.meta = {};
        child.meta.body = bodyByLabel.get(label) ?? '';
      }
    }

    // 3) Drop the entire footnote-block region: footnote_block_open
    //    through footnote_block_close (inclusive). markdown-it-footnote
    //    always emits a single contiguous block at the end of the
    //    token stream when any footnotes exist.
    const startIdx = tokens.findIndex(t => t.type === 'footnote_block_open');
    if (startIdx === -1) return false;
    const endIdx = tokens.findIndex((t, k) => k >= startIdx && t.type === 'footnote_block_close');
    if (endIdx === -1) return false;
    tokens.splice(startIdx, endIdx - startIdx + 1);

    return false;
  });
}
