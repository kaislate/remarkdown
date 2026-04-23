import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  readDocument: vi.fn(),
  toAssetUrl: (p: string) => `asset://localhost/${p}`,
}));

import { readDocument } from '../../src/lib/tauri-api';
import { doc, loadDocument, clearDocument } from '../../src/stores/doc';

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
