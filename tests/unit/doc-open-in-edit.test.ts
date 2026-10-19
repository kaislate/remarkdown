import { it, expect, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  readDocument: vi.fn(async (p: string) => ({ path: p, dir: '/', markdown: '# x\n', sidecarRaw: null, sha256: 'sha', bytes: 4 })),
  toAssetUrl: (p: string) => p,
}));
const installed: string[] = [];
vi.mock('../../src/lib/file-watch', () => ({
  installFileWatcher: vi.fn(async (p: string) => { installed.push(p); return async () => {}; }),
}));

import { loadIntoSession } from '../../src/stores/doc';
import { createSession } from '../../src/stores/sessions';
import { updateSettings } from '../../src/stores/settings';

// "Writer" profile: documents open straight into edit mode, set up exactly
// as if the user had pressed Ctrl+E (watcher paused so autosaves don't
// bounce back as reloads).
it('openInEditMode opens new documents in edit mode with the watcher paused', async () => {
  updateSettings({ openInEditMode: true });
  const s = createSession();
  await loadIntoSession(s, '/w.md');
  expect(get(s.editMode)).toBe(true);
  expect(s.watcherPaused).toBe(true);
  expect(installed).not.toContain('/w.md');
  updateSettings({ openInEditMode: false });
});
