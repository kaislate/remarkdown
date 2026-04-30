import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import EditModeToggle from '../../src/components/EditModeToggle.svelte';
import { editMode, exitEditMode } from '../../src/stores/edit-mode';

describe('EditModeToggle', () => {
  beforeEach(() => { exitEditMode(); cleanup(); });

  it('renders a button with edit-mode-toggle class', () => {
    const { container } = render(EditModeToggle);
    const btn = container.querySelector('.edit-mode-toggle');
    expect(btn).not.toBeNull();
    expect(btn?.tagName).toBe('BUTTON');
  });

  it('clicking flips the editMode store', async () => {
    const user = userEvent.setup();
    const { container } = render(EditModeToggle);
    expect(get(editMode)).toBe(false);
    const btn = container.querySelector('.edit-mode-toggle') as HTMLButtonElement;
    await user.click(btn);
    expect(get(editMode)).toBe(true);
    await user.click(btn);
    expect(get(editMode)).toBe(false);
  });

  it('reflects active state via aria-pressed', async () => {
    const user = userEvent.setup();
    const { container } = render(EditModeToggle);
    const btn = container.querySelector('.edit-mode-toggle') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    await user.click(btn);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });
});
