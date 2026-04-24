import { writable } from 'svelte/store';

// Persistent UI preferences.
const MINIMAP_KEY = 'rmd-minimap-shown';

function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === 'true';
}

export const minimapShown = writable<boolean>(readBool(MINIMAP_KEY, true));

if (typeof localStorage !== 'undefined') {
  minimapShown.subscribe((v) => {
    try {
      localStorage.setItem(MINIMAP_KEY, String(v));
    } catch {
      // quota or private mode — ignore
    }
  });
}

export function toggleMinimap(): void {
  minimapShown.update((v) => !v);
}
