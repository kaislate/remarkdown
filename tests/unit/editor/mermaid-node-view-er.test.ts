// ER diagram editing through the real NodeView + real mermaid renders
// (jsdom geometry stubbed): click real SVG elements, edit through the
// popover DOM, check the exact resulting source.
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

function byText(parent: HTMLElement, text: string): Element | null {
  const hits = Array.from(parent.querySelectorAll('.mermaid-rendered p')).filter((p) => p.textContent === text);
  return hits[hits.length - 1] ?? null;
}

const popover = (parent: HTMLElement) => parent.querySelector<HTMLElement>('.mermaid-form-popover')!;

function type(input: HTMLInputElement | null, value: string, commit: 'enter' | 'blur' = 'enter'): void {
  expect(input, 'input').toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
  if (commit === 'enter') input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  else input!.dispatchEvent(new FocusEvent('blur'));
}

function choose(select: HTMLSelectElement | null, value: string): void {
  expect(select, 'select').toBeTruthy();
  select!.value = value;
  select!.dispatchEvent(new Event('change', { bubbles: true }));
}

const cell = (parent: HTMLElement, row: number, label: string) =>
  popover(parent).querySelector<HTMLInputElement>(`[data-field="attributes"] tr[data-row="${row}"] [aria-label="${label}"]`);

const SRC = [
  'erDiagram',
  '    %% keep me',
  '    CUSTOMER ||--o{ ORDER : places',
  '    CUSTOMER {',
  '        string name',
  '        string email PK',
  '    }',
].join('\n');

describe('MermaidNodeView ER diagrams: entities', () => {
  it('is editable; renaming writes an alias on its line only', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    expect(parent.querySelector('.mermaid-block-editor')?.classList.contains('mermaid-fallback')).toBe(false);
    click(byText(parent, 'CUSTOMER'));
    await flush(1);
    const name = popover(parent).querySelector<HTMLInputElement>('.mermaid-entity-name');
    expect(name?.value).toBe('CUSTOMER');
    type(name, 'Customer');
    await flush();
    expect(text()).toBe(SRC.replace('    CUSTOMER {', '    CUSTOMER["Customer"] {'));
  });

  it('attributes table: keys as toggles, words stored the way the diagram can hold them', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(byText(parent, 'CUSTOMER'));
    await flush(1);
    expect(cell(parent, 1, 'PK')?.checked).toBe(true);
    expect(cell(parent, 1, 'FK')?.checked).toBe(false);
    cell(parent, 1, 'FK')!.checked = true;
    cell(parent, 1, 'FK')!.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(text()).toBe(SRC.replace('string email PK', 'string email PK, FK'));
    type(cell(parent, 0, 'Type'), 'unsigned int', 'blur');
    await flush();
    expect(text()).toBe(SRC.replace('string email PK', 'string email PK, FK').replace('string name', 'unsigned_int name'));
    // The cell shows what is stored.
    expect(cell(parent, 0, 'Type')?.value).toBe('unsigned_int');
    type(cell(parent, 0, 'Comment'), 'Full "legal" name', 'blur');
    await flush();
    expect(text()).toContain('        unsigned_int name "Full #quot;legal#quot; name"\n');
  });

  it('adds, removes and reorders attributes; clicking a row opens it focused', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(byText(parent, 'email'));
    await flush(2);
    expect(document.activeElement?.closest('tr')?.getAttribute('data-row')).toBe('1');
    click(popover(parent).querySelector('[data-field="attributes"] .mermaid-form-add'));
    await flush();
    expect(text()).toBe(SRC.replace('        string email PK\n', '        string email PK\n        string attribute\n'));
    click(popover(parent).querySelector('[data-field="attributes"] tr[data-row="2"] button[aria-label="Remove"]'));
    await flush();
    expect(text()).toBe(SRC);
    click(popover(parent).querySelector('[data-field="attributes"] tr[data-row="0"] button[aria-label="Move down"]'));
    await flush();
    expect(text()).toBe(SRC.replace('        string name\n        string email PK\n', '        string email PK\n        string name\n'));
  });

  it('deletes an entity and its relationships, keeping the other entity', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(byText(parent, 'CUSTOMER'));
    await flush(1);
    click(popover(parent).querySelector('[data-action="delete"]'));
    await flush();
    expect(text()).toBe('erDiagram\n    %% keep me\n    ORDER');
  });
});

describe('MermaidNodeView ER diagrams: relationships and toolbar', () => {
  it('cardinalities in plain words, the line kind and the label', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(byText(parent, 'places'));
    await flush(1);
    const p = popover(parent);
    expect(p.textContent).not.toMatch(/\|\||o\{|--/);
    const from = p.querySelector<HTMLSelectElement>('select[aria-label="CUSTOMER side"]')!;
    expect(from.selectedOptions[0].textContent).toBe('exactly one');
    expect(p.querySelector<HTMLSelectElement>('select[aria-label="ORDER side"]')!.selectedOptions[0].textContent).toBe('zero or more');
    choose(from, 'zero-or-one');
    await flush();
    expect(text()).toBe(SRC.replace('||--o{', '|o--o{'));
    const solid = popover(parent).querySelector<HTMLInputElement>('[data-field="identifying"] input')!;
    expect(solid.checked).toBe(true);
    solid.checked = false;
    solid.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(text()).toBe(SRC.replace('||--o{', '|o..o{'));
    type(popover(parent).querySelector('.mermaid-relationship-label'), 'buys from');
    await flush();
    expect(text()).toBe(SRC.replace('||--o{ ORDER : places', '|o..o{ ORDER : "buys from"'));
    // Enter closed the popover: reopen it from the label.
    click(byText(parent, 'buys from'));
    await flush(1);
    click(popover(parent).querySelector('[data-action="delete"]'));
    await flush();
    // Both entities were first named there: they stay.
    expect(text()).toBe(SRC.replace('    CUSTOMER ||--o{ ORDER : places', '    CUSTOMER\n    ORDER'));
  });

  it('"Connect to…" an entity adds a relationship and opens it; "+ Entity" adds one and opens it', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(byText(parent, 'ORDER'));
    await flush(1);
    click(popover(parent).querySelector('[data-action="connect"]'));
    await flush(1);
    expect(parent.querySelector('.mermaid-connect-banner')?.hasAttribute('hidden')).toBe(false);
    click(byText(parent, 'CUSTOMER'));
    await flush();
    expect(text()).toBe(`${SRC}\n    ORDER ||--o{ CUSTOMER : ""`);
    expect(popover(parent).querySelector('select[aria-label="ORDER side"]')).toBeTruthy();
    click(parent.querySelector('.mermaid-actions-bar [data-action="add-entity"]'));
    await flush();
    expect(text()).toBe(`${SRC}\n    ORDER ||--o{ CUSTOMER : ""\n    New_entity["New entity"]`);
    expect(popover(parent).querySelector<HTMLInputElement>('.mermaid-entity-name')?.value).toBe('New entity');
  });

  it('direction buttons and an empty diagram\'s first entity', async () => {
    const { parent, text } = makeView('erDiagram');
    await flush();
    click(parent.querySelector('.mermaid-empty-state'));
    await flush();
    expect(text()).toBe('erDiagram\n    New_entity["New entity"]');
    click(parent.querySelector('.mermaid-actions-bar [data-action="direction-LR"]'));
    await flush();
    expect(text()).toBe('erDiagram\n    direction LR\n    New_entity["New entity"]');
  });
});
