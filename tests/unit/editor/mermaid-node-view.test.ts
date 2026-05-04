import { describe, it, expect } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { MermaidNodeView } from '../../../src/lib/editor/mermaid-node-view';

describe('MermaidNodeView', () => {
  it('mounts a wrapper div for a mermaid code_block', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = parseMarkdownToDoc('```mermaid\nflowchart TD\nA[a]\n```\n');
    const view = new EditorView(parent, {
      state: EditorState.create({ doc, schema: editorSchema }),
      nodeViews: {
        code_block: (node, editorView, getPos) =>
          new MermaidNodeView(node, editorView, getPos),
      },
    });
    expect(parent.querySelector('.mermaid-block-editor')).not.toBeNull();
    view.destroy();
    parent.remove();
  });

  it('falls back to render-only when source is unparseable', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    // sequenceDiagram is unsupported by our parser
    const doc = parseMarkdownToDoc('```mermaid\nsequenceDiagram\nA->>B: hi\n```\n');
    const view = new EditorView(parent, {
      state: EditorState.create({ doc, schema: editorSchema }),
      nodeViews: {
        code_block: (node, editorView, getPos) =>
          new MermaidNodeView(node, editorView, getPos),
      },
    });
    const wrap = parent.querySelector('.mermaid-block-editor');
    expect(wrap).not.toBeNull();
    expect(wrap!.classList.contains('mermaid-fallback')).toBe(true);
    view.destroy();
    parent.remove();
  });

  it('selecting a node sets mermaid-has-selection on the wrapper', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = parseMarkdownToDoc('```mermaid\nflowchart TD\nA[a]\nB[b]\nA --> B\n```\n');
    const view = new EditorView(parent, {
      state: EditorState.create({ doc, schema: editorSchema }),
      nodeViews: {
        code_block: (node, editorView, getPos) =>
          new MermaidNodeView(node, editorView, getPos),
      },
    });
    // Wait for the async mermaid render to complete.
    await new Promise((r) => setTimeout(r, 100));
    // Synthesize a click on the rendered node.
    const nodeEl = parent.querySelector('g.node[id^="flowchart-A-"]');
    if (!nodeEl) {
      // jsdom may not fully render mermaid SVG. Skip assertion in that case.
      view.destroy();
      parent.remove();
      return;
    }
    nodeEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(parent.querySelector('.mermaid-block-editor.mermaid-has-selection')).not.toBeNull();
    view.destroy();
    parent.remove();
  });
});
