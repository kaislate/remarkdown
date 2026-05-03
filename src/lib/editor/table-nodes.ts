// Wrapper around prosemirror-tables' tableNodes() factory. Centralizes
// the schema config so the parser, serializer, and commands all see the
// same shape.
//
// `cellContent: 'inline*'` constrains every cell to inline-only — GFM
// tables don't support multi-paragraph cells anyway, and this lets the
// serializer flatten cell content directly to inline markdown without
// having to decide what to do with nested paragraphs / lists.
import { tableNodes as buildTableNodes } from 'prosemirror-tables';

export const tableNodes = buildTableNodes({
  tableGroup: 'block',
  cellContent: 'inline*',
  cellAttributes: {},
});
