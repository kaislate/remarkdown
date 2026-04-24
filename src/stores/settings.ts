import { writable, get } from 'svelte/store';
import type { Settings } from '../lib/settings-schema';
import { DEFAULT_SETTINGS, parseSettings } from '../lib/settings-schema';
import { loadSettingsJson, saveSettingsJson } from '../lib/tauri-api';

export const settings = writable<Settings>(DEFAULT_SETTINGS);

// Load persisted settings on startup. Failures (no Tauri host, IO error,
// malformed file) fall back to defaults silently — settings should never
// block app launch.
export async function refreshSettings(): Promise<void> {
  try {
    const raw = await loadSettingsJson();
    settings.set(parseSettings(raw));
  } catch {
    settings.set(DEFAULT_SETTINGS);
  }
}

let installed = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Subscribe-and-save with a 200ms debounce so rapid slider drags coalesce
// into a single write.
export function installSettingsAutosave(): () => void {
  if (installed) return () => {};
  installed = true;
  let first = true;
  const unsub = settings.subscribe((s) => {
    if (first) { first = false; return; }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await saveSettingsJson(JSON.stringify(s, null, 2));
      } catch {
        // best-effort; ignore IO errors
      }
    }, 200);
  });
  return () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    installed = false;
    unsub();
  };
}

export function updateSettings(patch: Partial<Settings>): void {
  settings.update((s) => ({ ...s, ...patch }));
}

export function resetSettings(): void {
  settings.set(DEFAULT_SETTINGS);
}

export function getSettings(): Settings {
  return get(settings);
}
