import { writable } from 'svelte/store';

// The main viewer's scroll container element. The Minimap subscribes to this to
// track scroll position and inject the viewport indicator. Null when no doc loaded.
export const viewerScroll = writable<HTMLElement | null>(null);

// The editor's content element (ProseMirror's root) while a document is
// being edited, else null. In edit mode the minimap mirrors and measures
// this instead of the hidden reading article: the editor lays out a little
// differently (diagrams carry their editing controls), so the reading
// layout would put the viewport box in the wrong place.
export const currentEditorRoot = writable<HTMLElement | null>(null);

