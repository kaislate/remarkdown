import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import ContextMenu from '../../src/components/ContextMenu.svelte';

function setup(extra: Partial<{ x: number; y: number }> = {}) {
  const a = vi.fn();
  const b = vi.fn();
  const c = vi.fn();
  const onclose = vi.fn();
  render(ContextMenu, {
    x: extra.x ?? 100,
    y: extra.y ?? 80,
    label: 'Recent file actions',
    items: [
      { label: 'Open in new tab', hint: 'Middle-click', onSelect: a },
      { label: 'Open in new window', onSelect: b, disabled: true },
      'separator',
      { label: 'Remove from list', onSelect: c, danger: true },
    ],
    onclose,
  });
  return { a, b, c, onclose };
}

describe('ContextMenu', () => {
  it('renders items as a menu with hints and a separator', () => {
    setup();
    expect(screen.getByRole('menu', { name: 'Recent file actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent?.replace(/\s+/g, ' ').trim()))
      .toEqual(['Open in new tab Middle-click', 'Open in new window', 'Remove from list']);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('clicking an item runs it and closes the menu', async () => {
    const { a, onclose } = setup();
    await fireEvent.click(screen.getByRole('menuitem', { name: /new tab/ }));
    expect(a).toHaveBeenCalled();
    expect(onclose).toHaveBeenCalled();
  });

  it('disabled items do nothing', async () => {
    const { b, onclose } = setup();
    await fireEvent.click(screen.getByRole('menuitem', { name: /new window/ }));
    expect(b).not.toHaveBeenCalled();
    expect(onclose).not.toHaveBeenCalled();
  });

  it('keyboard: focus starts on the first item, arrows skip disabled items, Enter runs', async () => {
    const { c } = setup();
    await tick();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /new tab/ }));
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /Remove/ }));
    await fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(c).toHaveBeenCalled();
  });

  it('Escape and outside clicks close it', async () => {
    const { onclose } = setup();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(1);
    await fireEvent.pointerDown(document.body);
    expect(onclose).toHaveBeenCalledTimes(2);
  });

  it('stays inside the window near the right/bottom edge', async () => {
    // jsdom has no layout: give the menu a real-looking size.
    const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    const h = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 220 });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 150 });
    try {
      setup({ x: window.innerWidth - 5, y: window.innerHeight - 5 });
      await tick();
      const menu = screen.getByRole('menu');
      expect(parseFloat(menu.style.left) + 220).toBeLessThanOrEqual(window.innerWidth);
      expect(parseFloat(menu.style.top) + 150).toBeLessThanOrEqual(window.innerHeight);
    } finally {
      if (w) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', w);
      if (h) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', h);
    }
  });
});
