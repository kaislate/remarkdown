import { writable, get } from 'svelte/store';
import type { Settings } from '../lib/settings-schema';
import { DEFAULT_SETTINGS, parseSettings } from '../lib/settings-schema';
import { loadSettingsJson, saveSettingsJson, windowLabel } from '../lib/tauri-api';

export const settings = writable<Settings>(DEFAULT_SETTINGS);

// Load persisted settings on startup. Failures (no Tauri host, IO error,
// malformed file) fall back to defaults silently — settings should never
// block app launch.
let loadedOnce = false;

export async function refreshSettings(): Promise<void> {
  try {
    const raw = await loadSettingsJson();
    const parsed = parseSettings(raw);
    // What's on disk now — the autosave below skips writing it back.
    lastSavedJson = serialize(parsed);
    loadedOnce = true;
    settings.set(parsed);
  } catch {
    // Couldn't read the settings file (locked, permissions…). Never let that
    // replace the user's settings: keep what's in use, or on a first load
    // use the defaults without saving them over the unreadable file.
    if (loadedOnce) return;
    lastSavedJson = serialize(DEFAULT_SETTINGS);
    settings.set(DEFAULT_SETTINGS);
  }
}

let installed = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// The JSON most recently written or read. Lets a window adopt another
// window's settings without saving them straight back (and re-announcing).
let lastSavedJson: string | null = null;

function serialize(s: Settings): string {
  return JSON.stringify(s, null, 2);
}

// Several windows can be open (new-window mode). Each keeps its own copy of
// the settings store, so after a save we tell the others to reload — or a
// window with stale settings would overwrite newer ones on its next save.
const SETTINGS_CHANGED = 'settings-changed';

// Subscribe-and-save with a 200ms debounce so rapid slider drags coalesce
// into a single write.
export function installSettingsAutosave(): () => void {
  if (installed) return () => {};
  installed = true;
  let first = true;
  const unsub = settings.subscribe((s) => {
    if (first) { first = false; return; }
    const json = serialize(s);
    if (json === lastSavedJson) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveSettingsJson(json);
        lastSavedJson = json;
      } catch {
        // best-effort; ignore IO errors
        return;
      }
      try {
        const { emit } = await import('@tauri-apps/api/event');
        await emit(SETTINGS_CHANGED, { from: windowLabel() });
      } catch {
        // non-Tauri host
      }
    }, 200);
  });

  let unlisten: (() => void) | null = null;
  let disposed = false;
  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const un = await listen<{ from: string }>(SETTINGS_CHANGED, (e) => {
        if (e.payload?.from !== windowLabel()) void refreshSettings();
      });
      if (disposed) un();
      else unlisten = un;
    } catch {
      // non-Tauri host
    }
  })();

  return () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    installed = false;
    disposed = true;
    unlisten?.();
    unsub();
  };
}

export function updateSettings(patch: Partial<Settings>): void {
  // Reader mode (nothing but the page) and edit mode never go together:
  // switching one "always open in…" on switches the other off.
  const p = { ...patch };
  if (p.openInEditMode === true && p.openInFocusMode === undefined) p.openInFocusMode = false;
  if (p.openInFocusMode === true && p.openInEditMode === undefined) p.openInEditMode = false;
  settings.update((s) => ({ ...s, ...p }));
}

export function resetSettings(): void {
  settings.set(DEFAULT_SETTINGS);
}

export function getSettings(): Settings {
  return get(settings);
}
