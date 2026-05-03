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
});
