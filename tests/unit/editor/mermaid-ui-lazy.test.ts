// A diagram's popovers, toolbars and banners are built the first time
// they are shown, not when the editor opens: a document with dozens of
// diagrams used to build hundreds of hidden popovers (thousands of DOM
// nodes) before its first paint in edit mode, though most are never
// opened.
import { describe, it, expect } from 'vitest';
import { makeView, flush, click } from './mermaid-node-view-harness';
import { mountUi } from '../../../src/lib/editor/mermaid/ui';
import MermaidNodePopover from '../../../src/components/MermaidNodePopover.svelte';
import type { DiagramHost } from '../../../src/lib/editor/mermaid/controller';
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from '../../../src/lib/editor/schema';
import { parseMarkdownToDoc } from '../../../src/lib/editor/parser';
import { MermaidNodeView } from '../../../src/lib/editor/mermaid-node-view';

function fakeHost(dom: HTMLElement): DiagramHost {
  return {
    dom,
    renderedEl: dom,
    source: () => null,
    commit: () => {},
    createUiHost: (className) => {
      const el = document.createElement('div');
      el.className = className;
      dom.appendChild(el);
      return el;
    },
    anchor: () => ({ x: 0, y: 0 }),
    setEscapeHandler: () => {},
  } as unknown as DiagramHost;
}

const nodeEls = (root: Element) => root.querySelectorAll('.mermaid-popover-host *').length;
// DOM built for popovers nobody can see.
const hiddenEls = (root: Element) =>
  root.querySelectorAll('.mermaid-popover-host [hidden], .mermaid-popover-host [hidden] *').length;

describe('mountUi', () => {
  it('keeps its place in the diagram but builds nothing until first shown', async () => {
    const dom = document.createElement('div');
    document.body.appendChild(dom);
    const ui = mountUi(fakeHost(dom), MermaidNodePopover, 'mermaid-popover-host', { visible: false } as never);
    // The host is there (so later popovers stack in the same order)...
    expect(dom.querySelectorAll('.mermaid-popover-host')).toHaveLength(1);
    // ...but empty.
    expect(nodeEls(dom)).toBe(0);
    ui.hide();
    expect(nodeEls(dom)).toBe(0);
    ui.destroy();
    expect(dom.querySelectorAll('.mermaid-popover-host')).toHaveLength(0);
    dom.remove();
  });
});

describe('diagram popovers in the editor', () => {
  const FLOW = 'flowchart LR\n  A[Start] --> B[Next]';

  it('an untouched flowchart builds none of its popovers', async () => {
    const { parent } = makeView(FLOW);
    await flush();
    expect(parent.querySelector('.mermaid-rendered svg')).not.toBeNull();
    // Only what is on show (the direction picker and the actions bar
    // under the diagram) is built.
    expect(hiddenEls(parent)).toBe(0);
  });

  it('a click still opens the node popover, which then stays built', async () => {
    const { parent } = makeView(FLOW);
    await flush();
    const node = Array.from(parent.querySelectorAll('g.node')).find((g) => /-flowchart-A-\d+$/.test(g.id));
    click(node);
    await flush(2);
    const pop = () => parent.querySelector<HTMLElement>('.mermaid-popover[aria-label="Edit node"]');
    expect(pop()).not.toBeNull();
    expect(pop()!.hidden).toBe(false);
    click(parent.querySelector('.mermaid-rendered svg'));
    await flush(2);
    expect(pop()?.hidden ?? true).toBe(true);
    // Built once, kept: opening it again finds the same element.
    const first = parent.querySelector('.mermaid-popover-host')!.firstElementChild;
    click(node);
    await flush(2);
    expect(pop()!.hidden).toBe(false);
    expect(parent.querySelector('.mermaid-popover-host')!.firstElementChild).toBe(first);
  });

  it('measures: hidden DOM built for 20 flowcharts', async () => {
    const md = Array.from({ length: 20 }, (_, i) => `\`\`\`mermaid\nflowchart LR\n  A${i}[Start] --> B${i}[Next]\n\`\`\`\n`).join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const t0 = performance.now();
    const view = new EditorView(parent, {
      state: EditorState.create({ doc: parseMarkdownToDoc(md), schema: editorSchema }),
      nodeViews: { code_block: (node, v, getPos) => new MermaidNodeView(node, v, getPos) },
    });
    // Until every diagram is drawn (each hides its popovers then).
    while (parent.querySelectorAll('.mermaid-rendered svg').length < 20) await flush(1);
    await flush(2);
    const ms = performance.now() - t0;
    const total = hiddenEls(parent);
    const all = nodeEls(parent);
    view.destroy();
    parent.remove();
    // eslint-disable-next-line no-console
    console.log(`[perf] diagram popovers: 20 flowcharts drawn in ${ms.toFixed(0)} ms with ${total} DOM nodes in hidden popovers, ${all} popover nodes in all`);
    expect(total).toBe(0);
  });
});
