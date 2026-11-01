import { writable } from 'svelte/store';

export type ModalState =
  | null
  | { kind: 'orphans' }
  // No reason: the file is malformed. 'unreadable': too large, not an
  // ordinary file, or not text. 'too-many': more annotations than the app
  // will load.
  | { kind: 'corrupt-sidecar'; path: string; reason?: 'unreadable' | 'too-many' }
  | { kind: 'settings' }
  | { kind: 'confirm-clear-annots' }
  | { kind: 'check-update' }
  | { kind: 'edit-conflict'; sessionId: string }
  | { kind: 'onboarding' };

export const activeModal = writable<ModalState>(null);

export function openModal(m: Exclude<ModalState, null>): void {
  activeModal.set(m);
}

export function closeModal(): void {
  activeModal.set(null);
}
