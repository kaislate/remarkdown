import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUnwatch, mockWatch } = vi.hoisted(() => {
  const mockUnwatch = vi.fn();
  const mockWatch = vi.fn();
  return { mockUnwatch, mockWatch };
});

vi.mock('@tauri-apps/plugin-fs', () => ({
  watch: mockWatch,
}));

import { installFileWatcher } from '../../src/lib/file-watch';

beforeEach(() => {
  vi.clearAllMocks();
  mockWatch.mockResolvedValue(mockUnwatch);
  vi.useFakeTimers();
});

describe('installFileWatcher', () => {
  it('returns a dispose function that unwatches the path', async () => {
    const onChange = vi.fn();
    const dispose = await installFileWatcher('/tmp/foo.md', onChange);
    expect(mockWatch).toHaveBeenCalledTimes(1);
    expect(mockWatch.mock.calls[0][0]).toBe('/tmp/foo.md');
    await dispose();
    expect(mockUnwatch).toHaveBeenCalled();
  });

  it('debounces change events within a 500ms window', async () => {
    const onChange = vi.fn();
    await installFileWatcher('/tmp/foo.md', onChange);
    // The watcher's callback is the second arg to watch().
    const watcherCallback = mockWatch.mock.calls[0][1];
    watcherCallback({ paths: ['/tmp/foo.md'] });
    watcherCallback({ paths: ['/tmp/foo.md'] });
    watcherCallback({ paths: ['/tmp/foo.md'] });
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('returns a no-op dispose when watch() throws (non-Tauri host)', async () => {
    mockWatch.mockRejectedValueOnce(new Error('no tauri'));
    const onChange = vi.fn();
    const dispose = await installFileWatcher('/tmp/foo.md', onChange);
    await dispose();
    expect(onChange).not.toHaveBeenCalled();
  });
});
