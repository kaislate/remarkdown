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

// "Writer" profile: documents open straight into edit mode. Until the user
// types, the tab keeps watching its file so outside changes still show up
// (Viewer pauses the watcher on the first keystroke).
it('openInEditMode opens new documents in edit mode, still watching the file', async () => {
  updateSettings({ openInEditMode: true });
  const s = createSession();
  await loadIntoSession(s, '/w.md');
  expect(get(s.editMode)).toBe(true);
  expect(s.watcherPaused).toBe(false);
  expect(installed).toContain('/w.md');
  updateSettings({ openInEditMode: false });
});

it('reader mode and edit mode never both turn on: "ready to edit" wins', async () => {
  updateSettings({ openInEditMode: true, openInFocusMode: true });
  const s = createSession();
  await loadIntoSession(s, '/both.md');
  expect(get(s.editMode)).toBe(true);
  expect(get(s.readerMode)).toBe(false);
  updateSettings({ openInEditMode: false, openInFocusMode: false });
});
