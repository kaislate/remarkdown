import { watch } from '@tauri-apps/plugin-fs';

const DEBOUNCE_MS = 500;

// Install a watcher on `path`. Returns a dispose function. On any change
// event for the watched path, calls `onChange()` after a debounce window
// to coalesce burst writes (text editors that save via temp+rename can
// fire multiple events for one logical save).
//
// In non-Tauri contexts (vitest, storybook), watch() throws and we
// return a no-op dispose so callers don't have to branch on the host.
export async function installFileWatcher(
  path: string,
  onChange: () => void,
): Promise<() => Promise<void>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unwatch: (() => Promise<void> | void) | null = null;

  try {
    const fn = await watch(path, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onChange();
      }, DEBOUNCE_MS);
    });
    unwatch = fn as () => Promise<void> | void;
  } catch {
    // Non-Tauri host or plugin unavailable — install no-op.
  }

  return async () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (unwatch) {
      try { await unwatch(); } catch { /* ignore */ }
    }
  };
}
