import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

// End-to-end flows around edit conflicts, against a fake disk with
// write_document's real semantics (refuse on a stale sha; return the sha of
// what was written). Each scenario once lost or misplaced the user's edits.

const disk: Record<string, string> = {};
const sha = (s: string) => 'sha:' + s;
const writes: Array<{ path: string; md: string; expected: string | null }> = [];

vi.mock('../../src/components/Editor.svelte', async () => {
  const { default: Stub } = await import('./fixtures/EditorStub.svelte');
  return { default: Stub };
});
vi.mock('../../src/lib/tauri-api', () => ({
  readDocument: vi.fn(async (p: string) => {
    await Promise.resolve();
    if (!(p in disk)) throw { Io: 'missing' };
    return { path: p, dir: '/', markdown: disk[p], sidecarRaw: null, sha256: sha(disk[p]), bytes: disk[p].length };
  }),
  writeDocument: vi.fn(async (p: string, md: string, expected: string | null = null) => {
    await Promise.resolve();
    writes.push({ path: p, md, expected });
    if (expected != null && p in disk && sha(disk[p]) !== expected) throw { Conflict: sha(disk[p]) };
    disk[p] = md;
    return sha(md);
  }),
  checkPathsExist: vi.fn(async (ps: string[]) => ps.map((p) => p in disk)),
  toAssetUrl: (p: string) => p,
}));
vi.mock('../../src/lib/file-watch', () => ({
  installFileWatcher: vi.fn(async () => async () => {}),
}));
vi.mock('../../src/stores/recent', () => ({ recordRecent: vi.fn(async () => {}) }));

import Viewer from '../../src/components/Viewer.svelte';
import EditConflictModal from '../../src/components/EditConflictModal.svelte';
import { createSession, sessions, activeSession, type DocSession } from '../../src/stores/sessions';
import { activateSession, closeSession } from '../../src/stores/tabs';
import { loadIntoSession } from '../../src/stores/doc';
import { resolveEditConflict, saveEditedMarkdown } from '../../src/lib/edit-save';
import { activeModal, closeModal, openModal } from '../../src/stores/modals';
import { updateSettings } from '../../src/stores/settings';
import { openPaths } from '../../src/lib/open-files';

async function settle(n = 10) { for (let i = 0; i < n; i++) { await tick(); await Promise.resolve(); } }
const typeOnce = () => fireEvent.click(screen.getByTestId('editor-stub-type'));
const dialog = () => document.querySelector('[role="alertdialog"]');

beforeEach(() => {
  for (const k of Object.keys(disk)) delete disk[k];
  writes.length = 0;
  closeModal();
  updateSettings({ saveDebounceMs: 5000, openMode: 'tabs', openInEditMode: false, openInFocusMode: false });
});

async function openEditing(path: string, content: string): Promise<DocSession> {
  disk[path] = content;
  const s = get(activeSession);
  await loadIntoSession(s, path);
  await settle();
  s.editMode.set(true);
  await settle();
  return s;
}

async function background(path: string, content: string): Promise<DocSession> {
  const s = createSession();
  disk[path] = content;
  await loadIntoSession(s, path);
  sessions.update((l) => [...l, s]);
  return s;
}

describe('edit conflicts — the user\'s text always survives', () => {
  it('Done with an unsaved edit that conflicts: "Keep my version" keeps MY text', async () => {
    render(Viewer); render(EditConflictModal);
    await settle();
    const a = await openEditing('/a.md', 'original\n');
    await typeOnce();
    disk['/a.md'] = 'theirs\n';
    a.editMode.set(false); // Done, before the debounce fires
    await settle(30);
    expect(dialog()).not.toBeNull();
    await resolveEditConflict(a, 'keep');
    await settle(20);
    expect(disk['/a.md']).toBe('original typed\n');
    expect(get(a.doc)?.markdown).toBe('original typed\n'); // the page shows it too
  });

  it('closing a tab whose last edit conflicts keeps the tab open and asks', async () => {
    render(Viewer); render(EditConflictModal);
    await settle();
    const a = await openEditing('/a.md', 'original\n');
    await background('/b.md', 'b\n');
    await typeOnce();
    disk['/a.md'] = 'theirs\n';
    await closeSession(a.id);
    await settle(30);
    expect(get(sessions)).toContain(a);
    expect(get(activeSession)).toBe(a);
    expect(dialog()).not.toBeNull();
    await resolveEditConflict(a, 'copy');
    await settle(20);
    expect(disk['/a (my copy).md']).toBe('original typed\n');
    await closeSession(a.id);
    await settle(20);
    expect(get(sessions)).not.toContain(a);
  });

  it('a conflict dialog whose tab no longer exists closes itself', async () => {
    render(EditConflictModal);
    openModal({ kind: 'edit-conflict', sessionId: 'gone' });
    await settle();
    expect(get(activeModal)).toBeNull();
  });

  it('"Use the other version" reloads even when the other version is the original file', async () => {
    updateSettings({ saveDebounceMs: 100 });
    render(Viewer); render(EditConflictModal);
    await settle();
    const a = await openEditing('/a.md', 'original\n');
    await typeOnce();
    await new Promise((r) => setTimeout(r, 200)); await settle();
    expect(disk['/a.md']).toBe('original typed\n');
    disk['/a.md'] = 'original\n'; // e.g. git checkout -- a.md
    await typeOnce();
    await new Promise((r) => setTimeout(r, 200)); await settle();
    expect(dialog()).not.toBeNull();
    const w = window as unknown as { __editorMounts?: number };
    const mountsBefore = w.__editorMounts ?? 0;
    await resolveEditConflict(a, 'theirs');
    await settle(30);
    // The editor must start over on the disk text (the real editor only
    // reads its text when it mounts), with no pending text of mine left.
    expect(w.__editorMounts ?? 0).toBeGreaterThan(mountsBefore);
    expect(screen.getByTestId('editor-stub').textContent).toBe('original\n');
    expect(a.editedMarkdown).toBeNull();
    expect(disk['/a.md']).toBe('original\n');
  });

  it('opening another file into a tab being edited never writes one file over the other', async () => {
    updateSettings({ openMode: 'replace' });
    render(Viewer); render(EditConflictModal);
    await settle();
    await openEditing('/a.md', 'A content\n');
    await typeOnce();
    disk['/b.md'] = 'B content\n';
    await openPaths(['/b.md']);
    await settle(30);
    expect(disk['/a.md']).toBe('A content typed\n'); // A's edit saved to A
    expect(get(get(activeSession).doc)?.path).toBe('/b.md');
    expect(get(get(activeSession).editMode)).toBe(false);
    await openPaths(['/a.md']);
    await settle(30);
    expect(disk['/b.md']).toBe('B content\n');
    expect(dialog()).toBeNull();
  });

  it('with "open ready to edit", replacing a document shows the new one in the editor', async () => {
    updateSettings({ openMode: 'replace', openInEditMode: true });
    render(Viewer);
    await settle();
    disk['/a.md'] = 'A content\n';
    await openPaths(['/a.md']); await settle(20);
    await typeOnce();
    disk['/b.md'] = 'B content\n';
    await openPaths(['/b.md']); await settle(30);
    expect(screen.getByTestId('editor-stub').textContent).toBe('B content\n');
    expect(disk['/a.md']).toBe('A content typed\n');
  });

  it('two of my own saves in flight never look like someone else\'s change', async () => {
    disk['/a.md'] = 'v1\n';
    const a = get(activeSession);
    await loadIntoSession(a, '/a.md');
    a.editMode.set(true);
    const s1 = saveEditedMarkdown(a, '/a.md', 'v2\n');
    const s2 = saveEditedMarkdown(a, '/a.md', 'v3\n');
    await Promise.all([s1, s2]); await settle();
    expect(get(activeModal)).toBeNull();
    expect(disk['/a.md']).toBe('v3\n');
  });

  it('a conflict prompt pushed aside by another dialog comes back on the next save', async () => {
    render(EditConflictModal);
    disk['/a.md'] = 'v1\n';
    const a = get(activeSession);
    await loadIntoSession(a, '/a.md');
    a.editMode.set(true);
    disk['/a.md'] = 'theirs\n';
    await saveEditedMarkdown(a, '/a.md', 'mine 1\n');
    expect(get(activeModal)).toEqual({ kind: 'edit-conflict', sessionId: a.id });
    openModal({ kind: 'settings' }); // something else takes the dialog slot
    await saveEditedMarkdown(a, '/a.md', 'mine 2\n');
    expect(get(activeModal)).toEqual({ kind: 'edit-conflict', sessionId: a.id });
    await resolveEditConflict(a, 'keep');
    expect(disk['/a.md']).toBe('mine 2\n'); // the latest text, not the first
  });
});
