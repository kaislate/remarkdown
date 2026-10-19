import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

// Edit-mode autosave must never silently overwrite a file another program
// changed while the user was editing. On a conflict, saving pauses and the
// user picks: keep mine, use theirs, or save mine as a copy.

vi.mock('../../src/lib/tauri-api', () => ({
  writeDocument: vi.fn(),
  checkPathsExist: vi.fn(async (ps: string[]) => ps.map(() => false)),
}));
vi.mock('../../src/stores/doc', async () => {
  const actual = await vi.importActual<typeof import('../../src/stores/doc')>('../../src/stores/doc');
  return { ...actual, loadIntoSession: vi.fn(async () => true) };
});
vi.mock('../../src/lib/open-files', () => ({ openPaths: vi.fn(async () => 1) }));

import { writeDocument, checkPathsExist } from '../../src/lib/tauri-api';
import { loadIntoSession } from '../../src/stores/doc';
import { openPaths } from '../../src/lib/open-files';
import { saveEditedMarkdown, resolveEditConflict, copyPathFor } from '../../src/lib/edit-save';
import { createSession, type DocSession } from '../../src/stores/sessions';
import { activeModal, closeModal } from '../../src/stores/modals';

function editing(path = 'C:\\docs\\Plan.md'): DocSession {
  const s = createSession();
  s.doc.set({ path, dir: 'C:\\docs', sha256: 'sha-v1', bytes: 1, markdown: 'v1', html: '', plaintext: '', blocks: [], sidecarRaw: null });
  s.diskSha = 'sha-v1';
  s.editMode.set(true);
  return s;
}

const conflict = () => Promise.reject({ Conflict: 'sha-theirs' });

describe('saveEditedMarkdown', () => {
  beforeEach(() => {
    vi.mocked(writeDocument).mockReset();
    vi.mocked(loadIntoSession).mockClear();
    vi.mocked(openPaths).mockClear();
    closeModal();
  });

  it('writes against the last known disk version and remembers the new one', async () => {
    const s = editing();
    vi.mocked(writeDocument).mockResolvedValue('sha-v2');
    await saveEditedMarkdown(s, 'C:\\docs\\Plan.md', 'v2');
    expect(writeDocument).toHaveBeenCalledWith('C:\\docs\\Plan.md', 'v2', 'sha-v1');
    expect(s.diskSha).toBe('sha-v2');
  });

  it('on a conflict: nothing is written, saving pauses, and the user is asked', async () => {
    const s = editing();
    vi.mocked(writeDocument).mockImplementation(conflict);
    await saveEditedMarkdown(s, 'C:\\docs\\Plan.md', 'mine');
    expect(s.editConflict).toEqual({ path: 'C:\\docs\\Plan.md', markdown: 'mine' });
    expect(get(activeModal)).toEqual({ kind: 'edit-conflict', sessionId: s.id });
    vi.mocked(writeDocument).mockClear();
    await saveEditedMarkdown(s, 'C:\\docs\\Plan.md', 'mine, more');
    expect(writeDocument).not.toHaveBeenCalled();
    // The decision will be about the newest text.
    expect(s.editConflict?.markdown).toBe('mine, more');
  });

  it('keep mine: writes the recorded text to the recorded file and resumes saving', async () => {
    const s = editing();
    s.editConflict = { path: 'C:\\docs\\Plan.md', markdown: 'mine, latest' };
    s.editedMarkdown = 'something the tab shows later';
    vi.mocked(writeDocument).mockResolvedValue('sha-mine');
    await resolveEditConflict(s, 'keep');
    expect(writeDocument).toHaveBeenCalledWith('C:\\docs\\Plan.md', 'mine, latest', null);
    expect(s.editConflict).toBeNull();
    expect(s.diskSha).toBe('sha-mine');
  });

  it('use theirs: drops my pending edits (even a late flush) and reloads from disk', async () => {
    const s = editing();
    s.editConflict = { path: 'C:\\docs\\Plan.md', markdown: 'mine' };
    s.editedMarkdown = 'mine';
    vi.mocked(loadIntoSession).mockImplementation(async () => {
      // The editor's debounced save flushes while the document reloads.
      await saveEditedMarkdown(s, 'C:\\docs\\Plan.md', 'mine');
      return true;
    });
    await resolveEditConflict(s, 'theirs');
    expect(writeDocument).not.toHaveBeenCalled();
    expect(loadIntoSession).toHaveBeenCalledWith(s, 'C:\\docs\\Plan.md', { force: true });
    expect(s.editConflict).toBeNull();
    expect(s.editedMarkdown).toBeNull();
    expect(s.discardPendingEdits).toBe(false);
  });

  it('save mine as a copy: writes a sibling copy, opens it, and reloads this tab', async () => {
    const s = editing();
    s.editConflict = { path: 'C:\\docs\\Plan.md', markdown: 'mine' };
    s.editedMarkdown = 'mine';
    vi.mocked(writeDocument).mockResolvedValue('sha-copy');
    await resolveEditConflict(s, 'copy');
    expect(writeDocument).toHaveBeenCalledWith('C:\\docs\\Plan (my copy).md', 'mine', null);
    expect(openPaths).toHaveBeenCalledWith(['C:\\docs\\Plan (my copy).md'], { mode: 'tabs' });
    expect(loadIntoSession).toHaveBeenCalledWith(s, 'C:\\docs\\Plan.md', { force: true });
    expect(s.editConflict).toBeNull();
  });

  it('copy names never clobber an existing file', async () => {
    vi.mocked(checkPathsExist).mockImplementation(async (ps: string[]) =>
      ps.map((p) => p.endsWith('Plan (my copy).md') || p.endsWith('Plan (my copy 2).md')));
    expect(await copyPathFor('C:\\docs\\Plan.md')).toBe('C:\\docs\\Plan (my copy 3).md');
    expect(await copyPathFor('/home/k/notes.markdown')).toMatch(/notes \(my copy( \d)?\)\.markdown$/);
  });

  it('if it cannot check which copy names are taken, it refuses instead of guessing', async () => {
    vi.mocked(checkPathsExist).mockImplementation(() => Promise.reject(new Error('io')));
    await expect(copyPathFor('C:\\docs\\Plan.md')).rejects.toThrow();
  });
});
