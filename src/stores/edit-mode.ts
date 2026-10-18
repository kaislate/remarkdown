// Edit mode is per tab (like separate Word documents) and never persisted —
// opening the app starts every tab in read mode. Toggling enters/exits the
// PM-backed editor for the active document. Proxy onto the active session's
// store; see sessions.ts.
import { activeProxy } from './sessions';

export const editMode = activeProxy((s) => s.editMode);

export function enterEditMode(): void {
  editMode.set(true);
}

export function exitEditMode(): void {
  editMode.set(false);
}

export function toggleEditMode(): void {
  editMode.update((v) => !v);
}
