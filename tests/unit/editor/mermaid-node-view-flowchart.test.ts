// Flowchart popovers through the real NodeView + real mermaid renders
// (jsdom geometry stubbed): groups, colours, every link kind, the
// legacy `graph` keyword, bold / italic labels, the diagram title.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
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

async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 10));
}

let current: { view: EditorView; parent: HTMLElement } | null = null;
afterEach(() => {
  current?.view.destroy();
  current?.parent.remove();
  current = null;
});

function makeView(source: string): { view: EditorView; parent: HTMLElement; text: () => string } {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView(parent, {
    state: EditorState.create({ doc: parseMarkdownToDoc('```mermaid\n' + source + '\n```\n'), schema: editorSchema }),
    nodeViews: { code_block: (node, v, getPos) => new MermaidNodeView(node, v, getPos) },
  });
  current = { view, parent };
  return { view, parent, text: () => view.state.doc.textContent };
}

function click(el: Element | null | undefined): void {
  expect(el, 'element to click').toBeTruthy();
  el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function nodeEl(parent: HTMLElement, id: string): Element | null {
  return Array.from(parent.querySelectorAll('g.node')).find((g) => new RegExp(`-flowchart-${id}-\\d+$`).test(g.id)) ?? null;
}

function editRich(field: HTMLElement, html: string): void {
  field.innerHTML = html;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

const GROUPS = [
  'flowchart TB',
  '    %% keep me',
  '    subgraph one [First group]',
  '        a1 --> a2',
  '    end',
  '    subgraph two [Second group]',
  '        b1',
  '    end',
  '    a2 --> b1',
  '    b1 --> c1',
].join('\n');

describe('MermaidNodeView flowchart: groups', () => {
  it('clicking a group opens its popover; renaming it changes only its title', async () => {
    const { parent, text } = makeView(GROUPS);
    await flush();
    const cluster = Array.from(parent.querySelectorAll('g.cluster')).find((c) => c.id.endsWith('-one'));
    click(cluster?.querySelector('rect'));
    await flush(1);
    const field = parent.querySelector<HTMLElement>('.mermaid-form-popover .mermaid-group-title');
    expect(field?.textContent).toBe('First group');
    editRich(field!, 'Renamed');
    await flush();
    expect(text()).toBe(GROUPS.replace('one [First group]', 'one [Renamed]'));
  });

  it('the node popover moves a node into another group', async () => {
    const { parent, text } = makeView(GROUPS);
    await flush();
    click(nodeEl(parent, 'c1')?.querySelector('rect'));
    await flush(1);
    const select = parent.querySelector<HTMLSelectElement>('.mermaid-popover select[aria-label="Group"]')!;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['No group', 'First group', 'Second group', 'New group…']);
    select.value = 'two';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(text()).toBe(GROUPS.replace('        b1\n', '        b1\n        c1\n'));
  });

  it('"New group…" puts the node in a fresh group and opens it for naming', async () => {
    const { parent, text } = makeView(GROUPS);
    await flush();
    click(nodeEl(parent, 'c1')?.querySelector('rect'));
    await flush(1);
    const select = parent.querySelector<HTMLSelectElement>('.mermaid-popover select[aria-label="Group"]')!;
    select.value = '+new';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(text()).toBe(`${GROUPS}\n    subgraph group1 [Group]\n        c1\n    end`);
    expect(parent.querySelector<HTMLElement>('.mermaid-form-popover .mermaid-group-title')?.textContent).toBe('Group');
  });

  it('removing a group keeps what was inside it', async () => {
    const { parent, text } = makeView(GROUPS);
    await flush();
    const cluster = Array.from(parent.querySelectorAll('g.cluster')).find((c) => c.id.endsWith('-two'));
    click(cluster?.querySelector('rect'));
    await flush(1);
    click(parent.querySelector('.mermaid-form-popover [data-action="ungroup"]'));
    await flush();
    expect(text()).toBe(GROUPS.replace('    subgraph two [Second group]\n', '').replace('        b1\n    end\n', '        b1\n'));
  });
});

describe('MermaidNodeView flowchart: styling and links', () => {
  it('colour swatches write a style line for the node', async () => {
    const src = 'flowchart LR\n    A[Start] --> B[End]';
    const { parent, text } = makeView(src);
    await flush();
    click(nodeEl(parent, 'A')?.querySelector('rect'));
    await flush(1);
    click(parent.querySelector('.mermaid-popover button[aria-label="Colours"]'));
    await flush(1);
    click(parent.querySelector('.mermaid-popover [aria-label="Fill colour"] button[aria-label="Colour #bbf7d0"]'));
    await flush();
    expect(text()).toBe(`${src}\n    style A fill:#bbf7d0`);
    // The colours stay open across the edit (pick fill, then border …)
    // and show the colour as chosen.
    expect(parent.querySelector('.mermaid-popover button[aria-label="Colours"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(parent.querySelector('.mermaid-popover [aria-label="Fill colour"] button[aria-checked="true"]')?.getAttribute('aria-label')).toBe('Colour #bbf7d0');
  });

  it('the edge popover picks line, ends and colour', async () => {
    const src = 'graph LR\n    A --> B';
    const { parent, text } = makeView(src);
    await flush();
    const edge = () => parent.querySelector('path.flowchart-link[data-id="L_A_B_0"]');
    click(edge());
    await flush(1);
    click(parent.querySelector('.mermaid-edge-popover button[aria-label="Circle end"]'));
    await flush();
    expect(text()).toBe('graph LR\n    A --o B');
    click(edge());
    await flush(1);
    click(parent.querySelector('.mermaid-edge-popover button[aria-label="Dotted line"]'));
    await flush();
    expect(text()).toBe('graph LR\n    A -.-o B');
    click(edge());
    await flush(1);
    click(parent.querySelector('.mermaid-edge-popover [aria-label="Line colour"] button[aria-label="Colour #2563eb"]'));
    await flush();
    expect(text()).toBe('graph LR\n    A -.-o B\n    linkStyle 0 stroke:#2563eb');
  });

  it('bold / italic labels: never shown as asterisks, written as a markdown string', async () => {
    const src = 'flowchart LR\n    A["`**Bold** label`"] --> B[Plain]';
    const { parent, text } = makeView(src);
    await flush();
    click(nodeEl(parent, 'A')?.querySelector('rect'));
    await flush(1);
    const field = parent.querySelector<HTMLElement>('.mermaid-popover .mermaid-popover-label')!;
    expect(field.textContent).toBe('Bold label');
    expect(field.querySelector('b')?.textContent).toBe('Bold');
    expect(parent.querySelector('.mermaid-popover')!.textContent).not.toMatch(/[*`]/);
    click(nodeEl(parent, 'B')?.querySelector('rect'));
    await flush(1);
    editRich(parent.querySelector<HTMLElement>('.mermaid-popover .mermaid-popover-label')!, 'Now <i>slanted</i>');
    await flush();
    expect(text()).toBe('flowchart LR\n    A["`**Bold** label`"] --> B["`Now *slanted*`"]');
  });
});

describe('MermaidNodeView flowchart: toolbar', () => {
  it('"Shape" adds a shape and opens its popover; "Add title" writes frontmatter', async () => {
    const src = 'flowchart LR\n    A --> B';
    const { parent, text } = makeView(src);
    await flush();
    click(parent.querySelector('.mermaid-actions-bar [data-action="add-shape"]'));
    await flush();
    expect(text()).toBe('flowchart LR\n    A --> B\n    C[" "]');
    expect(parent.querySelector('.mermaid-popover')?.hasAttribute('hidden')).toBe(false);
    click(parent.querySelector('.mermaid-actions-bar [data-action="title"]'));
    await flush(1);
    const input = parent.querySelector<HTMLInputElement>('.mermaid-form-popover .mermaid-title-input')!;
    input.value = 'My flow';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(text()).toBe('---\ntitle: My flow\n---\nflowchart LR\n    A --> B\n    C[" "]');
  });

  it('the legacy graph keyword is editable and stays graph', async () => {
    const { parent, text } = makeView('graph TD\n    A[Legacy] --> B');
    await flush();
    expect(parent.querySelector('.mermaid-block-editor')?.classList.contains('mermaid-fallback')).toBe(false);
    click(nodeEl(parent, 'A')?.querySelector('rect'));
    await flush(1);
    editRich(parent.querySelector<HTMLElement>('.mermaid-popover .mermaid-popover-label')!, 'Still legacy');
    await flush();
    expect(text()).toBe('graph TD\n    A[Still legacy] --> B');
  });
});
