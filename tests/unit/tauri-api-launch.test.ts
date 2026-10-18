import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));
// listen() is unavailable outside Tauri; the wrapper must still register
// the callback locally so tests (and the e2e bridge) can fire it.
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockRejectedValue(new Error('no tauri')),
}));

import { invoke } from '@tauri-apps/api/core';
import {
  takePendingOpens,
  openDocumentWindow,
  loadSessionJson,
  saveSessionJson,
  onOpenRequested,
  fireOpenRequestedForTests,
  windowLabel,
} from '../../src/lib/tauri-api';

describe('launch / session IPC wrappers', () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it('takePendingOpens invokes take_pending_opens', async () => {
    vi.mocked(invoke).mockResolvedValue(['/a.md']);
    expect(await takePendingOpens()).toEqual(['/a.md']);
    expect(invoke).toHaveBeenCalledWith('take_pending_opens');
  });

  it('openDocumentWindow passes the path', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await openDocumentWindow('/a.md');
    expect(invoke).toHaveBeenCalledWith('open_document_window', { path: '/a.md' });
  });

  it('session json round-trips through load_session / save_session', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined).mockResolvedValueOnce('{"x":1}');
    await saveSessionJson('{"x":1}');
    expect(invoke).toHaveBeenCalledWith('save_session', { json: '{"x":1}' });
    expect(await loadSessionJson()).toBe('{"x":1}');
    expect(invoke).toHaveBeenLastCalledWith('load_session');
  });

  it('onOpenRequested callbacks fire until unlistened', async () => {
    const cb = vi.fn();
    const un = await onOpenRequested(cb);
    fireOpenRequestedForTests();
    expect(cb).toHaveBeenCalledTimes(1);
    un();
    fireOpenRequestedForTests();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('windowLabel defaults to main outside Tauri', () => {
    expect(windowLabel()).toBe('main');
  });
});

// Kept outside the describe above: vitest 2.1.9 reports a rejection that the
// wrapper catches as a test failure when the mock was reset/cleared in a
// beforeEach in the same scope. Standalone, the behaviour is observable.
it('takePendingOpens returns [] when the command is unavailable', async () => {
  vi.mocked(invoke).mockImplementation(async () => { throw new Error('no tauri'); });
  expect(await takePendingOpens()).toEqual([]);
});
