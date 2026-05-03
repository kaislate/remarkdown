// Editor-side wrappers around prosemirror-tables' built-in commands,
// plus a couple of custom ones (Tab-at-last-cell creates a new row;
// insertTable factory creates an empty n×m table).
import {
  addRowAfter,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  goToNextCell,
  isInTable,
} from 'prosemirror-tables';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { editorSchema } from './schema';

export const addRowAfterCmd: Command = addRowAfter;
export const addColumnAfterCmd: Command = addColumnAfter;
export const deleteRowCmd: Command = deleteRow;
export const deleteColumnCmd: Command = deleteColumn;

// Tab inside a table: try to advance to the next cell (built-in
// goToNextCell). If we're at the LAST cell of the LAST row, that
// command returns false — we then add a new row and place the caret
// in its first cell. Outside a table, returns false so the caller's
// chain falls through to indentCodeBlock / sinkListItem.
export const tabInTable: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  // Try the built-in forward navigation first.
  if (goToNextCell(1)(state, dispatch)) return true;
  // We're at the last cell — add a new row. We must dispatch a single
  // coherent transaction to the caller; goToNextCell would produce one
  // off the post-row-add state and applying it to the original state
  // would be a mismatch. So we capture the row-add transaction and
  // adjust its selection to the new row's first cell ourselves.
  if (!dispatch) return true;
  let captured: Transaction | null = null;
  const ok = addRowAfter(state, (tr) => { captured = tr; });
  if (!ok || !captured) return false;
  const tr = captured as Transaction;
  // Walk the new doc to find the appended row's first text-leaf
  // position so the caret lands inside the first cell.
  const newDoc = tr.doc;
  let firstCellInLastRowPos: number | null = null;
  let lastRowStart = -1;
  newDoc.descendants((n, p) => {
    if (n.type.name === 'table_row') lastRowStart = p;
  });
  if (lastRowStart >= 0) {
    const rowNode = newDoc.nodeAt(lastRowStart);
    if (rowNode && rowNode.firstChild) {
      // First cell starts at lastRowStart + 1; caret inside its first
      // (paragraph) child is at lastRowStart + 2.
      firstCellInLastRowPos = lastRowStart + 2;
    }
  }
  if (firstCellInLastRowPos != null) {
    try {
      const $pos = newDoc.resolve(firstCellInLastRowPos);
      tr.setSelection(new TextSelection($pos, $pos));
    } catch {
      // If the resolve fails for any reason, leave the selection as-is —
      // the row was still added so the user can Tab again.
    }
  }
  dispatch(tr.scrollIntoView());
  return true;
};

// Build an empty n×m table with the first row as headers. Returns a
// Command directly — same shape as insertCallout / insertCodeBlock /
// insertTaskList, so callers invoke it as `insertTable(3, 2)(state, dispatch)`.
export function insertTable(rows: number, cols: number) {
  return (
    state: EditorState,
    dispatch?: (tr: Transaction) => void,
  ): boolean => {
    const tableType = editorSchema.nodes.table;
    const rowType = editorSchema.nodes.table_row;
    const cellType = editorSchema.nodes.table_cell;
    const headerType = editorSchema.nodes.table_header;
    if (!tableType || !rowType || !cellType || !headerType) return false;

    const rowsArr = [];
    for (let r = 0; r < rows; r++) {
      const cells = [];
      for (let c = 0; c < cols; c++) {
        const ctype = r === 0 ? headerType : cellType;
        cells.push(ctype.create(null));
      }
      rowsArr.push(rowType.create(null, cells));
    }
    const table = tableType.create(null, rowsArr);

    const { $from } = state.selection;
    const range = $from.blockRange();
    if (!range) return false;
    if (dispatch) {
      const tr = state.tr.replaceRangeWith(range.start, range.end, table);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}
