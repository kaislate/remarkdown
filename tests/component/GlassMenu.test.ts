import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import GlassMenu from '../../src/components/GlassMenu.svelte';

vi.mock('../../src/lib/tauri-api', () => ({
  openFileDialog: vi.fn().mockResolvedValue('/tmp/x.md'),
}));

vi.mock('../../src/stores/doc', () => ({
  loadDocument: vi.fn(),
  clearDocument: vi.fn(),
}));

vi.mock('../../src/stores/recent', () => ({
  recordRecent: vi.fn(),
  recent: { subscribe: (fn: (v: string[]) => void) => { fn([]); return () => {}; } },
}));

import { openFileDialog } from '../../src/lib/tauri-api';
import { loadDocument } from '../../src/stores/doc';
import { recordRecent } from '../../src/stores/recent';
import { annots, currentViewerRoot } from '../../src/stores/annots';
import { closeModal } from '../../src/stores/modals';

beforeEach(() => {
  annots.set([]);
  currentViewerRoot.set(null);
  closeModal();
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

  it('Open… triggers dialog, loadDocument, and recordRecent', async () => {
    const user = userEvent.setup();
    render(GlassMenu);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    await user.click(screen.getByRole('menuitem', { name: /open/i }));
    expect(openFileDialog).toHaveBeenCalled();
    expect(loadDocument).toHaveBeenCalledWith('/tmp/x.md');
    expect(recordRecent).toHaveBeenCalledWith('/tmp/x.md');
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
