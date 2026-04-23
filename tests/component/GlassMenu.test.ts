import { describe, it, expect, vi } from 'vitest';
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
