// Custom MarkdownSerializer for the editor. Extends prosemirror-markdown's
// default node serializers with `callout`, emitting:
//
//   > [!type][fold] [optional title]
//   > body line 1
//   > body line 2
//
// Marks all default to prosemirror-markdown's behaviour. Future sub-
// phases (code blocks, tables, etc.) extend the nodes record here.

import { defaultMarkdownSerializer, MarkdownSerializer, MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node } from 'prosemirror-model';

// Composes the [!type][fold] title line that opens a callout block.
function calloutHeader(node: Node): string {
  const type = String(node.attrs.type || 'note');
  const fold = String(node.attrs.fold || '');
  const title = String(node.attrs.title || '');
  // Default title (auto-derived from type) shouldn't be re-emitted —
  // we only emit the explicit title if it's distinct from the default.
  const defaultTitle = type.charAt(0).toUpperCase() + type.slice(1);
  const titlePart = title && title !== defaultTitle ? ` ${title}` : '';
  return `[!${type}]${fold}${titlePart}`;
}

const callout = (state: MarkdownSerializerState, node: Node) => {
  // Use wrapBlock so every rendered line automatically gets the `> ` prefix
  // (via state.delim). The `firstDelim` is the full `> [!type][fold][title]`
  // opening line; wrapBlock passes it to `write()` which handles flushClose
  // and delimiter flushing correctly before we enter the content render.
  state.wrapBlock('> ', `> ${calloutHeader(node)}\n`, node, () =>
    state.renderContent(node),
  );
};

const editorMarkdownSerializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, callout },
  defaultMarkdownSerializer.marks,
);

export function serializeDocToMarkdown(doc: Node): string {
  const out = editorMarkdownSerializer.serialize(doc);
  // POSIX trailing newline (same convention as Phase 1's serializer).
  return out.endsWith('\n') ? out : out + '\n';
}
