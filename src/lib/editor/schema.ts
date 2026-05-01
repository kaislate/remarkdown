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

import { schema as baseSchema } from 'prosemirror-markdown';
import { Schema } from 'prosemirror-model';
import type { NodeSpec } from 'prosemirror-model';
import { calloutIcon } from './callout-icons';

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

const nodes = baseSchema.spec.nodes
  .update('code_block', codeBlockNode)
  .addBefore('blockquote', 'callout', calloutNode);

export const editorSchema = new Schema({
  nodes,
  marks: baseSchema.spec.marks,
});
