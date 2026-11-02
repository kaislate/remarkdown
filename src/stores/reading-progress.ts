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

// How many documents' places are remembered: the most recently read ones.
// Far more than the recents list (at most 50) or any session's tabs, and
// it keeps the file (rewritten after every scroll) from growing for as
// long as the app is used.
export const MAX_REMEMBERED_DOCUMENTS = 500;

// A fresh object every time: recordProgress writes into the map it holds,
// so no two stores may ever share one.
function empty(): ProgressStore {
  return { schemaVersion: 1, documents: {} };
}

export const readingProgress = writable<ProgressStore>(empty());

export async function refreshReadingProgress(): Promise<void> {
  try {
    const raw = await loadReadingProgressJson();
    if (!raw) {
      readingProgress.set(empty());
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
    readingProgress.set(empty());
  }
}

export function getProgressFor(path: string): DocProgress | null {
  const $p = get(readingProgress);
  return $p.documents[path] ?? null;
}

// Keep only the most recently read documents. lastReadAt is an ISO string,
// so it sorts as text.
function prune(s: ProgressStore): ProgressStore {
  const paths = Object.keys(s.documents);
  if (paths.length <= MAX_REMEMBERED_DOCUMENTS) return s;
  const keep = paths
    .map((p) => [p, s.documents[p]] as const)
    .sort((a, b) => (a[1].lastReadAt < b[1].lastReadAt ? 1 : a[1].lastReadAt > b[1].lastReadAt ? -1 : 0))
    .slice(0, MAX_REMEMBERED_DOCUMENTS);
  return { ...s, documents: Object.fromEntries(keep) };
}

function serialize(): string {
  const pruned = prune(get(readingProgress));
  if (pruned !== get(readingProgress)) readingProgress.set(pruned);
  return JSON.stringify(pruned);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function recordProgress(path: string, scrollRatio: number): void {
  // Clamp to [0, 1] to avoid silly values.
  const ratio = Math.max(0, Math.min(1, scrollRatio));
  // Runs on every scroll event: write the one entry in place rather than
  // copying the map of every document ever read. update() still tells
  // subscribers (a store holding an object always counts as changed).
  readingProgress.update((s) => {
    s.documents[path] = { scrollRatio: ratio, lastReadAt: new Date().toISOString() };
    return s;
  });
  // Debounced persist — we don't want to write to disk on every scroll tick.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveReadingProgressJson(serialize());
  }, 800);
}

export function flushReadingProgress(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return saveReadingProgressJson(serialize());
}
