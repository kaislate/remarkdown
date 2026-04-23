import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  pushRecent: vi.fn(),
  listRecent: vi.fn(),
  checkPathsExist: vi.fn().mockResolvedValue([]),
}));

import { pushRecent, listRecent, checkPathsExist } from '../../src/lib/tauri-api';
import { recent, recentExistence, refreshRecent, recordRecent, markMissing } from '../../src/stores/recent';

describe('recent store', () => {
  beforeEach(() => {
    vi.mocked(pushRecent).mockReset();
    vi.mocked(listRecent).mockReset();
    vi.mocked(checkPathsExist).mockReset().mockResolvedValue([]);
    recent.set([]);
    recentExistence.set({});
  });

  it('refreshRecent populates store from list_recent and checks existence', async () => {
    vi.mocked(listRecent).mockResolvedValue(['/a', '/b']);
    vi.mocked(checkPathsExist).mockResolvedValue([true, false]);
    await refreshRecent();
    expect(get(recent)).toEqual(['/a', '/b']);
    expect(get(recentExistence)).toEqual({ '/a': true, '/b': false });
  });

  it('recordRecent calls push_recent and marks path as existing', async () => {
    vi.mocked(pushRecent).mockResolvedValue(['/new', '/a']);
    await recordRecent('/new');
    expect(pushRecent).toHaveBeenCalledWith('/new');
    expect(get(recent)).toEqual(['/new', '/a']);
    expect(get(recentExistence)['/new']).toBe(true);
  });

  it('refreshRecent with empty list clears existence', async () => {
    vi.mocked(listRecent).mockResolvedValue([]);
    await refreshRecent();
    expect(get(recent)).toEqual([]);
    expect(get(recentExistence)).toEqual({});
  });

  it('markMissing flips a path to false', () => {
    recentExistence.set({ '/a': true });
    markMissing('/a');
    expect(get(recentExistence)['/a']).toBe(false);
  });

  it('refreshRecent with check failure falls back to assuming all exist', async () => {
    vi.mocked(listRecent).mockResolvedValue(['/a']);
    vi.mocked(checkPathsExist).mockRejectedValue(new Error('oops'));
    await refreshRecent();
    expect(get(recentExistence)).toEqual({ '/a': true });
  });
});
