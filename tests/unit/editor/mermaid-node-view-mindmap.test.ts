// Mindmap editing through the real NodeView + real mermaid renders
// (jsdom geometry stubbed): click an idea, edit it in the popover,
// outline operations, keyboard shortcuts.
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

function idea(parent: HTMLElement, text: string): Element | null {
  return Array.from(parent.querySelectorAll('g.mindmap-node')).find((g) => g.textContent?.trim() === text) ?? null;
}

const popover = (parent: HTMLElement) => parent.querySelector<HTMLElement>('.mermaid-form-popover:not([hidden])');
const action = (parent: HTMLElement, id: string) => parent.querySelector<HTMLElement>(`.mermaid-form-popover [data-action="${id}"]`);

function editRich(field: HTMLElement, html: string): void {
  field.innerHTML = html;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

// jsdom has no canvas, which mermaid's default mindmap layout needs; the
// init directive picks the layout mermaid draws in jsdom (the SVG is the
// same apart from positions).
const SRC = [
  '%%{init: {"layout": "dagre"}}%%',
  'mindmap',
  '  %% the plan',
  '  root((Plan))',
  '    Research',
  '    ::icon(fa fa-book)',
  '      Papers',
  '    Design',
  '    Build',
].join('\n');

describe('MermaidNodeView mindmap', () => {
  it('is editable: no "coming soon" note', async () => {
    const { parent } = makeView(SRC);
    await flush();
    expect(parent.querySelector<HTMLElement>('.mermaid-fallback-note')?.hidden ?? true).toBe(true);
    expect(parent.querySelectorAll('g.mindmap-node').length).toBe(5);
  });

  it('clicking an idea opens its popover; renaming changes only its line', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(idea(parent, 'Design')?.querySelector('p'));
    await flush(1);
    expect(idea(parent, 'Design')?.classList.contains('mermaid-selected')).toBe(true);
    const field = popover(parent)?.querySelector<HTMLElement>('.mermaid-mindmap-text');
    expect(field?.textContent).toBe('Design');
    expect(popover(parent)?.textContent).not.toMatch(/mindmap|::|%%/);
    editRich(field!, 'Visual <b>design</b>');
    await flush();
    expect(text()).toBe(SRC.replace('    Design', '    Visual **design**'));
  });

  it('the shape buttons change only the delimiters', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(idea(parent, 'Plan')?.querySelector('p'));
    await flush(1);
    expect(popover(parent)?.querySelector('button[aria-label="Circle"]')?.getAttribute('aria-checked')).toBe('true');
    click(popover(parent)?.querySelector('button[aria-label="Cloud"]'));
    await flush();
    expect(text()).toBe(SRC.replace('root((Plan))', 'root)Plan('));
  });

  it('"Add child" adds a line and opens the new idea', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(idea(parent, 'Research')?.querySelector('p'));
    await flush(1);
    click(action(parent, 'add-child'));
    await flush();
    expect(text()).toBe(SRC.replace('      Papers', '      Papers\n      (-" "-)'));
    const field = popover(parent)?.querySelector<HTMLElement>('.mermaid-mindmap-text');
    expect(field?.textContent).toBe('');
    editRich(field!, 'Notes');
    await flush();
    expect(text()).toBe(SRC.replace('      Papers', '      Papers\n      Notes'));
  });

  it('delete says it takes the branch and removes it, icon line included', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(idea(parent, 'Research')?.querySelector('p'));
    await flush(1);
    expect(action(parent, 'delete')?.textContent?.trim()).toBe('Delete (with its branch)');
    click(action(parent, 'delete'));
    await flush();
    expect(text()).toBe(SRC.replace('    Research\n    ::icon(fa fa-book)\n      Papers\n', ''));
    expect(popover(parent)).toBeNull();
  });

  it('the root has no sibling / delete / outdent actions', async () => {
    const { parent } = makeView(SRC);
    await flush();
    click(idea(parent, 'Plan')?.querySelector('p'));
    await flush(1);
    const ids = Array.from(popover(parent)!.querySelectorAll('[data-action]')).map((b) => b.getAttribute('data-action'));
    expect(ids).toEqual(['add-child']);
  });

  it('Tab indents and Shift+Tab outdents, keeping the idea selected', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(idea(parent, 'Build')?.querySelector('p'));
    await flush(1);
    const field = popover(parent)!.querySelector<HTMLElement>('.mermaid-mindmap-text')!;
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await flush();
    const indented = SRC.replace('    Build', '      Build');
    expect(text()).toBe(indented);
    expect(idea(parent, 'Build')?.classList.contains('mermaid-selected')).toBe(true);
    const again = popover(parent)!.querySelector<HTMLElement>('.mermaid-mindmap-text')!;
    expect(again.textContent).toBe('Build');
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(text()).toBe(SRC);
  });

  it('move up swaps the idea with its sibling, branch and icon included', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(idea(parent, 'Design')?.querySelector('p'));
    await flush(1);
    click(action(parent, 'move-up'));
    await flush();
    expect(text()).toBe(SRC.replace('    Research\n    ::icon(fa fa-book)\n      Papers\n    Design', '    Design\n    Research\n    ::icon(fa fa-book)\n      Papers'));
    expect(idea(parent, 'Design')?.classList.contains('mermaid-selected')).toBe(true);
  });

  it('an empty mindmap offers to add the central idea', async () => {
    const { parent, text } = makeView('%%{init: {"layout": "dagre"}}%%\nmindmap\n');
    await flush();
    const btn = parent.querySelector<HTMLElement>('.mermaid-empty-state, .mermaid-placeholder, button.mermaid-empty');
    expect(btn?.textContent).toContain('Add the central idea');
    click(btn);
    await flush();
    expect(text()).toBe('%%{init: {"layout": "dagre"}}%%\nmindmap\n  (-" "-)\n');
  });
});
