import { describe, it, expect } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { insertMermaid, insertSequenceDiagram, insertDiagram, DIAGRAM_STARTERS } from '../../../src/lib/editor/mermaid-commands';
import { detectDiagramType } from '../../../src/lib/editor/mermaid-detect';
import { canEditDiagram } from '../../../src/lib/editor/mermaid/controller';
import '../../../src/lib/editor/mermaid/registry';
import { mermaidAccepts } from './mermaid-test-utils';

describe('insertDiagram: a starter for every editable diagram kind', () => {
  for (const [kind, starter] of Object.entries(DIAGRAM_STARTERS)) {
    it(`${kind}: inserts a diagram mermaid accepts and the editor can edit`, async () => {
      let state = EditorState.create({ doc: parseMarkdownToDoc('hello\n'), schema: editorSchema });
      expect(insertDiagram(kind as keyof typeof DIAGRAM_STARTERS)(state, (tr) => { state = state.apply(tr); })).toBe(true);
      let text = '';
      state.doc.descendants((n) => {
        if (n.type.name === 'code_block' && n.attrs.language === 'mermaid') text = n.textContent;
      });
      expect(text).toBe(starter);
      const type = detectDiagramType(text);
      expect(canEditDiagram(type, text), `${kind} editable`).toBe(true);
      // Flowchart and sequence start empty (their placeholder button
      // adds the first item); the others start with a small example.
      if (kind !== 'flowchart' && kind !== 'sequence') expect(await mermaidAccepts(text)).toBe(true);
    });
  }
});

describe('insertMermaid command', () => {
  it('inserts an empty mermaid code_block at the current paragraph', () => {
    const doc = parseMarkdownToDoc('hello\n');
    let state = EditorState.create({ doc, schema: editorSchema });
    let dispatched = false;
    insertMermaid()(state, (tr) => {
      state = state.apply(tr);
      dispatched = true;
    });
    expect(dispatched).toBe(true);
    let firstBlock: { type: { name: string }; attrs: { language: unknown }; textContent: string } | null = null;
    state.doc.descendants((n) => {
      if (n.type.name === 'code_block' && firstBlock === null) {
        firstBlock = n as never;
      }
    });
    expect(firstBlock).not.toBeNull();
    expect(firstBlock!.attrs.language).toBe('mermaid');
    expect(firstBlock!.textContent).toBe('flowchart TD\n');
  });

  it('returns false when called inside an existing code_block', () => {
    const doc = parseMarkdownToDoc('```mermaid\nflowchart TD\n```\n');
    const state = EditorState.create({ doc, schema: editorSchema });
    const ok = insertMermaid()(state, () => {});
    expect(ok).toBe(false);
  });
});

describe('insertSequenceDiagram command', () => {
  it('inserts an empty sequenceDiagram code_block at the current paragraph', () => {
    const doc = parseMarkdownToDoc('hello\n');
    let state = EditorState.create({ doc, schema: editorSchema });
    let dispatched = false;
    insertSequenceDiagram()(state, (tr) => {
      state = state.apply(tr);
      dispatched = true;
    });
    expect(dispatched).toBe(true);
    let firstBlock: { type: { name: string }; attrs: { language: unknown }; textContent: string } | null = null;
    state.doc.descendants((n) => {
      if (n.type.name === 'code_block' && firstBlock === null) {
        firstBlock = n as never;
      }
    });
    expect(firstBlock).not.toBeNull();
    expect(firstBlock!.attrs.language).toBe('mermaid');
    expect(firstBlock!.textContent).toBe('sequenceDiagram\n');
  });

  it('returns false when called inside an existing code_block', () => {
    const doc = parseMarkdownToDoc('```mermaid\nsequenceDiagram\n```\n');
    const state = EditorState.create({ doc, schema: editorSchema });
    const ok = insertSequenceDiagram()(state, () => {});
    expect(ok).toBe(false);
  });
});
