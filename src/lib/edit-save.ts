// Edit-mode autosave with conflict protection.
//
// Each tab remembers the sha of the file as it last read or wrote it
// (session.diskSha). Every save asks Rust to write only if the file on disk
// still matches. If another program changed it meanwhile, nothing is
// written: saving pauses for that tab and the user decides, like Word's
// "This file has been modified by another program" prompt:
//   keep   — overwrite the file with my version
//   theirs — drop my unsaved edits and load the file from disk
//   copy   — save my version next to it as "<name> (my copy).md", open it
//            in a new tab, and load this tab from disk

import { get } from 'svelte/store';
import type { DocSession } from '../stores/sessions';
import { loadIntoSession } from '../stores/doc';
import { openModal, closeModal, activeModal } from '../stores/modals';
import { addToast } from '../stores/toasts';
import { writeDocument, checkPathsExist } from './tauri-api';
import { openPaths } from './open-files';

export type ConflictChoice = 'keep' | 'theirs' | 'copy';

function isConflict(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'Conflict' in err;
}

export async function saveEditedMarkdown(session: DocSession, path: string, markdown: string): Promise<void> {
  // "Use the other version" is reloading this tab: a debounced save that
  // flushes meanwhile carries the edits the user just chose to discard.
  if (session.discardPendingEdits) return;
  // Waiting on the user's decision — the latest text is in editedMarkdown.
  if (session.editConflict) return;
  try {
    session.diskSha = await writeDocument(path, markdown, session.diskSha);
  } catch (err) {
    if (isConflict(err)) {
      session.editConflict = true;
      openModal({ kind: 'edit-conflict', sessionId: session.id });
      return;
    }
    addToast({ kind: 'error', message: `Couldn't save your changes: ${describe(err)}` });
  }
}

export async function resolveEditConflict(session: DocSession, choice: ConflictChoice): Promise<void> {
  const d = get(session.doc);
  const m = get(activeModal);
  if (m?.kind === 'edit-conflict' && m.sessionId === session.id) closeModal();
  if (!d) {
    session.editConflict = false;
    return;
  }
  const mine = session.editedMarkdown ?? d.markdown;

  if (choice === 'keep') {
    try {
      session.diskSha = await writeDocument(d.path, mine, null);
      session.editConflict = false;
    } catch (err) {
      addToast({ kind: 'error', message: `Couldn't save your changes: ${describe(err)}` });
      session.editConflict = false;
    }
    return;
  }

  if (choice === 'copy') {
    try {
      const copy = await copyPathFor(d.path);
      await writeDocument(copy, mine, null);
      await reloadFromDisk(session, d.path);
      await openPaths([copy]);
    } catch (err) {
      addToast({ kind: 'error', message: `Couldn't save a copy: ${describe(err)}` });
      session.editConflict = false;
    }
    return;
  }

  await reloadFromDisk(session, d.path);
}

// Load the on-disk version into this tab, discarding unsaved edits. The tab
// stays in edit mode; the editor remounts on the new content.
async function reloadFromDisk(session: DocSession, path: string): Promise<void> {
  session.discardPendingEdits = true;
  session.editedMarkdown = null;
  session.editorState = null;
  try {
    await loadIntoSession(session, path);
  } finally {
    session.discardPendingEdits = false;
    session.editConflict = false;
  }
}

// "Plan.md" → "Plan (my copy).md", then "(my copy 2)", … — never an
// existing file.
export async function copyPathFor(path: string): Promise<string> {
  const m = /^(.*?)(\.(?:md|markdown))?$/i.exec(path)!;
  const stem = m[1];
  const ext = m[2] ?? '.md';
  const candidates = Array.from({ length: 50 }, (_, i) =>
    `${stem} (my copy${i === 0 ? '' : ` ${i + 1}`})${ext}`);
  let exists: boolean[];
  try {
    exists = await checkPathsExist(candidates);
  } catch {
    exists = candidates.map(() => false);
  }
  const free = candidates.find((_, i) => !exists[i]);
  return free ?? `${stem} (my copy ${Date.now()})${ext}`;
}

function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'Io' in err) return String((err as { Io: unknown }).Io);
  return String(err);
}
