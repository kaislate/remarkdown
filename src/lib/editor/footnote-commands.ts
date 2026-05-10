import type { Command } from 'prosemirror-state';

// Inserts a footnote inline node at the current selection. Auto-numbers
// the label by counting existing numeric-labeled footnotes in the doc
// and choosing the next integer (1, 2, 3, ...). Skips any non-numeric
// labels — those are user-typed and stay verbatim.
export const insertFootnote: Command = (state, dispatch) => {
  const { schema, tr } = state;
  if (!schema.nodes.footnote) return false;

  let maxNumeric = 0;
  state.doc.descendants(node => {
    if (node.type.name !== 'footnote') return;
    const n = parseInt(String(node.attrs.label), 10);
    if (!isNaN(n) && n > maxNumeric) maxNumeric = n;
  });
  const label = String(maxNumeric + 1);

  const node = schema.nodes.footnote.create({ label, body: '' });
  if (dispatch) {
    dispatch(tr.replaceSelectionWith(node, false).scrollIntoView());
  }
  return true;
};
