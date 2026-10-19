// Sequence popovers beyond messages and notes, through the real NodeView
// + real mermaid renders (jsdom geometry stubbed): blocks, boxes,
// actors, activations, numbering, title — and that clicks find the right
// message when blocks and activations shift mermaid's own numbering.
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
  const named = new Set(['purple', 'transparent']);
  (window.CSS as unknown as Record<string, unknown>).supports = (_p: string, v: string) =>
    /^(rgba?|hsla?)\(/i.test(v) || /^#[0-9a-f]{3,8}$/i.test(v) || named.has(String(v).toLowerCase());
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

function click(el: Element | null | undefined, init: MouseEventInit = {}): void {
  expect(el, 'element to click').toBeTruthy();
  el!.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
}

function select(el: HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const SRC = [
  'sequenceDiagram',
  '    autonumber',
  '    participant C as Client',
  '    participant S as Server',
  '    C->>+S: Ask',
  '    alt ok',
  '        S-->>C: Yes',
  '    else not ok',
  '        S-->>C: No',
  '    end',
  '    S-->>-C: Bye',
].join('\n');

describe('MermaidNodeView sequence: numbering past blocks and activations', () => {
  it('a click on a message after a block and an activation edits that message', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    // mermaid numbers: 0 autonumber, 1 Ask, 2 activation, 3 alt, 4 Yes,
    // 5 else, 6 No, 7 end, 8 Bye.
    click(parent.querySelector('[data-et="message"][data-id="i8"]'));
    await flush(1);
    const input = parent.querySelector<HTMLInputElement>('.mermaid-message-popover-text')!;
    expect(input.value).toBe('Bye');
    input.value = 'Goodbye';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(text()).toBe(SRC.replace('S-->>-C: Bye', 'S-->>-C: Goodbye'));
  });
});

describe('MermaidNodeView sequence: blocks', () => {
  it('clicking a block frame opens it: label, branches, removal keeping messages', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(parent.querySelector('g[data-et="control-structure"][data-id="i7"] line'));
    await flush(1);
    const label = parent.querySelector<HTMLInputElement>('.mermaid-form-popover .mermaid-block-label')!;
    expect(label.value).toBe('ok');
    label.value = 'accepted';
    label.dispatchEvent(new Event('input', { bubbles: true }));
    label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(text()).toBe(SRC.replace('alt ok', 'alt accepted'));
    click(parent.querySelector('g[data-et="control-structure"][data-id="i7"] line'));
    await flush(1);
    click(parent.querySelector('.mermaid-form-popover [data-action="remove-block"]'));
    await flush();
    expect(text()).toBe(SRC.replace('alt ok', 'alt accepted').replace('    alt accepted\n', '').replace('    else not ok\n', '').replace('    end\n', ''));
  });

  it('shift-click selects a run of messages; "Put in a block" wraps them', async () => {
    const src = 'sequenceDiagram\n    A->>B: one\n    B->>A: two\n    A->>B: three';
    const { parent, text } = makeView(src);
    await flush();
    click(parent.querySelector('[data-et="message"][data-id="i0"]'));
    await flush(1);
    click(parent.querySelector('[data-et="message"][data-id="i1"]'), { shiftKey: true });
    await flush(1);
    expect(parent.querySelectorAll('[data-et="message"].sequence-selected').length).toBe(2);
    select(parent.querySelector<HTMLSelectElement>('.mermaid-message-popover select[aria-label="Put in a block"]')!, 'loop');
    await flush();
    expect(text()).toBe('sequenceDiagram\n    loop\n    A->>B: one\n    B->>A: two\n    end\n    A->>B: three');
    // The new block's popover opens, ready for its label.
    expect(parent.querySelector('.mermaid-form-popover')?.hasAttribute('hidden')).toBe(false);
  });
});

describe('MermaidNodeView sequence: participants, activations, toolbar', () => {
  it('a participant can be drawn as a person', async () => {
    const { parent, text } = makeView(SRC);
    await flush();
    click(parent.querySelector('g[data-et="participant"][data-id="C"]'));
    await flush(1);
    click(parent.querySelector('.mermaid-participant-popover button[aria-label="Person"]'));
    await flush();
    expect(text()).toBe(SRC.replace('participant C as Client', 'actor C as Client'));
  });

  it('the activity-bar choice adds an activation mark; every arrow kind is offered', async () => {
    const src = 'sequenceDiagram\n    A->>B: work\n    B-->>A: done';
    const { parent, text } = makeView(src);
    await flush();
    click(parent.querySelector('[data-et="message"][data-id="i0"]'));
    await flush(1);
    expect(parent.querySelectorAll('.mermaid-message-popover [role="radiogroup"][aria-label="Arrow"] button').length).toBe(10);
    // Nothing to end yet for B: "Sender stops working" is offered only
    // once the sender is working.
    const act = parent.querySelector<HTMLSelectElement>('.mermaid-message-popover select[aria-label="Activity bar"]')!;
    expect(act.querySelector<HTMLOptionElement>('option[value="deactivate"]')!.disabled).toBe(true);
    select(act, 'activate');
    await flush();
    expect(text()).toBe('sequenceDiagram\n    A->>+B: work\n    B-->>A: done');
    click(parent.querySelector('[data-et="message"][data-id="i2"]'));
    await flush(1);
    click(parent.querySelector('.mermaid-message-popover button[aria-label="Solid, crossed end (lost / cancelled)"]'));
    await flush();
    expect(text()).toBe('sequenceDiagram\n    A->>+B: work\n    B-xA: done');
  });

  it('toolbar: numbering on / off and a title', async () => {
    const src = 'sequenceDiagram\n    A->>B: hi';
    const { parent, text } = makeView(src);
    await flush();
    click(parent.querySelector('.mermaid-actions-bar [data-action="numbered"]'));
    await flush();
    expect(text()).toBe('sequenceDiagram\n    autonumber\n    A->>B: hi');
    expect(parent.querySelector('.mermaid-actions-bar [data-action="numbered"]')?.getAttribute('aria-pressed')).toBe('true');
    click(parent.querySelector('.mermaid-actions-bar [data-action="title"]'));
    await flush(1);
    const input = parent.querySelector<HTMLInputElement>('.mermaid-form-popover .mermaid-title-input')!;
    input.value = 'Greeting';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(text()).toBe('sequenceDiagram\n    title Greeting\n    autonumber\n    A->>B: hi');
  });

  it('a group box is renamed and recoloured from its popover', async () => {
    const src = 'sequenceDiagram\n    box Purple Front\n    participant A\n    end\n    A->>B: hi';
    const { parent, text } = makeView(src);
    await flush();
    click(parent.querySelector('g[data-et="participant"][data-id="A"]'));
    await flush(1);
    click(parent.querySelector('.mermaid-participant-popover button[aria-label="Edit group box"]'));
    await flush(1);
    const name = parent.querySelector<HTMLInputElement>('.mermaid-form-popover .mermaid-box-label')!;
    expect(name.value).toBe('Front');
    name.value = 'Client side';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(text()).toBe(src.replace('box Purple Front', 'box Purple Client side'));
  });
});
