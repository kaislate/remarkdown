// Edit mode is session-scoped — opening the app starts in read mode. We
// don't persist this because edit mode is a deliberate choice the user
// makes per session, not a global preference. Toggling enters/exits the
// PM-backed editor for the active document.
import { writable } from 'svelte/store';

export const editMode = writable(false);

export function enterEditMode(): void {
  editMode.set(true);
}

export function exitEditMode(): void {
  editMode.set(false);
}

export function toggleEditMode(): void {
  editMode.update((v) => !v);
}
