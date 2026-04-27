// Re-attach mode state. When non-null, the article enters a special
// "select-where-this-annotation-should-live" mode: tool rail is disabled,
// cursor becomes a text I-beam, and the next text selection commits the
// annotation's new anchor.

import { writable } from 'svelte/store';

export interface ReattachTarget {
  annotationId: string;
  // Short preview of what's being re-attached, shown in the banner.
  // First 60 chars of the orphan's text/body.
  snippet: string;
  // For drawings: the original shape kind so we can preserve em offsets
  // when re-attaching to a different block. For highlights / re.marks
  // this is undefined.
  kind?: string;
}

export const reattachTarget = writable<ReattachTarget | null>(null);

export function startReattach(target: ReattachTarget): void {
  reattachTarget.set(target);
}

export function cancelReattach(): void {
  reattachTarget.set(null);
}
