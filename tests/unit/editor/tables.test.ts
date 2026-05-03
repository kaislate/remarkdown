import { describe, it, expect } from 'vitest';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';

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
