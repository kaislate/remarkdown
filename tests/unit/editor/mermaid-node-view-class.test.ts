// Class diagram editing through the real NodeView + real mermaid
// renders (jsdom geometry stubbed): click real SVG elements, edit
// through the popover DOM, check the exact resulting source.
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

function classNode(parent: HTMLElement, id: string): Element | null {
  return Array.from(parent.querySelectorAll('g.node')).find((g) => new RegExp(`-classId-${id}-\\d+$`).test(g.id)) ?? null;
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
  popover(parent).querySelector<HTMLInputElement & HTMLSelectElement>(`[data-field="members"] tr[data-row="${row}"] [aria-label="${label}"]`);

const SRC = [
  'classDiagram',
  '    %% keep me',
  '    class Animal {',
  '        +String name',
  '        +makeSound() void',
  '    }',
  '    Animal <|-- Dog',
  '    Dog "1" --> "*" Bone : chews',
  '    note for Dog "Good boy"',
].join('\n');

describe('MermaidNodeView class diagrams: classes', () => {
  it('is editable (no "coming soon" note) and renaming sets a label on its line only', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    expect(parent.querySelector('.mermaid-block-editor')?.classList.contains('mermaid-fallback')).toBe(false);
    click(classNode(parent, 'Animal')?.querySelector('.label-group p'));
    await flush(1);
    const name = popover(parent).querySelector<HTMLInputElement>('.mermaid-class-name');
    expect(name?.value).toBe('Animal');
    expect(popover(parent).textContent).not.toMatch(/<\||--|~|:::/);
    type(name, 'Any animal');
    await flush();
    expect(text()).toBe(SRC.replace('class Animal {', 'class Animal["Any animal"] {'));
  });

  it('shows members in plain words and edits a cell', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(classNode(parent, 'Animal')?.querySelector('.label-group p'));
    await flush(1);
    expect(cell(parent, 0, 'Visibility')?.selectedOptions[0].textContent).toBe('public');
    expect(cell(parent, 0, 'Kind')?.value).toBe('field');
    expect(cell(parent, 0, 'Type')?.value).toBe('String');
    expect(cell(parent, 1, 'Kind')?.value).toBe('method');
    expect(cell(parent, 1, 'Type')?.value).toBe('void');
    type(cell(parent, 0, 'Name'), 'fullName', 'blur');
    await flush();
    expect(text()).toBe(SRC.replace('+String name', '+String fullName'));
    choose(cell(parent, 1, 'Visibility'), 'private');
    await flush();
    expect(text()).toBe(SRC.replace('+String name', '+String fullName').replace('+makeSound() void', '-makeSound() void'));
    choose(cell(parent, 0, 'Modifier'), 'static');
    await flush();
    expect(text()).toContain('        +String fullName$\n');
  });

  it('clicking a member row in the diagram opens the class focused on that row', async () => {
    const { parent } = makeView(SRC);
    await flush();
    click(byText(parent, '+makeSound() : void'));
    await flush(2);
    expect(popover(parent).hidden).toBe(false);
    expect(document.activeElement?.closest('tr')?.getAttribute('data-row')).toBe('1');
  });

  it('adds, removes and reorders members', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(classNode(parent, 'Animal')?.querySelector('.label-group p'));
    await flush(1);
    click(popover(parent).querySelector('[data-field="members"] .mermaid-form-add'));
    await flush();
    expect(text()).toBe(SRC.replace('        +makeSound() void\n', '        +makeSound() void\n        +newField\n'));
    // Rows show fields first: the new field is row 1.
    click(popover(parent).querySelector('[data-field="members"] tr[data-row="1"] button[aria-label="Remove"]'));
    await flush();
    expect(text()).toBe(SRC);
    click(popover(parent).querySelector('[data-field="members"] tr[data-row="0"] button[aria-label="Move down"]'));
    await flush();
    // A field and a method are drawn in their own groups: nothing to swap.
    expect(text()).toBe(SRC);
  });

  it('annotation: plain choices and custom text', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(classNode(parent, 'Animal')?.querySelector('.label-group p'));
    await flush(1);
    choose(popover(parent).querySelector('select[aria-label="Kind of class"]'), 'interface');
    await flush();
    expect(text()).toBe(SRC.replace('    class Animal {\n', '    class Animal {\n        <<interface>>\n'));
    choose(popover(parent).querySelector('select[aria-label="Kind of class"]'), 'custom');
    await flush(1);
    type(popover(parent).querySelector('.mermaid-class-annotation'), 'Data store');
    await flush();
    expect(text()).toBe(SRC.replace('    class Animal {\n', '    class Animal {\n        <<Data store>>\n'));
  });

  it('deletes a class with everything about it', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(classNode(parent, 'Dog')?.querySelector('.label-group p'));
    await flush(1);
    click(popover(parent).querySelector('[data-action="delete"]'));
    await flush();
    expect(text()).toBe(['classDiagram', '    %% keep me', '    class Animal {', '        +String name', '        +makeSound() void', '    }', '    class Bone'].join('\n'));
  });
});

describe('MermaidNodeView class diagrams: relationships and notes', () => {
  const relPath = (parent: HTMLElement, dataId: string) => parent.querySelector(`.mermaid-rendered path.relation[data-id="${dataId}"]`);

  it('picks a kind in plain words, flips, sets both ends and the label', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(relPath(parent, 'id_Animal_Dog_1'));
    await flush(1);
    const p = popover(parent);
    expect(p.textContent).toContain('Dog inherits from Animal');
    // (0..1-style counts are what the diagram shows, not syntax.)
    expect(p.textContent).not.toMatch(/<\||--|\|>/);
    click(p.querySelector('button[aria-label="Composition"]'));
    await flush();
    expect(text()).toBe(SRC.replace('Animal <|-- Dog', 'Animal *-- Dog'));
    click(popover(parent).querySelector('[data-action="flip"]'));
    await flush();
    expect(text()).toBe(SRC.replace('Animal <|-- Dog', 'Animal --* Dog'));
    click(popover(parent).querySelector('[data-field="to-card-suggest"] button[aria-label="0..1"]'));
    await flush();
    expect(text()).toBe(SRC.replace('Animal <|-- Dog', 'Animal --* "0..1" Dog'));
    type(popover(parent).querySelector('.mermaid-relation-label'), 'owns');
    await flush();
    expect(text()).toBe(SRC.replace('Animal <|-- Dog', 'Animal --* "0..1" Dog : owns'));
  });

  it('a label click opens the same popover; delete keeps the classes', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(byText(parent, 'chews'));
    await flush(1);
    expect(popover(parent).querySelector<HTMLInputElement>('.mermaid-relation-label')?.value).toBe('chews');
    expect(popover(parent).querySelector<HTMLInputElement>('.mermaid-from-card')?.value).toBe('1');
    click(popover(parent).querySelector('[data-action="delete"]'));
    await flush();
    expect(text()).toBe(SRC.replace('    Dog "1" --> "*" Bone : chews\n', '    class Bone\n'));
  });

  it('"Connect to…" then a class adds a relationship and opens its kind picker', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(classNode(parent, 'Bone')?.querySelector('.label-group p'));
    await flush(1);
    click(popover(parent).querySelector('[data-action="connect"]'));
    await flush(1);
    expect(parent.querySelector('.mermaid-connect-banner')?.hasAttribute('hidden')).toBe(false);
    click(classNode(parent, 'Animal')?.querySelector('.label-group p'));
    await flush();
    expect(text()).toBe(`${SRC}\n    Bone --> Animal`);
    expect(popover(parent).querySelector('button[aria-label="Association"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('notes: edit text, delete', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(byText(parent, 'Good boy'));
    await flush(1);
    type(popover(parent).querySelector('.mermaid-note-text'), 'Very "good"');
    await flush();
    expect(text()).toBe(SRC.replace('"Good boy"', '"Very #quot;good#quot;"'));
    click(byText(parent, 'Very "good"'));
    await flush(1);
    click(popover(parent).querySelector('[data-action="delete"]'));
    await flush();
    expect(text()).toBe(SRC.replace('\n    note for Dog "Good boy"', ''));
  });
});

describe('MermaidNodeView class diagrams: toolbar', () => {
  it('"Class" adds one and opens it; "Note" adds a note; direction buttons', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(parent.querySelector('.mermaid-actions-bar [data-action="add-class"]'));
    await flush();
    expect(text()).toBe(`${SRC}\n    class NewClass["New class"]`);
    expect(popover(parent).querySelector<HTMLInputElement>('.mermaid-class-name')?.value).toBe('New class');
    click(parent.querySelector('.mermaid-actions-bar [data-action="add-note"]'));
    await flush();
    expect(text()).toBe(`${SRC}\n    class NewClass["New class"]\n    note "Note"`);
    expect(popover(parent).querySelector<HTMLInputElement>('.mermaid-note-text')?.value).toBe('Note');
    click(parent.querySelector('.mermaid-actions-bar [data-action="direction-LR"]'));
    await flush();
    expect(text()).toBe(`classDiagram\n    direction LR\n${SRC.slice('classDiagram\n'.length)}\n    class NewClass["New class"]\n    note "Note"`);
    expect(parent.querySelector('.mermaid-actions-bar [data-action="direction-LR"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('moves a class into a namespace', async () => {
    const src = 'classDiagram\n    namespace Shapes {\n        class Square\n    }\n    class Circle';
    const { parent, text } = makeView(src);
    await flush();
    click(classNode(parent, 'Circle')?.querySelector('.label-group p'));
    await flush(1);
    choose(popover(parent).querySelector('select[aria-label="Namespace"]'), 'Shapes');
    await flush();
    expect(text()).toBe('classDiagram\n    namespace Shapes {\n        class Square\n        class Circle\n    }\n    class Circle');
  });
});
