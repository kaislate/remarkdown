// State diagram popovers through the real NodeView + real mermaid
// renders (jsdom geometry stubbed): clicking each kind of item, editing
// it through the popover DOM, and checking the exact resulting source.
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

function makeView(source: string): { parent: HTMLElement; text: () => string } {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView(parent, {
    state: EditorState.create({ doc: parseMarkdownToDoc('```mermaid\n' + source + '\n```\n'), schema: editorSchema }),
    nodeViews: { code_block: (node, v, getPos) => new MermaidNodeView(node, v, getPos) },
  });
  current = { view, parent };
  return { parent, text: () => view.state.doc.textContent };
}

function click(el: Element | null | undefined): void {
  expect(el, 'element to click').toBeTruthy();
  el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const stateEl = (parent: HTMLElement, id: string) =>
  Array.from(parent.querySelectorAll('g.node')).find((g) => new RegExp(`-state-${id}-\\d+$`).test(g.id)) ?? null;
const popover = (parent: HTMLElement) => parent.querySelector<HTMLElement>('.mermaid-form-popover:not([hidden])');
const action = (parent: HTMLElement, id: string) => popover(parent)?.querySelector(`[data-action="${id}"]`);

function editRich(field: HTMLElement, html: string): void {
  field.innerHTML = html;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

const SRC = [
  'stateDiagram-v2',
  '    %% keep me',
  '    [*] --> Idle',
  '    Idle --> Running : start',
  '    state Running {',
  '        [*] --> Loading',
  '        Loading --> Working',
  '    }',
  '    Running --> Done',
  '    note right of Idle : Waiting',
].join('\n');

describe('MermaidNodeView state diagram: states', () => {
  it('is editable (no "coming soon"); clicking a state opens its popover, renaming writes a name', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    expect(parent.querySelector('.mermaid-block-editor')?.classList.contains('mermaid-fallback')).toBe(false);
    click(stateEl(parent, 'Idle')?.querySelector('rect'));
    await flush(1);
    const field = popover(parent)?.querySelector<HTMLElement>('.mermaid-state-name');
    expect(field?.textContent).toBe('Idle');
    // Never any mermaid syntax in the popover.
    expect(popover(parent)!.textContent).not.toMatch(/\[\*\]|-->|<<|>>/);
    editRich(field!, 'Waiting <b>room</b>');
    await flush();
    expect(text()).toBe(SRC.replace('    [*] --> Idle\n', '    [*] --> Idle\n    state "Waiting **room**" as Idle\n'));
  });

  it('the kind buttons turn a state into a choice, with plain words', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(stateEl(parent, 'Done')?.querySelector('rect'));
    await flush(1);
    const kinds = Array.from(popover(parent)!.querySelectorAll('[data-field="kind"] button')).map((b) => b.getAttribute('aria-label'));
    expect(kinds).toEqual(['Normal', 'Fork (split)', 'Join', 'Choice']);
    click(popover(parent)!.querySelector('[data-field="kind"] button[aria-label="Choice"]'));
    await flush();
    expect(text()).toBe(SRC.replace('    Running --> Done', '    state Done <<choice>>\n    Running --> Done'));
  });

  it('the group picker moves a state into a group, and "New group…" wraps it', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(stateEl(parent, 'Done')?.querySelector('rect'));
    await flush(1);
    const select = popover(parent)!.querySelector<HTMLSelectElement>('select[aria-label="Group"]')!;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['No group', 'Running', 'New group…']);
    choose(select, 'Running');
    await flush();
    expect(text()).toBe(SRC.replace('        Loading --> Working\n', '        Loading --> Working\n        Done\n'));
  });

  it('"New group…" draws a new group around the state and opens it for naming', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(stateEl(parent, 'Done')?.querySelector('rect'));
    await flush(1);
    choose(popover(parent)!.querySelector<HTMLSelectElement>('select[aria-label="Group"]')!, '+new');
    await flush();
    expect(text()).toBe(`${SRC}\n    state Group {\n        Done\n    }`);
    expect(popover(parent)?.querySelector<HTMLElement>('.mermaid-group-title')?.textContent).toBe('Group');
  });

  it('adds start / end arrows and a note; deletes a state with its transitions', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(stateEl(parent, 'Done')?.querySelector('rect'));
    await flush(1);
    expect(action(parent, 'add-start')).toBeTruthy();
    click(action(parent, 'add-end'));
    await flush();
    expect(text()).toBe(`${SRC}\n    Done --> [*]`);
    click(stateEl(parent, 'Done')?.querySelector('rect'));
    await flush(1);
    // It has an end arrow now: no second one offered.
    expect(action(parent, 'add-end')).toBeFalsy();
    click(action(parent, 'add-note'));
    await flush();
    expect(text()).toBe(`${SRC}\n    Done --> [*]\n    note right of Done : Note`);
    // The new note's popover is open for typing.
    expect(popover(parent)?.querySelector<HTMLElement>('.mermaid-note-text')?.textContent).toBe('Note');
    click(stateEl(parent, 'Done')?.querySelector('rect'));
    await flush(1);
    click(action(parent, 'delete'));
    await flush();
    expect(text()).toBe(SRC.replace('\n    Running --> Done', ''));
  });

  it('connect mode: the next click on a state adds a transition; "Add new state" adds and connects one', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(stateEl(parent, 'Idle')?.querySelector('rect'));
    await flush(1);
    click(action(parent, 'connect'));
    await flush(1);
    expect(parent.querySelector('.mermaid-connect-banner:not([hidden])')?.textContent).toContain('Click a state');
    click(stateEl(parent, 'Done')?.querySelector('rect'));
    await flush();
    expect(text()).toBe(`${SRC}\n    Idle --> Done`);
    expect(parent.querySelector('.mermaid-connect-banner:not([hidden])')).toBeNull();
    click(stateEl(parent, 'Done')?.querySelector('rect'));
    await flush(1);
    click(action(parent, 'connect'));
    await flush(1);
    click(parent.querySelector('.mermaid-connect-banner .mermaid-connect-add-new'));
    await flush();
    expect(text()).toBe(`${SRC}\n    Idle --> Done\n    state "#32;" as S1\n    Done --> S1`);
    // The new state's popover is open to name it.
    expect(popover(parent)?.querySelector<HTMLElement>('.mermaid-state-name')).toBeTruthy();
  });
});

describe('MermaidNodeView state diagram: groups, transitions, notes, start / end', () => {
  it('a group renames, adds a state inside, and ungroups keeping its contents', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(parent.querySelector('[data-id="Running"] rect'));
    await flush(1);
    const field = popover(parent)?.querySelector<HTMLElement>('.mermaid-group-title');
    expect(field?.textContent).toBe('Running');
    expect(action(parent, 'delete-group')?.textContent).toMatch(/everything in it/);
    editRich(field!, 'Run phase');
    await flush();
    const renamed = SRC.replace('state Running {', 'state "Run phase" as Running {');
    expect(text()).toBe(renamed);
    click(parent.querySelector('[data-id="Running"] rect'));
    await flush(1);
    click(action(parent, 'ungroup'));
    await flush();
    // The group's own start arrow and everything connected to the group
    // go; Done keeps a line of its own (it was introduced by an arrow
    // from the group).
    expect(text()).toBe(
      ['stateDiagram-v2', '    %% keep me', '    [*] --> Idle', '        Loading', '        Loading --> Working', '    Done', '    note right of Idle : Waiting'].join('\n'),
    );
  });

  it('a transition edits its label and deletes', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(parent.querySelector('path.transition[data-id="edge1"]'));
    await flush(1);
    const field = popover(parent)?.querySelector<HTMLElement>('.mermaid-transition-label');
    expect(field?.textContent).toBe('start');
    expect(popover(parent)!.textContent).toContain('From Idle to Running');
    editRich(field!, 'go');
    await flush();
    expect(text()).toBe(SRC.replace(': start', ': go'));
    click(parent.querySelector('path.transition[data-id="edge1"]'));
    await flush(1);
    click(action(parent, 'delete'));
    await flush();
    // Running first appeared in that arrow: it keeps its place.
    expect(text()).toBe(SRC.replace('    Idle --> Running : start\n', '    Running\n'));
  });

  it('a note edits its text and side, and deletes', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(parent.querySelector('g.statediagram-note rect, g.statediagram-note path'));
    await flush(1);
    expect(popover(parent)?.querySelector<HTMLElement>('.mermaid-note-text')?.textContent).toBe('Waiting');
    click(popover(parent)!.querySelector('[data-field="side"] button[aria-label="Left"]'));
    await flush();
    expect(text()).toBe(SRC.replace('note right of Idle', 'note left of Idle'));
    click(parent.querySelector('g.statediagram-note rect, g.statediagram-note path'));
    await flush(1);
    editRich(popover(parent)!.querySelector<HTMLElement>('.mermaid-note-text')!, 'Two<br>lines');
    await flush();
    expect(text()).toBe(SRC.replace('    note right of Idle : Waiting', '    note left of Idle\n        Two\n        lines\n    end note'));
    click(parent.querySelector('g.statediagram-note rect, g.statediagram-note path'));
    await flush(1);
    click(action(parent, 'delete'));
    await flush();
    expect(text()).toBe(SRC.replace('\n    note right of Idle : Waiting', ''));
  });

  it('a start circle says "Start" and deletes its arrows', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(Array.from(parent.querySelectorAll('g.node')).find((g) => /-state-root_start-\d+$/.test(g.id)));
    await flush(1);
    expect(popover(parent)?.getAttribute('aria-label')).toBe('Start');
    click(action(parent, 'delete'));
    await flush();
    expect(text()).toBe(SRC.replace('    [*] --> Idle', '    Idle'));
  });
});

describe('MermaidNodeView state diagram: toolbar', () => {
  it('"+ State" adds a state and opens it; direction and title', async () => {
    const src = 'stateDiagram\n    A --> B';
    const { parent, text } = makeView(src);
    await flush();
    click(parent.querySelector('.mermaid-actions-bar [data-action="add-state"]'));
    await flush();
    expect(text()).toBe('stateDiagram\n    A --> B\n    state "#32;" as S1');
    expect(popover(parent)?.querySelector<HTMLElement>('.mermaid-state-name')).toBeTruthy();
    click(parent.querySelector('.mermaid-direction-picker button[aria-label="Left to right"]'));
    await flush();
    expect(text()).toBe('stateDiagram\n    direction LR\n    A --> B\n    state "#32;" as S1');
    click(parent.querySelector('.mermaid-actions-bar [data-action="title"]'));
    await flush(1);
    const input = parent.querySelector<HTMLInputElement>('.mermaid-form-popover .mermaid-title-input')!;
    input.value = 'Life';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(text()).toBe('---\ntitle: Life\n---\nstateDiagram\n    direction LR\n    A --> B\n    state "#32;" as S1');
  });

  it('an empty diagram offers "+ Add first state"', async () => {
    const { parent, text } = makeView('stateDiagram-v2');
    await flush();
    const button = parent.querySelector<HTMLElement>('.mermaid-empty-state');
    expect(button?.textContent).toContain('Add first state');
    click(button);
    await flush();
    expect(text()).toBe('stateDiagram-v2\n    state "#32;" as S1');
  });
});
