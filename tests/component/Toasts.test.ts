// tests/component/Toasts.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { get } from 'svelte/store';
import Toasts from '../../src/components/Toasts.svelte';
import { toasts, clearToasts, addToast } from '../../src/stores/toasts';

beforeEach(() => { clearToasts(); });

describe('Toasts', () => {
  it('renders no toasts initially', () => {
    const { container } = render(Toasts);
    expect(container.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('renders one toast per entry in the store', () => {
    render(Toasts);
    flushSync(() => {
      addToast({ kind: 'info', message: 'first' });
      addToast({ kind: 'warning', message: 'second' });
    });
    const entries = document.querySelectorAll('.toast');
    expect(entries).toHaveLength(2);
  });

  it('applies the kind as a CSS class', () => {
    render(Toasts);
    flushSync(() => addToast({ kind: 'error', message: 'x' }));
    const toast = document.querySelector('.toast') as HTMLElement;
    expect(toast.classList.contains('error')).toBe(true);
  });

  it('clicking the dismiss button removes the toast', async () => {
    render(Toasts);
    flushSync(() => addToast({ kind: 'error', message: 'x' }));
    const user = userEvent.setup();
    const btn = document.querySelector('.toast .dismiss') as HTMLButtonElement;
    await user.click(btn);
    expect(get(toasts)).toHaveLength(0);
  });
});
