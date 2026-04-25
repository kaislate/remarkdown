import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

const minimize = vi.fn();
const toggleMaximize = vi.fn();
const close = vi.fn();
const startDragging = vi.fn();
const startResizeDragging = vi.fn();
const setSize = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize,
    toggleMaximize,
    close,
    startDragging,
    startResizeDragging,
    setSize,
  }),
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
}));

import TitleBar from '../../src/components/TitleBar.svelte';

beforeEach(() => {
  minimize.mockReset();
  toggleMaximize.mockReset();
  close.mockReset();
  startDragging.mockReset();
  startResizeDragging.mockReset();
  setSize.mockReset();
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

  // Helper to construct a pointer event that satisfies the production
  // handler's contract (button, pointerId, clientX/Y) without relying on
  // jsdom's PointerEvent constructor (which doesn't initialise these).
  function pointerEvt(
    type: string,
    { button = 0, pointerId = 1, clientX = 0, clientY = 0 } = {},
  ) {
    const e = new Event(type, { bubbles: true, cancelable: true }) as any;
    e.button = button;
    e.pointerId = pointerId;
    e.clientX = clientX;
    e.clientY = clientY;
    return e as PointerEvent;
  }

  it('left-pointerdown + drag past threshold on the drag strip calls startDragging()', async () => {
    const { container } = render(TitleBar);
    const strip = container.querySelector('.titlebar-drag') as HTMLElement;
    // pointerdown alone is no longer enough — the production handler
    // waits for movement so a click+release lets dblclick fire normally.
    strip.dispatchEvent(pointerEvt('pointerdown', { clientX: 100, clientY: 10 }));
    expect(startDragging).not.toHaveBeenCalled();
    // Move past the 4px threshold (squared distance > 16) to arm the drag.
    strip.dispatchEvent(pointerEvt('pointermove', { clientX: 110, clientY: 10 }));
    // The handler dispatches startDragging via Promise.resolve().then(...) —
    // wait one microtask tick so the call lands.
    await Promise.resolve();
    await Promise.resolve();
    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it('left-pointerdown WITHOUT moving does NOT call startDragging (so dblclick can fire)', async () => {
    const { container } = render(TitleBar);
    const strip = container.querySelector('.titlebar-drag') as HTMLElement;
    strip.dispatchEvent(pointerEvt('pointerdown', { clientX: 100, clientY: 10 }));
    strip.dispatchEvent(pointerEvt('pointerup',   { clientX: 100, clientY: 10 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(startDragging).not.toHaveBeenCalled();
  });

  it('dblclick on the drag strip toggles maximize', async () => {
    const { container } = render(TitleBar);
    const strip = container.querySelector('.titlebar-drag') as HTMLElement;
    strip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it('right-pointerdown on the drag strip does NOT arm the drag', async () => {
    const { container } = render(TitleBar);
    const strip = container.querySelector('.titlebar-drag') as HTMLElement;
    strip.dispatchEvent(pointerEvt('pointerdown', { button: 2, clientX: 100, clientY: 10 }));
    strip.dispatchEvent(pointerEvt('pointermove',                { clientX: 200, clientY: 10 }));
    await Promise.resolve();
    expect(startDragging).not.toHaveBeenCalled();
  });

  it('pointerdown on a control button does NOT start dragging (separate element from drag strip)', async () => {
    render(TitleBar);
    const btn = screen.getByRole('button', { name: /close/i });
    btn.dispatchEvent(pointerEvt('pointerdown', { clientX: 100, clientY: 10 }));
    btn.dispatchEvent(pointerEvt('pointermove', { clientX: 200, clientY: 10 }));
    await Promise.resolve();
    expect(startDragging).not.toHaveBeenCalled();
  });

  it('drag past threshold on the resize grip calls startResizeDragging("SouthEast")', async () => {
    const { container } = render(TitleBar);
    const grip = container.querySelector('.resize-grip') as HTMLElement;
    grip.dispatchEvent(pointerEvt('pointerdown', { clientX: 500, clientY: 500 }));
    grip.dispatchEvent(pointerEvt('pointermove', { clientX: 510, clientY: 510 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(startResizeDragging).toHaveBeenCalledTimes(1);
    expect(startResizeDragging).toHaveBeenCalledWith('SouthEast');
  });

  it('dblclick on the resize grip resets the window to 1100x780', async () => {
    const { container } = render(TitleBar);
    const grip = container.querySelector('.resize-grip') as HTMLElement;
    grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(setSize).toHaveBeenCalledTimes(1);
    const arg = setSize.mock.calls[0][0];
    expect(arg.width).toBe(1100);
    expect(arg.height).toBe(780);
  });

  it('swallows errors from the window API (e.g., running outside Tauri)', async () => {
    close.mockImplementation(() => { throw new Error('no ipc'); });
    const user = userEvent.setup();
    render(TitleBar);
    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(close).toHaveBeenCalled();
  });
});
