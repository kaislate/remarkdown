// Edit-mode autosave with conflict protection.
//
// Each tab remembers the sha of the file as it last read or wrote it
// (session.diskSha). Saves for a tab run one after another (session.saveChain),
// each refusing to write if the file on disk no longer matches — so another
// program's changes are never silently overwritten, and two of our own saves
// in flight can't be mistaken for someone else's.
//
// When a save is refused, the conflict records exactly which file and which
// text it was about (session.editConflict). Saving pauses for that tab — later
// keystrokes only update the recorded text — and the user decides, like
// Word's "This file has been modified by another program":
//   keep   — write my text to that file
//   theirs — drop my text and load the file from disk
//   copy   — save my text next to it as "<name> (my copy).md", open that in a
//            new tab, and load this tab from disk
// Resolution always uses the record, never whatever the tab shows by then.

import { get } from 'svelte/store';
import { activeSession, sessions, type DocSession } from '../stores/sessions';
import { loadIntoSession, resumeFileWatcher } from '../stores/doc';
import { openModal, closeModal, activeModal } from '../stores/modals';
import { addToast } from '../stores/toasts';
import { writeDocument, checkPathsExist } from './tauri-api';
import { openPaths } from './open-files';

export type ConflictChoice = 'keep' | 'theirs' | 'copy';

function isConflict(err: unknown): boolean {
  return !!err && typeof err === 'object' && 'Conflict' in err;
}

// Queue a save of `markdown` to `path` for this tab. Resolves when this save
// (and every earlier one for the tab) has finished.
export function saveEditedMarkdown(session: DocSession, path: string, markdown: string): Promise<void> {
  const run = session.saveChain.then(() => saveNow(session, path, markdown));
  session.saveChain = run.catch(() => undefined);
  return run;
}

// Wait until every save queued for this tab has finished.
export function savesSettled(session: DocSession): Promise<void> {
  return session.saveChain;
}

async function saveNow(session: DocSession, path: string, markdown: string): Promise<void> {
  // "Use the other version" is reloading this tab: a debounced save that
  // flushes meanwhile carries the edits the user just chose to discard.
  if (session.discardPendingEdits) return;
  if (session.editConflict) {
    // Waiting on the user's decision: keep their newest text for it, and
    // make sure they are actually being asked.
    if (session.editConflict.path === path) session.editConflict.markdown = markdown;
    askAboutConflict(session);
    return;
  }
  try {
    session.diskSha = await writeDocument(path, markdown, session.diskSha);
  } catch (err) {
    if (isConflict(err)) {
      session.editConflict = { path, markdown };
      askAboutConflict(session);
      return;
    }
    addToast({ kind: 'error', message: `Couldn't save your changes: ${describe(err)}`, persistent: true });
  }
}

// Show this tab's conflict dialog unless it's already showing. A conflict
// outranks any other dialog: losing the decision means losing the text.
export function askAboutConflict(session: DocSession): void {
  const m = get(activeModal);
  if (m?.kind === 'edit-conflict' && m.sessionId === session.id) return;
  if (m?.kind === 'edit-conflict') return; // another tab is being asked; it hands over after
  openModal({ kind: 'edit-conflict', sessionId: session.id });
}

// After one conflict is settled, ask about the next tab that has one.
function askAboutNextConflict(): void {
  const next = get(sessions).find((s) => s.editConflict && !s.closed);
  if (next) askAboutConflict(next);
}

export async function resolveEditConflict(session: DocSession, choice: ConflictChoice): Promise<void> {
  const m = get(activeModal);
  if (m?.kind === 'edit-conflict' && m.sessionId === session.id) closeModal();
  const conflict = session.editConflict;
  if (!conflict) {
    askAboutNextConflict();
    return;
  }

  try {
    if (choice === 'keep') {
      try {
        session.diskSha = await writeDocument(conflict.path, conflict.markdown, null);
        session.editConflict = null;
        session.editedMarkdown = get(session.editMode) ? conflict.markdown : null;
        // Not editing any more (they pressed Done before deciding): show
        // the text that was just kept.
        if (!get(session.editMode)) await refreshFromDisk(session, conflict.path);
      } catch (err) {
        addToast({ kind: 'error', message: `Couldn't save your changes: ${describe(err)}`, persistent: true });
        askAboutConflict(session); // still undecided — keep their text safe
      }
      return;
    }

    if (choice === 'copy') {
      let copy: string;
      try {
        copy = await copyPathFor(conflict.path);
        await writeDocument(copy, conflict.markdown, null);
      } catch (err) {
        addToast({ kind: 'error', message: `Couldn't save a copy: ${describe(err)}`, persistent: true });
        askAboutConflict(session);
        return;
      }
      await discardAndReload(session, conflict.path);
      await openPaths([copy], { mode: 'tabs' });
      return;
    }

    await discardAndReload(session, conflict.path);
  } finally {
    if (!session.editConflict) askAboutNextConflict();
  }
}

// Load the on-disk version into this tab, discarding unsaved edits. Forced:
// even if the disk is back to exactly what the tab first opened, the editor
// must start over on it (the editor only reads its text when it mounts).
async function discardAndReload(session: DocSession, path: string): Promise<void> {
  session.discardPendingEdits = true;
  session.editedMarkdown = null;
  session.editorState = null;
  try {
    await loadIntoSession(session, path, { force: true });
  } finally {
    session.discardPendingEdits = false;
    session.editConflict = null;
  }
  if (!get(session.editMode)) void resumeFileWatcher(session);
}

async function refreshFromDisk(session: DocSession, path: string): Promise<void> {
  await loadIntoSession(session, path, { force: true });
  if (!get(session.editMode)) void resumeFileWatcher(session);
}

// "Plan.md" → "Plan (my copy).md", then "(my copy 2)", … — never an existing
// file. Throws if it can't check which names are taken (it never guesses).
export async function copyPathFor(path: string): Promise<string> {
  const m = /^(.*?)(\.(?:md|markdown))?$/i.exec(path)!;
  const stem = m[1];
  const ext = m[2] ?? '.md';
  const candidates = Array.from({ length: 50 }, (_, i) =>
    `${stem} (my copy${i === 0 ? '' : ` ${i + 1}`})${ext}`);
  const exists = await checkPathsExist(candidates);
  const free = candidates.find((_, i) => !exists[i]);
  if (free) return free;
  throw new Error('too many copies already exist next to this file');
}

// Any tab still waiting on a conflict decision (used before closing).
export function unresolvedConflict(): DocSession | null {
  return get(sessions).find((s) => s.editConflict && !s.closed) ?? null;
}

export function isActive(session: DocSession): boolean {
  return get(activeSession) === session;
}

function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'Io' in err) return String((err as { Io: unknown }).Io);
  if (err instanceof Error) return err.message;
  return String(err);
}
