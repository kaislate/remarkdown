import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

// Leaving edit mode flushes the autosave and reloads the tab from disk.
// That reload is asynchronous — these cover what happens if the user
// switches tabs or jumps back into edit mode before it lands.

vi.mock('../../src/components/Editor.svelte', async () => {
  const { default: Stub } = await import('./fixtures/EditorStub.svelte');
  return { default: Stub };
});

let diskMarkdown = 'original\n';
vi.mock('../../src/lib/tauri-api', () => ({
  readDocument: vi.fn(async (p: string) => {
    await new Promise((r) => setTimeout(r, 25)); // a big file takes a moment
    return { path: p, dir: '/', markdown: diskMarkdown, sidecarRaw: null, sha256: 'sha:' + diskMarkdown, bytes: 3 };
  }),
  writeDocument: vi.fn(async (_p: string, md: string) => { diskMarkdown = md; }),
  toAssetUrl: (p: string) => p,
}));
vi.mock('../../src/lib/file-watch', () => ({
  installFileWatcher: vi.fn(async () => async () => {}),
}));

import Viewer from '../../src/components/Viewer.svelte';
import { createSession, sessions, activeSession, type DocSession } from '../../src/stores/sessions';
import { activateSession } from '../../src/stores/tabs';

function withDoc(path: string, markdown = 'original\n'): DocSession {
  const s = createSession();
  s.doc.set({ path, dir: '/', sha256: 'v1' + path, bytes: 1, markdown, html: '<p data-block-id="p:1">x</p>', plaintext: 'x', blocks: ['p:1'], sidecarRaw: null });
  return s;
}
async function settle() { for (let i = 0; i < 5; i++) { await tick(); await Promise.resolve(); } }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Viewer — leaving edit mode while the reload is in flight', () => {
  beforeEach(() => { diskMarkdown = 'original\n'; });

  it('switching to an editing tab right after leaving edit mode resumes the right watcher', async () => {
    const a = withDoc('/a.md');
    const b = withDoc('/b.md');
    sessions.set([a, b]);
    activeSession.set(a);
    render(Viewer);
    await settle();
    await activateSession(b.id); await settle();
    b.editMode.set(true); await settle();
    await activateSession(a.id); await settle();
    a.editMode.set(true); await settle();
    a.editMode.set(false); await settle(); // reload of A starts
    await activateSession(b.id);           // Ctrl+Tab before it lands
    await wait(60); await settle();
    expect(a.watcherPaused).toBe(false);
    expect(b.watcherPaused).toBe(true);
  });

  it('re-entering edit mode before the reload lands keeps the previous edits', async () => {
    const a = withDoc('/a.md');
    sessions.set([a]);
    activeSession.set(a);
    render(Viewer);
    await settle();
    a.editMode.set(true); await settle();
    // The user types; the stub reports the change like the real editor.
    await fireEvent.click(screen.getByTestId('editor-stub-type'));
    a.editMode.set(false); await settle();   // flush + reload in flight
    a.editMode.set(true); await settle();    // Ctrl+E again, immediately
    expect(screen.getByTestId('editor-stub').textContent).toContain('typed');
    await wait(60); await settle();          // the late reload lands
    expect(screen.getByTestId('editor-stub').textContent).toContain('typed');
    expect(a.watcherPaused).toBe(true);      // still editing: stay paused
  });
});
