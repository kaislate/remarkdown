// Tab operations over document sessions: add, switch, close, cycle.
//
// Switching never reloads from disk. The outgoing tab gets a chance to
// stash what only the live UI knows (scroll offset, editor state, pending
// autosaves) through before-switch hooks registered by the components that
// own that state; the incoming tab's stores are already complete, so the
// proxies re-emit and the UI redraws from memory.

import { get } from 'svelte/store';
import { tick } from 'svelte';
import { activeSession, createSession, sessions, type DocSession } from './sessions';
import { docEpoch } from './annots';
import { reloadSession } from './doc';
import { cancelReattach } from './reattach';
import { viewerScroll } from './viewport';
import { getProgressFor } from './reading-progress';
import { askAboutConflict, savesSettled } from '../lib/edit-save';
import { activeModal, closeModal } from './modals';

type BeforeSwitchHook = (outgoing: DocSession) => void | Promise<void>;
const beforeSwitchHooks = new Set<BeforeSwitchHook>();

// Register work that must happen before the active tab changes or closes
// (flush saves, capture scroll / editor state). Returns an unregister fn.
export function onBeforeSwitch(hook: BeforeSwitchHook): () => void {
  beforeSwitchHooks.add(hook);
  return () => { beforeSwitchHooks.delete(hook); };
}

// Runs every before-switch hook for the active tab. Also used on window
// close so the last edits are flushed.
export async function runBeforeSwitch(): Promise<void> {
  const outgoing = get(activeSession);
  for (const hook of [...beforeSwitchHooks]) {
    try {
      await hook(outgoing);
    } catch (err) {
      console.error('[remarkdown] before-switch hook failed:', err);
    }
  }
}

// Windows paths: the same file can arrive as C:\Docs\A.md or c:/docs/a.md.
function normalisePath(p: string): string {
  return p.replace(/\//g, '\\').toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return normalisePath(a) === normalisePath(b);
}

export function findSessionByPath(path: string): DocSession | null {
  return get(sessions).find((s) => {
    const d = get(s.doc);
    return !!d && samePath(d.path, path);
  }) ?? null;
}

// New tabs open right after the active one, like a browser. Pass `after`
// to keep a batch (several files opened at once) in its original order.
export function addSession(session: DocSession, after: DocSession = get(activeSession)): void {
  sessions.update((list) => {
    const i = list.indexOf(after);
    const next = [...list];
    next.splice(i + 1, 0, session);
    return next;
  });
}

// Dialogs that act on "the current document" must not survive a switch,
// or confirming one would act on the newly shown tab instead.
function dismissDocumentDialogs(): void {
  const m = get(activeModal);
  if (m && (m.kind === 'confirm-clear-annots' || m.kind === 'orphans')) closeModal();
}

function setActive(session: DocSession): void {
  dismissDocumentDialogs();
  activeSession.set(session);
  docEpoch.update((e) => e + 1);
  restoreScroll(session);
}

// Each switch/close takes a ticket; a switch whose before-switch work
// finishes after a newer request was made doesn't apply (rapid clicks must
// land on the last tab clicked).
let switchTicket = 0;

export async function activateSession(id: string): Promise<void> {
  const target = get(sessions).find((s) => s.id === id);
  if (!target || target === get(activeSession)) return;
  const ticket = ++switchTicket;
  cancelReattach();
  await runBeforeSwitch();
  if (ticket !== switchTicket || target.closed) return;
  setActive(target);
  if (target.pendingDiskReload) {
    target.pendingDiskReload = false;
    // Let the incoming tab's page render first: the reload's "N
    // re-anchored" count compares annotations against it.
    await tick();
    await reloadSession(target);
  }
}

// Put the tab back where the user left it: the exact offset captured on
// switch-away, or — for a tab never viewed this run (restored / just
// opened) — the saved reading-progress ratio.
//
// Runs as soon as Svelte has applied the switch to the DOM (tick), not
// frames later: the tab's content is already in memory, and setting
// scrollTop forces layout. A deferred restore would race the user — a
// scroll made right after switching would be yanked back.
export function restoreScroll(session: DocSession): void {
  void tick().then(() => {
    if (get(activeSession) !== session) return;
    const el = get(viewerScroll);
    if (!el) return;
    if (session.scrollTop != null) {
      el.scrollTop = session.scrollTop;
      return;
    }
    const d = get(session.doc);
    if (!d) return;
    const progress = getProgressFor(d.path);
    const max = el.scrollHeight - el.clientHeight;
    if (progress && progress.scrollRatio > 0.001 && max > 0) {
      el.scrollTop = max * progress.scrollRatio;
    }
  });
}

export async function closeSession(id: string): Promise<void> {
  const list = get(sessions);
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return;
  const closing = list[idx];

  // Never close away edits the user hasn't decided about: if the tab's last
  // save hit a conflict (or one is pending), keep it open and ask.
  const keepForConflict = () => {
    if (!closing.editConflict) return false;
    closing.closed = false;
    if (closing !== get(activeSession)) void activateSession(closing.id);
    askAboutConflict(closing);
    return true;
  };
  if (keepForConflict()) return;

  if (closing === get(activeSession)) {
    const ticket = ++switchTicket;
    cancelReattach();
    await runBeforeSwitch();
    if (keepForConflict()) return;
    closing.closed = true;
    // A newer switch may have happened meanwhile — then leave it be, unless
    // the closing tab is somehow still the visible one.
    if (ticket === switchTicket || get(activeSession) === closing) {
      const current = get(sessions).filter((s) => s === closing || !s.closed);
      const i = current.indexOf(closing);
      const neighbour = current[i + 1] ?? current[i - 1] ?? null;
      if (neighbour) {
        setActive(neighbour);
      } else {
        // Closing the last tab: the window goes back to the empty state.
        const fresh = createSession();
        sessions.set([fresh]);
        setActive(fresh);
      }
    }
  } else {
    // A background tab: its pending save was flushed when the user left it,
    // but may still be in flight.
    await savesSettled(closing);
    if (keepForConflict()) return;
    closing.closed = true;
  }

  if (closing.disposeWatcher) {
    await closing.disposeWatcher();
    closing.disposeWatcher = null;
  }
  // When the last tab closed, `sessions` is already [fresh]: a no-op.
  sessions.update((l) => l.filter((s) => s !== closing));
}

export async function cycleSession(delta: 1 | -1): Promise<void> {
  const list = get(sessions);
  if (list.length < 2) return;
  const i = list.indexOf(get(activeSession));
  await activateSession(list[(i + delta + list.length) % list.length].id);
}

// Bulk closes from the tab context menu. The tab the user right-clicked
// becomes (or stays) the visible one first, so closing the rest never
// flashes a neighbour that is about to go too.
async function closeAllBut(keep: DocSession, closing: DocSession[]): Promise<void> {
  if (closing.includes(get(activeSession))) await activateSession(keep.id);
  for (const s of closing) await closeSession(s.id);
}

export async function closeOtherSessions(id: string): Promise<void> {
  const list = get(sessions);
  const keep = list.find((s) => s.id === id);
  if (!keep) return;
  await closeAllBut(keep, list.filter((s) => s !== keep));
}

// "Close tabs to the right" (or "below", with tabs on the left).
export async function closeSessionsAfter(id: string): Promise<void> {
  const list = get(sessions);
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return;
  await closeAllBut(list[i], list.slice(i + 1));
}
