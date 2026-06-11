// Edge click-routing tests with REAL mermaid renders. jsdom has no SVG
// layout engine, so we stub the two geometry APIs mermaid needs — the
// produced SVG then carries mermaid's actual element structure and
// data-ids, which is exactly what these tests are about: resolving a
// clicked edge back to the right index in graph.edges.
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

describe('MermaidNodeView edge identity', () => {
  it('clicking the second of two parallel edges edits the second edge', async () => {
    const { view, parent } = makeView(
      '```mermaid\nflowchart TD\nA[a]\nB[b]\nA -->|first| B\nA -->|second| B\n```\n',
    );
    await flush();
    // Mermaid assigns L_A_B_0 to the first occurrence and L_A_B_2 to
    // the second (flowDb skips counter 1).
    const second = parent.querySelector('path.flowchart-link[data-id="L_A_B_2"]');
    expect(second).not.toBeNull();
    second!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush(1);
    const popover = parent.querySelector('.mermaid-edge-popover');
    expect(popover).not.toBeNull();
    expect(popover!.hasAttribute('hidden')).toBe(false);
    const input = popover!.querySelector<HTMLInputElement>(
      '.mermaid-edge-popover-label',
    );
    expect(input?.value).toBe('second');
    // The highlight lands on the clicked path, not its sibling.
    expect(
      parent.querySelector('path.flowchart-link.mermaid-selected')?.getAttribute('data-id'),
    ).toBe('L_A_B_2');
    view.destroy();
    parent.remove();
  });

  it('resolves edges whose node ids contain underscores', async () => {
    // `L_A_B_C_0` is ambiguous as a string (A→B_C or A_B→C) — the
    // NodeView must resolve it against the graph, not parse it.
    const { view, parent } = makeView(
      '```mermaid\nflowchart TD\nA[a]\nB_C[bc]\nA -->|link| B_C\n```\n',
    );
    await flush();
    const edge = parent.querySelector('path.flowchart-link[data-id="L_A_B_C_0"]');
    expect(edge).not.toBeNull();
    edge!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush(1);
    const popover = parent.querySelector('.mermaid-edge-popover');
    expect(popover).not.toBeNull();
    expect(popover!.hasAttribute('hidden')).toBe(false);
    expect(
      popover!.querySelector<HTMLInputElement>('.mermaid-edge-popover-label')
        ?.value,
    ).toBe('link');
    view.destroy();
    parent.remove();
  });

  it('deleting via the popover on a parallel edge removes that edge, not the first', async () => {
    const { view, parent } = makeView(
      '```mermaid\nflowchart TD\nA[a]\nB[b]\nA -->|first| B\nA -->|second| B\n```\n',
    );
    await flush();
    const second = parent.querySelector('path.flowchart-link[data-id="L_A_B_2"]');
    expect(second).not.toBeNull();
    second!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush(1);
    const deleteBtn = parent.querySelector<HTMLButtonElement>(
      '.mermaid-edge-popover .mermaid-edge-popover-delete',
    );
    expect(deleteBtn).not.toBeNull();
    deleteBtn!.click();
    await flush(1);
    // The doc keeps the FIRST edge.
    const text = view.state.doc.textContent;
    expect(text).toContain('first');
    expect(text).not.toContain('second');
    view.destroy();
    parent.remove();
  });
});
