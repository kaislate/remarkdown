import { writable } from 'svelte/store';
import { listRecent, pushRecent } from '../lib/tauri-api';

export const recent = writable<string[]>([]);

export async function refreshRecent(): Promise<void> {
  const list = await listRecent();
  recent.set(list);
}

export async function recordRecent(path: string): Promise<void> {
  const list = await pushRecent(path);
  recent.set(list);
}
