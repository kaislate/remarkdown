import { writable } from 'svelte/store';
import { ulid } from 'ulid';

export type ToastKind = 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  createdAt: number;
}

const AUTO_DISMISS_MS: Partial<Record<ToastKind, number>> = {
  info: 4000,
  warning: 4000,
  // error has no auto-dismiss
};

export const toasts = writable<Toast[]>([]);

export function addToast(t: {
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}): string {
  const id = ulid();
  const toast: Toast = { ...t, id, createdAt: Date.now() };
  toasts.update((list) => [...list, toast]);
  const ms = AUTO_DISMISS_MS[t.kind];
  if (ms) setTimeout(() => dismissToast(id), ms);
  return id;
}

export function dismissToast(id: string): void {
  toasts.update((list) => list.filter((t) => t.id !== id));
}

export function clearToasts(): void {
  toasts.set([]);
}
