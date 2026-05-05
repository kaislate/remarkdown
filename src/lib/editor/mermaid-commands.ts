// Toolbar entry point for inserting a fresh, empty mermaid flowchart.
// The MermaidNodeView's empty-state placeholder takes over once the
// block is on the page — this command is just responsible for putting
// the block there.
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { editorSchema } from './schema';

const SEED_SOURCE = 'flowchart TD\n';

export function insertMermaid(): Command {
  return (
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
  ): boolean => {
    const codeBlockType = editorSchema.nodes.code_block;
    if (!codeBlockType) return false;

    const { $from } = state.selection;
    if ($from.parent.type.name === 'code_block') return false;
    const range = $from.blockRange();
    if (!range) return false;

    if (dispatch) {
      const block = codeBlockType.create(
        { language: 'mermaid' },
        state.schema.text(SEED_SOURCE),
      );
      const tr = state.tr.replaceRangeWith(range.start, range.end, block);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
