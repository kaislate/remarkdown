import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

// Reopened tabs are read after the first document is on screen, while the
// user may already have a dialog open. A tab whose annotations file is
// malformed must not replace that dialog with a notice about a tab that
// isn't even shown: the notice waits until the tab is first shown.

vi.mock('../../src/lib/tauri-api', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/tauri-api')>('../../src/lib/tauri-api');
  return {
    ...actual,
    loadSessionJson: vi.fn(async () => null),
    saveSessionJson: vi.fn(async () => {}),
    checkPathsExist: vi.fn(async (paths: string[]) => paths.map(() => true)),
    windowLabel: vi.fn(() => 'main'),
    readDocument: vi.fn(async (path: string) => ({
      path,
      dir: '/',
      sha256: path,
      bytes: 3,
      markdown: '# ' + path,
      sidecarRaw: path.includes('bad-notes') ? '{not json' : null,
    })),
    toAssetUrl: (p: string) => p,
  };
});
vi.mock('../../src/lib/file-watch', () => ({ installFileWatcher: vi.fn(async () => async () => {}) }));

import {
  restoreSavedTabs,
  finishSessionRestore,
  loadRestoredTabsInBackground,
  serializeSession,
} from '../../src/stores/session-persist';
import { loadSessionJson } from '../../src/lib/tauri-api';
import { activeModal, closeModal, openModal } from '../../src/stores/modals';
import { activeSession, resetSessionsForTests, sessions } from '../../src/stores/sessions';
import { resetSettings } from '../../src/stores/settings';
import { activateSession } from '../../src/stores/tabs';
import { loadDocument } from '../../src/stores/doc';

const activePath = () => get(get(activeSession).doc)?.path ?? null;
const tabFor = (path: string) => get(sessions).find((s) => (get(s.doc)?.path ?? s.lazyPath) === path)!;

beforeEach(() => {
  resetSessionsForTests();
  resetSettings();
  closeModal();
});

describe('a reopened tab with a malformed annotations file', () => {
  it('loaded in the background, leaves the open dialog alone and tells the user when the tab is shown', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/bad-notes.md'], 0));
    await restoreSavedTabs();
    await finishSessionRestore();
    expect(activePath()).toBe('/a.md');
    openModal({ kind: 'onboarding' });
    await loadRestoredTabsInBackground();
    expect(get(activeModal)).toEqual({ kind: 'onboarding' });

    closeModal();
    await activateSession(tabFor('/bad-notes.md').id);
    expect(get(activeModal)).toEqual({ kind: 'corrupt-sidecar', path: '/bad-notes.md' });

    // Once is enough.
    closeModal();
    await activateSession(tabFor('/a.md').id);
    await activateSession(tabFor('/bad-notes.md').id);
    expect(get(activeModal)).toBeNull();
  });

  it('shown at startup, tells the user straight away, as before', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/bad-notes.md'], 1));
    await restoreSavedTabs();
    await finishSessionRestore();
    expect(activePath()).toBe('/bad-notes.md');
    expect(get(activeModal)).toEqual({ kind: 'corrupt-sidecar', path: '/bad-notes.md' });
  });

  it('switched to before it loaded, tells the user once it is shown', async () => {
    vi.mocked(loadSessionJson).mockResolvedValueOnce(serializeSession(['/a.md', '/bad-notes.md'], 0));
    await restoreSavedTabs();
    await finishSessionRestore();
    await activateSession(tabFor('/bad-notes.md').id);
    expect(activePath()).toBe('/bad-notes.md');
    expect(get(activeModal)).toEqual({ kind: 'corrupt-sidecar', path: '/bad-notes.md' });
  });

  it('a document the user opens still tells them straight away', async () => {
    await loadDocument('/bad-notes.md');
    expect(get(activeModal)).toEqual({ kind: 'corrupt-sidecar', path: '/bad-notes.md' });
  });
});
