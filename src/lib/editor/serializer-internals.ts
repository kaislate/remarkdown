// Typed shim re-exposing prosemirror-markdown's MarkdownSerializerState
// internals. The dist .d.ts marks the constructor, `nodes`, `marks`,
// and `out` as @internal (stripped during the d.ts build), even though
// they exist at runtime and are required for spawning a sub-state to
// render a single node to a string buffer.
//
// The table serializer in serializer.ts uses MarkdownSerializerStateImpl
// to render each cell to its own buffer (so it can build a string
// matrix and column-align the output) without triggering svelte-check
// / tsc errors against the public type surface.

import { MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node } from 'prosemirror-model';

export type MarkdownSerializerStateInternals = MarkdownSerializerState & {
  out: string;
  // The shapes here mirror the runtime types declared in
  // node_modules/prosemirror-markdown/src/to_markdown.ts (lines 187-193).
  nodes: { [name: string]: (state: MarkdownSerializerState, node: Node, parent: Node, index: number) => void };
  marks: Record<string, unknown>;
};

export type MarkdownSerializerStateCtor = new (
  nodes: MarkdownSerializerStateInternals['nodes'],
  marks: MarkdownSerializerStateInternals['marks'],
  options: MarkdownSerializerState['options'],
) => MarkdownSerializerStateInternals;

export const MarkdownSerializerStateImpl =
  MarkdownSerializerState as unknown as MarkdownSerializerStateCtor;
