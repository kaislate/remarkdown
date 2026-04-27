import { writable, derived } from 'svelte/store';
import { resolveAnchor } from '../lib/anchoring';
import type { Annotation, Drawing } from '../lib/schema';

export interface ResolvedAnnotation {
  annotation: Annotation;
  range: Range; // for highlights/notes. For drawings this is a placeholder; DrawLayer uses anchorBlock directly.
}

export const annots = writable<Annotation[]>([]);

// The viewer root element used to resolve anchors. Set by Viewer.svelte on mount.
export const currentViewerRoot = writable<HTMLElement | null>(null);

// epoch increments when the rendered doc changes, forcing derived stores to re-resolve.
export const docEpoch = writable(0);

export function addAnnotation(a: Annotation): void {
  annots.update((list) => [...list, a]);
}

export function updateAnnotation(id: string, mutate: (a: Annotation) => Annotation): void {
  annots.update((list) =>
    list.map((a) => (a.id === id ? { ...mutate(a), updatedAt: new Date().toISOString() } : a)),
  );
}

export function removeAnnotation(id: string): void {
  annots.update((list) => list.filter((a) => a.id !== id));
}

export function replaceAll(list: Annotation[]): void {
  annots.set(list);
}

// Shared helper — both derived stores partition from the same source of truth.
function partition($annots: Annotation[], $root: HTMLElement | null): {
  resolved: ResolvedAnnotation[];
  orphanedIds: Set<string>;
} {
  if (!$root) return { resolved: [], orphanedIds: new Set($annots.map((a) => a.id)) };
  const resolved: ResolvedAnnotation[] = [];
  const orphanedIds = new Set<string>();
  for (const a of $annots) {
    if (a.type === 'drawing') {
      const d = a as Drawing;
      let resolves: boolean;
      switch (d.shape.kind) {
        case 'circle':
        case 'rectangle':
        case 'underline':
        case 'strikethrough':
          // TextAnchor shapes — resolve the same way highlights/notes do.
          resolves = resolveAnchor(d.shape.anchor, $root) !== null;
          break;
        case 'circle-empty':
        case 'margin-bar':
        case 'freehand':
          // BlockAnchor / BlockEmAnchor shapes — the referenced block must exist.
          resolves = !!$root.querySelector(`[data-block-id="${CSS.escape(d.shape.anchor.blockId)}"]`);
          break;
        case 'freehand-legacy':
          // Pre-refactor shape: top-level anchorBlock field.
          resolves = !!$root.querySelector(`[data-block-id="${CSS.escape(d.shape.anchorBlock)}"]`);
          break;
      }
      if (resolves) resolved.push({ annotation: d, range: null as unknown as Range });
      else orphanedIds.add(d.id);
      continue;
    }
    const range = resolveAnchor(a.anchor, $root);
    if (range) resolved.push({ annotation: a, range });
    else orphanedIds.add(a.id);
  }
  return { resolved, orphanedIds };
}

export const resolvedAnnots = derived(
  [annots, currentViewerRoot, docEpoch],
  ([$annots, $root]) => partition($annots, $root).resolved,
);

export const orphanedAnnots = derived(
  [annots, currentViewerRoot, docEpoch],
  ([$annots, $root]) => {
    const { orphanedIds } = partition($annots, $root);
    return $annots.filter((a) => orphanedIds.has(a.id));
  },
);
