import { writable, get } from 'svelte/store';
import { loadReadingProgressJson, saveReadingProgressJson } from '../lib/tauri-api';

interface DocProgress {
  scrollRatio: number;
  lastReadAt: string;
}

interface ProgressStore {
  schemaVersion: 1;
  documents: Record<string, DocProgress>;
}

const DEFAULT: ProgressStore = { schemaVersion: 1, documents: {} };

export const readingProgress = writable<ProgressStore>(DEFAULT);

export async function refreshReadingProgress(): Promise<void> {
  try {
    const raw = await loadReadingProgressJson();
    if (!raw) {
      readingProgress.set(DEFAULT);
      return;
    }
    const parsed = JSON.parse(raw) as Partial<ProgressStore>;
    if (parsed && typeof parsed === 'object' && parsed.documents) {
      readingProgress.set({
        schemaVersion: 1,
        documents: parsed.documents,
      });
    }
  } catch {
    readingProgress.set(DEFAULT);
  }
}

export function getProgressFor(path: string): DocProgress | null {
  const $p = get(readingProgress);
  return $p.documents[path] ?? null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function recordProgress(path: string, scrollRatio: number): void {
  // Clamp to [0, 1] to avoid silly values.
  const ratio = Math.max(0, Math.min(1, scrollRatio));
  readingProgress.update((s) => ({
    ...s,
    documents: {
      ...s.documents,
      [path]: { scrollRatio: ratio, lastReadAt: new Date().toISOString() },
    },
  }));
  // Debounced persist — we don't want to write to disk on every scroll tick.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveReadingProgressJson(JSON.stringify(get(readingProgress)));
  }, 800);
}

export function flushReadingProgress(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return saveReadingProgressJson(JSON.stringify(get(readingProgress)));
}
