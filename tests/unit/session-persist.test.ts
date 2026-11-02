import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  loadSessionJson: vi.fn(async () => null),
  saveSessionJson: vi.fn(async () => {}),
  checkPathsExist: vi.fn(async (paths: string[]) => paths.map((p) => !p.includes('gone'))),
  windowLabel: vi.fn(() => 'main'),
}));

vi.mock('../../src/stores/recent', () => ({ recordRecent: vi.fn(async () => {}) }));

// How long each path takes to read and render (ms); none by default.
const loadDelays = vi.hoisted(() => new Map<string, number>());

vi.mock('../../src/stores/doc', async () => {
  const actual = await vi.importActual<typeof import('../../src/stores/doc')>('../../src/stores/doc');
  return {
    ...actual,
    loadIntoSession: vi.fn(async (session: import('../../src/stores/sessions').DocSession, path: string) => {
      const delay = loadDelays.get(path);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (path.includes('broken')) return false;
      session.doc.set({ path, dir: '/', sha256: path, bytes: 1, markdown: '', html: '', plaintext: '', blocks: [], sidecarRaw: null });
      return true;
    }),
  };
});

import {
  serializeSession,
  parseSession,
  restoreSavedTabs,
  finishSessionRestore,
  loadRestoredTabsInBackground,
  installSessionAutosave,
  flushSessionNow,
} from '../../src/stores/session-persist';
import { loadIntoSession } from '../../src/stores/doc';
import { loadSessionJson, saveSessionJson, windowLabel } from '../../src/lib/tauri-api';
import { recordRecent } from '../../src/stores/recent';
import { sessions, activeSession, resetSessionsForTests } from '../../src/stores/sessions';
import { updateSettings, resetSettings } from '../../src/stores/settings';
import { openPaths } from '../../src/lib/open-files';
import {
  activateSession,
  closeOtherSessions,
  closeSession,
  closeSessionsAfter,
  cycleSession,
  findSessionByPath,
  shownTab,
} from '../../src/stores/tabs';

const openTabs = () => get(sessions).map((s) => get(s.doc)?.path ?? null);
const activePath = () => get(get(activeSession).doc)?.path ?? null;
// What the tab bar shows: loaded tabs and ones still waiting to load.
const tabPaths = () => get(sessions).map((s) => get(s.doc)?.path ?? s.lazyPath).filter((p) => p !== null);
const loadedPaths = () => vi.mocked(loadIntoSession).mock.calls.map((c) => c[1]);

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
    resetSessionsForTests();
    resetSettings();
    vi.mocked(recordRecent).mockClear();
    vi.mocked(loadIntoSession).mockClear();
  });

  // A plain launch: the saved tabs come back, the saved active one is shown,
  // and only that one is read and rendered before the window is usable.
  it('reopens saved tabs (skipping missing files) and shows the saved one, loading only it', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/gone.md', '/b.md', '/c.md'], 2));
    await restoreSavedTabs();
    await finishSessionRestore();
    expect(tabPaths()).toEqual(['/a.md', '/b.md', '/c.md']);
    expect(activePath()).toBe('/b.md');
    expect(loadedPaths()).toEqual(['/b.md']);
    expect(recordRecent).not.toHaveBeenCalled();
  });

  it('falls back to the first tab when the saved active one is missing', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/gone.md'], 1));
    await restoreSavedTabs();
    await finishSessionRestore();
    expect(activePath()).toBe('/a.md');
    expect(tabPaths()).toEqual(['/a.md']);
  });

  it('falls back to the next tab when the saved active one cannot be read', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/broken.md', '/c.md'], 1));
    await restoreSavedTabs();
    await finishSessionRestore();
    expect(activePath()).toBe('/a.md');
    expect(tabPaths()).toEqual(['/a.md', '/c.md']);
  });

  it('does nothing without a saved session', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(null);
    await restoreSavedTabs();
    await finishSessionRestore();
    expect(openTabs()).toEqual([null]);
  });

  // A double-clicked file: it opens right after the saved active tab, as it
  // always has, and is the only document read before it is on screen.
  it('a launched file opens after the saved active tab and is the only one loaded first', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/b.md', '/c.md'], 1));
    await restoreSavedTabs();
    await openPaths(['/new.md']);
    await finishSessionRestore();
    expect(tabPaths()).toEqual(['/a.md', '/b.md', '/new.md', '/c.md']);
    expect(activePath()).toBe('/new.md');
    expect(loadedPaths()).toEqual(['/new.md']);
    expect(get(sessions)).toHaveLength(4);
  });

  it('a launched file that was already a saved tab switches to that tab, with no extra empty tab', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/b.md', '/c.md'], 0));
    await restoreSavedTabs();
    await openPaths(['/c.md']);
    await finishSessionRestore();
    expect(tabPaths()).toEqual(['/a.md', '/b.md', '/c.md']);
    expect(get(sessions)).toHaveLength(3);
    expect(activePath()).toBe('/c.md');
    expect(loadedPaths()).toEqual(['/c.md']);
  });

  it('the welcome document opens after the saved active tab, like a launched file', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/b.md'], 0));
    await restoreSavedTabs();
    await openPaths(['/welcome.md']);
    await finishSessionRestore();
    expect(tabPaths()).toEqual(['/a.md', '/welcome.md', '/b.md']);
    expect(activePath()).toBe('/welcome.md');
  });

  it('the rest load in the background afterwards, in tab order; one that fails to load goes away', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/broken.md', '/b.md', '/c.md'], 2));
    await restoreSavedTabs();
    await openPaths(['/new.md']);
    await finishSessionRestore();
    await loadRestoredTabsInBackground();
    expect(loadedPaths()).toEqual(['/new.md', '/a.md', '/broken.md', '/b.md', '/c.md']);
    expect(openTabs()).toEqual(['/a.md', '/b.md', '/new.md', '/c.md']);
    expect(activePath()).toBe('/new.md');
  });

  it('switching to a tab that has not loaded yet loads it first', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/b.md'], 0));
    await restoreSavedTabs();
    await finishSessionRestore();
    expect(activePath()).toBe('/a.md');
    await activateSession(get(sessions)[1].id);
    expect(activePath()).toBe('/b.md');
    expect(loadedPaths()).toEqual(['/a.md', '/b.md']);
  });

  it('closing the active tab shows its neighbour fully loaded', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/b.md'], 0));
    await restoreSavedTabs();
    await finishSessionRestore();
    await closeSession(get(activeSession).id);
    expect(activePath()).toBe('/b.md');
    expect(tabPaths()).toEqual(['/b.md']);
  });

  it('a tab closed before it loaded is never loaded', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/b.md', '/c.md'], 0));
    await restoreSavedTabs();
    await finishSessionRestore();
    await closeSession(get(sessions)[1].id);
    await loadRestoredTabsInBackground();
    expect(loadedPaths()).toEqual(['/a.md', '/c.md']);
    expect(tabPaths()).toEqual(['/a.md', '/c.md']);
  });

  // "Close others" / "Close tabs to the right" first show the tab the user
  // right-clicked. If that tab turns out to be unreadable it drops out, and
  // nothing else may be closed: not the tab being read, not the saved set.
  it('"Close others" on a tab that cannot be read closes nothing else', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/broken.md', '/c.md'], 0));
    await restoreSavedTabs();
    await finishSessionRestore();
    const broken = get(sessions).find((s) => s.lazyPath === '/broken.md')!;
    await closeOtherSessions(broken.id);
    expect(activePath()).toBe('/a.md');
    expect(tabPaths()).toEqual(['/a.md', '/c.md']);
  });

  it('"Close tabs to the right" of a tab that cannot be read closes nothing else', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/b.md', '/broken.md', '/d.md'], 3));
    await restoreSavedTabs();
    await finishSessionRestore();
    expect(activePath()).toBe('/d.md');
    const broken = get(sessions).find((s) => s.lazyPath === '/broken.md')!;
    await closeSessionsAfter(broken.id);
    expect(activePath()).toBe('/d.md');
    expect(tabPaths()).toEqual(['/a.md', '/b.md', '/d.md']);
  });

  it('"Close others" on a tab not loaded yet loads it and closes the rest', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/b.md', '/c.md'], 0));
    await restoreSavedTabs();
    await finishSessionRestore();
    await closeOtherSessions(get(sessions)[2].id);
    expect(activePath()).toBe('/c.md');
    expect(tabPaths()).toEqual(['/c.md']);
  });

  it('tabs not loaded yet are still found by path and still saved', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/b.md', '/c.md'], 1));
    await restoreSavedTabs();
    await finishSessionRestore();
    expect(findSessionByPath('/c.md')).toBe(get(sessions)[2]);
    vi.mocked(saveSessionJson).mockClear();
    await flushSessionNow();
    expect(JSON.parse(vi.mocked(saveSessionJson).mock.lastCall![0])).toMatchObject({ tabs: ['/a.md', '/b.md', '/c.md'], active: 1 });
  });
});

// Reopened tabs are read when first needed, which takes a moment: the
// keyboard and clicks must still land where the user aimed them.
describe('switching while reopened tabs are still loading', () => {
  const docs = ['/d0.md', '/d1.md', '/d2.md', '/d3.md', '/d4.md', '/d5.md'];
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeEach(() => {
    resetSessionsForTests();
    resetSettings();
    vi.mocked(loadIntoSession).mockClear();
    loadDelays.clear();
  });
  afterEach(() => loadDelays.clear());

  it('quick Ctrl+Tab presses each move one tab on, though none has loaded yet', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(docs, 0));
    await restoreSavedTabs();
    await finishSessionRestore();
    for (const d of docs.slice(1)) loadDelays.set(d, 30);
    const presses: Promise<void>[] = [];
    for (let i = 0; i < 4; i++) {
      presses.push(cycleSession(1));
      await pause(5);
    }
    await Promise.all(presses);
    expect(activePath()).toBe('/d4.md');
  });

  it('Ctrl+Tab then Ctrl+Shift+Tab before the first lands stays on the same tab', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(docs, 2));
    await restoreSavedTabs();
    await finishSessionRestore();
    loadDelays.set('/d3.md', 30);
    const forward = cycleSession(1);
    await pause(5);
    const back = cycleSession(-1);
    await Promise.all([forward, back]);
    expect(activePath()).toBe('/d2.md');
  });

  // Until it has been read, the saved active tab is the one the tab bar
  // shows as selected, and Ctrl+Tab steps on from it (never onto the
  // hidden empty tab the window starts with).
  it('the saved tab is shown selected while it loads, and Ctrl+Tab steps on from it', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(docs, 2));
    await restoreSavedTabs();
    const saved = get(sessions).find((s) => s.lazyPath === '/d2.md')!;
    expect(get(shownTab)).toBe(saved);
    loadDelays.set('/d2.md', 30);
    const finishing = finishSessionRestore();
    await pause(5);
    expect(get(shownTab)).toBe(saved);
    const press = cycleSession(1);
    await Promise.all([finishing, press]);
    expect(activePath()).toBe('/d3.md');
    expect(get(shownTab)).toBe(get(activeSession));
  });

  it('Ctrl+Tab before startup reads the saved tab steps on from it too', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(docs, 2));
    await restoreSavedTabs();
    const press = cycleSession(-1);
    await finishSessionRestore();
    await press;
    expect(activePath()).toBe('/d1.md');
  });

  it('a file opened at launch into the start tab is the one shown selected', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(docs, 2));
    await restoreSavedTabs();
    await openPaths(['/new.md']);
    expect(get(shownTab)).toBe(get(activeSession));
    await finishSessionRestore();
    expect(get(shownTab)).toBe(get(activeSession));
    expect(activePath()).toBe('/new.md');
  });

  // The tab bar fills with every reopened tab at once, while the saved
  // active tab is still being read: a tab the user picks meanwhile is the
  // one that stays shown.
  it('a tab clicked while the saved tab loads stays shown (it loads first)', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/big.md', '/small.md'], 0));
    loadDelays.set('/big.md', 60);
    loadDelays.set('/small.md', 5);
    await restoreSavedTabs();
    const finishing = finishSessionRestore();
    await pause(10);
    const small = get(sessions).find((s) => s.lazyPath === '/small.md')!;
    await activateSession(small.id);
    expect(activePath()).toBe('/small.md');
    await finishing;
    expect(activePath()).toBe('/small.md');
    expect(tabPaths()).toEqual(['/big.md', '/small.md']);
  });

  it('a tab clicked while the saved tab loads stays shown (the saved tab loads first)', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/slow.md'], 0));
    loadDelays.set('/a.md', 20);
    loadDelays.set('/slow.md', 60);
    await restoreSavedTabs();
    const finishing = finishSessionRestore();
    await pause(5);
    const slow = get(sessions).find((s) => s.lazyPath === '/slow.md')!;
    const click = activateSession(slow.id);
    await Promise.all([finishing, click]);
    expect(activePath()).toBe('/slow.md');
    expect(tabPaths()).toEqual(['/a.md', '/slow.md']);
  });

  it('a clicked tab that cannot be read leaves the saved tab to be shown', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/broken.md'], 0));
    loadDelays.set('/a.md', 20);
    loadDelays.set('/broken.md', 40);
    await restoreSavedTabs();
    const finishing = finishSessionRestore();
    await pause(5);
    const broken = get(sessions).find((s) => s.lazyPath === '/broken.md')!;
    const click = activateSession(broken.id);
    await Promise.all([finishing, click]);
    expect(activePath()).toBe('/a.md');
    expect(get(sessions)).toHaveLength(1);
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
