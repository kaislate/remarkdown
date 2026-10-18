// Remembers which tabs were open so the next launch can reopen them
// ("Reopen tabs from last session", tabs mode only). Stored in
// session.json next to settings.json. Only the main window writes it —
// windows opened in new-window mode are single-document and transient.
//
// Exact scroll offsets aren't stored: reading progress already persists a
// per-file scroll ratio, which restoreScroll() uses for tabs that haven't
// been viewed yet this run.

import { get } from 'svelte/store';
import { activeSession, createSession, sessions, type DocSession } from './sessions';
import { loadIntoSession } from './doc';
import { activateSession, addSession } from './tabs';
import { settings } from './settings';
import { checkPathsExist, loadSessionJson, saveSessionJson, windowLabel } from '../lib/tauri-api';

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
// them). The first restored tab reuses the empty start tab.
export async function restoreSavedTabs(): Promise<void> {
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

  let lastAdded: DocSession | null = null;
  let toActivate: DocSession | null = null;
  for (let i = 0; i < saved.tabs.length; i++) {
    if (!exists[i]) continue;
    const path = saved.tabs[i];
    const active = get(activeSession);
    const session: DocSession = get(active.doc) === null && !lastAdded ? active : createSession();
    if (!(await loadIntoSession(session, path))) continue;
    if (session !== active) addSession(session, lastAdded ?? active);
    lastAdded = session;
    if (i === saved.active || !toActivate) toActivate = session;
  }
  if (toActivate) await activateSession(toActivate.id);
}

function currentSnapshot(): string {
  const list = get(sessions);
  const withDocs = list.filter((s) => get(s.doc) !== null);
  const tabs = withDocs.map((s) => get(s.doc)!.path);
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
