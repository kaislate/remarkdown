import { get } from 'svelte/store';
import { readDocument, toAssetUrl } from '../lib/tauri-api';
import { render } from '../lib/MarkdownRenderer';
import { loadSidecar } from '../lib/sidecar';
import { docEpoch, orphanedAnnots } from './annots';
import { addToast } from './toasts';
import { openModal } from './modals';
import { installFileWatcher } from '../lib/file-watch';
import type { Annotation } from '../lib/schema';
import { getProgressFor } from './reading-progress';
import { viewerScroll } from './viewport';
import { settings } from './settings';
import { activeProxy, activeSession, type DocSession } from './sessions';

export type { DocState } from './doc-types';

// The active tab's document. A proxy onto the active session's own store —
// see sessions.ts.
export const doc = activeProxy((s) => s.doc);

// Edit mode pauses a tab's watcher so autosave writes don't bounce back as
// "file changed on disk" reloads. Pass the tab explicitly from async code:
// by the time a reload resolves, the active tab may be a different one.
export async function pauseFileWatcher(session: DocSession = get(activeSession)): Promise<void> {
  session.watcherPaused = true;
  if (session.disposeWatcher) {
    await session.disposeWatcher();
    session.disposeWatcher = null;
  }
}

export async function resumeFileWatcher(session: DocSession = get(activeSession)): Promise<void> {
  session.watcherPaused = false;
  const path = get(session.doc)?.path;
  if (!path || session.disposeWatcher) return;
  session.disposeWatcher = await installFileWatcher(path, () => onFileChanged(session));
}

// Opens `path` in the active tab.
export async function loadDocument(path: string): Promise<boolean> {
  return loadIntoSession(get(activeSession), path);
}

// Loads `path` into `session`, which may be a background tab (tabs mode
// loads a new tab before switching to it). Returns true when the document
// is loaded (or was already loaded and unchanged), false on a read error —
// which has already been reported with a toast.
export async function loadIntoSession(session: DocSession, path: string): Promise<boolean> {
  let r;
  try {
    r = await readDocument(path);
  } catch (err) {
    if (err && typeof err === 'object' && 'NotUtf8' in err) {
      addToast({ kind: 'error', message: 'This file is not UTF-8 — remarkdown only supports UTF-8 markdown files.' });
    } else if (err && typeof err === 'object' && 'Io' in err) {
      addToast({ kind: 'error', message: `Could not open file: ${(err as Record<string, unknown>).Io}` });
    } else {
      addToast({ kind: 'error', message: `Could not open file: ${String(err)}` });
    }
    return false;
  }

  // Skip reload if content is unchanged — prevents loops when the watcher
  // fires on our own writes or no-op touches.
  const current = get(session.doc);
  if (current && current.path === r.path && current.sha256 === r.sha256) {
    return true;
  }

  // Detect "user opened a new doc" vs "current doc reloaded after an
  // external edit" — only the former should auto-enter Focus mode if
  // the user has that setting on. Edit-reload keeps the current chrome
  // state so the file watcher doesn't yank the UI from under the user.
  const isNewDocOpen = !current || current.path !== r.path;

  const { html, plaintext, blocks } = await render(r.markdown, {
    baseDir: r.dir,
    toAssetUrl,
  });

  let parsedAnnotations: Annotation[] = [];
  if (r.sidecarRaw) {
    const result = loadSidecar(r.sidecarRaw);
    if (result.ok) {
      parsedAnnotations = result.value.annotations;
    } else {
      console.warn('[remarkdown] sidecar load failed:', result.error);
      openModal({ kind: 'corrupt-sidecar', path: r.path });
    }
  }
  session.annots.set(parsedAnnotations);

  // New content invalidates anything captured from the previous render —
  // unless the tab is (back) in edit mode: then this is the late reload
  // after a previous edit session and the live editor is the truth.
  session.scrollTop = null;
  if (!get(session.editMode)) {
    session.editorState = null;
    session.editedMarkdown = null;
  }
  session.pendingDiskReload = false;

  session.doc.set({
    path: r.path,
    dir: r.dir,
    sha256: r.sha256,
    bytes: r.bytes,
    markdown: r.markdown,
    html,
    plaintext,
    blocks,
    sidecarRaw: r.sidecarRaw,
  });
  const isActive = session === get(activeSession);
  if (isActive) docEpoch.update((e) => e + 1);

  if (isNewDocOpen && get(settings).openInFocusMode) {
    session.readerMode.set(true);
  }

  if (isActive && isNewDocOpen) restoreProgressScroll(path);

  // Replace this session's watcher (if any) with one for the new path,
  // unless it's paused (edit mode autosave).
  if (session.disposeWatcher) {
    await session.disposeWatcher();
    session.disposeWatcher = null;
  }
  if (!session.watcherPaused && !session.closed) {
    const dispose = await installFileWatcher(path, () => onFileChanged(session));
    // The tab may have been closed while the watcher was being set up.
    if (session.closed) await dispose();
    else session.disposeWatcher = dispose;
  }
  return true;
}

// Restore scroll position from saved reading progress. Deferred two
// animation frames so the article renders + computes layout first.
function restoreProgressScroll(path: string): void {
  const progress = getProgressFor(path);
  if (!progress || progress.scrollRatio <= 0.001) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const scrollEl = get(viewerScroll);
      if (!scrollEl) return;
      const max = scrollEl.scrollHeight - scrollEl.clientHeight;
      if (max > 0) scrollEl.scrollTop = max * progress.scrollRatio;
    });
  });
}

// A background tab's file changed on disk: don't re-render into a DOM it
// doesn't own — reload when the user switches to it.
function onFileChanged(session: DocSession): void {
  if (session !== get(activeSession)) {
    session.pendingDiskReload = true;
    return;
  }
  void reloadSession(session);
}

// Reload a session from disk and report how its annotations fared. The
// orphan deltas come from the derived stores, which only describe the
// active tab — callers only reload the active session.
export async function reloadSession(session: DocSession): Promise<void> {
  const path = get(session.doc)?.path;
  if (!path) return;
  // Capture orphan-set BEFORE reload so we can compute deltas.
  const before = new Set(get(orphanedAnnots).map((a) => a.id));
  await loadIntoSession(session, path);
  // After reload, derived stores re-partition. Compare orphan sets.
  const after = new Set(get(orphanedAnnots).map((a) => a.id));
  let reanchored = 0;
  for (const id of before) if (!after.has(id)) reanchored += 1;
  let newOrphans = 0;
  for (const id of after) if (!before.has(id)) newOrphans += 1;
  if (reanchored > 0 || newOrphans > 0) {
    addToast({
      kind: 'info',
      message: `File reloaded — ${reanchored} re-anchored, ${newOrphans} orphaned.`,
    });
  } else {
    addToast({ kind: 'info', message: 'File reloaded from disk.' });
  }
}

export function clearDocument(): void {
  const session = get(activeSession);
  session.doc.set(null);
  session.annots.set([]);
  docEpoch.update((e) => e + 1);
}
