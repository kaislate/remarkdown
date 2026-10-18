import { it, expect, vi } from 'vitest';
import { get } from 'svelte/store';

// Opens can overlap: the startup drain and an 'open-requested' event (an
// Explorer multi-select launches one process per file), a double-click
// while restored tabs are still loading, etc. Each must end up in its own
// tab — never two loads racing into the same empty start tab.

vi.mock('../../src/lib/tauri-api', () => ({
  readDocument: vi.fn(async (p: string) => {
    // a.md is slow (big file / cold disk), b.md is fast.
    await new Promise((r) => setTimeout(r, p.includes('a.md') ? 30 : 5));
    return { path: p, dir: '/', markdown: `# ${p}\n`, sidecarRaw: null, sha256: 'sha' + p, bytes: 3 };
  }),
  toAssetUrl: (p: string) => p,
  takePendingOpens: vi.fn(async () => []),
  openDocumentWindow: vi.fn(async () => {}),
  openFileDialog: vi.fn(async () => null),
  loadSessionJson: vi.fn(async () => null),
  checkPathsExist: vi.fn(async (ps: string[]) => ps.map(() => true)),
}));
vi.mock('../../src/lib/file-watch', () => ({
  installFileWatcher: vi.fn(async () => async () => {}),
}));
vi.mock('../../src/stores/recent', () => ({ recordRecent: vi.fn(async () => {}) }));

import { openPaths } from '../../src/lib/open-files';
import { sessions } from '../../src/stores/sessions';

const openTabs = () => get(sessions).map((s) => get(s.doc)?.path ?? null);

it('two concurrent opens on the empty start tab both end up open', async () => {
  const [na, nb] = await Promise.all([openPaths(['C:\\d\\a.md']), openPaths(['C:\\d\\b.md'])]);
  expect(na + nb).toBe(2);
  expect(openTabs().sort()).toEqual(['C:\\d\\a.md', 'C:\\d\\b.md']);
});

it('the same file opened twice concurrently gives one tab', async () => {
  await Promise.all([openPaths(['C:\\d\\a.md']), openPaths(['c:/d/a.md'])]);
  expect(openTabs()).toEqual(['C:\\d\\a.md']);
});
