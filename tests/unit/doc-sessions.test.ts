import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  readDocument: vi.fn(),
  toAssetUrl: (p: string) => `asset://localhost/${p}`,
}));

// Capture each watcher's onChange so tests can simulate a file change.
const watchers = new Map<string, () => void>();
const disposed: string[] = [];
vi.mock('../../src/lib/file-watch', () => ({
  installFileWatcher: vi.fn(async (path: string, onChange: () => void) => {
    watchers.set(path, onChange);
    return async () => { disposed.push(path); watchers.delete(path); };
  }),
}));

import { readDocument } from '../../src/lib/tauri-api';
import { loadIntoSession, loadDocument } from '../../src/stores/doc';
import { createSession, activeSession, sessions } from '../../src/stores/sessions';
import { docEpoch } from '../../src/stores/annots';

function stubRead(path: string, sha = 'sha-' + path) {
  vi.mocked(readDocument).mockImplementation(async (p: string) => ({
    path: p,
    dir: '/tmp',
    markdown: `# ${p}\n`,
    sidecarRaw: null,
    sha256: p === path ? sha : 'sha-' + p,
    bytes: 8,
  }));
}

describe('per-session loading', () => {
  beforeEach(() => {
    vi.mocked(readDocument).mockReset();
    watchers.clear();
    disposed.length = 0;
  });

  it('loading into a background session leaves the active session alone', async () => {
    stubRead('/b.md');
    const bg = createSession();
    sessions.update((l) => [...l, bg]);
    const epoch = get(docEpoch);
    expect(await loadIntoSession(bg, '/b.md')).toBe(true);
    expect(get(bg.doc)?.path).toBe('/b.md');
    expect(get(get(activeSession).doc)).toBeNull();
    expect(get(docEpoch)).toBe(epoch);
  });

  it('loadDocument loads into the active session and bumps docEpoch', async () => {
    stubRead('/a.md');
    const epoch = get(docEpoch);
    expect(await loadDocument('/a.md')).toBe(true);
    expect(get(get(activeSession).doc)?.path).toBe('/a.md');
    expect(get(docEpoch)).toBeGreaterThan(epoch);
  });

  it('a change to a background file marks it for reload instead of reloading', async () => {
    stubRead('/b.md');
    const bg = createSession();
    await loadIntoSession(bg, '/b.md');
    const calls = vi.mocked(readDocument).mock.calls.length;
    watchers.get('/b.md')!();
    await Promise.resolve();
    expect(bg.pendingDiskReload).toBe(true);
    expect(vi.mocked(readDocument).mock.calls.length).toBe(calls);
  });

  it('a change to the active file reloads it immediately', async () => {
    stubRead('/a.md');
    await loadDocument('/a.md');
    stubRead('/a.md', 'changed');
    watchers.get('/a.md')!();
    await vi.waitFor(() => expect(get(get(activeSession).doc)?.sha256).toBe('changed'));
  });

  it('returns false and keeps the session empty on a read error', async () => {
    vi.mocked(readDocument).mockImplementation(async () => { throw { Io: 'nope' }; });
    const s = createSession();
    expect(await loadIntoSession(s, '/missing.md')).toBe(false);
    expect(get(s.doc)).toBeNull();
  });

  it('a fresh load clears captured scroll and editor state', async () => {
    stubRead('/a.md');
    const s = createSession();
    s.scrollTop = 500;
    s.editorState = {} as never;
    await loadIntoSession(s, '/a.md');
    expect(s.scrollTop).toBeNull();
    expect(s.editorState).toBeNull();
  });

  it('each session keeps its own watcher; reloading replaces only its own', async () => {
    stubRead('/a.md');
    const a = createSession();
    const b = createSession();
    await loadIntoSession(a, '/a.md');
    await loadIntoSession(b, '/b.md');
    expect([...watchers.keys()].sort()).toEqual(['/a.md', '/b.md']);
    stubRead('/a.md', 'v2');
    await loadIntoSession(a, '/a.md');
    expect(disposed).toEqual(['/a.md']);
    expect(watchers.has('/b.md')).toBe(true);
  });
});
