import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

// The editor itself is exercised elsewhere; here we only care which
// document it's mounted with and whether disk reloads happen.
vi.mock('../../src/components/Editor.svelte', async () => {
  const { default: Stub } = await import('./fixtures/EditorStub.svelte');
  return { default: Stub };
});

vi.mock('../../src/stores/doc', async () => {
  const actual = await vi.importActual<typeof import('../../src/stores/doc')>('../../src/stores/doc');
  return {
    ...actual,
    loadIntoSession: vi.fn(async () => true),
    pauseFileWatcher: vi.fn(async () => {}),
    resumeFileWatcher: vi.fn(async () => {}),
  };
});

import Viewer from '../../src/components/Viewer.svelte';
import { loadIntoSession } from '../../src/stores/doc';
import { createSession, sessions, activeSession, type DocSession } from '../../src/stores/sessions';
import { activateSession } from '../../src/stores/tabs';
import { get } from 'svelte/store';

function withDoc(path: string, markdown: string): DocSession {
  const s = createSession();
  s.doc.set({
    path, dir: '/', sha256: path, bytes: 1, markdown,
    html: `<p data-block-id="p:1">${markdown}</p>`, plaintext: markdown, blocks: ['p:1'], sidecarRaw: null,
  });
  return s;
}

async function settle() {
  for (let i = 0; i < 3; i++) { await tick(); await Promise.resolve(); }
}

describe('Viewer across tabs', () => {
  beforeEach(() => vi.mocked(loadIntoSession).mockClear());

  it('switching from an editing tab to a reading tab does not reload from disk', async () => {
    const a = withDoc('/a.md', 'alpha');
    const b = withDoc('/b.md', 'beta');
    sessions.set([a, b]);
    activeSession.set(a);
    render(Viewer);
    a.editMode.set(true);
    await settle();
    await activateSession(b.id);
    await settle();
    expect(loadIntoSession).not.toHaveBeenCalled();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('leaving edit mode in the same tab still reloads that tab from disk', async () => {
    const a = withDoc('/a.md', 'alpha');
    sessions.set([a]);
    activeSession.set(a);
    render(Viewer);
    a.editMode.set(true);
    await settle();
    a.editMode.set(false);
    await settle();
    expect(loadIntoSession).toHaveBeenCalledWith(a, '/a.md');
  });

  it('switching between two editing tabs remounts the editor with the right document', async () => {
    const a = withDoc('/a.md', 'alpha');
    const b = withDoc('/b.md', 'beta');
    a.editMode.set(true);
    b.editMode.set(true);
    sessions.set([a, b]);
    activeSession.set(a);
    render(Viewer);
    await settle();
    expect(screen.getByTestId('editor-stub').textContent).toBe('alpha');
    await activateSession(b.id);
    await settle();
    expect(screen.getByTestId('editor-stub').textContent).toBe('beta');
    expect(loadIntoSession).not.toHaveBeenCalled();
  });

  it('captures the outgoing tab scroll offset on switch', async () => {
    const a = withDoc('/a.md', 'alpha');
    const b = withDoc('/b.md', 'beta');
    sessions.set([a, b]);
    activeSession.set(a);
    const { container } = render(Viewer);
    await settle();
    const scroller = container.querySelector('.scroll') as HTMLElement;
    scroller.scrollTop = 321;
    await activateSession(b.id);
    expect(a.scrollTop).toBe(321);
    expect(get(activeSession)).toBe(b);
  });
});
