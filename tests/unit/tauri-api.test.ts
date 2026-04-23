import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the @tauri-apps/api modules so tests run without a Tauri runtime.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import { invoke } from '@tauri-apps/api/core';
import { openFileDialog, readDocument, writeSidecar, pushRecent, listRecent, toAssetUrl } from '../../src/lib/tauri-api';

describe('tauri-api wrapper', () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it('openFileDialog calls "open_file_dialog" and returns the path', async () => {
    vi.mocked(invoke).mockResolvedValue('/tmp/x.md');
    const result = await openFileDialog();
    expect(invoke).toHaveBeenCalledWith('open_file_dialog');
    expect(result).toBe('/tmp/x.md');
  });

  it('readDocument passes the path arg and returns typed result (snake_case from Rust)', async () => {
    // Rust serde serializes fields as snake_case by default — test with that shape.
    vi.mocked(invoke).mockResolvedValue({
      path: '/tmp/x.md',
      dir: '/tmp',
      markdown: '# hi',
      sidecar_raw: null,
      sha256: 'abc',
      bytes: 4,
    });
    const result = await readDocument('/tmp/x.md');
    expect(invoke).toHaveBeenCalledWith('read_document', { path: '/tmp/x.md' });
    expect(result.markdown).toBe('# hi');
    expect(result.sidecarRaw).toBeNull();
  });

  it('readDocument surfaces sidecar_raw content', async () => {
    vi.mocked(invoke).mockResolvedValue({
      path: '/tmp/x.md',
      dir: '/tmp',
      markdown: '',
      sidecar_raw: '{"annotations":[]}',
      sha256: 'abc',
      bytes: 0,
    });
    const result = await readDocument('/tmp/x.md');
    expect(result.sidecarRaw).toBe('{"annotations":[]}');
  });

  it('writeSidecar forwards mdPath and json', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await writeSidecar('/tmp/x.md', '{}');
    expect(invoke).toHaveBeenCalledWith('write_sidecar', { mdPath: '/tmp/x.md', json: '{}' });
  });

  it('pushRecent returns the updated list', async () => {
    vi.mocked(invoke).mockResolvedValue(['/a', '/b']);
    const result = await pushRecent('/a');
    expect(invoke).toHaveBeenCalledWith('push_recent', { path: '/a' });
    expect(result).toEqual(['/a', '/b']);
  });

  it('listRecent returns a list', async () => {
    vi.mocked(invoke).mockResolvedValue(['/a']);
    const result = await listRecent();
    expect(invoke).toHaveBeenCalledWith('list_recent');
    expect(result).toEqual(['/a']);
  });

  it('toAssetUrl delegates to convertFileSrc', () => {
    expect(toAssetUrl('/tmp/x.png')).toBe('asset://localhost//tmp/x.png');
  });
});
