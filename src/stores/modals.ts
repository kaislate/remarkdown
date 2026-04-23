import { writable } from 'svelte/store';

export type ModalState =
  | null
  | { kind: 'orphans' }
  | { kind: 'corrupt-sidecar'; path: string };

export const activeModal = writable<ModalState>(null);

export function openModal(m: Exclude<ModalState, null>): void {
  activeModal.set(m);
}

export function closeModal(): void {
  activeModal.set(null);
}
