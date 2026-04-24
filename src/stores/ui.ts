import { writable } from 'svelte/store';

// Minimap visibility persists across sessions in localStorage. Zoom does NOT
// — its starting value comes from settings.defaultZoom (set by App.svelte on
// mount); within a session Ctrl+/- mutates it freely without persisting.
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

// Zoom: stepped levels so increment/decrement land on predictable values.
export const ZOOM_LEVELS = [0.75, 0.85, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0] as const;
const DEFAULT_ZOOM = 1.0;

function snapToLevel(value: number): number {
  // Find the closest defined level. Annotate as `number` so the literal-type
  // tuple from `as const` doesn't lock `best` to its first element's type.
  let best: number = ZOOM_LEVELS[0];
  let bestDiff = Math.abs(value - best);
  for (const lvl of ZOOM_LEVELS) {
    const d = Math.abs(value - lvl);
    if (d < bestDiff) { bestDiff = d; best = lvl; }
  }
  return best;
}

export const zoomLevel = writable<number>(DEFAULT_ZOOM);

function step(direction: 1 | -1): void {
  zoomLevel.update((current) => {
    const idx = ZOOM_LEVELS.indexOf(snapToLevel(current) as (typeof ZOOM_LEVELS)[number]);
    const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx + direction));
    return ZOOM_LEVELS[next];
  });
}

export function increaseZoom(): void { step(1); }
export function decreaseZoom(): void { step(-1); }
export function resetZoom(): void { zoomLevel.set(DEFAULT_ZOOM); }
