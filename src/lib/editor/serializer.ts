// Custom MarkdownSerializer for the editor. Extends prosemirror-markdown's
// default node serializers with `callout`, emitting:
//
//   > [!type][fold] [optional title]
//   > body line 1
//   > body line 2
//
// Marks all default to prosemirror-markdown's behaviour. Future sub-
// phases (code blocks, tables, etc.) extend the nodes record here.
//
// Note: indented code blocks (4-space-leading-indent) are intentionally
// upgraded to fenced code blocks on round-trip. This is by design per
// the product framing ("a markdown editor for people who don't know
// markdown") — fenced fences are visually clearer and unambiguous about
// language. Future contributors: this is NOT a bug to "fix".

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
  // Pick a fence length one longer than the longest run of backticks in
  // the body, with a 3-tick floor (CommonMark minimum). Without this a
  // user who writes markdown-about-markdown would see their fence "swallow"
  // the inner content's literal triple-backticks on round-trip.
  const text = node.textContent;
  const longestRun = (text.match(/`+/g) ?? []).reduce(
    (m, run) => Math.max(m, run.length),
    0,
  );
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  state.write(fence + lang + '\n');
  state.text(text, false); // false = don't escape markdown chars
  // Ensure the closing fence sits on its own line. wrapBlock-friendly.
  state.ensureNewLine();
  state.write(fence);
  state.closeBlock(node);
};

const list_item = (state: MarkdownSerializerState, node: Node) => {
  const checked = node.attrs.checked;
  if (checked === true) {
    state.write('[x] ');
  } else if (checked === false) {
    state.write('[ ] ');
  }
  // Default behavior: just render the children. The bullet (`*`) is
  // emitted by the parent bullet_list's renderList; our optional
  // `[ ] ` / `[x] ` lands AFTER that bullet on the same line because
  // state.write doesn't insert a newline.
  state.renderContent(node);
};

const editorMarkdownSerializer = new MarkdownSerializer(
  { ...defaultMarkdownSerializer.nodes, callout, code_block, list_item },
  defaultMarkdownSerializer.marks,
);

export function serializeDocToMarkdown(doc: Node): string {
  const out = editorMarkdownSerializer.serialize(doc);
  // POSIX trailing newline (same convention as Phase 1's serializer).
  return out.endsWith('\n') ? out : out + '\n';
}
