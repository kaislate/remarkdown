import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/stores/doc', async () => {
  const actual = await vi.importActual<typeof import('../../src/stores/doc')>('../../src/stores/doc');
  return { ...actual, reloadSession: vi.fn(async () => {}) };
});

import { reloadSession } from '../../src/stores/doc';
import { createSession, sessions, activeSession, type DocSession } from '../../src/stores/sessions';
import {
  samePath,
  addSession,
  activateSession,
  closeSession,
  cycleSession,
  onBeforeSwitch,
  findSessionByPath,
  closeOtherSessions,
  closeSessionsAfter,
} from '../../src/stores/tabs';
import { reattachTarget } from '../../src/stores/reattach';
import { activeModal, openModal, closeModal } from '../../src/stores/modals';

function withDoc(path: string): DocSession {
  const s = createSession();
  s.doc.set({ path, dir: '/', sha256: 'x', bytes: 1, markdown: '', html: '', plaintext: '', blocks: [], sidecarRaw: null });
  return s;
}

describe('tabs', () => {
  beforeEach(() => vi.mocked(reloadSession).mockClear());

  it('samePath ignores slash style and letter case', () => {
    expect(samePath('C:\\Docs\\A.md', 'c:/docs/a.md')).toBe(true);
    expect(samePath('C:\\Docs\\A.md', 'C:\\Docs\\B.md')).toBe(false);
  });

  it('findSessionByPath matches across slash style and case', () => {
    const a = withDoc('C:\\Docs\\Notes.md');
    addSession(a);
    expect(findSessionByPath('c:/docs/notes.md')).toBe(a);
    expect(findSessionByPath('c:/docs/other.md')).toBeNull();
  });

  it('addSession inserts right after the active tab', () => {
    const first = get(activeSession);
    const a = withDoc('/a.md');
    const b = withDoc('/b.md');
    addSession(a);
    addSession(b);
    expect(get(sessions)).toEqual([first, b, a]);
  });

  it('activateSession runs before-switch hooks with the outgoing session', async () => {
    const outgoing = get(activeSession);
    const b = withDoc('/b.md');
    addSession(b);
    const seen: string[] = [];
    const off = onBeforeSwitch((s) => { seen.push(s.id); });
    await activateSession(b.id);
    off();
    expect(seen).toEqual([outgoing.id]);
    expect(get(activeSession)).toBe(b);
  });

  it('activating the already-active tab is a no-op', async () => {
    const hook = vi.fn();
    const off = onBeforeSwitch(hook);
    await activateSession(get(activeSession).id);
    off();
    expect(hook).not.toHaveBeenCalled();
  });

  it('switching cancels an in-progress re-attach', async () => {
    const b = withDoc('/b.md');
    addSession(b);
    reattachTarget.set({ annotationId: 'x' } as never);
    await activateSession(b.id);
    expect(get(reattachTarget)).toBeNull();
  });

  it('activating a tab whose file changed in the background reloads it', async () => {
    const b = withDoc('/b.md');
    b.pendingDiskReload = true;
    addSession(b);
    await activateSession(b.id);
    expect(reloadSession).toHaveBeenCalledWith(b);
    expect(b.pendingDiskReload).toBe(false);
  });

  it('closing the active tab activates the right neighbour, else the left', async () => {
    const first = get(activeSession);
    first.doc.set({ path: '/0.md' } as never);
    const a = withDoc('/a.md');
    const b = withDoc('/b.md');
    sessions.set([first, a, b]);
    await activateSession(a.id);
    await closeSession(a.id);
    expect(get(activeSession)).toBe(b);
    await closeSession(b.id);
    expect(get(activeSession)).toBe(first);
    expect(get(sessions)).toEqual([first]);
  });

  it('closing a background tab keeps the active tab', async () => {
    const first = get(activeSession);
    const a = withDoc('/a.md');
    addSession(a);
    await closeSession(a.id);
    expect(get(activeSession)).toBe(first);
    expect(get(sessions)).toEqual([first]);
  });

  it('closing the last tab leaves one fresh empty session', async () => {
    const only = withDoc('/a.md');
    sessions.set([only]);
    activeSession.set(only);
    await closeSession(only.id);
    const list = get(sessions);
    expect(list).toHaveLength(1);
    expect(list[0]).not.toBe(only);
    expect(get(list[0].doc)).toBeNull();
    expect(get(activeSession)).toBe(list[0]);
  });

  it('closing disposes the tab watcher and flushes the outgoing tab', async () => {
    const a = withDoc('/a.md');
    const dispose = vi.fn(async () => {});
    a.disposeWatcher = dispose;
    sessions.set([a]);
    activeSession.set(a);
    const hook = vi.fn();
    const off = onBeforeSwitch(hook);
    await closeSession(a.id);
    off();
    expect(dispose).toHaveBeenCalled();
    expect(hook).toHaveBeenCalledWith(a);
  });

  it('cycleSession wraps around in both directions', async () => {
    const first = get(activeSession);
    const a = withDoc('/a.md');
    sessions.set([first, a]);
    await cycleSession(1);
    expect(get(activeSession)).toBe(a);
    await cycleSession(1);
    expect(get(activeSession)).toBe(first);
    await cycleSession(-1);
    expect(get(activeSession)).toBe(a);
  });

  it('switching tabs dismisses dialogs that act on the current document', async () => {
    const b = withDoc('/b.md');
    addSession(b);
    openModal({ kind: 'confirm-clear-annots' });
    await activateSession(b.id);
    expect(get(activeModal)).toBeNull();
  });

  it('switching tabs leaves app-wide dialogs open', async () => {
    const b = withDoc('/b.md');
    addSession(b);
    openModal({ kind: 'settings' });
    await activateSession(b.id);
    expect(get(activeModal)).toEqual({ kind: 'settings' });
    closeModal();
  });

  it('rapid switches: the last one requested wins even if an earlier one finishes later', async () => {
    const b = withDoc('/b.md');
    const c = withDoc('/c.md');
    addSession(b);
    addSession(c);
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => { release = r; });
    let first = true;
    const off = onBeforeSwitch(async () => { if (first) { first = false; await slow; } });
    const toB = activateSession(b.id);   // stalls in its before-switch hook
    const toC = activateSession(c.id);   // requested later
    await toC;
    release();
    await toB;
    off();
    expect(get(activeSession)).toBe(c);
  });

  it('closing marks the session closed', async () => {
    const a = withDoc('/a.md');
    addSession(a);
    await closeSession(a.id);
    expect(a.closed).toBe(true);
  });

  it('closeOtherSessions keeps only that tab and makes it the active one', async () => {
    const a = withDoc('/a.md');
    const b = withDoc('/b.md');
    const c = withDoc('/c.md');
    sessions.set([a, b, c]);
    activeSession.set(c);
    await closeOtherSessions(b.id);
    expect(get(sessions)).toEqual([b]);
    expect(get(activeSession)).toBe(b);
    expect([a.closed, b.closed, c.closed]).toEqual([true, false, true]);
  });

  it('closeSessionsAfter closes the tabs to its right and keeps the active tab when it survives', async () => {
    const a = withDoc('/a.md');
    const b = withDoc('/b.md');
    const c = withDoc('/c.md');
    const d = withDoc('/d.md');
    sessions.set([a, b, c, d]);
    activeSession.set(a);
    await closeSessionsAfter(b.id);
    expect(get(sessions)).toEqual([a, b]);
    expect(get(activeSession)).toBe(a);
  });

  it('closeSessionsAfter moves to that tab when the active tab is among those closed', async () => {
    const a = withDoc('/a.md');
    const b = withDoc('/b.md');
    const c = withDoc('/c.md');
    sessions.set([a, b, c]);
    activeSession.set(c);
    await closeSessionsAfter(a.id);
    expect(get(sessions)).toEqual([a]);
    expect(get(activeSession)).toBe(a);
  });
});
