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

// Months of use leave an entry for every file ever scrolled. Each scroll
// event must not copy that whole history, and the file must not grow
// without end.
describe('reading-progress store at scale', () => {
  function seed(n: number): void {
    const documents: Record<string, { scrollRatio: number; lastReadAt: string }> = {};
    for (let i = 0; i < n; i++) {
      // Older entries first: entry i was read i minutes after the epoch.
      documents[`/old/${i}.md`] = { scrollRatio: 0.5, lastReadAt: new Date(i * 60_000).toISOString() };
    }
    readingProgress.set({ schemaVersion: 1, documents });
  }

  it('recording a scroll position does not copy the whole history', () => {
    seed(5000);
    const before = get(readingProgress).documents;
    recordProgress('/now.md', 0.3);
    const after = get(readingProgress).documents;
    expect(after).toBe(before);
    expect(after['/now.md'].scrollRatio).toBe(0.3);
  });

  it('still tells subscribers (the menu\'s "% read") on every record', () => {
    seed(10);
    const seen: number[] = [];
    const unsub = readingProgress.subscribe((s) => seen.push(s.documents['/now.md']?.scrollRatio ?? -1));
    recordProgress('/now.md', 0.25);
    recordProgress('/now.md', 0.5);
    unsub();
    expect(seen.slice(-2)).toEqual([0.25, 0.5]);
  });

  it('saves only the 500 most recently read documents', async () => {
    seed(1200);
    recordProgress('/now.md', 0.7);
    await vi.advanceTimersByTimeAsync(900);
    expect(saveReadingProgressJson).toHaveBeenCalledTimes(1);
    const saved = JSON.parse((saveReadingProgressJson as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    const paths = Object.keys(saved.documents);
    expect(paths).toHaveLength(500);
    expect(saved.documents['/now.md'].scrollRatio).toBe(0.7);
    // The newest of the old ones stay, the oldest go.
    expect(saved.documents['/old/1199.md']).toBeDefined();
    expect(saved.documents['/old/701.md']).toBeDefined();
    expect(saved.documents['/old/700.md']).toBeUndefined();
    expect(saved.documents['/old/0.md']).toBeUndefined();
    // Memory matches what was written.
    expect(Object.keys(get(readingProgress).documents)).toHaveLength(500);
  });

  it('keeps a small history whole', async () => {
    seed(20);
    recordProgress('/now.md', 0.1);
    await vi.advanceTimersByTimeAsync(900);
    const saved = JSON.parse((saveReadingProgressJson as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(Object.keys(saved.documents)).toHaveLength(21);
  });

  it('a reset after load never shares its map with a later record', async () => {
    (loadReadingProgressJson as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await refreshReadingProgress();
    recordProgress('/a.md', 0.4);
    await refreshReadingProgress();
    expect(get(readingProgress).documents).toEqual({});
  });

  it('measures: 2000 scroll events over a 5000-file history', () => {
    seed(5000);
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) recordProgress('/now.md', i / 2000);
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[perf] reading-progress: 2000 records over 5000 entries took ${ms.toFixed(1)} ms`);
    // Generous: a per-event copy of 5000 keys takes seconds here.
    expect(ms).toBeLessThan(1500);
  });
});
