import { describe, it, expect } from 'vitest';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { serializeDocToMarkdown } from '../../../src/lib/editor/serializer';
import { EditorState, TextSelection } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import {
  tabInTable,
  insertTable,
  addRowAfterCmd,
  addColumnAfterCmd,
  deleteRowCmd,
  deleteColumnCmd,
} from '../../../src/lib/editor/table-commands';
import { createTableActionsPlugin, tableActionsKey } from '../../../src/lib/editor/table-actions-plugin';

describe('table parsing', () => {
  it('parses a simple 2x2 table into table > table_row > table_cell', () => {
    const md = '| A | B |\n| - | - |\n| 1 | 2 |\n';
    const doc = parseMarkdownToDoc(md);
    const table = doc.firstChild!;
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(2); // header row + body row
    const headerRow = table.firstChild!;
    expect(headerRow.type.name).toBe('table_row');
    expect(headerRow.firstChild!.type.name).toBe('table_header');
    expect(headerRow.firstChild!.textContent).toBe('A');
    const bodyRow = table.child(1);
    expect(bodyRow.firstChild!.type.name).toBe('table_cell');
    expect(bodyRow.firstChild!.textContent).toBe('1');
  });

  it('parses a 3-column table with proper cell counts per row', () => {
    const md = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n';
    const doc = parseMarkdownToDoc(md);
    const table = doc.firstChild!;
    expect(table.firstChild!.childCount).toBe(3);
    expect(table.child(1).childCount).toBe(3);
  });

  it('parses an empty cell without crashing', () => {
    const md = '| a | b |\n| - | - |\n|   | 2 |\n';
    const doc = parseMarkdownToDoc(md);
    const table = doc.firstChild!;
    const bodyRow = table.child(1);
    expect(bodyRow.firstChild!.textContent).toBe('');
    expect(bodyRow.child(1).textContent).toBe('2');
  });
});

describe('table round-trip', () => {
  function rt(md: string): string {
    return serializeDocToMarkdown(parseMarkdownToDoc(md));
  }

  it('round-trips a 2x2 table', () => {
    const src = '| A | B |\n| - | - |\n| 1 | 2 |\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips a 3x3 table', () => {
    const src = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips a table with empty cells', () => {
    const src = '| a | b |\n| - | - |\n|   | 2 |\n';
    expect(rt(src)).toBe(src);
  });

  it('round-trips a table with inline marks (bold, italic, code)', () => {
    const src = '| **a** | *b* |\n| - | - |\n| `c` | d |\n';
    expect(rt(src)).toBe(src);
  });
});

describe('table commands', () => {
  // Reference unused imports so they aren't tree-shaken by lint/TS;
  // these are re-exports for Task 7's menu and we just verify they
  // resolve to functions.
  it('re-exports prosemirror-tables row/column commands', () => {
    expect(typeof addRowAfterCmd).toBe('function');
    expect(typeof addColumnAfterCmd).toBe('function');
    expect(typeof deleteRowCmd).toBe('function');
    expect(typeof deleteColumnCmd).toBe('function');
  });

  it('insertTable produces an n×m table with a header row', () => {
    const doc = parseMarkdownToDoc('hello\n');
    let state = EditorState.create({ doc, schema: editorSchema });
    insertTable(3, 2)(state, (tr) => { state = state.apply(tr); });
    let table: { childCount: number; firstChild: { childCount: number; firstChild: { type: { name: string } } } } | null = null;
    state.doc.descendants((n) => {
      if (n.type.name === 'table' && !table) table = n as never;
    });
    expect(table).not.toBeNull();
    expect(table!.childCount).toBe(3); // 3 rows
    expect(table!.firstChild.childCount).toBe(2); // 2 cols
    expect(table!.firstChild.firstChild.type.name).toBe('table_header');
  });

  it('tabInTable adds a new row when at the last cell', () => {
    const doc = parseMarkdownToDoc('| a | b |\n| - | - |\n| 1 | 2 |\n');
    let state = EditorState.create({ doc, schema: editorSchema });
    // Place caret in the very last cell.
    let lastCellPos = -1;
    state.doc.descendants((n, p) => {
      if (n.type.name === 'table_cell') lastCellPos = p;
    });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, lastCellPos + 1)));
    let dispatched = false;
    tabInTable(state, (tr) => { state = state.apply(tr); dispatched = true; });
    expect(dispatched).toBe(true);
    // Now there should be 3 rows (header + original body + new body row).
    let rowCount = 0;
    state.doc.descendants((n) => {
      if (n.type.name === 'table_row') rowCount += 1;
    });
    expect(rowCount).toBe(3);
  });

  it('tabInTable returns false when not in a table', () => {
    const doc = parseMarkdownToDoc('hello\n');
    const state = EditorState.create({ doc, schema: editorSchema });
    const ok = tabInTable(state, () => {});
    expect(ok).toBe(false);
  });
});

describe('tableActionsPlugin', () => {
  it('sets active = null when selection is outside any table', () => {
    const plugin = createTableActionsPlugin();
    const doc = parseMarkdownToDoc('hello\n');
    const state = EditorState.create({
      doc,
      schema: editorSchema,
      plugins: [plugin],
    });
    const pluginState = tableActionsKey.getState(state);
    expect(pluginState).toBeDefined();
    expect(pluginState!.active).toBeNull();
  });

  it('sets active = { tablePos, ... } when selection is inside a table', () => {
    const plugin = createTableActionsPlugin();
    const doc = parseMarkdownToDoc('| a | b |\n| - | - |\n| 1 | 2 |\n');
    let state = EditorState.create({
      doc,
      schema: editorSchema,
      plugins: [plugin],
    });
    let firstCellPos = -1;
    state.doc.descendants((n, p) => {
      if (n.type.name === 'table_cell' && firstCellPos === -1) firstCellPos = p;
    });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, firstCellPos + 1)));
    const pluginState = tableActionsKey.getState(state);
    expect(pluginState!.active).not.toBeNull();
    expect(pluginState!.active!.tablePos).toBeGreaterThanOrEqual(0);
  });
});
