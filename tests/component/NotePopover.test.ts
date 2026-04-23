import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import NotePopover from '../../src/components/NotePopover.svelte';

describe('NotePopover', () => {
  it('renders current body in the textarea', () => {
    render(NotePopover, { props: { body: 'current note body', onUpdate: () => {}, onDelete: () => {} } });
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('current note body');
  });

  it('calls onUpdate as the user types', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(NotePopover, { props: { body: '', onUpdate, onDelete: () => {} } });
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hi');
    expect(onUpdate).toHaveBeenCalled();
    const lastCall = onUpdate.mock.calls.at(-1)?.[0];
    expect(lastCall).toBe('hi');
  });

  it('calls onDelete when Delete button is clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(NotePopover, { props: { body: 'to go', onUpdate: () => {}, onDelete } });
    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalled();
  });
});
