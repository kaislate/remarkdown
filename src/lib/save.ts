import { get, writable, type Writable } from 'svelte/store';
import { writeSidecar } from './tauri-api';
import { serializeSidecar } from './sidecar';
import { doc } from '../stores/doc';
import { annots } from '../stores/annots';
import { getSettings } from '../stores/settings';
import type { Sidecar } from './schema';
import { addToast } from '../stores/toasts';

const SIZE_WARN_BYTES = 2 * 1024 * 1024;
let warnedOnceForThisPath: string | null = null;

// Fallback used when settings haven't loaded yet (e.g. very first save during
// app boot, or in tests that don't initialise the settings store). Once
// settings are hydrated, getSettings().saveDebounceMs takes over.
export const SAVE_DEBOUNCE_MS = 500;

export const savedPulse: Writable<number> = writable(0);
export const persistentSaveError: Writable<string | null> = writable(null);

const MAX_RETRIES = 3;
const BACKOFF_MS = [100, 400, 1600];

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

  const byteLen = new TextEncoder().encode(current.json).length;
  if (byteLen > SIZE_WARN_BYTES && warnedOnceForThisPath !== current.path) {
    addToast({
      kind: 'warning',
      message: 'Annotations file is getting large — drawings dominate the file size.',
    });
    warnedOnceForThisPath = current.path;
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await writeSidecar(current.path, current.json);
      lastSerializedSnapshot = current.json;
      savedPulse.set(Date.now());
      persistentSaveError.set(null);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
      }
    }
  }
  persistentSaveError.set(`Could not save annotations: ${String(lastErr)}`);
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
  const ms = getSettings().saveDebounceMs ?? SAVE_DEBOUNCE_MS;
  timer = setTimeout(() => {
    timer = null;
    doSave().catch((e) => console.error('[remarkdown] save failed:', e));
  }, ms);
}

export function installSaveWatcher(): () => void {
  // Reset snapshot whenever doc changes so the first write for a new doc always fires.
  const unsubDoc = doc.subscribe(() => {
    lastSerializedSnapshot = null;
    warnedOnceForThisPath = null;
  });
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
