import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/stores/tabs', async () => {
  const actual = await vi.importActual<typeof import('../../src/stores/tabs')>('../../src/stores/tabs');
  return {
    ...actual,
    activateSession: vi.fn(async () => {}),
    closeSession: vi.fn(async () => {}),
    cycleSession: vi.fn(async () => {}),
  };
});
vi.mock('../../src/lib/open-files', () => ({ openViaDialog: vi.fn(async () => {}) }));

import TabBar from '../../src/components/TabBar.svelte';
import { activateSession, closeSession, cycleSession } from '../../src/stores/tabs';
import { openViaDialog } from '../../src/lib/open-files';
import { createSession, sessions, activeSession, type DocSession } from '../../src/stores/sessions';
import { updateSettings, resetSettings } from '../../src/stores/settings';

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
});
