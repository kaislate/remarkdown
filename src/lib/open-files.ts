// The one place files get opened. Double-click / "Open with" (via the
// launch queue), the Open… menu item, Open Recent, drag-and-drop and the tab
// bar's + button all come through openPaths(), so they all honour the
// user's "When opening a file" setting:
//
//   tabs     — already open here → switch to it; the empty start tab is
//              reused; otherwise a new tab. The last file opened is shown.
//   replace  — load into the current tab (the pre-tabs behaviour).
//   windows  — use this window while it's empty, otherwise a new window.

import { get } from 'svelte/store';
import { settings } from '../stores/settings';
import { activeSession, createSession, type DocSession } from '../stores/sessions';
import { loadIntoSession } from '../stores/doc';
import { activateSession, addSession, findSessionByPath } from '../stores/tabs';
import { recordRecent } from '../stores/recent';
import { addToast } from '../stores/toasts';
import { openDocumentWindow, openFileDialog, takePendingOpens } from './tauri-api';

// Opens run one at a time. They can overlap in practice — the startup
// drain and an 'open-requested' event (Explorer multi-select launches a
// process per file), a double-click while saved tabs are restoring — and
// each one decides "is the start tab empty?" / "is this file already
// open?" before awaiting a load. Interleaved, two files could load into
// the same empty tab (one silently lost) or one file into two tabs.
let openQueue: Promise<unknown> = Promise.resolve();

export function runOpenExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = openQueue.then(fn);
  openQueue = run.catch(() => undefined);
  return run;
}

// Returns how many of `paths` ended up open (including ones that were
// already open). Failures have already been reported with a toast.
export function openPaths(paths: string[]): Promise<number> {
  return runOpenExclusive(() => openPathsNow(paths));
}

async function openPathsNow(paths: string[]): Promise<number> {
  const mode = get(settings).openMode;
  let opened = 0;
  let toActivate: DocSession | null = null;
  let lastAdded: DocSession | null = null;

  for (const path of paths) {
    if (mode === 'tabs') {
      const existing = findSessionByPath(path);
      if (existing) {
        toActivate = existing;
        opened += 1;
        continue;
      }
    }

    const active = get(activeSession);
    const activeEmpty = get(active.doc) === null;

    if (mode === 'replace' || activeEmpty) {
      if (await loadIntoSession(active, path)) {
        opened += 1;
        toActivate = null; // it's already the visible tab
        await record(path);
      }
      continue;
    }

    if (mode === 'windows') {
      try {
        await openDocumentWindow(path);
        opened += 1;
        await record(path);
      } catch (err) {
        addToast({ kind: 'error', message: `Could not open a new window: ${String(err)}` });
      }
      continue;
    }

    // Tabs: load in the background first so the user never sees an empty
    // tab flash, then insert it (after the previous one from this batch).
    const session = createSession();
    if (await loadIntoSession(session, path)) {
      addSession(session, lastAdded ?? active);
      lastAdded = session;
      toActivate = session;
      opened += 1;
      await record(path);
    }
  }

  if (toActivate) await activateSession(toActivate.id);
  return opened;
}

async function record(path: string): Promise<void> {
  try {
    await recordRecent(path);
  } catch {
    // Recents are a convenience; never fail an open over them.
  }
}

// Open whatever the OS handed us (launch argv, or a second launch while
// we're running). Safe to call concurrently: the Rust queue drains once.
export async function drainPendingOpens(): Promise<number> {
  return openPaths(await takePendingOpens());
}

export async function openViaDialog(): Promise<void> {
  const path = await openFileDialog();
  if (path) await openPaths([path]);
}
