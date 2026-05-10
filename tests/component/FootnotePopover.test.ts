import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { writable } from 'svelte/store';
import FootnotePopover from '../../src/components/FootnotePopover.svelte';

function makeStore(open = true, label = '1', body = 'A body.') {
  return writable({ open, label, body, x: 100, y: 100 });
}

describe('FootnotePopover', () => {
  it('renders nothing when open=false', () => {
    const stateStore = makeStore(false);
    const { container } = render(FootnotePopover, {
      props: { stateStore, onSave: () => {}, onDelete: () => {} },
    });
    expect(container.querySelector('.footnote-popover')).toBeNull();
  });

  it('renders label + body inputs when open', () => {
    const stateStore = makeStore(true);
    const { container } = render(FootnotePopover, {
      props: { stateStore, onSave: () => {}, onDelete: () => {} },
    });
    expect(container.querySelector('input[data-field="label"]')).not.toBeNull();
    expect(container.querySelector('textarea[data-field="body"]')).not.toBeNull();
    expect(container.querySelector('button[data-action="delete"]')).not.toBeNull();
  });

  it('seeds inputs with the store values', () => {
    const stateStore = makeStore(true, 'note', 'Hello world.');
    const { container } = render(FootnotePopover, {
      props: { stateStore, onSave: () => {}, onDelete: () => {} },
    });
    const labelInput = container.querySelector<HTMLInputElement>('input[data-field="label"]')!;
    const bodyInput = container.querySelector<HTMLTextAreaElement>('textarea[data-field="body"]')!;
    expect(labelInput.value).toBe('note');
    expect(bodyInput.value).toBe('Hello world.');
  });

  it('calls onSave with edited label + body when save fires', async () => {
    const stateStore = makeStore(true, '1', 'old');
    const onSave = vi.fn();
    const user = userEvent.setup();
    const { container } = render(FootnotePopover, {
      props: { stateStore, onSave, onDelete: () => {} },
    });
    const labelInput = container.querySelector<HTMLInputElement>('input[data-field="label"]')!;
    const bodyInput = container.querySelector<HTMLTextAreaElement>('textarea[data-field="body"]')!;
    await user.clear(labelInput);
    await user.type(labelInput, 'newlabel');
    await user.clear(bodyInput);
    await user.type(bodyInput, 'new body');
    const saveBtn = container.querySelector<HTMLButtonElement>('button[data-action="save"]')!;
    await user.click(saveBtn);
    expect(onSave).toHaveBeenCalledWith({ label: 'newlabel', body: 'new body' });
    cleanup();
  });

  it('calls onDelete when delete button clicked', async () => {
    const stateStore = makeStore();
    const onDelete = vi.fn();
    const user = userEvent.setup();
    const { container } = render(FootnotePopover, {
      props: { stateStore, onSave: () => {}, onDelete },
    });
    const del = container.querySelector<HTMLButtonElement>('button[data-action="delete"]')!;
    await user.click(del);
    expect(onDelete).toHaveBeenCalled();
    cleanup();
  });
});
