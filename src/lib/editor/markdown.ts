// src/lib/editor/markdown.ts
// Round-trip helpers for the editor. Phase 1 used prosemirror-markdown's
// default schema + parser + serializer; Phase 2a swaps in our custom
// versions so callouts (and future rich blocks) survive the round-trip
// as their own PM node specs instead of degrading to plain blockquotes.
//
// CONVENTION: this module is the canonical import for round-trip
// helpers ONLY. The schema lives in `./schema` and is imported from
// there directly — both internal callers (view.ts, parser.ts) and
// external consumers (Editor.svelte, tests). Keeping the schema export
// out of here means there's exactly one valid import path per symbol.
import { parseMarkdownToDoc } from './parser';
import { serializeDocToMarkdown } from './serializer';
import type { Node } from 'prosemirror-model';

export function parseMarkdown(md: string): Node {
  return parseMarkdownToDoc(md);
}

export function serializeToMarkdown(doc: Node): string {
  return serializeDocToMarkdown(doc);
}
