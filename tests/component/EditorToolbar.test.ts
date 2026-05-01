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
});
