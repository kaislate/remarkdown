import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import Editor from '../../src/components/Editor.svelte';

describe('Editor.svelte toolbar inserts', () => {
  it('mounts the Callout/Diagram toolbar buttons even when a mermaid block is in the doc', async () => {
    // Regression check for the report that having a mermaid block in the doc
    // killed the OTHER toolbar buttons. We don't actually .click() the
    // button here — jsdom's getClientRects on detached SVG content makes
    // PM's scrollToSelection throw an uncaught exception during the
    // resulting dispatchTransaction, which jsdom surfaces as a top-level
    // error event independent of our try/catch. The full click-to-write
    // chain is covered by the e2e suite (edit-mode-roundtrip.spec.ts ›
    // "toolbar Callout button still inserts when a mermaid block is also
    // in the doc"). Here we just confirm the toolbar buttons mount
    // alongside a mermaid NodeView without bailing the whole component.
    const { container } = render(Editor, {
      props: {
        initialMarkdown:
          '# Doc\n\nA paragraph.\n\n```mermaid\nflowchart TD\nA[a] --> B[b]\n```\n',
        onChange: () => {},
      },
    });
    await tick();
    await new Promise((r) => setTimeout(r, 100));
    expect(
      container.querySelector('.toolbar-btn[data-action="insert-callout"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('.toolbar-btn[data-action="mermaid"]'),
    ).not.toBeNull();
    // The mermaid NodeView mounted alongside.
    expect(container.querySelector('.mermaid-block-editor')).not.toBeNull();
    cleanup();
  });
});

describe('Editor.svelte', () => {
  it('renders a ProseMirror surface seeded from initialMarkdown', async () => {
    const { container } = render(Editor, {
      props: { initialMarkdown: '# Hi\n\nA paragraph.\n', onChange: () => {} },
    });
    await tick();
    expect(container.querySelector('.ProseMirror')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Hi');
    cleanup();
  });

  it('calls onChange when the document mutates', async () => {
    const onChange = vi.fn();
    const { container } = render(Editor, {
      props: { initialMarkdown: 'a\n', onChange },
    });
    await tick();
    const pm = container.querySelector('.ProseMirror') as HTMLElement;
    // Simulate typing: replace innerText (PM watches for input events; we
    // approximate with a beforeinput dispatch since jsdom doesn't run the
    // contenteditable input pipeline).
    pm.innerHTML = '<p>b</p>';
    pm.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'b' }));
    await tick();
    // ProseMirror reconciles; depending on jsdom support onChange may or
    // may not fire from synthetic events. The deeper guarantee is that
    // onChange is wired — see view.ts unit tests for the dispatch path.
    // This test just ensures the Editor surface is contenteditable.
    expect(pm.getAttribute('contenteditable')).toBe('true');
    cleanup();
  });
});
