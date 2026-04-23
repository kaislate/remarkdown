import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  pushRecent: vi.fn(),
  listRecent: vi.fn(),
}));

import { pushRecent, listRecent } from '../../src/lib/tauri-api';
import { recent, refreshRecent, recordRecent } from '../../src/stores/recent';

describe('recent store', () => {
  beforeEach(() => {
    vi.mocked(pushRecent).mockReset();
    vi.mocked(listRecent).mockReset();
    recent.set([]);
  });

  it('refreshRecent populates store from list_recent', async () => {
    vi.mocked(listRecent).mockResolvedValue(['/a', '/b']);
    await refreshRecent();
    expect(get(recent)).toEqual(['/a', '/b']);
  });

  it('recordRecent calls push_recent and updates store', async () => {
    vi.mocked(pushRecent).mockResolvedValue(['/new', '/a']);
    await recordRecent('/new');
    expect(pushRecent).toHaveBeenCalledWith('/new');
    expect(get(recent)).toEqual(['/new', '/a']);
  });
});
