// Remembers which tabs were open so the next launch can reopen them
// ("Reopen tabs from last session", tabs mode only). Stored in
// session.json next to settings.json. Only the main window writes it —
// windows opened in new-window mode are single-document and transient.
//
// Exact scroll offsets aren't stored: reading progress already persists a
// per-file scroll ratio, which restoreScroll() uses for tabs that haven't
// been viewed yet this run.

import { get } from 'svelte/store';
import { activeSession, createSession, sessionPath, sessions, type DocSession } from './sessions';
import { activateSession, ensureSessionLoaded, restoringTab, switchesSettled } from './tabs';
import { settings } from './settings';
import { checkPathsExist, loadSessionJson, saveSessionJson, windowLabel } from '../lib/tauri-api';
import { runOpenExclusive } from '../lib/open-files';

const SCHEMA_VERSION = 1;
const SAVE_DEBOUNCE_MS = 300;

export interface SavedSession {
  tabs: string[];
  active: number;
}

export function serializeSession(tabs: string[], active: number): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, tabs, active });
}

export function parseSession(raw: string | null): SavedSession | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as { schemaVersion?: unknown; tabs?: unknown; active?: unknown };
  if (p.schemaVersion !== SCHEMA_VERSION) return null;
  if (!Array.isArray(p.tabs) || !p.tabs.every((t) => typeof t === 'string')) return null;
  const tabs = p.tabs as string[];
  const rawActive = typeof p.active === 'number' && Number.isInteger(p.active) ? p.active : 0;
  const active = rawActive >= 0 && rawActive < tabs.length ? rawActive : 0;
  return { tabs, active };
}

// Reopen the saved tabs. Files that no longer exist are skipped silently;
// restored tabs are not pushed into recents (the user didn't just open
// them). Runs in the open queue so a double-click arriving meanwhile waits
// its turn.
//
// Startup shows one document as soon as it can, so this only puts the saved
// tabs in the tab bar; none is read yet. The empty start tab stays active,
// placed right after the saved active tab: a file the user double-clicked
// (or the welcome document) loads into it there, which is where it has
// always opened. finishSessionRestore() then shows the saved active tab if
// nothing else was opened, and loadRestoredTabsInBackground() reads the rest
// once that document is on screen.
let startTab: DocSession | null = null;
let savedActiveTab: DocSession | null = null;

export function restoreSavedTabs(): Promise<void> {
  return runOpenExclusive(restoreSavedTabsNow);
}

async function restoreSavedTabsNow(): Promise<void> {
  let saved: SavedSession | null = null;
  try {
    saved = parseSession(await loadSessionJson());
  } catch {
    return;
  }
  if (!saved || saved.tabs.length === 0) return;

  let exists: boolean[];
  try {
    exists = await checkPathsExist(saved.tabs);
  } catch {
    exists = saved.tabs.map(() => true);
  }

  const start = get(activeSession);
  const restored: DocSession[] = [];
  let activeAt = -1;
  for (let i = 0; i < saved.tabs.length; i++) {
    if (!exists[i]) continue;
    const session = createSession();
    session.lazyPath = saved.tabs[i];
    if (i === saved.active) activeAt = restored.length;
    restored.push(session);
  }
  if (restored.length === 0) return;
  // The saved active tab, or the first one when that file is gone.
  if (activeAt < 0) activeAt = 0;
  if (sessionPath(start) !== null || get(sessions).length !== 1) {
    // Something is open already (not at startup): the saved tabs go after
    // it and the saved active one is shown, as they always were.
    sessions.update((l) => {
      const next = [...l];
      next.splice(l.indexOf(start) + 1, 0, ...restored);
      return next;
    });
    await activateSession(restored[activeAt].id);
    return;
  }
  sessions.set([...restored.slice(0, activeAt + 1), start, ...restored.slice(activeAt + 1)]);
  startTab = start;
  savedActiveTab = restored[activeAt];
  restoringTab.set(savedActiveTab);
}

// After the launch's own opens: if nothing loaded into the start tab, show
// the saved active tab (or the next one that can be read), then drop the
// empty start tab so it never shows up as a tab. Every reopened tab is in the
// tab bar while the saved one is read: if the user picks one meanwhile (a
// click, Ctrl+Tab), that switch lands and the saved tab isn't forced over it.
export function finishSessionRestore(): Promise<void> {
  return runOpenExclusive(finishSessionRestoreNow);
}

async function finishSessionRestoreNow(): Promise<void> {
  try {
    await showSavedActiveTab();
  } finally {
    restoringTab.set(null);
  }
}

async function showSavedActiveTab(): Promise<void> {
  const start = startTab;
  const preferred = savedActiveTab;
  startTab = null;
  savedActiveTab = null;
  if (!start || get(start.doc) !== null || start.closed) return;
  if (get(activeSession) === start) {
    const order = get(sessions).filter((s) => s !== start && !s.closed);
    const candidates = preferred && order.includes(preferred)
      ? [preferred, ...order.filter((s) => s !== preferred)]
      : order;
    for (const s of candidates) {
      if (s.closed) continue;
      const ok = s.lazyPath === null || (await ensureSessionLoaded(s));
      await switchesSettled();
      if (get(activeSession) !== start) break;
      if (ok) {
        await activateSession(s.id);
        break;
      }
    }
  }
  if (get(activeSession) !== start) {
    start.closed = true;
    sessions.update((l) => l.filter((s) => s !== start));
  }
}

// Read the reopened tabs that haven't been yet, one at a time and in tab
// order, letting the page breathe in between so scrolling and clicks on the
// document already shown stay smooth. Tabs switched to meanwhile load then
// (sharing the load if this was already reading them).
export async function loadRestoredTabsInBackground(
  breathe: () => Promise<void> = () => Promise.resolve(),
): Promise<void> {
  for (;;) {
    const next = get(sessions).find((s) => s.lazyPath !== null && !s.closed);
    if (!next) return;
    await breathe();
    await ensureSessionLoaded(next);
  }
}

function currentSnapshot(): string {
  const list = get(sessions);
  const withDocs = list.filter((s) => sessionPath(s) !== null);
  const tabs = withDocs.map((s) => sessionPath(s)!);
  const active = Math.max(0, withDocs.indexOf(get(activeSession)));
  return serializeSession(tabs, active);
}

function shouldPersist(): boolean {
  return get(settings).openMode === 'tabs' && windowLabel() === 'main';
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastWritten: string | null = null;

async function writeNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!shouldPersist()) return;
  const json = currentSnapshot();
  if (json === lastWritten) return;
  try {
    await saveSessionJson(json);
    lastWritten = json;
  } catch {
    // Best-effort, like settings.
  }
}

export async function flushSessionNow(): Promise<void> {
  lastWritten = null;
  await writeNow();
}

// Save (debounced) whenever tabs open, close, switch, or a tab's document
// changes path. Returns a dispose function.
export function installSessionAutosave(): () => void {
  const schedule = () => {
    if (!shouldPersist()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void writeNow(); }, SAVE_DEBOUNCE_MS);
  };
  let docUnsubs: Array<() => void> = [];
  const unsubSessions = sessions.subscribe((list) => {
    docUnsubs.forEach((u) => u());
    docUnsubs = list.map((s) => s.doc.subscribe(schedule));
    schedule();
  });
  const unsubActive = activeSession.subscribe(schedule);
  return () => {
    unsubSessions();
    unsubActive();
    docUnsubs.forEach((u) => u());
    docUnsubs = [];
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    lastWritten = null;
  };
}
