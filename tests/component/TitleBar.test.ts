import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

const minimize = vi.fn();
const toggleMaximize = vi.fn();
const close = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize,
    toggleMaximize,
    close,
  }),
}));

import TitleBar from '../../src/components/TitleBar.svelte';

beforeEach(() => {
  minimize.mockReset();
  toggleMaximize.mockReset();
  close.mockReset();
});

describe('TitleBar', () => {
  it('renders three window control buttons', () => {
    render(TitleBar);
    expect(screen.getByRole('button', { name: /minimize/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('marks the strip as a Tauri drag region', () => {
    const { container } = render(TitleBar);
    const strip = container.querySelector('.titlebar') as HTMLElement;
    expect(strip).not.toBeNull();
    expect(strip.hasAttribute('data-tauri-drag-region')).toBe(true);
  });

  it('clicking minimize calls getCurrentWindow().minimize()', async () => {
    const user = userEvent.setup();
    render(TitleBar);
    await user.click(screen.getByRole('button', { name: /minimize/i }));
    expect(minimize).toHaveBeenCalledTimes(1);
  });

  it('clicking maximize calls toggleMaximize', async () => {
    const user = userEvent.setup();
    render(TitleBar);
    await user.click(screen.getByRole('button', { name: /maximize/i }));
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it('clicking close calls close', async () => {
    const user = userEvent.setup();
    render(TitleBar);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('swallows errors from the window API (e.g. when running outside Tauri)', async () => {
    close.mockImplementation(() => { throw new Error('no ipc'); });
    const user = userEvent.setup();
    render(TitleBar);
    // Should not throw or bubble.
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(close).toHaveBeenCalled();
  });
});
