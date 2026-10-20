// What the editor says about diagrams it can't edit visually or can't
// draw, and the text panel it offers for both. Product rule: never tell
// the user to edit markdown / source.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { MermaidNodeView } from '../../../src/lib/editor/mermaid-node-view';
import { resetMermaidRuntimeForTests } from '../../../src/lib/mermaid-runtime';

vi.mock('mermaid', () => ({
  default: {
    initialize: () => {},
    render: async (id: string, source: string) => {
      if (source.includes('BROKEN')) throw new Error('Parse error on line 2: Expecting SQE');
      return { svg: `<svg id="${id}"><g class="node" id="flowchart-A-0"><rect></rect></g></svg>` };
    },
  },
}));

async function flush(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
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

function setBlockText(view: EditorView, newText: string): void {
  let pos: number | null = null;
  view.state.doc.descendants((node, p) => {
    if (pos === null && node.type.name === 'code_block') pos = p;
    return pos === null;
  });
  const node = view.state.doc.nodeAt(pos!)!;
  view.dispatch(view.state.tr.replaceWith(pos! + 1, pos! + 1 + node.content.size, view.state.schema.text(newText)));
}

const note = (parent: HTMLElement) => parent.querySelector<HTMLElement>('.mermaid-fallback-note');
const GIT = '```mermaid\ngitGraph\n  commit\n```\n';

beforeEach(() => {
  resetMermaidRuntimeForTests();
  document.body.innerHTML = '';
});

describe("MermaidNodeView: diagrams that can't be edited visually", () => {
  it('offers to change the diagram through its text — never "markdown" or "source"', async () => {
    const { view, parent } = makeView(GIT);
    await flush();
    const el = note(parent);
    expect(el).not.toBeNull();
    expect(el!.hidden).toBe(false);
    expect(el!.querySelector('.mermaid-fallback-text')?.textContent).toBe('This diagram is changed through its text.');
    expect(el!.querySelector('button')?.textContent).toBe('Edit diagram text');
    expect(parent.textContent).not.toMatch(/markdown|source|syntax|coming soon/i);
    view.destroy();
  });

  it('the text panel: the text, a live drawing of it, and Save puts it in the document', async () => {
    const { view, parent } = makeView(GIT);
    await flush();
    note(parent)!.querySelector('button')!.click();
    const panel = parent.querySelector<HTMLElement>('.mermaid-text-panel')!;
    expect(panel).not.toBeNull();
    expect(parent.querySelector('.mermaid-block-editor')!.classList.contains('mermaid-text-open')).toBe(true);
    const box = panel.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(box.value).toBe('gitGraph\n  commit');
    await flush();
    expect(panel.querySelector('.mermaid-text-preview svg')).not.toBeNull();
    // A mistake: the drawing stays (faded) and says what's wrong.
    box.value = 'gitGraph\n  BROKEN\n';
    box.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 300));
    await flush();
    expect(panel.querySelector('.mermaid-text-preview')!.classList.contains('stale')).toBe(true);
    expect(panel.querySelector('.mermaid-text-problem')!.textContent).toMatch(/^Can't draw this yet: Parse error on line 2/);
    box.value = 'gitGraph\n  commit\n  commit\n';
    panel.querySelector<HTMLButtonElement>('.mermaid-text-save')!.click();
    expect(parent.querySelector('.mermaid-text-panel')).toBeNull();
    expect(view.state.doc.firstChild!.textContent).toBe('gitGraph\n  commit\n  commit');
    view.destroy();
  });

  it('Esc closes the panel without changing anything', async () => {
    const { view, parent } = makeView(GIT);
    await flush();
    note(parent)!.querySelector('button')!.click();
    const box = parent.querySelector<HTMLTextAreaElement>('.mermaid-text-panel textarea')!;
    box.value = 'changed';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(parent.querySelector('.mermaid-text-panel')).toBeNull();
    expect(view.state.doc.firstChild!.textContent).toBe('gitGraph\n  commit');
    view.destroy();
  });

  it('shows no such note for editable diagrams', async () => {
    const { view, parent } = makeView('```mermaid\nflowchart TD\nA[a]\n```\n');
    await flush();
    expect(note(parent)?.hidden ?? true).toBe(true);
    view.destroy();
  });
});

describe('MermaidNodeView: diagrams that fail to draw', () => {
  it('a diagram that was already broken in the file: friendly error, no undo hint, a way to fix it', async () => {
    const { view, parent } = makeView('```mermaid\nflowchart TD\nA[BROKEN\n```\n');
    await flush();
    const err = parent.querySelector('.mermaid-error');
    expect(err?.querySelector('.mermaid-error-title')?.textContent).toBe("This diagram couldn't be displayed.");
    expect(err?.querySelector('.mermaid-error-hint')).toBeNull();
    // Broken, not unsupported: the way to fix it, through its text.
    expect(note(parent)?.hidden).toBe(false);
    expect(note(parent)!.querySelector('button')?.textContent).toBe('Fix the diagram text');
    view.destroy();
  });

  it('a diagram broken by an edit in this session: also says how to undo', async () => {
    const { view, parent } = makeView('```mermaid\nflowchart TD\nA[ok]\n```\n');
    await flush();
    expect(parent.querySelector('.mermaid-error')).toBeNull();
    setBlockText(view, 'flowchart TD\nA[BROKEN\n');
    await flush();
    expect(parent.querySelector('.mermaid-error-hint')?.textContent).toMatch(
      /^Press (Ctrl|⌘)\+Z to undo the last change\.$/,
    );
    expect(parent.textContent).not.toMatch(/markdown|source|syntax/i);
    view.destroy();
  });
});
