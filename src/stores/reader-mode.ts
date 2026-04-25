// Reader mode hides every chrome layer (menu, title bar buttons,
// tool rail, minimap, watermark, panels) so the user can read the
// article without distraction. The title bar drag region and resize
// grip stay invisible-but-functional so the window can still be moved
// and resized without leaving reader mode.
//
// State is session-scoped — opening the app again starts in normal
// mode. We don't persist this because reader mode is a "while I'm
// reading" choice, not a global preference.

import { writable } from 'svelte/store';

export const readerMode = writable(false);

export function toggleReaderMode() {
  readerMode.update((v) => !v);
}

export function exitReaderMode() {
  readerMode.set(false);
}
