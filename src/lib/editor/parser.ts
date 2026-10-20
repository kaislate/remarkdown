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
import { tasksPlugin } from '../markdown-it-tasks';
import subPlugin from 'markdown-it-sub';
import supPlugin from 'markdown-it-sup';
import footnotePlugin from 'markdown-it-footnote';
import { footnoteAttachBodyPlugin } from './parser-footnote';
import katexPlugin from '@vscode/markdown-it-katex';
import { frontMatterPlugin } from '../markdown-it-frontmatter';
import { editorSchema } from './schema';
import type { Node } from 'prosemirror-model';
import type Token from 'markdown-it/lib/token.mjs';

// Use the default preset (not 'commonmark') so GFM tables produce
// table_open / tr_open / th_open / td_open tokens. The default preset
// also enables strikethrough (`~~text~~` → `s_open`/`s_close`); we
// have a `strike` mark in the schema and a handler below to map it.
const md = MarkdownIt();
md.use(calloutsPlugin);
md.use(tasksPlugin);
md.use(subPlugin);
md.use(supPlugin);
md.use(footnotePlugin);
md.use(footnoteAttachBodyPlugin);
// Maths and front matter are tokenised the reader's way, so the editor
// sees exactly what the reader shows — and keeps their text as written.
md.use((katexPlugin as unknown as { default?: typeof katexPlugin }).default ?? katexPlugin);
md.use(frontMatterPlugin);
// The katex plugin labels `$$…$$` within a line `math_block` too; inside
// a paragraph that's inline maths shown on its own line.
md.core.ruler.push('math-inline-display', (state) => {
  for (const t of state.tokens) {
    for (const c of t.children ?? []) if (c.type === 'math_block') c.type = 'math_inline_block';
  }
  return false;
});

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
  // Indented code blocks (no language).
  code_block: {
    block: 'code_block',
    noCloseToken: true,
    getAttrs: () => ({ language: '' }),
  },
  // Fenced code blocks: ```lang\n...\n```
  fence: {
    block: 'code_block',
    noCloseToken: true,
    getAttrs: (tok: Token) => ({ language: (tok.info || '').trim() }),
  },
  // The marker (`-`, `*`, `+`) is kept; tightness as prosemirror-markdown
  // works it out (no blank lines between items).
  bullet_list: {
    block: 'bullet_list',
    getAttrs: (tok: Token, tokens: Token[], i: number) => {
      let j = i;
      while (++j < tokens.length) if (tokens[j].type !== 'list_item_open') break;
      return { tight: j < tokens.length ? tokens[j].hidden : false, bullet: tok.markup || '*' };
    },
  },
  list_item: {
    block: 'list_item',
    getAttrs: (tok: Token) => {
      const state = tok.attrGet('data-task-state');
      return {
        checked:
          state === 'checked' ? true : state === 'unchecked' ? false : null,
      };
    },
  },
  table: { block: 'table' },
  tr: { block: 'table_row' },
  th: { block: 'table_header' },
  td: { block: 'table_cell' },
  // thead / tbody are presentational in markdown-it's table tokens but
  // don't have a corresponding PM node. Mark them as ignored so the
  // parser skips the open/close tokens cleanly.
  thead: { ignore: true },
  tbody: { ignore: true },
  // Strikethrough: markdown-it emits `s_open` / `s_close` for `~~text~~`.
  s: { mark: 'strike' },
  // Subscript: markdown-it-sub emits `sub_open` / `sub_close` for `~text~`.
  sub: { mark: 'sub' },
  // Superscript: markdown-it-sup emits `sup_open` / `sup_close` for `^text^`.
  sup: { mark: 'sup' },
  // Footnote: markdown-it-footnote emits `footnote_ref` tokens; our
  // core rule (parser-footnote.ts) attaches `meta.body` so we can
  // store the definition's text alongside the label here.
  math_inline: {
    node: 'math_inline',
    noCloseToken: true,
    getAttrs: (tok: Token) => ({ tex: tok.content, display: false }),
  },
  // `$$…$$` inside a line of text.
  math_inline_block: {
    node: 'math_inline',
    noCloseToken: true,
    getAttrs: (tok: Token) => ({ tex: tok.content, display: true }),
  },
  math_block: {
    node: 'math_block',
    noCloseToken: true,
    getAttrs: (tok: Token) => {
      const oneLine = !!tok.map && tok.map[1] - tok.map[0] === 1;
      return { tex: tok.content.replace(/\n$/, ''), oneLine };
    },
  },
  front_matter: {
    node: 'front_matter',
    noCloseToken: true,
    getAttrs: (tok: Token) => ({ content: tok.content, close: tok.markup || '---' }),
  },
  footnote_ref: {
    node: 'footnote',
    getAttrs: (tok: Token) => ({
      label: String(tok.meta?.label ?? ''),
      body: String((tok.meta as { body?: string } | undefined)?.body ?? ''),
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
