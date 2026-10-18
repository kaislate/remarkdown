import { it, expect, vi } from 'vitest';
import { get } from 'svelte/store';

// A tab switch waits for the outgoing tab's pending annotation save. If
// that write is slow (disk, antivirus, retries), the user can still add an
// annotation to the outgoing tab meanwhile. It must be saved to that tab's
// sidecar — not to whichever tab is active when the debounce fires.

let release: (() => void) | null = null;
const writes: Array<{ path: string; ids: string[] }> = [];
vi.mock('../../src/lib/tauri-api', () => ({
  writeSidecar: vi.fn(async (path: string, json: string) => {
    writes.push({ path, ids: JSON.parse(json).annotations.map((a: { id: string }) => a.id) });
    if (writes.length === 1) await new Promise<void>((r) => { release = r; }); // first write is slow
  }),
}));

import { addAnnotation } from '../../src/stores/annots';
import { installSaveWatcher } from '../../src/lib/save';
import { createSession, sessions, activeSession } from '../../src/stores/sessions';
import { activateSession } from '../../src/stores/tabs';
import type { Annotation } from '../../src/lib/schema';

const hl = (id: string) => ({
  id, type: 'highlight', color: '#ffd25a',
  anchor: { text: 'x', prefix: '', suffix: '', blockHint: 'p:1' },
  createdAt: 'now', updatedAt: 'now',
}) as Annotation;
const docFor = (path: string) => ({ path, dir: '/', sha256: 'abc', bytes: 1, markdown: '', html: '', plaintext: '', blocks: [], sidecarRaw: null });

it('an annotation added while the switch awaits a slow flush is saved to its own tab', async () => {
  const a = get(activeSession);
  a.doc.set(docFor('/a.md'));
  const b = createSession();
  b.doc.set(docFor('/b.md'));
  sessions.set([a, b]);
  const dispose = installSaveWatcher();

  addAnnotation(hl('a1'));              // pending save for A
  const switching = activateSession(b.id);
  await Promise.resolve();
  addAnnotation(hl('a2'));              // still on A — the switch hasn't happened yet
  release!();
  await switching;
  await new Promise((r) => setTimeout(r, 700));
  dispose();

  expect(get(a.annots).map((x) => x.id)).toEqual(['a1', 'a2']);
  expect(writes.filter((w) => w.path === '/a.md').pop()?.ids).toEqual(['a1', 'a2']);
  expect(writes.filter((w) => w.path === '/b.md')).toEqual([]);
});
