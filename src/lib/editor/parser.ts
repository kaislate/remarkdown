// Custom MarkdownParser for the editor. Wraps a markdown-it instance
// with our calloutsPlugin so blockquotes prefixed with [!type] become
// `callout` PM nodes (instead of generic blockquotes). The trick:
// prosemirror-markdown's MarkdownParser keys its token-handlers on
// markdown-it's token type strings, so we can't dynamically pick a
// node based on token metadata. Instead, after calloutsPlugin marks
// the relevant tokens with metadata, we add a core-rule that RENAMES
// the marked tokens from `blockquote_open` / `blockquote_close` to
// `callout_open` / `callout_close`. The MarkdownParser then maps the
// renamed tokens to the callout node via a standard handler entry.
//
// This rename is local to THIS markdown-it instance (parser.ts owns
// its own md), so the production renderer in MarkdownRenderer.ts is
// unaffected.

import MarkdownIt from 'markdown-it';
import { MarkdownParser, defaultMarkdownParser } from 'prosemirror-markdown';
import { calloutsPlugin } from '../markdown-it-callouts';
import { editorSchema } from './schema';
import type { Node } from 'prosemirror-model';
import type Token from 'markdown-it/lib/token.mjs';

const md = MarkdownIt('commonmark');
md.use(calloutsPlugin);

// Rename `blockquote_open`/`blockquote_close` tokens to `callout_open`/
// `callout_close` whenever calloutsPlugin marked them. We track a stack
// of "currently-open callout depths" so closes match the right opens.
md.core.ruler.after('callouts', 'callout-rename', (state) => {
  const tokens = state.tokens;
  const calloutDepths: number[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'blockquote_open') {
      depth += 1;
      const meta = (t as Token & { meta?: { callout?: boolean } }).meta;
      if (meta?.callout) {
        t.type = 'callout_open';
        calloutDepths.push(depth);
      }
    } else if (t.type === 'blockquote_close') {
      if (calloutDepths[calloutDepths.length - 1] === depth) {
        t.type = 'callout_close';
        calloutDepths.pop();
      }
      depth -= 1;
    }
  }
  return false;
});

const editorMarkdownParser = new MarkdownParser(editorSchema, md, {
  ...defaultMarkdownParser.tokens,
  callout: {
    block: 'callout',
    getAttrs: (tok: Token) => ({
      type: tok.attrGet('data-callout') || 'note',
      title: tok.attrGet('data-title') || '',
      fold: tok.attrGet('data-fold') === 'open' ? '+'
          : tok.attrGet('data-fold') === 'closed' ? '-'
          : '',
    }),
  },
});

export function parseMarkdownToDoc(markdown: string): Node {
  const result = editorMarkdownParser.parse(markdown);
  if (!result) {
    return editorSchema.node('doc', null, [editorSchema.node('paragraph')]);
  }
  return result;
}
