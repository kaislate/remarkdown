import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  writeSidecar: vi.fn().mockResolvedValue(undefined),
}));

import { writeSidecar } from '../../src/lib/tauri-api';
import { annots } from '../../src/stores/annots';
import { installSaveWatcher, SAVE_DEBOUNCE_MS } from '../../src/lib/save';
import { createSession, sessions, activeSession } from '../../src/stores/sessions';
import { activateSession } from '../../src/stores/tabs';
import type { Annotation } from '../../src/lib/schema';

const hl = (id: string): Annotation => ({
  id, type: 'highlight', color: '#ffd25a',
  anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
  createdAt: 'now', updatedAt: 'now',
} as Annotation);

function docFor(path: string) {
  return { path, dir: '/', sha256: 'abc', bytes: 1, markdown: '', html: '', plaintext: '', blocks: [], sidecarRaw: null };
}

describe('save across tabs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(writeSidecar).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('a tab switch alone does not write the incoming tab sidecar', async () => {
    const a = get(activeSession);
    a.doc.set(docFor('/a.md'));
    const b = createSession();
    b.doc.set(docFor('/b.md'));
    b.annots.set([hl('b1')]);
    sessions.set([a, b]);
    const dispose = installSaveWatcher();
    await activateSession(b.id);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(writeSidecar).not.toHaveBeenCalled();
    dispose();
  });

  it('a pending save for the outgoing tab is flushed to its own path on switch', async () => {
    const a = get(activeSession);
    a.doc.set(docFor('/a.md'));
    const b = createSession();
    b.doc.set(docFor('/b.md'));
    sessions.set([a, b]);
    const dispose = installSaveWatcher();
    annots.set([hl('a1')]); // pending (debounced) save for A
    await activateSession(b.id);
    expect(writeSidecar).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeSidecar).mock.calls[0][0]).toBe('/a.md');
    dispose();
  });

  it('annotation changes after a switch save to the new tab path', async () => {
    const a = get(activeSession);
    a.doc.set(docFor('/a.md'));
    const b = createSession();
    b.doc.set(docFor('/b.md'));
    sessions.set([a, b]);
    const dispose = installSaveWatcher();
    await activateSession(b.id);
    annots.set([hl('b1')]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(writeSidecar).toHaveBeenCalledTimes(1);
    expect(vi.mocked(writeSidecar).mock.calls[0][0]).toBe('/b.md');
    expect(JSON.parse(vi.mocked(writeSidecar).mock.calls[0][1]).annotations[0].id).toBe('b1');
    dispose();
  });
});
