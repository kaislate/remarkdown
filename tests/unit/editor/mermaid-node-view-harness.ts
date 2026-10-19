// Shared harness for the pie / gantt / timeline node-view tests: a real
// MermaidNodeView in a real EditorView, real mermaid renders (jsdom
// geometry stubbed), clicks on real SVG elements, edits through the
// popover DOM.
import { afterEach, beforeAll, expect } from 'vitest';
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

export async function flush(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 10));
}

let current: { view: EditorView; parent: HTMLElement } | null = null;
afterEach(() => {
  current?.view.destroy();
  current?.parent.remove();
  current = null;
});

export function makeView(source: string): { view: EditorView; parent: HTMLElement; text: () => string } {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView(parent, {
    state: EditorState.create({ doc: parseMarkdownToDoc('```mermaid\n' + source + '\n```\n'), schema: editorSchema }),
    nodeViews: { code_block: (node, v, getPos) => new MermaidNodeView(node, v, getPos) },
  });
  current = { view, parent };
  return { view, parent, text: () => view.state.doc.textContent };
}

export function click(el: Element | null | undefined): void {
  expect(el, 'element to click').toBeTruthy();
  el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

// The form popover (null while hidden).
export function form(parent: HTMLElement): HTMLElement | null {
  const el = parent.querySelector<HTMLElement>('.mermaid-form-popover');
  return el && !el.hasAttribute('hidden') ? el : null;
}

// Type into an input and press Enter (commit + close).
export function typeEnter(input: HTMLInputElement | null | undefined, value: string): void {
  expect(input, 'input').toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
  input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

// Type into an input and leave it (commit, popover stays).
export function typeBlur(input: HTMLInputElement | null | undefined, value: string): void {
  expect(input, 'input').toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
  input!.dispatchEvent(new FocusEvent('blur'));
}

export function choose(select: HTMLSelectElement | null | undefined, value: string): void {
  expect(select, 'select').toBeTruthy();
  select!.value = value;
  select!.dispatchEvent(new Event('change', { bubbles: true }));
}

export function field<T extends HTMLElement = HTMLInputElement>(parent: HTMLElement, id: string, selector = 'input, select'): T | null {
  return form(parent)?.querySelector<T>(`[data-field="${id}"] ${selector}`.trim()) ?? null;
}

export function action(parent: HTMLElement, id: string): Element | null {
  return form(parent)?.querySelector(`[data-action="${id}"]`) ?? null;
}

export function barButton(parent: HTMLElement, id: string): HTMLElement | null {
  return parent.querySelector<HTMLElement>(`.mermaid-actions-bar [data-action="${id}"]`);
}

// Lines of `before` missing from `after`, in order (a simple diff for
// "only these lines changed").
export function changedLines(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split('\n');
  const b = after.split('\n');
  return { removed: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) };
}
