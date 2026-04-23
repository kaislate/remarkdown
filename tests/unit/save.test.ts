import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  writeSidecar: vi.fn().mockResolvedValue(undefined),
}));

import { writeSidecar } from '../../src/lib/tauri-api';
import { annots } from '../../src/stores/annots';
import { doc } from '../../src/stores/doc';
import { installSaveWatcher, flushSave, SAVE_DEBOUNCE_MS } from '../../src/lib/save';

describe('save', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(writeSidecar).mockReset().mockResolvedValue(undefined);
    annots.set([]);
    doc.set(null);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('does not save when no doc is loaded', async () => {
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(writeSidecar).not.toHaveBeenCalled();
    dispose();
  });

  it('saves after debounce when annots change with a loaded doc', async () => {
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
    expect(writeSidecar).toHaveBeenCalledTimes(1);
    const [mdPath, json] = vi.mocked(writeSidecar).mock.calls[0];
    expect(mdPath).toBe('/tmp/a.md');
    expect(JSON.parse(json).annotations).toHaveLength(1);
    dispose();
  });

  it('collapses rapid changes into a single debounced write', async () => {
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    const dispose = installSaveWatcher();
    const mk = (id: string) => ({
      id, type: 'highlight' as const, color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    });
    annots.set([mk('01A')]);
    await vi.advanceTimersByTimeAsync(100);
    annots.set([mk('01A'), mk('01B')]);
    await vi.advanceTimersByTimeAsync(100);
    annots.set([mk('01A'), mk('01B'), mk('01C')]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(writeSidecar).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('flushSave forces an immediate write and cancels the pending timer', async () => {
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await flushSave();
    expect(writeSidecar).toHaveBeenCalledTimes(1);
    // advance past the debounce — no further writes should fire.
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(writeSidecar).toHaveBeenCalledTimes(1);
    dispose();
  });
});

describe('save retry behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(writeSidecar).mockReset().mockResolvedValue(undefined);
    annots.set([]);
    doc.set(null);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('retries up to 3 times on write failure', async () => {
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    vi.mocked(writeSidecar).mockRejectedValue(new Error('denied'));
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 10);
    // Retries are 100ms, 400ms, 1600ms — total ~2100ms after first failure.
    await vi.advanceTimersByTimeAsync(3000);
    expect(writeSidecar).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    dispose();
  });

  it('sets persistentSaveError after exhausting retries', async () => {
    const { persistentSaveError } = await import('../../src/lib/save');
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    vi.mocked(writeSidecar).mockRejectedValue(new Error('denied'));
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 3100);
    expect(get(persistentSaveError)).toMatch(/denied/);
    dispose();
  });

  it('clears persistentSaveError on a successful save', async () => {
    const { persistentSaveError } = await import('../../src/lib/save');
    doc.set({
      path: '/tmp/a.md', dir: '/tmp', sha256: 'abc', bytes: 1, markdown: '',
      html: '', plaintext: '', blocks: [], sidecarRaw: null,
    });
    persistentSaveError.set('stale');
    vi.mocked(writeSidecar).mockResolvedValue(undefined);
    const dispose = installSaveWatcher();
    annots.set([{
      id: '01A', type: 'highlight', color: '#ffd25a',
      anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
      createdAt: 'now', updatedAt: 'now',
    }]);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(get(persistentSaveError)).toBeNull();
    dispose();
  });
});
