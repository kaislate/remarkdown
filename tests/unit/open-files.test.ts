import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  takePendingOpens: vi.fn(async () => []),
  openDocumentWindow: vi.fn(async () => {}),
  openFileDialog: vi.fn(async () => null),
}));

vi.mock('../../src/stores/recent', () => ({
  recordRecent: vi.fn(async () => {}),
}));

// Loading succeeds for any path except ones containing "missing".
vi.mock('../../src/stores/doc', async () => {
  const actual = await vi.importActual<typeof import('../../src/stores/doc')>('../../src/stores/doc');
  return {
    ...actual,
    loadIntoSession: vi.fn(async (session: import('../../src/stores/sessions').DocSession, path: string) => {
      if (path.includes('missing')) return false;
      session.doc.set({ path, dir: '/', sha256: path, bytes: 1, markdown: '', html: '', plaintext: '', blocks: [], sidecarRaw: null });
      return true;
    }),
  };
});

import { openPaths, drainPendingOpens, openViaDialog } from '../../src/lib/open-files';
import { takePendingOpens, openDocumentWindow, openFileDialog } from '../../src/lib/tauri-api';
import { recordRecent } from '../../src/stores/recent';
import { sessions, activeSession } from '../../src/stores/sessions';
import { updateSettings, resetSettings } from '../../src/stores/settings';

const paths = () => get(sessions).map((s) => get(s.doc)?.path ?? null);
const activePath = () => get(get(activeSession).doc)?.path ?? null;

describe('openPaths', () => {
  beforeEach(() => {
    resetSettings();
    vi.mocked(recordRecent).mockClear();
    vi.mocked(openDocumentWindow).mockClear();
  });

  describe('tabs mode (default)', () => {
    it('the first file reuses the empty start tab', async () => {
      expect(await openPaths(['/a.md'])).toBe(1);
      expect(paths()).toEqual(['/a.md']);
      expect(activePath()).toBe('/a.md');
    });

    it('further files open as new tabs, in order, and the last one becomes active', async () => {
      await openPaths(['/a.md']);
      await openPaths(['/b.md', '/c.md']);
      expect(paths()).toEqual(['/a.md', '/b.md', '/c.md']);
      expect(activePath()).toBe('/c.md');
    });

    it('a file that is already open (different case / slashes) switches to its tab', async () => {
      await openPaths(['C:\\Docs\\A.md', '/b.md']);
      expect(activePath()).toBe('/b.md');
      expect(await openPaths(['c:/docs/a.md'])).toBe(1);
      expect(get(sessions)).toHaveLength(2);
      expect(activePath()).toBe('C:\\Docs\\A.md');
    });

    it('a file that fails to load adds no tab, and the rest still open', async () => {
      await openPaths(['/a.md']);
      expect(await openPaths(['/missing.md', '/b.md'])).toBe(1);
      expect(paths()).toEqual(['/a.md', '/b.md']);
      expect(activePath()).toBe('/b.md');
    });

    it('records each successfully opened file in recents', async () => {
      await openPaths(['/a.md', '/missing.md', '/b.md']);
      expect(vi.mocked(recordRecent).mock.calls.map((c) => c[0])).toEqual(['/a.md', '/b.md']);
    });
  });

  describe('replace mode', () => {
    it('always loads into the current tab', async () => {
      updateSettings({ openMode: 'replace' });
      await openPaths(['/a.md']);
      await openPaths(['/b.md']);
      expect(paths()).toEqual(['/b.md']);
    });
  });

  describe('new-window mode', () => {
    it('uses this window while it is empty, then opens new windows', async () => {
      updateSettings({ openMode: 'windows' });
      await openPaths(['/a.md', '/b.md']);
      expect(paths()).toEqual(['/a.md']);
      expect(openDocumentWindow).toHaveBeenCalledWith('/b.md');
      expect(vi.mocked(recordRecent).mock.calls.map((c) => c[0])).toEqual(['/a.md', '/b.md']);
    });
  });

  it('drainPendingOpens opens whatever the launch queue holds', async () => {
    vi.mocked(takePendingOpens).mockResolvedValueOnce(['/launched.md']);
    expect(await drainPendingOpens()).toBe(1);
    expect(activePath()).toBe('/launched.md');
  });

  it('openViaDialog opens the chosen file and ignores a cancel', async () => {
    vi.mocked(openFileDialog).mockResolvedValueOnce(null);
    await openViaDialog();
    expect(activePath()).toBeNull();
    vi.mocked(openFileDialog).mockResolvedValueOnce('/picked.md');
    await openViaDialog();
    expect(activePath()).toBe('/picked.md');
  });

  describe('explicit mode (recents context menu, middle-click)', () => {
    it('new tab even when the setting is replace', async () => {
      updateSettings({ openMode: 'replace' });
      await openPaths(['/a.md']);
      await openPaths(['/b.md'], { mode: 'tabs' });
      expect(paths()).toEqual(['/a.md', '/b.md']);
      expect(activePath()).toBe('/b.md');
    });

    it('new window even when the setting is tabs', async () => {
      await openPaths(['/a.md']);
      await openPaths(['/b.md'], { mode: 'windows' });
      expect(openDocumentWindow).toHaveBeenCalledWith('/b.md');
      expect(paths()).toEqual(['/a.md']);
    });

    it('open here replaces the current tab even in tabs mode', async () => {
      await openPaths(['/a.md', '/b.md']);
      await openPaths(['/c.md'], { mode: 'replace' });
      expect(paths()).toEqual(['/a.md', '/c.md']);
      expect(activePath()).toBe('/c.md');
    });
  });
});
