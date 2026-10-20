import { writable, derived, get } from 'svelte/store';
import { resolveAnchor } from '../lib/anchoring';
import type { Annotation, Drawing } from '../lib/schema';
import { activeProxy, activeSession, type DocSession } from './sessions';

export interface ResolvedAnnotation {
  annotation: Annotation;
  range: Range; // for highlights/notes. For drawings this is a placeholder; DrawLayer uses anchorBlock directly.
}

// The active tab's annotations (proxy onto the active session's store).
export const annots = activeProxy((s) => s.annots);

// The viewer root element used to resolve anchors. Set by Viewer.svelte on mount.
export const currentViewerRoot = writable<HTMLElement | null>(null);

// epoch increments when the rendered doc changes, forcing derived stores to re-resolve.
export const docEpoch = writable(0);

// ── undo / redo ──────────────────────────────────────────────────────
// Each tab keeps the annotation lists from before its recent changes
// (Ctrl+Z / Ctrl+Y outside the editor; App.svelte). Changes to one
// annotation in quick succession — typing a re.mark, dragging a colour —
// are one step. Loading the document (again) starts afresh.

interface History {
  undo: Annotation[][];
  redo: Annotation[][];
  // The last change, to merge quick edits of the same annotation.
  last: { id: string; at: number } | null;
}
const HISTORY_LIMIT = 100;
const MERGE_MS = 1200;
const histories = new WeakMap<DocSession, History>();

function historyOf(s: DocSession): History {
  let h = histories.get(s);
  if (!h) histories.set(s, (h = { undo: [], redo: [], last: null }));
  return h;
}

// Called before every change: keeps the list as it was.
function remember(mergeId: string | null): void {
  const h = historyOf(get(activeSession));
  const now = Date.now();
  if (mergeId && h.last?.id === mergeId && now - h.last.at < MERGE_MS) {
    h.last.at = now;
    return;
  }
  h.undo.push(get(annots));
  if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
  h.redo = [];
  h.last = mergeId ? { id: mergeId, at: now } : null;
}

export function resetAnnotHistory(s: DocSession): void {
  histories.delete(s);
}

export function canUndoAnnot(): boolean {
  return historyOf(get(activeSession)).undo.length > 0;
}

export function canRedoAnnot(): boolean {
  return historyOf(get(activeSession)).redo.length > 0;
}

// What a step did, in words, from the list before to the list after.
export function describeChange(before: Annotation[], after: Annotation[]): string {
  const name = (a: Annotation) => (a.type === 'highlight' ? 'highlight' : a.type === 'note' ? 're.mark' : 'drawing');
  const ids = new Set(before.map((a) => a.id));
  const added = after.filter((a) => !ids.has(a.id));
  const kept = new Set(after.map((a) => a.id));
  const removed = before.filter((a) => !kept.has(a.id));
  const one = (verb: string, list: Annotation[]) =>
    list.length === 1 ? `${verb} a ${name(list[0])}` : `${verb} ${list.length} annotations`;
  if (added.length && !removed.length) return one('added', added);
  if (removed.length && !added.length) return one('removed', removed);
  const changed = after.find((a) => before.find((b) => b.id === a.id) !== a);
  return changed ? `changed a ${name(changed)}` : 'changed annotations';
}

// Steps back (or forward) one change; returns what it undid / redid, or
// null when there's nothing to.
export function undoAnnot(): string | null {
  const h = historyOf(get(activeSession));
  const prev = h.undo.pop();
  if (!prev) return null;
  const now = get(annots);
  h.redo.push(now);
  h.last = null;
  annots.set(prev);
  return describeChange(prev, now);
}

export function redoAnnot(): string | null {
  const h = historyOf(get(activeSession));
  const next = h.redo.pop();
  if (!next) return null;
  const now = get(annots);
  h.undo.push(now);
  h.last = null;
  annots.set(next);
  return describeChange(now, next);
}

export function addAnnotation(a: Annotation): void {
  remember(null);
  // Changes to it straight after (a stroke finishing, a re.mark being
  // written) belong to the same step.
  historyOf(get(activeSession)).last = { id: a.id, at: Date.now() };
  annots.update((list) => [...list, a]);
}

export function updateAnnotation(id: string, mutate: (a: Annotation) => Annotation): void {
  remember(id);
  annots.update((list) =>
    list.map((a) => (a.id === id ? { ...mutate(a), updatedAt: new Date().toISOString() } : a)),
  );
}

export function removeAnnotation(id: string): void {
  remember(null);
  annots.update((list) => list.filter((a) => a.id !== id));
}

export function replaceAll(list: Annotation[]): void {
  remember(null);
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
