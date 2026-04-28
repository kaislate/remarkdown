// Shared state for the X-cursor follower (the "click to close" affordance
// that appears over modal backdrops). Any overlay component subscribes
// to setActive/setPressed; a single MouseCursor follower at the app root
// reads the state and grows/shrinks accordingly.

import { writable } from 'svelte/store';

export interface CursorState {
  active: boolean;
  pressed: boolean;
}

export const cursorState = writable<CursorState>({ active: false, pressed: false });

export function setCursorActive(v: boolean): void {
  cursorState.update((s) => ({ ...s, active: v }));
}

export function setCursorPressed(v: boolean): void {
  cursorState.update((s) => ({ ...s, pressed: v }));
}

export function collapseCursor(): void {
  cursorState.set({ active: false, pressed: false });
}
