// Sequence-diagram popover edits through the real NodeView + real
// mermaid renders (jsdom geometry stubbed, as in the edges test).
import { describe, it, expect, beforeAll } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { MermaidNodeView } from '../../../src/lib/editor/mermaid-node-view';
import { warmMermaidRuntime } from '../../../src/lib/mermaid-runtime';

(SVGElement.prototype as unknown as Record<string, unknown>).getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 });
(SVGElement.prototype as unknown as Record<string, unknown>).getComputedTextLength = () => 10;

beforeAll(async () => {
  await warmMermaidRuntime();
}, 60_000);

async function flush(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 10));
}

function makeView(markdown: string): { view: EditorView; parent: HTMLElement } {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView(parent, {
    state: EditorState.create({ doc: parseMarkdownToDoc(markdown), schema: editorSchema }),
    nodeViews: {
      code_block: (node, editorView, getPos) => new MermaidNodeView(node, editorView, getPos),
    },
  });
  return { view, parent };
}

function clickMessage(parent: HTMLElement, index: number): void {
  const el = parent.querySelector(`[data-et="message"][data-id="i${index}"]`);
  expect(el, `message i${index} rendered`).not.toBeNull();
  el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('MermaidNodeView sequence editing', () => {
  it('editing one message keeps the other lines exactly, and reads typed text back', async () => {
    const source = [
      'sequenceDiagram',
      '    %% comment inside an editable sequence',
      '    participant A as Alice',
      '    participant B as Bob',
      '    A->>B: Map x->y and back',
      '    B-->>A: Done',
    ].join('\n');
    const { view, parent } = makeView('```mermaid\n' + source + '\n```\n');
    await flush();
    const loaded = view.state.doc.textContent;

    clickMessage(parent, 1);
    await flush(1);
    const input = parent.querySelector<HTMLInputElement>('.mermaid-message-popover-text')!;
    input.value = 'Done; really # done';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    expect(view.state.doc.textContent).toBe(
      loaded.replace('B-->>A: Done', 'B-->>A: Done#59; really #35; done'),
    );
    // The diagram still renders, and shows what was typed.
    expect(parent.querySelector('.mermaid-error')).toBeNull();
    expect(parent.querySelector('.mermaid-rendered svg')?.textContent).toContain('Done; really # done');
    // Re-opening the popover shows the decoded text, not entity codes.
    clickMessage(parent, 1);
    await flush(1);
    expect(parent.querySelector<HTMLInputElement>('.mermaid-message-popover-text')!.value).toBe(
      'Done; really # done',
    );
    view.destroy();
    parent.remove();
  }, 30_000);

  it('"+ after" adds a message mermaid can draw', async () => {
    const { view, parent } = makeView('```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n');
    await flush();
    clickMessage(parent, 0);
    await flush(1);
    const after = parent.querySelector<HTMLButtonElement>('.mermaid-message-popover [aria-label*="after" i], .mermaid-message-popover button[title*="after" i]');
    expect(after, 'the "+ after" button').not.toBeNull();
    after!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(view.state.doc.textContent).toBe('sequenceDiagram\n  A->>B: hi\n  A->>B:');
    expect(parent.querySelector('.mermaid-error')).toBeNull();
    expect(parent.querySelectorAll('[data-et="message"]').length).toBeGreaterThanOrEqual(2);
    view.destroy();
    parent.remove();
  }, 30_000);
});
