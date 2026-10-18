import { get, writable, type Writable } from 'svelte/store';
import { writeSidecar } from './tauri-api';
import { serializeSidecar } from './sidecar';
import { doc } from '../stores/doc';
import { annots } from '../stores/annots';
import { getSettings } from '../stores/settings';
import type { Sidecar } from './schema';
import { addToast } from '../stores/toasts';
import { activeSession, type DocSession } from '../stores/sessions';
import { onBeforeSwitch } from '../stores/tabs';

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

// A pending save belongs to the tab whose annotations changed — not to
// whichever tab happens to be active when the debounce fires (the user may
// have switched tabs by then).
let timer: ReturnType<typeof setTimeout> | null = null;
let pendingSession: DocSession | null = null;
// Last JSON written per tab, so unchanged annotations aren't rewritten.
let lastSerialized = new WeakMap<DocSession, string>();

function sidecarFor(session: DocSession): { path: string; json: string } | null {
  const d = get(session.doc);
  if (!d) return null;
  const sidecar: Sidecar = {
    _comment: `remarkdown annotations for: ${d.path.split(/[\\/]/).pop() ?? d.path}`,
    $schema: 'remarkdown/v1',
    document: { path: d.path, sha256: d.sha256, lastSeenBytes: d.bytes },
    annotations: get(session.annots),
  };
  return { path: d.path, json: serializeSidecar(sidecar) };
}

async function doSave(session: DocSession): Promise<void> {
  const current = sidecarFor(session);
  if (!current) return;
  if (current.json === lastSerialized.get(session)) return;

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
      lastSerialized.set(session, current.json);
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

// Write the pending save now (or, with nothing pending, the active tab).
export async function flushSave(): Promise<void> {
  const session = pendingSession ?? get(activeSession);
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pendingSession = null;
  await doSave(session);
}

function scheduleSave(session: DocSession): void {
  // A different tab still has a save pending: write it now rather than
  // dropping it.
  if (pendingSession && pendingSession !== session) {
    const other = pendingSession;
    void doSave(other).catch((e) => console.error('[remarkdown] save failed:', e));
  }
  if (timer) clearTimeout(timer);
  pendingSession = session;
  const ms = getSettings().saveDebounceMs ?? SAVE_DEBOUNCE_MS;
  timer = setTimeout(() => {
    timer = null;
    const target = pendingSession;
    pendingSession = null;
    if (target) doSave(target).catch((e) => console.error('[remarkdown] save failed:', e));
  }, ms);
}

export function installSaveWatcher(): () => void {
  // Reset snapshot whenever doc changes so the first write for a new doc always fires.
  const unsubDoc = doc.subscribe(() => {
    lastSerialized.delete(get(activeSession));
    warnedOnceForThisPath = null;
  });
  // `annots` is a proxy onto the active tab, so it also emits when the user
  // switches tabs. That's not an edit — only schedule a save when the same
  // tab's annotations change. The outgoing tab's pending save is flushed by
  // the before-switch hook below, while it's still the active tab.
  let lastSessionId = get(activeSession).id;
  let firstAnnots = true;
  const unsubAnnots = annots.subscribe(() => {
    // Skip the initial emit on subscribe.
    if (firstAnnots) { firstAnnots = false; return; }
    const sessionId = get(activeSession).id;
    if (sessionId !== lastSessionId) {
      lastSessionId = sessionId;
      return;
    }
    if (!get(doc)) return;
    scheduleSave(get(activeSession));
  });
  // Before the active tab changes, write what's pending. Loop: the outgoing
  // tab is still active while a slow write is awaited, so the user can add
  // another annotation to it meanwhile.
  const offBeforeSwitch = onBeforeSwitch(async () => {
    while (pendingSession) await flushSave();
  });
  return () => {
    unsubDoc();
    unsubAnnots();
    offBeforeSwitch();
    if (timer) { clearTimeout(timer); timer = null; }
    pendingSession = null;
    lastSerialized = new WeakMap();
  };
}
