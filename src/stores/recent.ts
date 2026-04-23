import { writable } from 'svelte/store';
import { listRecent, pushRecent, checkPathsExist } from '../lib/tauri-api';

export const recent = writable<string[]>([]);
export const recentExistence = writable<Record<string, boolean>>({});

export async function refreshRecent(): Promise<void> {
  const list = await listRecent();
  recent.set(list);
  if (list.length > 0) {
    try {
      const flags = await checkPathsExist(list);
      const map: Record<string, boolean> = {};
      list.forEach((p, i) => { map[p] = flags[i]; });
      recentExistence.set(map);
    } catch {
      const map: Record<string, boolean> = {};
      list.forEach((p) => { map[p] = true; });
      recentExistence.set(map);
    }
  } else {
    recentExistence.set({});
  }
}

export async function recordRecent(path: string): Promise<void> {
  const list = await pushRecent(path);
  recent.set(list);
  recentExistence.update((map) => ({ ...map, [path]: true }));
}

export function markMissing(path: string): void {
  recentExistence.update((map) => ({ ...map, [path]: false }));
}
