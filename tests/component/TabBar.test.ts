import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';

vi.mock('../../src/stores/tabs', async () => {
  const actual = await vi.importActual<typeof import('../../src/stores/tabs')>('../../src/stores/tabs');
  return {
    ...actual,
    activateSession: vi.fn(async () => {}),
    closeSession: vi.fn(async () => {}),
    cycleSession: vi.fn(async () => {}),
    closeOtherSessions: vi.fn(async () => {}),
    closeSessionsAfter: vi.fn(async () => {}),
  };
});
vi.mock('../../src/lib/open-files', () => ({ openViaDialog: vi.fn(async () => {}) }));
vi.mock('../../src/lib/tauri-api', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/tauri-api')>('../../src/lib/tauri-api');
  return { ...actual, revealInFolder: vi.fn(async () => {}) };
});

import { get } from 'svelte/store';
import { viewerScroll } from '../../src/stores/viewport';
import TabBar from '../../src/components/TabBar.svelte';
import { activateSession, closeSession, cycleSession, closeOtherSessions, closeSessionsAfter } from '../../src/stores/tabs';
import { revealInFolder } from '../../src/lib/tauri-api';
import { settings } from '../../src/stores/settings';
import { openViaDialog } from '../../src/lib/open-files';
import { createSession, sessions, activeSession, type DocSession } from '../../src/stores/sessions';
import { updateSettings, resetSettings } from '../../src/stores/settings';
import { openModal, closeModal } from '../../src/stores/modals';
import { toasts, clearToasts } from '../../src/stores/toasts';

function withDoc(path: string): DocSession {
  const s = createSession();
  s.doc.set({ path, dir: '/', sha256: path, bytes: 1, markdown: '', html: '', plaintext: '', blocks: [], sidecarRaw: null });
  return s;
}

function twoTabs() {
  const a = withDoc('C:\\x\\Alpha.md');
  const b = withDoc('/x/beta.markdown');
  sessions.set([a, b]);
  activeSession.set(a);
  return { a, b };
}

describe('TabBar', () => {
  beforeEach(() => {
    resetSettings();
    vi.mocked(activateSession).mockClear();
    vi.mocked(closeSession).mockClear();
    vi.mocked(cycleSession).mockClear();
    vi.mocked(openViaDialog).mockClear();
  });

  it('labels tabs by file name without the markdown extension, full path as tooltip', () => {
    twoTabs();
    render(TabBar);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.querySelector('.label')?.textContent)).toEqual(['Alpha', 'beta']);
    expect(tabs[0].getAttribute('title')).toBe('C:\\x\\Alpha.md');
    expect(tabs[1].getAttribute('title')).toBe('/x/beta.markdown');
  });

  it('marks the active tab selected', () => {
    twoTabs();
    render(TabBar);
    const [first, second] = screen.getAllByRole('tab');
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(second.getAttribute('aria-selected')).toBe('false');
  });

  it('clicking a tab activates it', async () => {
    const { b } = twoTabs();
    render(TabBar);
    await userEvent.setup().click(screen.getAllByRole('tab')[1]);
    expect(activateSession).toHaveBeenCalledWith(b.id);
  });

  it('the close button closes that tab without activating it', async () => {
    const { b } = twoTabs();
    render(TabBar);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close beta' }));
    expect(closeSession).toHaveBeenCalledWith(b.id);
    expect(activateSession).not.toHaveBeenCalled();
  });

  it('middle-click closes a tab', async () => {
    const { a } = twoTabs();
    render(TabBar);
    await fireEvent(screen.getAllByRole('tab')[0], new MouseEvent('auxclick', { button: 1, bubbles: true }));
    expect(closeSession).toHaveBeenCalledWith(a.id);
  });

  it('the + button opens a file', async () => {
    twoTabs();
    render(TabBar);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open a file in a new tab' }));
    expect(openViaDialog).toHaveBeenCalled();
  });

  it('is hidden in replace mode with a single document', () => {
    updateSettings({ openMode: 'replace' });
    const a = withDoc('/a.md');
    sessions.set([a]);
    activeSession.set(a);
    render(TabBar);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('is hidden in tabs mode while nothing is open', () => {
    render(TabBar);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('is shown in tabs mode with one document', () => {
    const a = withDoc('/a.md');
    sessions.set([a]);
    activeSession.set(a);
    render(TabBar);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('keyboard: Ctrl+Tab / Ctrl+Shift+Tab cycle, Ctrl+W closes, Ctrl+O opens', async () => {
    const { a } = twoTabs();
    render(TabBar);
    await fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    expect(cycleSession).toHaveBeenLastCalledWith(1);
    await fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(cycleSession).toHaveBeenLastCalledWith(-1);
    await fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    expect(closeSession).toHaveBeenCalledWith(a.id);
    await fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    expect(openViaDialog).toHaveBeenCalled();
  });

  it('keyboard shortcuts are ignored while typing in a text field', async () => {
    twoTabs();
    render(TabBar);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await fireEvent.keyDown(input, { key: 'w', ctrlKey: true });
    await fireEvent.keyDown(input, { key: 'Tab', ctrlKey: true });
    expect(closeSession).not.toHaveBeenCalled();
    expect(cycleSession).not.toHaveBeenCalled();
    input.remove();
  });

  it('shortcuts do nothing while a dialog is open', async () => {
    twoTabs();
    render(TabBar);
    openModal({ kind: 'confirm-clear-annots' });
    await fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    await fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    await fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    closeModal();
    expect(cycleSession).not.toHaveBeenCalled();
    expect(closeSession).not.toHaveBeenCalled();
    expect(openViaDialog).not.toHaveBeenCalled();
  });

  it('a held-down Ctrl+W closes one tab, not several', async () => {
    twoTabs();
    render(TabBar);
    await fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    await fireEvent.keyDown(window, { key: 'w', ctrlKey: true, repeat: true });
    await fireEvent.keyDown(window, { key: 'w', ctrlKey: true, repeat: true });
    expect(closeSession).toHaveBeenCalledTimes(1);
  });

  it('keeps working after a tab closes (ResizeObserver never sees a closed tab)', async () => {
    const observed: Element[] = [];
    let nullObserves = 0; // the real ResizeObserver throws on these
    class StrictRO {
      constructor(_cb: ResizeObserverCallback) {}
      observe(el: Element) {
        if (!el) { nullObserves += 1; return; }
        observed.push(el);
      }
      unobserve() {}
      disconnect() {}
    }
    const original = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = StrictRO;
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onError);
    try {
      const { a, b } = twoTabs();
      render(TabBar);
      await tick();
      sessions.set([b]);           // a closed
      activeSession.set(b);
      await tick();
      const c = withDoc('/x/gamma.md');
      sessions.set([b, c]);        // another opened
      await tick();
      expect(errors).toEqual([]);
      expect(nullObserves).toBe(0);
      expect(screen.getAllByRole('tab')).toHaveLength(2);
      expect(observed.length).toBeGreaterThan(0);
      void a;
    } finally {
      window.removeEventListener('error', onError);
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
    }
  });
});

function threeTabs() {
  const a = withDoc('C:\\x\\Alpha.md');
  const b = withDoc('/x/beta.markdown');
  const c = withDoc('/x/3 gamma.md');
  sessions.set([a, b, c]);
  activeSession.set(a);
  return { a, b, c };
}

async function rightClick(el: Element) {
  await fireEvent.contextMenu(el, { clientX: 120, clientY: 20 });
}

describe('TabBar — no title band', () => {
  beforeEach(() => resetSettings());

  it('tabs sit on the window background: no band, a fade behind them only once the page scrolls', async () => {
    twoTabs();
    const scroll = document.createElement('div');
    document.body.appendChild(scroll);
    viewerScroll.set(scroll);
    render(TabBar);
    expect(document.querySelector('.tab-band')).toBeNull();
    expect(document.body.classList.contains('has-tabs')).toBe(true);
    const haze = document.querySelector('.tab-haze')!;
    expect(haze.classList.contains('shown')).toBe(false);
    Object.defineProperty(scroll, 'scrollTop', { value: 200, configurable: true }); // jsdom doesn't scroll
    scroll.dispatchEvent(new Event('scroll'));
    await tick();
    expect(haze.classList.contains('shown')).toBe(true);
    viewerScroll.set(null);
    scroll.remove();
  });

  it('no tab classes while tabs are hidden', () => {
    updateSettings({ openMode: 'replace' });
    const a = withDoc('/a.md');
    sessions.set([a]);
    activeSession.set(a);
    render(TabBar);
    expect(document.querySelector('.tab-haze')).toBeNull();
    expect(document.body.classList.contains('has-tabs')).toBe(false);
  });

  it('the classes go away once the tabs do', async () => {
    const { b } = twoTabs();
    updateSettings({ openMode: 'replace' });
    render(TabBar);
    expect(document.body.classList.contains('has-tabs')).toBe(true);
    sessions.set([b]);
    activeSession.set(b);
    await tick();
    expect(document.body.classList.contains('has-tabs')).toBe(false);
  });
});

describe('TabBar — top', () => {
  beforeEach(() => resetSettings());

  it('lays the tabs out in a row along the top, flat (no pills)', () => {
    twoTabs();
    render(TabBar);
    const list = screen.getByRole('tablist');
    expect(list.getAttribute('aria-orientation')).toBe('horizontal');
    expect(list.closest('.tabbar')).not.toBeNull();
    expect(document.querySelector('.tab-sidebar')).toBeNull();
    expect(document.body.classList.contains('tabs-left')).toBe(false);
    for (const t of screen.getAllByRole('tab')) {
      expect(t.classList.contains('glass')).toBe(false);
      expect(t.classList.contains('glass-pill')).toBe(false);
    }
  });

  it('arrow keys move between tabs', async () => {
    twoTabs();
    render(TabBar);
    const [first, second] = screen.getAllByRole('tab');
    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);
  });
});

describe('TabBar — left', () => {
  beforeEach(() => {
    resetSettings();
    updateSettings({ tabPosition: 'left' });
    vi.mocked(activateSession).mockClear();
    vi.mocked(closeSession).mockClear();
    vi.mocked(cycleSession).mockClear();
    vi.mocked(openViaDialog).mockClear();
  });

  it('shows the tabs as a vertical sidebar, one row per document', () => {
    twoTabs();
    render(TabBar);
    const list = screen.getByRole('tablist');
    expect(list.getAttribute('aria-orientation')).toBe('vertical');
    expect(list.closest('.tab-sidebar')).not.toBeNull();
    expect(document.querySelector('.tabbar')).toBeNull();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.querySelector('.label')?.textContent)).toEqual(['Alpha', 'beta']);
    expect(tabs[0].getAttribute('title')).toBe('C:\\x\\Alpha.md');
  });

  it("each row starts with the document's initial", () => {
    threeTabs();
    render(TabBar);
    const initials = screen.getAllByRole('tab').map((t) => t.querySelector('.tab-initial')?.textContent);
    expect(initials).toEqual(['A', 'B', '3']);
  });

  it('no band and no top fade with tabs on the left', () => {
    twoTabs();
    render(TabBar);
    expect(document.querySelector('.tab-band')).toBeNull();
    expect(document.querySelector('.tab-haze')).toBeNull();
    expect(document.body.classList.contains('has-tabs')).toBe(true);
    expect(document.body.classList.contains('tabs-left')).toBe(true);
  });

  it('clicking a row switches to it; its close button closes it', async () => {
    const { a, b } = twoTabs();
    render(TabBar);
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('tab')[1]);
    expect(activateSession).toHaveBeenCalledWith(b.id);
    await user.click(screen.getByRole('button', { name: 'Close Alpha' }));
    expect(closeSession).toHaveBeenCalledWith(a.id);
  });

  it('middle-click closes a row', async () => {
    const { b } = twoTabs();
    render(TabBar);
    await fireEvent(screen.getAllByRole('tab')[1], new MouseEvent('auxclick', { button: 1, bubbles: true }));
    expect(closeSession).toHaveBeenCalledWith(b.id);
  });

  it('up / down arrows move between rows', async () => {
    twoTabs();
    render(TabBar);
    const [first, second] = screen.getAllByRole('tab');
    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    await fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
  });

  it('the last row, "Open a file", opens a file', async () => {
    twoTabs();
    render(TabBar);
    const btn = screen.getByRole('button', { name: 'Open a file in a new tab' });
    expect(btn.textContent).toContain('Open a file');
    expect(btn.closest('.tab-sidebar')).not.toBeNull();
    await userEvent.setup().click(btn);
    expect(openViaDialog).toHaveBeenCalled();
  });

  it('keyboard shortcuts still work', async () => {
    const { a } = twoTabs();
    render(TabBar);
    await fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    expect(cycleSession).toHaveBeenLastCalledWith(1);
    await fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    expect(closeSession).toHaveBeenCalledWith(a.id);
  });

  it('is pinned open by default and pushes the page over', () => {
    twoTabs();
    render(TabBar);
    expect(document.querySelector('.tab-sidebar')!.classList.contains('pinned')).toBe(true);
    expect(document.body.classList.contains('tab-sidebar-pinned')).toBe(true);
    const pin = screen.getByRole('button', { name: 'Collapse the sidebar' });
    expect(pin.getAttribute('aria-pressed')).toBe('true');
  });

  it('collapsing it keeps just the initials (remembered as a setting); it can be pinned again', async () => {
    twoTabs();
    render(TabBar);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Collapse the sidebar' }));
    expect(get(settings).tabSidebarPinned).toBe(false);
    expect(document.querySelector('.tab-sidebar')!.classList.contains('pinned')).toBe(false);
    expect(document.body.classList.contains('tab-sidebar-pinned')).toBe(false);
    const pin = screen.getByRole('button', { name: 'Keep the sidebar open' });
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    await user.click(pin);
    expect(get(settings).tabSidebarPinned).toBe(true);
  });

  it('starts collapsed when the setting says so', () => {
    updateSettings({ tabSidebarPinned: false });
    twoTabs();
    render(TabBar);
    expect(document.querySelector('.tab-sidebar')!.classList.contains('pinned')).toBe(false);
    expect(screen.getByRole('button', { name: 'Keep the sidebar open' })).toBeInTheDocument();
  });

  it('switching the setting back to top swaps the sidebar for the row of tabs', async () => {
    twoTabs();
    render(TabBar);
    updateSettings({ tabPosition: 'top' });
    await tick();
    expect(document.querySelector('.tab-sidebar')).toBeNull();
    expect(screen.getByRole('tablist').closest('.tabbar')).not.toBeNull();
    expect(document.body.classList.contains('tabs-left')).toBe(false);
    expect(document.body.classList.contains('tab-sidebar-pinned')).toBe(false);
  });
});

describe('TabBar — right-click menu', () => {
  beforeEach(() => {
    resetSettings();
    vi.mocked(closeSession).mockClear();
    vi.mocked(closeOtherSessions).mockClear();
    vi.mocked(closeSessionsAfter).mockClear();
    vi.mocked(revealInFolder).mockClear();
  });

  const items = () => screen.getAllByRole('menuitem').map((m) => m.querySelector('span')?.textContent);

  it('offers Close, Close others, Close tabs to the right, Show in folder and Copy path', async () => {
    threeTabs();
    render(TabBar);
    await rightClick(screen.getAllByRole('tab')[1]);
    expect(screen.getByRole('menu', { name: 'beta actions' })).toBeInTheDocument();
    expect(items()).toEqual(['Close', 'Close others', 'Close tabs to the right', 'Show in folder', 'Copy path']);
  });

  it('says "Close tabs below" with tabs on the left', async () => {
    updateSettings({ tabPosition: 'left' });
    threeTabs();
    render(TabBar);
    await rightClick(screen.getAllByRole('tab')[0]);
    expect(items()).toContain('Close tabs below');
  });

  it('Close closes that tab', async () => {
    const { b } = threeTabs();
    render(TabBar);
    await rightClick(screen.getAllByRole('tab')[1]);
    await userEvent.setup().click(screen.getAllByRole('menuitem')[0]);
    expect(closeSession).toHaveBeenCalledWith(b.id);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Close others keeps only that tab', async () => {
    const { b } = threeTabs();
    render(TabBar);
    await rightClick(screen.getAllByRole('tab')[1]);
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Close others' }));
    expect(closeOtherSessions).toHaveBeenCalledWith(b.id);
  });

  it('Close tabs to the right closes the ones after it', async () => {
    const { a } = threeTabs();
    render(TabBar);
    await rightClick(screen.getAllByRole('tab')[0]);
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Close tabs to the right' }));
    expect(closeSessionsAfter).toHaveBeenCalledWith(a.id);
  });

  it('nothing to close: "Close others" is off with one tab, "to the right" is off on the last tab', async () => {
    const a = withDoc('/a.md');
    sessions.set([a]);
    activeSession.set(a);
    render(TabBar);
    await rightClick(screen.getAllByRole('tab')[0]);
    expect(screen.getByRole('menuitem', { name: 'Close others' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Close tabs to the right' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByRole('menuitem')[0].getAttribute('aria-disabled')).toBeNull();
  });

  it('Show in folder reveals the file', async () => {
    threeTabs();
    render(TabBar);
    await rightClick(screen.getAllByRole('tab')[2]);
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Show in folder' }));
    expect(revealInFolder).toHaveBeenCalledWith('/x/3 gamma.md');
  });

  it('Copy path puts the full path on the clipboard', async () => {
    threeTabs();
    render(TabBar);
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await rightClick(screen.getAllByRole('tab')[0]);
    await user.click(screen.getByRole('menuitem', { name: 'Copy path' }));
    expect(writeText).toHaveBeenCalledWith('C:\\x\\Alpha.md');
  });

  it('in reader mode Ctrl+Tab still switches, but nothing closes or opens tabs out of sight', async () => {
    const { a } = twoTabs();
    a.readerMode.set(true);
    render(TabBar);
    await fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    expect(cycleSession).toHaveBeenCalledWith(1);
    await fireEvent.keyDown(window, { key: 'w', ctrlKey: true });
    await fireEvent.keyDown(window, { key: 'o', ctrlKey: true });
    expect(closeSession).not.toHaveBeenCalled();
    expect(openViaDialog).not.toHaveBeenCalled();
  });
});

describe('TabBar — showing and hiding the tabs', () => {
  beforeEach(() => { resetSettings(); clearToasts(); });

  it('"Show tabs" off: no tab bar at all, but Ctrl+Tab still switches documents', async () => {
    twoTabs();
    updateSettings({ showTabs: false });
    render(TabBar);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(document.body.classList.contains('has-tabs')).toBe(false);
    await fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    expect(cycleSession).toHaveBeenCalledWith(1);
  });

  it('"Hide the tab bar with only one document" hides it for one, shows it for two', async () => {
    const { b } = twoTabs();
    updateSettings({ openMode: 'tabs', hideSingleTab: true });
    render(TabBar);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    sessions.set([b]);
    activeSession.set(b);
    await tick();
    expect(screen.queryByRole('tablist')).toBeNull();
    updateSettings({ hideSingleTab: false });
    await tick();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('Ctrl+Shift+B hides the tabs (saying how to bring them back) and shows them again', async () => {
    twoTabs();
    render(TabBar);
    await fireEvent.keyDown(window, { key: 'B', ctrlKey: true, shiftKey: true });
    expect(get(settings).showTabs).toBe(false);
    await tick();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(get(toasts).map((t) => t.message).join(' ')).toMatch(/Ctrl\+Shift\+B/);
    await fireEvent.keyDown(window, { key: 'B', ctrlKey: true, shiftKey: true });
    expect(get(settings).showTabs).toBe(true);
  });

  it('not behind a dialog', async () => {
    twoTabs();
    render(TabBar);
    openModal({ kind: 'settings' });
    await fireEvent.keyDown(window, { key: 'B', ctrlKey: true, shiftKey: true });
    expect(get(settings).showTabs).toBe(true);
    closeModal();
  });
});

