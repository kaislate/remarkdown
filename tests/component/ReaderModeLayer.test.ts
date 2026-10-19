import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

const startDragging = vi.fn(async () => {});
const toggleMaximize = vi.fn(async () => {});
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging, toggleMaximize }),
}));

import ReaderModeLayer, { HINT_MS } from '../../src/components/ReaderModeLayer.svelte';
import { readerMode } from '../../src/stores/reader-mode';
import { createSession, sessions, activeSession } from '../../src/stores/sessions';
import { get } from 'svelte/store';

// jsdom's PointerEvent drops clientX/Y; build a plain event instead.
function pointer(type: string, clientX: number, clientY: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true }) as any;
  Object.assign(e, { button: 0, pointerId: 1, clientX, clientY });
  return e;
}

const hint = () => document.querySelector('.reader-hint');
const band = () => document.querySelector<HTMLElement>('.reader-drag-band');

beforeEach(() => {
  vi.useFakeTimers();
  startDragging.mockClear();
  toggleMaximize.mockClear();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReaderModeLayer — entry hint', () => {
  it('shows nothing outside reader mode', () => {
    render(ReaderModeLayer);
    expect(hint()).toBeNull();
    expect(band()).toBeNull();
  });

  it('says how to leave, for about 2.5 seconds after entering', async () => {
    expect(HINT_MS).toBe(2500);
    render(ReaderModeLayer);
    readerMode.set(true);
    await tick();
    expect(hint()?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Press Esc to leave reader mode');
    vi.advanceTimersByTime(HINT_MS - 100);
    await tick();
    expect(hint()).not.toBeNull();
    vi.advanceTimersByTime(200);
    await tick();
    expect(hint()).toBeNull();
  });

  it('shows again on each new entry, and goes at once on leaving', async () => {
    render(ReaderModeLayer);
    readerMode.set(true);
    await tick();
    vi.advanceTimersByTime(HINT_MS + 10);
    await tick();
    expect(hint()).toBeNull();
    readerMode.set(false);
    readerMode.set(true);
    await tick();
    expect(hint()).not.toBeNull();
    readerMode.set(false);
    await tick();
    expect(hint()).toBeNull();
  });

  it('shows when switching to a tab that is in reader mode', async () => {
    render(ReaderModeLayer);
    const a = get(activeSession);
    const b = createSession();
    b.readerMode.set(true);
    sessions.set([a, b]);
    activeSession.set(b);
    await tick();
    expect(hint()).not.toBeNull();
  });

  it('is announced politely, not as a dialog Esc would close first', async () => {
    render(ReaderModeLayer);
    readerMode.set(true);
    await tick();
    expect(hint()?.getAttribute('role')).toBe('status');
  });
});

describe('ReaderModeLayer — window drag band', () => {
  it('spans the top of the window while reading', async () => {
    render(ReaderModeLayer);
    readerMode.set(true);
    await tick();
    expect(band()).not.toBeNull();
    expect(band()!.hasAttribute('data-tauri-drag-region')).toBe(true);
  });

  it('drags the window once the pointer moves; a click does not', async () => {
    render(ReaderModeLayer);
    readerMode.set(true);
    await tick();
    const el = band()!;
    el.dispatchEvent(pointer('pointerdown', 100, 10));
    el.dispatchEvent(pointer('pointerup', 100, 10));
    await vi.runAllTimersAsync();
    expect(startDragging).not.toHaveBeenCalled();
    el.dispatchEvent(pointer('pointerdown', 100, 10));
    el.dispatchEvent(pointer('pointermove', 140, 12));
    await vi.runAllTimersAsync();
    expect(startDragging).toHaveBeenCalledTimes(1);
  });

  it('double-click maximizes, like the title bar', async () => {
    render(ReaderModeLayer);
    readerMode.set(true);
    await tick();
    await fireEvent.dblClick(band()!);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it('clicking the band does not leave reader mode', async () => {
    render(ReaderModeLayer);
    readerMode.set(true);
    await tick();
    await fireEvent.click(band()!);
    expect(get(readerMode)).toBe(true);
  });
});
