// Adding a re.mark on the selected text from the right-click menu, opened
// ready to write in (NoteLayer opens whatever noteToOpen names), the same
// as clicking that text with the re.mark tool.
import { get, writable } from 'svelte/store';
import { ulid } from 'ulid';
import { addAnnotation, currentViewerRoot } from '../stores/annots';
import { createAnchor, rangeTouchesDiagram, DIAGRAM_ANNOTATION_HINT } from './anchoring';
import { addToast } from '../stores/toasts';
import type { Note } from './schema';

export const noteToOpen = writable<string | null>(null);

// True if a re.mark was added for the selection.
export function addNoteForSelection(): boolean {
  const root = get(currentViewerRoot);
  const sel = window.getSelection();
  if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return false;
  if (rangeTouchesDiagram(range)) {
    addToast({ kind: 'info', message: DIAGRAM_ANNOTATION_HINT });
    return false;
  }
  const anchor = createAnchor(range, root);
  if (!anchor) return false;
  const now = new Date().toISOString();
  const note: Note = { id: ulid(), type: 'note', anchor, body: '', createdAt: now, updatedAt: now };
  addAnnotation(note);
  sel.removeAllRanges();
  noteToOpen.set(note.id);
  return true;
}
