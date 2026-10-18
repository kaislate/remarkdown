// Document sessions — one per open tab.
//
// Each session owns the per-document state that used to live in module-level
// stores (doc, annotations, edit mode, focus mode) plus the bits needed to put
// the user back exactly where they were when they return to the tab: the
// scroll offset and the ProseMirror EditorState (which carries undo history
// and selection).
//
// The rest of the app keeps importing `doc`, `annots`, `editMode` and
// `readerMode` as before; those are now `activeProxy` stores that always show
// the active session. Background sessions are only ever written by their own
// loader / file watcher, so nothing the user does in one tab can touch
// another.

import { writable, get, type Writable } from 'svelte/store';
import type { EditorState } from 'prosemirror-state';
import type { Annotation } from '../lib/schema';
import type { DocState } from './doc-types';

export interface DocSession {
  id: string;
  doc: Writable<DocState | null>;
  annots: Writable<Annotation[]>;
  editMode: Writable<boolean>;
  readerMode: Writable<boolean>;
  // Exact scroll offset captured when the user switched away. Null until the
  // first switch-away (or after a reload) — then reading progress is used.
  scrollTop: number | null;
  // Editor state captured on switch-away while in edit mode. Only valid while
  // the session stays in edit mode; cleared on leaving edit mode or reload.
  editorState: EditorState | null;
  // The editor's latest markdown while (or just after) editing. The doc
  // store is frozen during edit mode, so this is what a re-mounted editor
  // must start from if the post-edit reload from disk hasn't landed yet.
  editedMarkdown: string | null;
  // The file changed on disk while this tab was in the background; reload
  // when it's activated.
  pendingDiskReload: boolean;
  watcherPaused: boolean;
  disposeWatcher: (() => Promise<void>) | null;
  // Set when the tab is closed, so an in-flight load doesn't install a
  // watcher (or anything else) on a tab that no longer exists.
  closed: boolean;
}

let counter = 0;

export function createSession(): DocSession {
  counter += 1;
  return {
    id: `s${counter}`,
    doc: writable<DocState | null>(null),
    annots: writable<Annotation[]>([]),
    editMode: writable(false),
    readerMode: writable(false),
    scrollTop: null,
    editorState: null,
    editedMarkdown: null,
    pendingDiskReload: false,
    watcherPaused: false,
    disposeWatcher: null,
    closed: false,
  };
}

// A window always has at least one session; an empty one (doc === null) is
// the "Open a markdown file" state.
const first = createSession();
export const sessions = writable<DocSession[]>([first]);
export const activeSession = writable<DocSession>(first);

// A Writable that always points at the active session's inner store.
// Subscribers follow tab switches (and get the new tab's value immediately);
// set/update write to whichever session is active at call time.
export function activeProxy<T>(pick: (s: DocSession) => Writable<T>): Writable<T> {
  return {
    subscribe(run, invalidate) {
      let inner: (() => void) | null = null;
      const outer = activeSession.subscribe((s) => {
        inner?.();
        inner = pick(s).subscribe(run, invalidate);
      });
      return () => {
        outer();
        inner?.();
      };
    },
    set(value) {
      pick(get(activeSession)).set(value);
    },
    update(fn) {
      pick(get(activeSession)).update(fn);
    },
  };
}

export function resetSessionsForTests(): void {
  const s = createSession();
  sessions.set([s]);
  activeSession.set(s);
}
