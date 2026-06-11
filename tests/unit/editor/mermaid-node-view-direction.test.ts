// Direction-picker tests with REAL mermaid renders (same jsdom geometry
// stubs as the edge tests). The picker is a floating control over the
// rendered flowchart exposing mermaid's four layout directions.
import { describe, it, expect } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { MermaidNodeView } from '../../../src/lib/editor/mermaid-node-view';

(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({
  x: 0,
  y: 0,
  width: 10,
  height: 10,
});
(
  SVGElement.prototype as unknown as Record<string, unknown>
).getComputedTextLength = () => 10;

async function flush(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

function makeView(markdown: string): { view: EditorView; parent: HTMLElement } {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const shell = document.createElement('div');
  shell.className = 'editor-shell';
  parent.appendChild(shell);
  const view = new EditorView(shell, {
    state: EditorState.create({
      doc: parseMarkdownToDoc(markdown),
      schema: editorSchema,
    }),
    nodeViews: {
      code_block: (node, editorView, getPos) =>
        new MermaidNodeView(node, editorView, getPos),
    },
  });
  return { view, parent };
}

describe('MermaidNodeView direction picker', () => {
  it('shows the picker on a parsed flowchart with the current direction active', async () => {
    const { view, parent } = makeView(
      '```mermaid\nflowchart TD\nA[a]\nB[b]\nA --> B\n```\n',
    );
    await flush();
    const picker = parent.querySelector('.mermaid-direction-picker');
    expect(picker).not.toBeNull();
    expect(picker!.hasAttribute('hidden')).toBe(false);
    const tdBtn = picker!.querySelector('button[aria-label="Top to bottom"]');
    expect(tdBtn?.classList.contains('active')).toBe(true);
    view.destroy();
    parent.remove();
  });

  it('clicking a direction commits the new directive to the document', async () => {
    const { view, parent } = makeView(
      '```mermaid\nflowchart TD\nA[a]\nB[b]\nA --> B\n```\n',
    );
    await flush();
    const lrBtn = parent.querySelector<HTMLButtonElement>(
      '.mermaid-direction-picker button[aria-label="Left to right"]',
    );
    expect(lrBtn).not.toBeNull();
    lrBtn!.click();
    await flush();
    expect(view.state.doc.textContent).toContain('flowchart LR');
    // The picker reflects the new direction after the re-render.
    const lrAfter = parent.querySelector(
      '.mermaid-direction-picker button[aria-label="Left to right"]',
    );
    expect(lrAfter?.classList.contains('active')).toBe(true);
    view.destroy();
    parent.remove();
  });

  it('stays hidden for sequence diagrams', async () => {
    const { view, parent } = makeView(
      '```mermaid\nsequenceDiagram\nparticipant A\nparticipant B\nA->>B: hi\n```\n',
    );
    await flush();
    const picker = parent.querySelector('.mermaid-direction-picker');
    expect(picker === null || picker.hasAttribute('hidden')).toBe(true);
    view.destroy();
    parent.remove();
  });

  it('stays hidden for unparseable flowcharts (render-only fallback)', async () => {
    const { view, parent } = makeView(
      '```mermaid\nflowchart TD\nsubgraph S\nA[a]\nend\n```\n',
    );
    await flush();
    const picker = parent.querySelector('.mermaid-direction-picker');
    expect(picker === null || picker.hasAttribute('hidden')).toBe(true);
    view.destroy();
    parent.remove();
  });
});
