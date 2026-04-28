import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  loadReadingProgressJson: vi.fn(),
  saveReadingProgressJson: vi.fn().mockResolvedValue(undefined),
}));

import {
  readingProgress,
  refreshReadingProgress,
  recordProgress,
  getProgressFor,
} from '../../src/stores/reading-progress';
import { loadReadingProgressJson, saveReadingProgressJson } from '../../src/lib/tauri-api';

beforeEach(() => {
  vi.clearAllMocks();
  readingProgress.set({ schemaVersion: 1, documents: {} });
  vi.useFakeTimers();
});

describe('reading-progress store', () => {
  it('refresh loads documents from JSON', async () => {
    (loadReadingProgressJson as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ schemaVersion: 1, documents: { '/foo.md': { scrollRatio: 0.5, lastReadAt: 't' } } }),
    );
    await refreshReadingProgress();
    const p = get(readingProgress);
    expect(p.documents['/foo.md']).toEqual({ scrollRatio: 0.5, lastReadAt: 't' });
  });

  it('refresh resets to default on missing file', async () => {
    (loadReadingProgressJson as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await refreshReadingProgress();
    expect(get(readingProgress).documents).toEqual({});
  });

  it('refresh resets to default on parse error', async () => {
    (loadReadingProgressJson as ReturnType<typeof vi.fn>).mockResolvedValue('not json');
    await refreshReadingProgress();
    expect(get(readingProgress).documents).toEqual({});
  });

  it('recordProgress clamps ratio to [0,1]', () => {
    recordProgress('/foo.md', 1.5);
    expect(getProgressFor('/foo.md')?.scrollRatio).toBe(1);
    recordProgress('/foo.md', -0.2);
    expect(getProgressFor('/foo.md')?.scrollRatio).toBe(0);
    recordProgress('/foo.md', 0.42);
    expect(getProgressFor('/foo.md')?.scrollRatio).toBe(0.42);
  });

  it('recordProgress debounces saves to ~800ms', async () => {
    recordProgress('/foo.md', 0.1);
    recordProgress('/foo.md', 0.2);
    recordProgress('/foo.md', 0.3);
    expect(saveReadingProgressJson).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(900);
    expect(saveReadingProgressJson).toHaveBeenCalledTimes(1);
  });
});
