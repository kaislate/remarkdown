// What the app reads from disk before it can show the first document:
// settings, recent files and reading progress. They don't depend on each
// other, so they're asked for together, as early as possible (main.ts starts
// them while the platform check is still out), rather than one after
// another from App's onMount, where each round trip waited for the last.
// The stores fill in as each answer arrives, exactly as the separate
// refresh calls always did.

import { refreshSettings } from '../stores/settings';
import { refreshRecent } from '../stores/recent';
import { refreshReadingProgress } from '../stores/reading-progress';

export interface StartupReads {
  settings: Promise<void>;
  recent: Promise<void>;
  progress: Promise<void>;
}

let reads: StartupReads | null = null;

// Failures are swallowed like the refresh calls' callers always did: settings
// fall back to defaults, recents and progress start empty. `platformSettled`
// (main.ts's platform check): settings are filled in with that OS's
// defaults, as when they were read after it.
export function startStartupReads(platformSettled?: Promise<unknown>): StartupReads {
  if (!reads) {
    reads = {
      settings: refreshSettings(platformSettled).catch(() => {}),
      recent: refreshRecent().catch(() => {}),
      progress: refreshReadingProgress().catch(() => {}),
    };
  }
  return reads;
}
