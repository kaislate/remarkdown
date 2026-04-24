import { writable } from 'svelte/store';

// The main viewer's scroll container element. The Minimap subscribes to this to
// track scroll position and inject the viewport indicator. Null when no doc loaded.
export const viewerScroll = writable<HTMLElement | null>(null);
