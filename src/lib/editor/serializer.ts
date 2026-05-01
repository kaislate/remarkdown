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
  // attrs.title only contains the user-explicit title (the parser keeps
  // it empty when the user didn't write one). So we can safely emit
  // ANY non-empty title, including ones that happen to equal the
  // capitalized type — `> [!note] Note` round-trips intact.
  const titlePart = title ? ` ${title}` : '';
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

const code_block = (state: MarkdownSerializerState, node: Node) => {
  const lang = String(node.attrs.language || '');
  state.write('```' + lang + '\n');
  state.text(node.textContent, false); // false = don't escape markdown chars
  // Ensure the closing fence sits on its own line. wrapBlock-friendly.
  state.ensureNewLine();
  state.write('```');
  state.closeBlock(node);
};

const editorMarkdownSerializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, callout, code_block },
  defaultMarkdownSerializer.marks,
);

export function serializeDocToMarkdown(doc: Node): string {
  const out = editorMarkdownSerializer.serialize(doc);
  // POSIX trailing newline (same convention as Phase 1's serializer).
  return out.endsWith('\n') ? out : out + '\n';
}
