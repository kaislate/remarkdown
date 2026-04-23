import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { toasts, clearToasts } from '../../src/stores/toasts';

vi.mock('../../src/lib/tauri-api', () => ({
  readDocument: vi.fn(),
  toAssetUrl: (p: string) => `asset://localhost/${p}`,
}));

import { readDocument } from '../../src/lib/tauri-api';
import { doc, loadDocument, clearDocument } from '../../src/stores/doc';
import { loadSidecar, serializeSidecar, emptySidecar } from '../../src/lib/sidecar';
import { annots, docEpoch } from '../../src/stores/annots';

describe('doc store', () => {
  beforeEach(() => {
    vi.mocked(readDocument).mockReset();
    clearDocument();
  });

  it('starts as null', () => {
    expect(get(doc)).toBeNull();
  });

  it('loadDocument populates the store with rendered html', async () => {
    vi.mocked(readDocument).mockResolvedValue({
      path: '/tmp/a.md',
      dir: '/tmp',
      markdown: '# Hello\n',
      sidecarRaw: null,
      sha256: 'abc',
      bytes: 8,
    });
    await loadDocument('/tmp/a.md');
    const value = get(doc);
    expect(value).not.toBeNull();
    expect(value!.path).toBe('/tmp/a.md');
    expect(value!.html).toContain('Hello');
    expect(value!.sha256).toBe('abc');
  });
});

describe('doc store — sidecar annotations', () => {
  beforeEach(() => {
    vi.mocked(readDocument).mockReset();
    clearDocument();
    annots.set([]);
  });

  it('populates annots from a valid sidecar', async () => {
    const sidecar = emptySidecar({ path: '/tmp/a.md', sha256: 'abc', lastSeenBytes: 8 });
    (sidecar.annotations as any[]).push({
      id: '01Z',
      type: 'highlight',
      color: '#ffd25a',
      anchor: { text: 'Hello', prefix: '', suffix: '\n', blockHint: 'h:1' },
      createdAt: '2026-04-20T00:00:00Z',
      updatedAt: '2026-04-20T00:00:00Z',
    });
    vi.mocked(readDocument).mockResolvedValue({
      path: '/tmp/a.md',
      dir: '/tmp',
      markdown: '# Hello\n',
      sidecarRaw: serializeSidecar(sidecar),
      sha256: 'abc',
      bytes: 8,
    });
    await loadDocument('/tmp/a.md');
    expect(get(annots)).toHaveLength(1);
    expect(get(annots)[0].id).toBe('01Z');
  });

  it('starts with empty annotations when sidecar is null', async () => {
    vi.mocked(readDocument).mockResolvedValue({
      path: '/tmp/a.md',
      dir: '/tmp',
      markdown: '# Hello\n',
      sidecarRaw: null,
      sha256: 'abc',
      bytes: 8,
    });
    await loadDocument('/tmp/a.md');
    expect(get(annots)).toEqual([]);
  });

  it('starts with empty annotations and logs on malformed sidecar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(readDocument).mockResolvedValue({
      path: '/tmp/a.md',
      dir: '/tmp',
      markdown: '# Hello\n',
      sidecarRaw: '{ not json',
      sha256: 'abc',
      bytes: 8,
    });
    await loadDocument('/tmp/a.md');
    expect(get(annots)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('increments docEpoch on every load', async () => {
    const before = get(docEpoch);
    vi.mocked(readDocument).mockResolvedValue({
      path: '/tmp/a.md',
      dir: '/tmp',
      markdown: '',
      sidecarRaw: null,
      sha256: 'a',
      bytes: 0,
    });
    await loadDocument('/tmp/a.md');
    expect(get(docEpoch)).toBe(before + 1);
  });
});

describe('doc store — error surfacing', () => {
  beforeEach(() => { clearToasts(); });

  it('surfaces a toast when readDocument throws a non-UTF-8 error', async () => {
    vi.mocked(readDocument).mockRejectedValue({ NotUtf8: null });
    await loadDocument('/tmp/bin.md');
    const list = get(toasts);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].kind).toBe('error');
    expect(list[0].message).toMatch(/utf-8/i);
  });

  it('surfaces a toast when readDocument throws an Io error', async () => {
    vi.mocked(readDocument).mockRejectedValue({ Io: 'file not found' });
    await loadDocument('/tmp/missing.md');
    const list = get(toasts);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].kind).toBe('error');
    expect(list[0].message).toMatch(/file not found/i);
  });
});
