import { get, writable, type Writable } from 'svelte/store';
import { writeSidecar } from './tauri-api';
import { serializeSidecar } from './sidecar';
import { doc } from '../stores/doc';
import { annots } from '../stores/annots';
import type { Sidecar } from './schema';

export const SAVE_DEBOUNCE_MS = 500;

export const savedPulse: Writable<number> = writable(0);

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSerializedSnapshot: string | null = null;

function currentSidecar(): { path: string; json: string } | null {
  const d = get(doc);
  if (!d) return null;
  const sidecar: Sidecar = {
    _comment: `remarkdown annotations for: ${d.path.split(/[\\/]/).pop() ?? d.path}`,
    $schema: 'remarkdown/v1',
    document: { path: d.path, sha256: d.sha256, lastSeenBytes: d.bytes },
    annotations: get(annots),
  };
  return { path: d.path, json: serializeSidecar(sidecar) };
}

async function doSave(): Promise<void> {
  const current = currentSidecar();
  if (!current) return;
  if (current.json === lastSerializedSnapshot) return;
  await writeSidecar(current.path, current.json);
  lastSerializedSnapshot = current.json;
  savedPulse.set(Date.now());
}

export async function flushSave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await doSave();
}

function scheduleSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    doSave().catch((e) => console.error('[remarkdown] save failed:', e));
  }, SAVE_DEBOUNCE_MS);
}

export function installSaveWatcher(): () => void {
  // Reset snapshot whenever doc changes so the first write for a new doc always fires.
  const unsubDoc = doc.subscribe(() => { lastSerializedSnapshot = null; });
  let firstAnnots = true;
  const unsubAnnots = annots.subscribe(() => {
    // Skip the initial emit on subscribe.
    if (firstAnnots) { firstAnnots = false; return; }
    if (!get(doc)) return;
    scheduleSave();
  });
  return () => {
    unsubDoc();
    unsubAnnots();
    if (timer) { clearTimeout(timer); timer = null; }
  };
}
