import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the @tauri-apps/api modules so tests run without a Tauri runtime.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import { invoke } from '@tauri-apps/api/core';
import {
  openFileDialog,
  readDocument,
  writeSidecar,
  pushRecent,
  listRecent,
  toAssetUrl,
  checkPathsExist,
  FILE_WAIT_MS,
} from '../../src/lib/tauri-api';

describe('tauri-api wrapper', () => {
  // A function returned from a hook is run after the test, and mockReset
  // returns the mock: a block, so invoke isn't called once more after each.
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

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
    expect(result.sidecarUnreadable).toBe(false);
  });

  it('readDocument passes on a sidecar Rust refused to read', async () => {
    vi.mocked(invoke).mockResolvedValue({
      path: '/tmp/x.md',
      dir: '/tmp',
      markdown: '',
      sidecar_raw: null,
      sidecar_unreadable: true,
      sha256: 'abc',
      bytes: 0,
    });
    const result = await readDocument('/tmp/x.md');
    expect(result.sidecarRaw).toBeNull();
    expect(result.sidecarUnreadable).toBe(true);
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

  // A file on a share that has stopped answering never comes back, and
  // opens run one at a time: every later open in the window waited with it.
  describe('a file that never answers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('readDocument gives up on it as a read error', async () => {
      vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
      const outcome = readDocument('/net/gone/x.md').then(() => 'answered', (err: unknown) => err);
      await vi.advanceTimersByTimeAsync(FILE_WAIT_MS);
      expect(await Promise.race([outcome, 'still waiting'])).toEqual({ Io: 'it took over a minute to answer' });
    });

    it('checkPathsExist gives up on it too', async () => {
      vi.mocked(invoke).mockReturnValue(new Promise(() => {}));
      const outcome = checkPathsExist(['/net/gone/x.md']).then(() => 'answered', (err: unknown) => err);
      await vi.advanceTimersByTimeAsync(FILE_WAIT_MS);
      expect(await Promise.race([outcome, 'still waiting'])).toEqual({ Io: 'it took over a minute to answer' });
    });

    it('a slow file that does answer is read as always', async () => {
      vi.mocked(invoke).mockReturnValue(
        new Promise((resolve) =>
          setTimeout(() => resolve({ path: '/x.md', dir: '/', markdown: 'hi', sidecar_raw: null, sha256: 's', bytes: 2 }), FILE_WAIT_MS - 1_000),
        ),
      );
      const read = readDocument('/x.md');
      await vi.advanceTimersByTimeAsync(FILE_WAIT_MS - 1_000);
      expect((await read).markdown).toBe('hi');
      // And nothing is left waiting to fail it later.
      expect(vi.getTimerCount()).toBe(0);
    });

    it('an error is passed on as it was', async () => {
      vi.mocked(invoke).mockRejectedValue({ NotUtf8: null });
      await expect(readDocument('/x.md')).rejects.toEqual({ NotUtf8: null });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('toAssetUrl delegates to convertFileSrc', () => {
    expect(toAssetUrl('/tmp/x.png')).toBe('asset://localhost//tmp/x.png');
  });
});
