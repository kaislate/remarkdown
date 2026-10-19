import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import EditorToolbar from '../../src/components/EditorToolbar.svelte';

describe('EditorToolbar', () => {
  it('renders the toolbar container', () => {
    const { container } = render(EditorToolbar, {
      props: { onInsert: () => {} },
    });
    expect(container.querySelector('.editor-toolbar')).not.toBeNull();
  });

  it('has an insert-callout button', () => {
    const { container } = render(EditorToolbar, {
      props: { onInsert: () => {} },
    });
    const btn = container.querySelector('.toolbar-btn[data-action="insert-callout"]');
    expect(btn).not.toBeNull();
  });

  it('clicking insert-callout fires onInsert with the callout action', async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    const { container } = render(EditorToolbar, { props: { onInsert } });
    const btn = container.querySelector('.toolbar-btn[data-action="insert-callout"]') as HTMLButtonElement;
    await user.click(btn);
    expect(onInsert).toHaveBeenCalledWith('callout');
    cleanup();
  });

  it('has a code button', () => {
    const { container } = render(EditorToolbar, {
      props: { onInsert: () => {} },
    });
    const btn = container.querySelector('.toolbar-btn[data-action="code"]');
    expect(btn).not.toBeNull();
  });

  it('clicking code fires onInsert with the code action', async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    const { container } = render(EditorToolbar, { props: { onInsert } });
    const btn = container.querySelector('.toolbar-btn[data-action="code"]') as HTMLButtonElement;
    await user.click(btn);
    expect(onInsert).toHaveBeenCalledWith('code');
    cleanup();
  });

  it('has a tasks button', () => {
    const { container } = render(EditorToolbar, {
      props: { onInsert: () => {} },
    });
    const btn = container.querySelector('.toolbar-btn[data-action="tasks"]');
    expect(btn).not.toBeNull();
  });

  it('clicking tasks fires onInsert with the tasks action', async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    const { container } = render(EditorToolbar, { props: { onInsert } });
    const btn = container.querySelector('.toolbar-btn[data-action="tasks"]') as HTMLButtonElement;
    await user.click(btn);
    expect(onInsert).toHaveBeenCalledWith('tasks');
    cleanup();
  });

  it('has a table button', () => {
    const { container } = render(EditorToolbar, {
      props: { onInsert: () => {} },
    });
    const btn = container.querySelector('.toolbar-btn[data-action="table"]');
    expect(btn).not.toBeNull();
  });

  it('clicking table fires onInsert with the table action', async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    const { container } = render(EditorToolbar, { props: { onInsert } });
    const btn = container.querySelector('.toolbar-btn[data-action="table"]') as HTMLButtonElement;
    await user.click(btn);
    expect(onInsert).toHaveBeenCalledWith('table');
    cleanup();
  });

  it('renders the diagram dropdown with Flowchart and Sequence options', () => {
    const { container } = render(EditorToolbar, {
      props: { onInsert: () => {} },
    });
    expect(container.querySelector('[data-action="diagram-menu"]')).not.toBeNull();
    expect(container.querySelector('[data-action="flowchart"]')).not.toBeNull();
    expect(container.querySelector('[data-action="sequence"]')).not.toBeNull();
  });

  it('clicking Flowchart fires onInsert("mermaid")', async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    const { container } = render(EditorToolbar, { props: { onInsert } });
    const btn = container.querySelector('[data-action="flowchart"]') as HTMLButtonElement;
    await user.click(btn);
    expect(onInsert).toHaveBeenCalledWith('mermaid');
    cleanup();
  });

  it('offers every editable diagram kind as a pictured tile, never syntax', async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    const { container } = render(EditorToolbar, { props: { onInsert } });
    const tiles = Array.from(container.querySelectorAll<HTMLButtonElement>('.toolbar-diagram-tile'));
    expect(tiles.map((t) => t.textContent?.trim())).toEqual([
      'Flowchart', 'Sequence', 'Pie chart', 'Timeline', 'Gantt chart', 'States', 'Classes', 'Database (ER)', 'Mind map', 'Board (kanban)',
    ]);
    for (const t of tiles) expect(t.querySelector('svg'), t.textContent ?? '').not.toBeNull();
    expect(container.querySelector('.toolbar-dropdown-menu')!.textContent).not.toMatch(/-->|\[\*\]|%%|erDiagram/);
    await user.click(container.querySelector('[data-action="diagram-gantt"]') as HTMLButtonElement);
    expect(onInsert).toHaveBeenCalledWith('diagram', 'gantt');
    cleanup();
  });

  it('clicking Sequence fires onInsert("sequence")', async () => {
    const onInsert = vi.fn();
    const user = userEvent.setup();
    const { container } = render(EditorToolbar, { props: { onInsert } });
    const btn = container.querySelector('[data-action="sequence"]') as HTMLButtonElement;
    await user.click(btn);
    expect(onInsert).toHaveBeenCalledWith('sequence');
    cleanup();
  });
});
