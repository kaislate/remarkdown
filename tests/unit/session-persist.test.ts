import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  loadSessionJson: vi.fn(async () => null),
  saveSessionJson: vi.fn(async () => {}),
  checkPathsExist: vi.fn(async (paths: string[]) => paths.map((p) => !p.includes('gone'))),
  windowLabel: vi.fn(() => 'main'),
}));

vi.mock('../../src/stores/recent', () => ({ recordRecent: vi.fn(async () => {}) }));

vi.mock('../../src/stores/doc', async () => {
  const actual = await vi.importActual<typeof import('../../src/stores/doc')>('../../src/stores/doc');
  return {
    ...actual,
    loadIntoSession: vi.fn(async (session: import('../../src/stores/sessions').DocSession, path: string) => {
      session.doc.set({ path, dir: '/', sha256: path, bytes: 1, markdown: '', html: '', plaintext: '', blocks: [], sidecarRaw: null });
      return true;
    }),
  };
});

import {
  serializeSession,
  parseSession,
  restoreSavedTabs,
  installSessionAutosave,
  flushSessionNow,
} from '../../src/stores/session-persist';
import { loadSessionJson, saveSessionJson, windowLabel } from '../../src/lib/tauri-api';
import { recordRecent } from '../../src/stores/recent';
import { sessions, activeSession } from '../../src/stores/sessions';
import { updateSettings, resetSettings } from '../../src/stores/settings';
import { openPaths } from '../../src/lib/open-files';
import { activateSession, closeSession } from '../../src/stores/tabs';

const openTabs = () => get(sessions).map((s) => get(s.doc)?.path ?? null);
const activePath = () => get(get(activeSession).doc)?.path ?? null;

describe('session.json format', () => {
  it('round-trips', () => {
    expect(parseSession(serializeSession(['/a.md', '/b.md'], 1))).toEqual({ tabs: ['/a.md', '/b.md'], active: 1 });
  });

  it('rejects garbage, wrong versions and wrong shapes', () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession('{bad')).toBeNull();
    expect(parseSession(JSON.stringify({ schemaVersion: 2, tabs: [], active: 0 }))).toBeNull();
    expect(parseSession(JSON.stringify({ schemaVersion: 1, tabs: 'x', active: 0 }))).toBeNull();
    expect(parseSession(JSON.stringify({ schemaVersion: 1, tabs: [1, 2], active: 0 }))).toBeNull();
  });

  it('clamps the active index into range', () => {
    expect(parseSession(JSON.stringify({ schemaVersion: 1, tabs: ['/a.md'], active: 7 }))?.active).toBe(0);
    expect(parseSession(JSON.stringify({ schemaVersion: 1, tabs: ['/a.md'], active: -3 }))?.active).toBe(0);
  });
});

describe('restoreSavedTabs', () => {
  beforeEach(() => {
    vi.mocked(recordRecent).mockClear();
  });

  it('reopens saved tabs (skipping missing files) and activates the saved one', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/gone.md', '/b.md', '/c.md'], 2));
    await restoreSavedTabs();
    expect(openTabs()).toEqual(['/a.md', '/b.md', '/c.md']);
    expect(activePath()).toBe('/b.md');
    expect(recordRecent).not.toHaveBeenCalled();
  });

  it('falls back to the first tab when the saved active one is missing', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/gone.md'], 1));
    await restoreSavedTabs();
    expect(activePath()).toBe('/a.md');
  });

  it('does nothing without a saved session', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(null);
    await restoreSavedTabs();
    expect(openTabs()).toEqual([null]);
  });
});

describe('installSessionAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSettings();
    vi.mocked(saveSessionJson).mockClear();
    vi.mocked(windowLabel).mockReturnValue('main');
  });
  afterEach(() => vi.useRealTimers());

  it('writes the open tabs and the active index after open / switch / close', async () => {
    const dispose = installSessionAutosave();
    await openPaths(['/a.md', '/b.md']);
    await vi.advanceTimersByTimeAsync(400);
    expect(JSON.parse(vi.mocked(saveSessionJson).mock.lastCall![0])).toMatchObject({ tabs: ['/a.md', '/b.md'], active: 1 });

    await activateSession(get(sessions)[0].id);
    await vi.advanceTimersByTimeAsync(400);
    expect(JSON.parse(vi.mocked(saveSessionJson).mock.lastCall![0]).active).toBe(0);

    await closeSession(get(sessions)[0].id);
    await vi.advanceTimersByTimeAsync(400);
    expect(JSON.parse(vi.mocked(saveSessionJson).mock.lastCall![0])).toMatchObject({ tabs: ['/b.md'], active: 0 });
    dispose();
  });

  it('flushSessionNow writes immediately', async () => {
    const dispose = installSessionAutosave();
    await openPaths(['/a.md']);
    vi.mocked(saveSessionJson).mockClear();
    await flushSessionNow();
    expect(saveSessionJson).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('does not write outside tabs mode', async () => {
    updateSettings({ openMode: 'replace' });
    const dispose = installSessionAutosave();
    await openPaths(['/a.md']);
    await vi.advanceTimersByTimeAsync(400);
    expect(saveSessionJson).not.toHaveBeenCalled();
    dispose();
  });

  it('does not write from secondary windows', async () => {
    vi.mocked(windowLabel).mockReturnValue('doc-1');
    const dispose = installSessionAutosave();
    await openPaths(['/a.md']);
    await vi.advanceTimersByTimeAsync(400);
    expect(saveSessionJson).not.toHaveBeenCalled();
    dispose();
  });
});
