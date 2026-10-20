// Custom ProseMirror schema for the editor. Extends prosemirror-markdown's
// default schema with a `callout` block node so we can render the same
// styled callout boxes the reader shows (via article.css rules on the
// .callout / .callout-{type} classes).
//
// The callout node's content is `block+` (one-or-more block children),
// matching how the markdown-it-callouts plugin maps `> [!type]\n> body`
// to a blockquote whose body re-parses as normal markdown.
//
// Foldability ('+', '-', or '') is stored as an attr so it survives
// round-trip; the actual hide/show interaction is handled by the
// existing delegated click handler in Viewer.svelte's reader path,
// and a dedicated edit-mode handler in Phase 2a-toolbar.
//
// This file ALSO overrides the default `code_block` node to add an
// explicit `language` attr (the prosemirror-markdown default stores
// the language under `params`, which doesn't round-trip cleanly with
// our toolbar/NodeView surface).

import { schema as baseSchema } from 'prosemirror-markdown';
import { Schema } from 'prosemirror-model';
import type { NodeSpec } from 'prosemirror-model';
import { calloutIcon } from './callout-icons';
import { tableNodes } from './table-nodes';

const calloutNode: NodeSpec = {
  attrs: {
    type: { default: 'note' },
    title: { default: '' },
    fold: { default: '' }, // '', '+' (open by default, foldable), '-' (closed by default)
  },
  content: 'block+',
  group: 'block',
  defining: true,
  parseDOM: [
    {
      tag: 'div.callout',
      getAttrs: (dom: HTMLElement) => ({
        type: dom.getAttribute('data-callout') || 'note',
        title: dom.querySelector('.callout-title')?.textContent || '',
        fold: dom.querySelector('.callout-body')?.hasAttribute('hidden') ? '-' : (dom.querySelector('.callout-fold') ? '+' : ''),
      }),
      contentElement: (dom: Node) => (dom as HTMLElement).querySelector('.callout-body') || dom as HTMLElement,
    },
  ],
  toDOM(node) {
    const type = String(node.attrs.type || 'note');
    const title = String(node.attrs.title || (type.charAt(0).toUpperCase() + type.slice(1)));
    const fold = String(node.attrs.fold || '');
    const icon = calloutIcon(type);
    const foldable = fold === '+' || fold === '-';
    const startsClosed = fold === '-';
    return [
      'div',
      { class: `callout callout-${type}`, 'data-callout': type },
      [
        'div',
        { class: 'callout-header', ...(foldable ? { 'data-foldable': '1' } : {}) },
        ['span', { class: 'callout-icon', 'aria-hidden': 'true' }, icon],
        ['span', { class: 'callout-title' }, title],
        ...(foldable
          ? [['button', { type: 'button', class: 'callout-fold', 'aria-label': startsClosed ? 'Expand' : 'Collapse' }, startsClosed ? '▸' : '▾']]
          : []),
      ],
      ['div', { class: 'callout-body', ...(startsClosed ? { hidden: '' } : {}) }, 0],
    ];
  },
};

// The language lives on `language` (the base schema's `params` doesn't
// round-trip cleanly); parser.ts and serializer.ts read and write it.
const codeBlockNode: NodeSpec = {
  attrs: { language: { default: '' } },
  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,
  parseDOM: [
    {
      tag: 'pre',
      preserveWhitespace: 'full',
      getAttrs: (dom: HTMLElement) => {
        // Pick the language from the inner <code class="language-foo">
        // when present (the read-mode Shiki path emits this), or from
        // a `data-language` attribute on the <pre> itself (the editor's
        // NodeView surface). Empty string when neither is set.
        const codeEl = dom.querySelector('code');
        const cls = codeEl?.className ?? '';
        const m = /(?:^|\s)language-([\w+#-]+)/.exec(cls);
        return { language: m ? m[1] : (dom.getAttribute('data-language') || '') };
      },
    },
  ],
  toDOM(node) {
    const lang = String(node.attrs.language || '');
    return [
      'pre',
      lang ? { 'data-language': lang } : {},
      ['code', lang ? { class: `language-${lang}` } : {}, 0],
    ];
  },
};

// `list_item` extended with an optional `checked` attr so GitHub-style
// task lists round-trip. null → plain list item; true / false → checked
// or unchecked task. The reader's markdown-it-task-lists plugin emits
// the same task-list-item / input shape, so this lights up article.css's
// existing styling automatically.
const listItemNode: NodeSpec = {
  attrs: { checked: { default: null } },
  content: 'paragraph block*',
  defining: true,
  parseDOM: [
    {
      tag: 'li',
      getAttrs: (dom: HTMLElement) => {
        if (!dom.classList.contains('task-list-item')) return { checked: null };
        const input = dom.querySelector<HTMLInputElement>(
          'input[type="checkbox"]',
        );
        return { checked: input?.checked === true };
      },
    },
  ],
  toDOM(node) {
    const checked = node.attrs.checked;
    if (checked === null) return ['li', 0];
    return [
      'li',
      { class: 'task-list-item' },
      [
        'input',
        {
          type: 'checkbox',
          contenteditable: 'false',
          ...(checked === true ? { checked: '' } : {}),
        },
      ],
      0,
    ];
  },
};

// Footnote inline reference. Stores the definition body as a plain-text
// `body` attr. We DO NOT model the body as PM content because editing
// rich inline marks inside a popover is finicky and the user's product
// framing ("markdown for people who don't know markdown") doesn't need
// it. The body string round-trips verbatim — markdown-it-footnote
// re-tokenizes it in read mode, so any inline markup the user types
// (like `**bold**`) renders correctly when read.
//
// `atom: true` makes PM treat the node as opaque: the cursor steps over
// it like a single character, no contentEditable propagation needed.
const footnoteNode: NodeSpec = {
  attrs: {
    label: { default: '' },
    body: { default: '' },
  },
  inline: true,
  group: 'inline',
  atom: true,
  draggable: false,
  parseDOM: [
    {
      tag: 'sup.footnote-ref',
      getAttrs: (dom: HTMLElement) => ({
        label: dom.getAttribute('data-label') || '',
        body: dom.getAttribute('data-body') || '',
      }),
    },
  ],
  toDOM(node) {
    const label = String(node.attrs.label);
    const body = String(node.attrs.body);
    return [
      'sup',
      { class: 'footnote-ref', 'data-label': label, 'data-body': body },
      ['a', { href: `#fn-${label}` }, `[${label}]`],
    ];
  },
};

// `bullet_list` remembering its marker (`-`, `*` or `+`), so saving
// doesn't rewrite every list in the file. New lists use `*`.
const bulletListNode: NodeSpec = {
  content: 'list_item+',
  group: 'block',
  attrs: { tight: { default: false }, bullet: { default: '*' } },
  parseDOM: [{ tag: 'ul', getAttrs: (dom: HTMLElement) => ({ tight: dom.hasAttribute('data-tight') }) }],
  toDOM(node) {
    return ['ul', { 'data-tight': node.attrs.tight ? 'true' : null }, 0];
  },
};

// Maths, kept exactly as written: `$…$` inline (or `$$…$$` within a
// line, `display`), and `$$` blocks. Atoms — the formula is edited in a
// popover (math-node-view.ts) and drawn with KaTeX; the TeX itself never
// passes through markdown escaping. A block remembers whether it was
// written on one line (`$$x$$`) or over several.
const mathInlineNode: NodeSpec = {
  attrs: { tex: { default: '' }, display: { default: false } },
  inline: true,
  group: 'inline',
  atom: true,
  parseDOM: [
    {
      tag: 'span.math-inline',
      getAttrs: (dom: HTMLElement) => ({
        tex: dom.getAttribute('data-tex') || '',
        display: dom.getAttribute('data-display') === 'true',
      }),
    },
  ],
  toDOM(node) {
    return ['span', { class: 'math-inline', 'data-tex': String(node.attrs.tex), 'data-display': String(node.attrs.display) }, String(node.attrs.tex)];
  },
};

const mathBlockNode: NodeSpec = {
  attrs: { tex: { default: '' }, oneLine: { default: false } },
  group: 'block',
  atom: true,
  parseDOM: [
    {
      tag: 'div.math-block',
      getAttrs: (dom: HTMLElement) => ({
        tex: dom.getAttribute('data-tex') || '',
        oneLine: dom.getAttribute('data-one-line') === 'true',
      }),
    },
  ],
  toDOM(node) {
    return ['div', { class: 'math-block', 'data-tex': String(node.attrs.tex), 'data-one-line': String(node.attrs.oneLine) }, String(node.attrs.tex)];
  },
};

// Front matter (lib/markdown-it-frontmatter.ts): the settings block at
// the top of a file, kept byte for byte. `content` is the text between
// the fences, final newline included; `close` is the closing fence
// (`---` or `...`).
const frontMatterNode: NodeSpec = {
  attrs: { content: { default: '' }, close: { default: '---' } },
  group: 'block',
  atom: true,
  parseDOM: [
    {
      tag: 'div.front-matter-block',
      getAttrs: (dom: HTMLElement) => ({
        content: dom.getAttribute('data-content') || '',
        close: dom.getAttribute('data-close') || '---',
      }),
    },
  ],
  toDOM(node) {
    return ['div', { class: 'front-matter-block', 'data-content': String(node.attrs.content), 'data-close': String(node.attrs.close) }];
  },
};

// OrderedMap.update() REPLACES the spec wholesale rather than merging,
// so `codeBlockNode` must be a complete NodeSpec — fields like
// `marks: ''`, `content: 'text*'`, `code: true`, etc. are restated on
// purpose because anything not restated here would be lost.
const nodes = baseSchema.spec.nodes
  .update('code_block', codeBlockNode)
  .update('list_item', listItemNode)
  .update('bullet_list', bulletListNode)
  .addBefore('blockquote', 'callout', calloutNode)
  .addToEnd('footnote', footnoteNode)
  .addToEnd('math_inline', mathInlineNode)
  .addToEnd('math_block', mathBlockNode)
  .addToStart('front_matter', frontMatterNode)
  .addToEnd('table', tableNodes.table)
  .addToEnd('table_row', tableNodes.table_row)
  .addToEnd('table_cell', tableNodes.table_cell)
  .addToEnd('table_header', tableNodes.table_header);

// Strikethrough mark — GFM emits `<s>...</s>` and accepts the older
// `<del>` / `<strike>` HTML aliases. Adding it to the schema lets the
// editor round-trip `~~text~~` (the parser maps the markdown-it `s`
// token to this mark; the serializer emits ~~ delimiters).
const marks = baseSchema.spec.marks
  .addToEnd('strike', {
    parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
    toDOM() {
      return ['s', 0];
    },
  })
  .addToEnd('sub', {
    parseDOM: [{ tag: 'sub' }],
    toDOM() {
      return ['sub', 0];
    },
  })
  .addToEnd('sup', {
    parseDOM: [{ tag: 'sup' }],
    toDOM() {
      return ['sup', 0];
    },
  });

export const editorSchema = new Schema({
  nodes,
  marks,
});
