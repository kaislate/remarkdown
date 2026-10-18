// Async-ordering tests for MermaidNodeView's render loop. The real
// mermaid renders too unpredictably (and too opaquely) to test races,
// so this file mocks the mermaid module with deferred render() calls
// the test resolves in a chosen order. We're testing OUR orchestration
// (stale-render guarding, popover anchoring after commit), not mermaid.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { MermaidNodeView } from '../../../src/lib/editor/mermaid-node-view';
import { resetMermaidRuntimeForTests } from '../../../src/lib/mermaid-runtime';
import { settings } from '../../../src/stores/settings';
import { DEFAULT_SETTINGS } from '../../../src/lib/settings-schema';

const mocked = vi.hoisted(() => {
  const renders: Array<{
    source: string;
    resolve: (svg: string) => void;
    reject: (err: unknown) => void;
  }> = [];
  const initializeCalls: Array<Record<string, unknown>> = [];
  return { renders, initializeCalls };
});

vi.mock('mermaid', () => ({
  default: {
    initialize: (config: Record<string, unknown>) => {
      mocked.initializeCalls.push(config);
    },
    render: (_id: string, source: string) =>
      new Promise<{ svg: string }>((res, rej) => {
        mocked.renders.push({
          source,
          resolve: (svg: string) => res({ svg }),
          reject: rej,
        });
      }),
  },
}));

// Let queued microtasks + macrotasks drain (renderFromNode hops the
// event loop a few times: dynamic import, mermaid.render, DOM writes).
async function flush(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

function setBlockText(view: EditorView, newText: string): void {
  let pos: number | null = null;
  view.state.doc.descendants((node, p) => {
    if (pos === null && node.type.name === 'code_block') pos = p;
    return pos === null;
  });
  if (pos === null) throw new Error('no code_block in doc');
  const node = view.state.doc.nodeAt(pos)!;
  const tr = view.state.tr.replaceWith(
    pos + 1,
    pos + 1 + node.content.size,
    view.state.schema.text(newText),
  );
  view.dispatch(tr);
}

beforeEach(() => {
  mocked.renders.length = 0;
  // The shared runtime caches by source; a hit would skip the mocked
  // render these tests are steering.
  resetMermaidRuntimeForTests();
});

describe('MermaidNodeView mermaid config', () => {
  it('initializes mermaid with securityLevel strict (matching read mode)', async () => {
    const { view, parent } = makeView('```mermaid\nflowchart TD\nA[a]\n```\n');
    await flush();
    expect(mocked.initializeCalls.length).toBeGreaterThan(0);
    expect(mocked.initializeCalls[0].securityLevel).toBe('strict');
    view.destroy();
    parent.remove();
  });

  it('follows the app theme setting and re-renders when it changes', async () => {
    settings.set({ ...DEFAULT_SETTINGS, theme: 'light' });
    const { view, parent } = makeView('```mermaid\nflowchart TD\nA[a]\n```\n');
    await flush();
    expect(mocked.initializeCalls.at(-1)?.theme).toBe('default');
    mocked.renders[0].resolve('<svg data-which="light"></svg>');
    await flush();

    settings.set({ ...DEFAULT_SETTINGS, theme: 'dark' });
    await flush();
    expect(mocked.renders.length).toBe(2);
    expect(mocked.initializeCalls.at(-1)?.theme).toBe('dark');
    mocked.renders[1].resolve('<svg data-which="dark"></svg>');
    await flush();
    expect(parent.querySelector('.mermaid-rendered svg')?.getAttribute('data-which')).toBe('dark');
    view.destroy();
    parent.remove();
    settings.set(DEFAULT_SETTINGS);
  });
});

describe('MermaidNodeView async ordering', () => {
  it('a superseded render never overwrites a newer one', async () => {
    const { view, parent } = makeView('```mermaid\nflowchart TD\nA[one]\n```\n');
    await flush();
    expect(mocked.renders.length).toBe(1);

    // The source changes while render #1 is still in flight. Renders
    // are serialized through the shared runtime's queue, so #2 only
    // starts once #1 settles — and #1's (now stale) result must not be
    // painted in the meantime.
    setBlockText(view, 'flowchart TD\nA[two]\n');
    await flush();
    expect(mocked.renders.length).toBe(1);

    mocked.renders[0].resolve('<svg data-which="one"></svg>');
    await flush();
    expect(parent.querySelector('.mermaid-rendered svg[data-which="one"]')).toBeNull();
    expect(mocked.renders.length).toBe(2);
    mocked.renders[1].resolve('<svg data-which="two"></svg>');
    await flush();

    const svg = parent.querySelector('.mermaid-rendered svg');
    expect(svg?.getAttribute('data-which')).toBe('two');
    view.destroy();
    parent.remove();
  });

  it('a superseded render that FAILS does not paint its error box', async () => {
    const { view, parent } = makeView('```mermaid\nflowchart TD\nA[one]\n```\n');
    await flush();
    setBlockText(view, 'flowchart TD\nA[two]\n');
    await flush();
    expect(mocked.renders.length).toBe(1);

    mocked.renders[0].reject(new Error('boom'));
    await flush();
    expect(parent.querySelector('.mermaid-error')).toBeNull();
    expect(mocked.renders.length).toBe(2);
    mocked.renders[1].resolve('<svg data-which="two"></svg>');
    await flush();

    expect(parent.querySelector('.mermaid-error')).toBeNull();
    expect(
      parent.querySelector('.mermaid-rendered svg')?.getAttribute('data-which'),
    ).toBe('two');
    view.destroy();
    parent.remove();
  });

  it('"+ Add first shape" opens the popover only after the render completes, anchored to the SVG', async () => {
    const { view, parent } = makeView('```mermaid\nflowchart TD\n```\n');
    await flush();
    const placeholder = parent.querySelector<HTMLButtonElement>(
      '.mermaid-empty-state',
    );
    expect(placeholder).not.toBeNull();

    placeholder!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(mocked.renders.length).toBe(1);

    // Wait past the old 50ms timeout window — the popover must NOT be
    // open yet, because the SVG it anchors to doesn't exist until the
    // (still pending) render resolves. The old behaviour opened it at
    // (0,0) here.
    await sleep(70);
    const early = parent.querySelector('.mermaid-popover');
    expect(early === null || early.hasAttribute('hidden')).toBe(true);

    mocked.renders[0].resolve(
      '<svg><g class="node" id="flowchart-A-0"><rect></rect></g></svg>',
    );
    await flush();

    const popover = parent.querySelector('.mermaid-popover');
    expect(popover).not.toBeNull();
    expect(popover!.hasAttribute('hidden')).toBe(false);
    // Anchored: the new node carries the selection highlight.
    expect(parent.querySelector('g.node.mermaid-selected')).not.toBeNull();
    view.destroy();
    parent.remove();
  });

  it('"+ Add first participant" opens the popover only after the render completes', async () => {
    const { view, parent } = makeView('```mermaid\nsequenceDiagram\n```\n');
    await flush();
    const placeholder = parent.querySelector<HTMLButtonElement>(
      '.mermaid-empty-state',
    );
    expect(placeholder).not.toBeNull();

    placeholder!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(mocked.renders.length).toBe(1);

    await sleep(70);
    const early = parent.querySelector('.mermaid-participant-popover');
    expect(early === null || early.hasAttribute('hidden')).toBe(true);

    mocked.renders[0].resolve(
      '<svg><g data-et="participant" data-id="A"><rect></rect></g></svg>',
    );
    await flush();

    const popover = parent.querySelector('.mermaid-participant-popover');
    expect(popover).not.toBeNull();
    expect(popover!.hasAttribute('hidden')).toBe(false);
    view.destroy();
    parent.remove();
  });
});
