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
import { editorComponent, setEditorImportForTests } from '../../src/lib/editor-loader';

// "Writer" profile: documents open straight into edit mode. Until the user
// types, the tab keeps watching its file so outside changes still show up
// (Viewer pauses the watcher on the first keystroke).
it('openInEditMode opens new documents in edit mode, still watching the file', async () => {
  setEditorImportForTests(async () => ({ default: () => {} }));
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

// The editor's code is fetched on its own. A document that opens ready to
// edit waits for it, so it appears with the editor rather than as an empty
// page while the code arrives.
it('a document that opens ready to edit appears together with the editor', async () => {
  let arrive: (m: { default: unknown }) => void = () => {};
  const Editor = () => {};
  setEditorImportForTests(() => new Promise((r) => { arrive = r; }));
  updateSettings({ openInEditMode: true });
  const s = createSession();
  const loading = loadIntoSession(s, '/ready.md');
  await new Promise((r) => setTimeout(r, 20));
  expect(get(s.doc)).toBeNull();
  arrive({ default: Editor });
  await loading;
  expect(get(s.doc)?.path).toBe('/ready.md');
  expect(get(s.editMode)).toBe(true);
  expect(get(editorComponent)).toBe(Editor);
  updateSettings({ openInEditMode: false });
});

it('if the editor cannot be fetched, the document still opens (edit mode tries again)', async () => {
  setEditorImportForTests(() => Promise.reject(new Error('offline')));
  updateSettings({ openInEditMode: true });
  const s = createSession();
  await loadIntoSession(s, '/offline.md');
  expect(get(s.doc)?.path).toBe('/offline.md');
  expect(get(s.editMode)).toBe(true);
  updateSettings({ openInEditMode: false });
});

it('a document opening for reading never waits for the editor', async () => {
  setEditorImportForTests(() => new Promise(() => {}));
  const s = createSession();
  await loadIntoSession(s, '/read.md');
  expect(get(s.doc)?.path).toBe('/read.md');
});
