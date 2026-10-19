// Kanban editing through the real NodeView + real mermaid renders
// (jsdom geometry stubbed): columns, cards, their metadata.
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

const column = (parent: HTMLElement, text: string) =>
  Array.from(parent.querySelectorAll('g.sections > g.cluster')).find((g) => g.textContent?.trim() === text) ?? null;
const card = (parent: HTMLElement, text: string) =>
  Array.from(parent.querySelectorAll('g.items > g.node')).find((g) => g.querySelector('.markdown-node-label')?.textContent?.trim() === text) ?? null;
const popover = (parent: HTMLElement) => parent.querySelector<HTMLElement>('.mermaid-form-popover:not([hidden])');
const action = (parent: HTMLElement, id: string) => parent.querySelector<HTMLElement>(`.mermaid-form-popover [data-action="${id}"]`);

function editRich(field: HTMLElement, html: string): void {
  field.innerHTML = html;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function editInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

const SRC = [
  'kanban',
  '  %% the board',
  '  todo[To do]',
  "    a[Draft]@{ assigned: 'Sam', ticket: T-1 }",
  '    b[Review]',
  '    ::icon(fa fa-eye)',
  '  Done',
  '    [Shipped]',
].join('\n');

describe('MermaidNodeView kanban', () => {
  it('is editable: no "coming soon" note', async () => {
    const { parent } = makeView(SRC);
    await flush();
    expect(parent.querySelector<HTMLElement>('.mermaid-fallback-note')?.hidden ?? true).toBe(true);
    expect(parent.querySelectorAll('g.items > g.node').length).toBe(3);
  });

  it('a column header opens its popover; renaming changes only its line', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(column(parent, 'To do')?.querySelector('.cluster-label'));
    await flush(1);
    expect(column(parent, 'To do')?.classList.contains('mermaid-selected')).toBe(true);
    const ids = Array.from(popover(parent)!.querySelectorAll('[data-action]')).map((b) => b.getAttribute('data-action'));
    expect(ids).toEqual(['add-card', 'move-right', 'delete-column']);
    const field = popover(parent)!.querySelector<HTMLElement>('.mermaid-kanban-column-name')!;
    expect(field.textContent).toBe('To do');
    editRich(field, 'Backlog');
    await flush();
    expect(text()).toBe(SRC.replace('todo[To do]', 'todo[Backlog]'));
  });

  it('"Add card" adds a line and opens the new card', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(column(parent, 'Done')?.querySelector('rect'));
    await flush(1);
    click(action(parent, 'add-card'));
    await flush();
    expect(text()).toBe(`${SRC}\n    [" "]`);
    const field = popover(parent)!.querySelector<HTMLElement>('.mermaid-kanban-card-text')!;
    expect(field.textContent).toBe('');
    editRich(field, 'Celebrate');
    await flush();
    expect(text()).toBe(`${SRC}\n    [Celebrate]`);
  });

  it('a card shows its text, assigned, ticket and priority; edits touch only its line', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(card(parent, 'Draft')?.querySelector('.markdown-node-label'));
    await flush(1);
    const pop = popover(parent)!;
    expect(pop.querySelector<HTMLElement>('.mermaid-kanban-card-text')?.textContent).toBe('Draft');
    expect(pop.querySelector<HTMLInputElement>('.mermaid-kanban-assigned')?.value).toBe('Sam');
    expect(pop.querySelector<HTMLInputElement>('.mermaid-kanban-ticket')?.value).toBe('T-1');
    expect(pop.textContent).not.toMatch(/@\{|kanban|::/);
    editInput(pop.querySelector<HTMLInputElement>('.mermaid-kanban-assigned')!, 'Kim');
    await flush();
    expect(text()).toBe(SRC.replace("@{ assigned: 'Sam', ticket: T-1 }", '@{ assigned: Kim, ticket: T-1 }'));
    choose(popover(parent)!.querySelector<HTMLSelectElement>('select[aria-label="Priority"]')!, 'Very High');
    await flush();
    expect(text()).toBe(SRC.replace("@{ assigned: 'Sam', ticket: T-1 }", '@{ assigned: Kim, ticket: T-1, priority: Very High }'));
    editInput(popover(parent)!.querySelector<HTMLInputElement>('.mermaid-kanban-ticket')!, '');
    await flush();
    expect(text()).toBe(SRC.replace("@{ assigned: 'Sam', ticket: T-1 }", '@{ assigned: Kim, priority: Very High }'));
  });

  it('the column picker moves a card (with its icon) to the end of another column', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(card(parent, 'Review')?.querySelector('rect'));
    await flush(1);
    const select = popover(parent)!.querySelector<HTMLSelectElement>('select[aria-label="Column"]')!;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['To do', 'Done']);
    choose(select, '1');
    await flush();
    expect(text()).toBe(SRC.replace('    b[Review]\n    ::icon(fa fa-eye)\n', '') + '\n    b[Review]\n    ::icon(fa fa-eye)');
    expect(card(parent, 'Review')?.classList.contains('mermaid-selected')).toBe(true);
  });

  it('cards move up / down and are deleted', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(card(parent, 'Review')?.querySelector('rect'));
    await flush(1);
    expect(action(parent, 'move-down')).toBeNull();
    click(action(parent, 'move-up'));
    await flush();
    const swapped = SRC.replace(
      "    a[Draft]@{ assigned: 'Sam', ticket: T-1 }\n    b[Review]\n    ::icon(fa fa-eye)",
      "    b[Review]\n    ::icon(fa fa-eye)\n    a[Draft]@{ assigned: 'Sam', ticket: T-1 }",
    );
    expect(text()).toBe(swapped);
    click(action(parent, 'delete-card'));
    await flush();
    expect(text()).toBe(swapped.replace('    b[Review]\n    ::icon(fa fa-eye)\n', ''));
    expect(popover(parent)).toBeNull();
  });

  it('"+ Column" adds a column and opens it; columns move right and are deleted', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(parent.querySelector('.mermaid-actions-bar [data-action="add-column"]'));
    await flush();
    expect(text()).toBe(`${SRC}\n  [" "]`);
    editRich(popover(parent)!.querySelector<HTMLElement>('.mermaid-kanban-column-name')!, 'Later');
    await flush();
    expect(text()).toBe(`${SRC}\n  Later`);
    click(column(parent, 'To do')?.querySelector('rect'));
    await flush(1);
    click(action(parent, 'move-right'));
    await flush();
    const moved = ['kanban', '  %% the board', '  Done', '    [Shipped]', '  todo[To do]', "    a[Draft]@{ assigned: 'Sam', ticket: T-1 }", '    b[Review]', '    ::icon(fa fa-eye)', '  Later'].join('\n');
    expect(text()).toBe(moved);
    expect(action(parent, 'delete-column')?.textContent?.trim()).toBe('Delete column (and its cards)');
    click(action(parent, 'delete-column'));
    await flush();
    expect(text()).toBe(['kanban', '  %% the board', '  Done', '    [Shipped]', '  Later'].join('\n'));
  });

  it('an empty board offers to add the first column', async () => {
    const { parent, text } = makeView('kanban\n');
    await flush();
    const btn = parent.querySelector<HTMLElement>('.mermaid-empty-state');
    expect(btn?.textContent).toContain('Add the first column');
    click(btn);
    await flush();
    expect(text()).toBe('kanban\n  [" "]\n');
  });
});
