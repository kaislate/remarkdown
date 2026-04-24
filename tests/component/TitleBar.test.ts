import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

const minimize = vi.fn();
const toggleMaximize = vi.fn();
const close = vi.fn();
const startDragging = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize,
    toggleMaximize,
    close,
    startDragging,
  }),
}));

import TitleBar from '../../src/components/TitleBar.svelte';

beforeEach(() => {
  minimize.mockReset();
  toggleMaximize.mockReset();
  close.mockReset();
  startDragging.mockReset();
});

describe('TitleBar', () => {
  it('renders three window control buttons', () => {
    render(TitleBar);
    expect(screen.getByRole('button', { name: /minimize/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /maximize/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('marks the drag strip as a Tauri drag region', () => {
    const { container } = render(TitleBar);
    const strip = container.querySelector('.titlebar-drag') as HTMLElement;
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

  it('left-pointerdown on the drag strip calls startDragging()', () => {
    const { container } = render(TitleBar);
    const strip = container.querySelector('.titlebar-drag') as HTMLElement;
    const evt = new Event('pointerdown', { bubbles: true, cancelable: true }) as any;
    evt.button = 0;
    evt.pointerId = 1;
    strip.dispatchEvent(evt);
    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it('right-pointerdown on the drag strip does NOT call startDragging', () => {
    const { container } = render(TitleBar);
    const strip = container.querySelector('.titlebar-drag') as HTMLElement;
    const evt = new Event('pointerdown', { bubbles: true, cancelable: true }) as any;
    evt.button = 2;
    evt.pointerId = 1;
    strip.dispatchEvent(evt);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it('pointerdown on a control button does NOT start dragging (separate element from drag strip)', () => {
    render(TitleBar);
    const btn = screen.getByRole('button', { name: /close/i });
    const evt = new Event('pointerdown', { bubbles: true, cancelable: true }) as any;
    evt.button = 0;
    evt.pointerId = 1;
    btn.dispatchEvent(evt);
    expect(startDragging).not.toHaveBeenCalled();
  });

  it('swallows errors from the window API (e.g., running outside Tauri)', async () => {
    close.mockImplementation(() => { throw new Error('no ipc'); });
    const user = userEvent.setup();
    render(TitleBar);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(close).toHaveBeenCalled();
  });
});
