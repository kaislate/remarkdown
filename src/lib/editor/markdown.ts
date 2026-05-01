// src/lib/editor/markdown.ts
// Round-trip helpers for the editor. Phase 1 used prosemirror-markdown's
// default schema + parser + serializer; Phase 2a swaps in our custom
// versions so callouts (and future rich blocks) survive the round-trip
// as their own PM node specs instead of degrading to plain blockquotes.

import { editorSchema } from './schema';
import { parseMarkdownToDoc } from './parser';
import { serializeDocToMarkdown } from './serializer';
import type { Node } from 'prosemirror-model';

export { editorSchema };

export function parseMarkdown(md: string): Node {
  return parseMarkdownToDoc(md);
}

export function serializeToMarkdown(doc: Node): string {
  return serializeDocToMarkdown(doc);
}
