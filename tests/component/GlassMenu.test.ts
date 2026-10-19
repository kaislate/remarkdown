import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import GlassMenu from '../../src/components/GlassMenu.svelte';

vi.mock('../../src/lib/tauri-api', () => ({
  openFileDialog: vi.fn().mockResolvedValue('/tmp/x.md'),
  revealInFolder: vi.fn(async () => {}),
}));

vi.mock('../../src/stores/doc', () => ({
  loadDocument: vi.fn(),
  clearDocument: vi.fn(),
}));

// Opening goes through open-files (which applies the open-mode setting and
// records recents); the menu just hands it the path.
vi.mock('../../src/lib/open-files', () => ({
  openPaths: vi.fn(),
  openViaDialog: vi.fn(),
}));

vi.mock('../../src/stores/recent', async () => {
  const { writable } = await import('svelte/store');
  return {
    recordRecent: vi.fn(),
    markMissing: vi.fn(),
    removeFromRecent: vi.fn(async () => {}),
    clearAllRecent: vi.fn(),
    recent: writable<string[]>([]),
    recentExistence: writable<Record<string, boolean>>({}),
  };
});

vi.mock('../../src/stores/toasts', () => ({
  addToast: vi.fn(),
}));

import { openFileDialog } from '../../src/lib/tauri-api';
import { openPaths, openViaDialog } from '../../src/lib/open-files';
import { recordRecent, recentExistence } from '../../src/stores/recent';
import { annots, currentViewerRoot } from '../../src/stores/annots';
import { closeModal } from '../../src/stores/modals';

beforeEach(() => {
  annots.set([]);
  currentViewerRoot.set(null);
  closeModal();
  // Clear accumulated mock call history so each test starts fresh.
  vi.clearAllMocks();
});

describe('GlassMenu', () => {
  it('starts closed', () => {
    render(GlassMenu);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens a menu when the hamburger is clicked', async () => {
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /open/i })).toBeInTheDocument();
  });

  it('Open… hands off to openViaDialog', async () => {
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /open…/i }));
    expect(openViaDialog).toHaveBeenCalledTimes(1);
  });
});

describe('GlassMenu — Orphaned Annotations item', () => {
  it('is disabled when no orphans exist', async () => {
    annots.set([]);
    currentViewerRoot.set(null);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    const item = screen.getByRole('menuitem', { name: /orphaned/i });
    expect(item).toBeDisabled();
  });

  it('opens the orphan modal when clicked', async () => {
    const { activeModal } = await import('../../src/stores/modals');
    const { get } = await import('svelte/store');
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:99' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    currentViewerRoot.set(null); // null root → everything orphaned
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /orphaned/i }));
    expect(get(activeModal)).toEqual({ kind: 'orphans' });
  });
});

describe('GlassMenu — Open Recent', () => {
  it('shows recent paths when menu is open and recent is non-empty', async () => {
    const { recent } = await import('../../src/stores/recent');
    recent.set(['/home/kai/a.md', '/home/kai/b.md']);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    expect(screen.getByRole('menuitem', { name: /a\.md/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /b\.md/i })).toBeInTheDocument();
  });

  it('clicking a recent path opens it by its full path', async () => {
    const { recent } = await import('../../src/stores/recent');
    recent.set(['/home/kai/a.md']);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /a\.md/i }));
    expect(openPaths).toHaveBeenCalledWith(['/home/kai/a.md']);
  });

  it('omits the Open Recent section when recent list is empty', async () => {
    const { recent } = await import('../../src/stores/recent');
    recent.set([]);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    expect(screen.queryByText(/open recent/i)).toBeNull();
  });

  it('shows "(missing)" suffix for recent paths that do not exist', async () => {
    const { recent, recentExistence } = await import('../../src/stores/recent');
    recent.set(['/home/kai/missing.md']);
    recentExistence.set({ '/home/kai/missing.md': false });
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    expect(screen.getByText(/missing\.md \(missing\)/i)).toBeInTheDocument();
  });

  it('renders a per-row remove (×) button for each recent entry', async () => {
    const { recent } = await import('../../src/stores/recent');
    recent.set(['/home/kai/a.md', '/home/kai/b.md']);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    expect(screen.getByRole('button', { name: /remove a\.md from recents/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove b\.md from recents/i })).toBeInTheDocument();
  });

  it('clicking the remove (×) button calls removeFromRecent and does NOT open the file', async () => {
    const { recent, removeFromRecent } = await import('../../src/stores/recent');
    recent.set(['/home/kai/a.md']);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    await user.click(screen.getByRole('button', { name: /remove a\.md from recents/i }));
    expect(removeFromRecent).toHaveBeenCalledWith('/home/kai/a.md');
    expect(openPaths).not.toHaveBeenCalled();
  });

  it('renders a "Clear recents" footer when there are recent entries', async () => {
    const { recent } = await import('../../src/stores/recent');
    recent.set(['/home/kai/a.md']);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    expect(screen.getByText('Clear recents')).toBeInTheDocument();
  });

  it('clicking "Clear recents" calls clearAllRecent', async () => {
    const { recent, clearAllRecent } = await import('../../src/stores/recent');
    recent.set(['/home/kai/a.md', '/home/kai/b.md']);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    await user.click(screen.getByText('Clear recents'));
    expect(clearAllRecent).toHaveBeenCalled();
  });

  it('omits the "Clear recents" footer when there are no recent entries', async () => {
    const { recent } = await import('../../src/stores/recent');
    recent.set([]);
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    expect(screen.queryByText('Clear recents')).toBeNull();
  });
});

describe('GlassMenu — recent file actions', () => {
  const PATH = 'C:/docs/Budget_Blueprint.md';

  async function openRecentMenu() {
    const { recent, recentExistence } = await import('../../src/stores/recent');
    recent.set([PATH]);
    recentExistence.set({ [PATH]: true });
    render(GlassMenu);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /menu/i }));
    const row = screen.getByRole('menuitem', { name: /Budget_Blueprint\.md/ });
    return { row, user };
  }

  it('middle-click opens the file in a new tab', async () => {
    const { row } = await openRecentMenu();
    await fireEvent(row, new MouseEvent('auxclick', { button: 1, bubbles: true }));
    expect(openPaths).toHaveBeenCalledWith([PATH], { mode: 'tabs' });
  });

  it('right-click shows the file actions', async () => {
    const { row } = await openRecentMenu();
    await fireEvent.contextMenu(row);
    const menu = screen.getByRole('menu', { name: /Budget_Blueprint/ });
    const labels = Array.from(menu.querySelectorAll('[role="menuitem"] > span:first-child')).map((n) => n.textContent);
    expect(labels).toEqual(['Open in new tab', 'Open in new window', 'Open here', 'Show in folder', 'Copy path', 'Remove from list']);
  });

  it.each([
    ['Open in new tab', 'tabs'],
    ['Open in new window', 'windows'],
    ['Open here', 'replace'],
  ])('%s opens with mode %s', async (label, mode) => {
    const { row } = await openRecentMenu();
    await fireEvent.contextMenu(row);
    await fireEvent.click(screen.getByRole('menuitem', { name: new RegExp('^' + label) }));
    expect(openPaths).toHaveBeenCalledWith([PATH], { mode });
  });

  it('Show in folder reveals the file', async () => {
    const { revealInFolder } = await import('../../src/lib/tauri-api');
    const { row } = await openRecentMenu();
    await fireEvent.contextMenu(row);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Show in folder' }));
    expect(revealInFolder).toHaveBeenCalledWith(PATH);
  });

  it('Copy path puts the full path on the clipboard', async () => {
    const { row } = await openRecentMenu();
    // After userEvent.setup(), which installs its own clipboard.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await fireEvent.contextMenu(row);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }));
    expect(writeText).toHaveBeenCalledWith(PATH);
  });

  it('Remove from list removes only that entry', async () => {
    const { removeFromRecent } = await import('../../src/stores/recent');
    const { row } = await openRecentMenu();
    await fireEvent.contextMenu(row);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from list' }));
    expect(removeFromRecent).toHaveBeenCalledWith(PATH);
    expect(openPaths).not.toHaveBeenCalled();
  });

  it('a missing file can still be removed or shown, but not opened', async () => {
    const { recent, recentExistence } = await import('../../src/stores/recent');
    recent.set([PATH]);
    recentExistence.set({ [PATH]: false });
    render(GlassMenu);
    await userEvent.setup().click(screen.getByRole('button', { name: /menu/i }));
    await fireEvent.contextMenu(screen.getByRole('menuitem', { name: /Budget_Blueprint/ }));
    for (const label of ['Open in new tab', 'Open in new window', 'Open here']) {
      expect(screen.getByRole('menuitem', { name: new RegExp('^' + label) })).toHaveAttribute('aria-disabled', 'true');
    }
    expect(screen.getByRole('menuitem', { name: 'Remove from list' })).not.toHaveAttribute('aria-disabled');
  });
});

