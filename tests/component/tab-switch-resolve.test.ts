// Annotations are looked for in the page they belong to, once: switching
// tabs (or loading a file into the tab) must not search the incoming
// document's annotations in the outgoing page first. Every such search
// misses its hinted block and falls back to scanning the whole article.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import type { Anchor } from '../../src/lib/schema';

const searches: Array<{ text: string; page: string; connected: boolean }> = [];
vi.mock('../../src/lib/anchoring', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/anchoring')>('../../src/lib/anchoring');
  return {
    ...actual,
    resolveAnchor: (anchor: Anchor, root: HTMLElement) => {
      searches.push({ text: anchor.text, page: root.textContent ?? '', connected: root.isConnected });
      return actual.resolveAnchor(anchor, root);
    },
  };
});

let disk: Record<string, string> = {};
vi.mock('../../src/lib/tauri-api', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/tauri-api')>('../../src/lib/tauri-api');
  return {
    ...actual,
    readDocument: vi.fn(async (p: string) => ({
      path: p, dir: '/', markdown: disk[p], sidecarRaw: sidecarFor(p), sha256: 'sha:' + disk[p], bytes: disk[p].length,
    })),
    toAssetUrl: (p: string) => p,
  };
});
vi.mock('../../src/lib/file-watch', () => ({
  installFileWatcher: vi.fn(async () => async () => {}),
}));
vi.mock('../../src/stores/recent', () => ({ recordRecent: vi.fn(async () => {}) }));

import Viewer from '../../src/components/Viewer.svelte';
import { createSession, sessions, activeSession, type DocSession } from '../../src/stores/sessions';
import { activateSession } from '../../src/stores/tabs';
import { loadIntoSession } from '../../src/stores/doc';
import { resolvedAnnots } from '../../src/stores/annots';

const WORDS = ['one', 'two', 'three', 'four', 'five'];

function highlights(word: string) {
  return WORDS.map((w, i) => ({
    id: `${word}-${i}`, type: 'highlight' as const, color: '#ffd25a',
    anchor: { text: `${word} ${w}`, prefix: '', suffix: '', blockHint: `p:${i + 1}` },
    createdAt: 'now', updatedAt: 'now',
  }));
}

function sidecarFor(path: string): string {
  const word = path.includes('alpha') ? 'alpha' : 'beta';
  return JSON.stringify({
    $schema: 'remarkdown/v1',
    document: { path: path.slice(1), sha256: 'x', lastSeenBytes: 1 },
    annotations: highlights(word),
  });
}

function withDoc(word: string): DocSession {
  const s = createSession();
  const html = WORDS.map((w, i) => `<p data-block-id="p:${i + 1}">${word} ${w}</p>`).join('');
  s.doc.set({
    path: `/${word}.md`, dir: '/', sha256: word, bytes: 1, markdown: word, html,
    plaintext: word, blocks: WORDS.map((_, i) => `p:${i + 1}`), sidecarRaw: null,
  });
  s.annots.set(highlights(word));
  return s;
}

async function settle() {
  for (let i = 0; i < 5; i++) { await tick(); await Promise.resolve(); }
}

describe('annotations are resolved against their own page', () => {
  beforeEach(() => { searches.length = 0; document.body.innerHTML = ''; });

  it('switching tabs searches the new tab\'s highlights once, in the new tab\'s page', async () => {
    const a = withDoc('alpha');
    const b = withDoc('beta');
    sessions.set([a, b]);
    activeSession.set(a);
    render(Viewer);
    await settle();
    searches.length = 0;

    await activateSession(b.id);
    await settle();

    expect(searches.filter((s) => s.page.includes('alpha'))).toEqual([]);
    expect(searches.map((s) => s.text).sort()).toEqual(highlights('beta').map((h) => h.anchor.text).sort());
    expect(get(resolvedAnnots)).toHaveLength(5);
    expect(get(resolvedAnnots).every((r) => r.range.startContainer.isConnected)).toBe(true);
  });

  it('loading another file into the tab searches its highlights in its own page', async () => {
    disk = {
      '/alpha.md': WORDS.map((w) => `alpha ${w}`).join('\n\n') + '\n',
      '/beta.md': WORDS.map((w) => `beta ${w}`).join('\n\n') + '\n',
    };
    const a = createSession();
    sessions.set([a]);
    activeSession.set(a);
    render(Viewer);
    await loadIntoSession(a, '/alpha.md');
    await settle();
    expect(get(resolvedAnnots)).toHaveLength(5);
    searches.length = 0;

    await loadIntoSession(a, '/beta.md');
    await settle();

    expect(searches.filter((s) => s.page.includes('alpha'))).toEqual([]);
    expect(get(resolvedAnnots)).toHaveLength(5);
    expect(get(resolvedAnnots).every((r) => r.range.startContainer.isConnected)).toBe(true);
  });
});
