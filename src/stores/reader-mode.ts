// Reader mode shows nothing but the page: every chrome layer (menu, title
// bar buttons, tabs, tool rail, minimap, panels, toggles, banners) is
// hidden by styles/reader-mode.css, the article switches to reading
// typography and the chosen reader theme, and annotations stay visible
// but can't be changed. An invisible band along the top still drags the
// window. The only way out is Esc.
//
// State is session-scoped — opening the app again starts in normal
// mode. We don't persist this because reader mode is a "while I'm
// reading" choice, not a global preference.

// Per tab: each tab remembers whether it was in reader mode. Proxy onto the
// active session's store; see sessions.ts.
import { get } from 'svelte/store';
import { activeProxy } from './sessions';
import { editMode } from './edit-mode';
import { settings } from './settings';
import { activeModal } from './modals';
import { reattachTarget } from './reattach';
import { tool, setMode } from './tool';
import type { Tool } from '../lib/schema';

export const readerMode = activeProxy((s) => s.readerMode);

export function toggleReaderMode() {
  // Reader mode is for reading: leave edit mode first (the normal way —
  // its pending save is flushed and the page reloads from disk).
  if (!get(readerMode) && get(editMode)) editMode.set(false);
  readerMode.update((v) => !v);
}

export function exitReaderMode() {
  readerMode.set(false);
}

// Something on top of the page that Esc should close first: a modal, a
// popover or context menu (anything with role dialog / menu that is
// actually showing), or an in-progress re-attach.
export function hasOpenLayer(): boolean {
  if (get(activeModal) !== null) return true;
  if (get(reattachTarget) !== null) return true;
  for (const el of document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"]')) {
    // Chrome hidden by reader mode can still be mounted (an open ToC
    // when the user entered); it isn't on screen, so it doesn't count.
    // jsdom has no checkVisibility — there everything mounted counts.
    if (typeof el.checkVisibility !== 'function' || el.checkVisibility()) return true;
  }
  return false;
}

// Runs in the capture phase on window, i.e. before any other keydown
// handler — so it sees the layers as they were when the key was pressed,
// and a handler that closes a popover can't make the same Esc also leave
// reader mode.
function onEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (!get(readerMode)) return;
  if (hasOpenLayer()) return;
  exitReaderMode();
}

// Wires reader mode into the page; returns the disposer. Called once by
// App.svelte.
//  - body.reader-mode + body[data-reader-theme] drive reader-mode.css.
//  - The annotation tool is parked on 'cursor' while reading (highlights,
//    re.marks and drawings are read-only) and handed back on the way out —
//    including when the user switches to a tab that isn't in reader mode.
export function installReaderMode(): () => void {
  let parkedTool: Tool | null = null;

  const unsubMode = readerMode.subscribe((on) => {
    document.body.classList.toggle('reader-mode', on);
    if (on && parkedTool === null) {
      parkedTool = get(tool).mode;
      if (parkedTool !== 'cursor') setMode('cursor');
    } else if (!on && parkedTool !== null) {
      const back = parkedTool;
      parkedTool = null;
      if (get(tool).mode !== back) setMode(back);
    }
  });

  const unsubTheme = settings.subscribe((s) => {
    document.body.dataset.readerTheme = s.readerTheme;
    document.body.classList.toggle('reader-minimap', s.readerMinimap);
    document.body.classList.toggle('reader-nav-left', s.readerNav === 'left');
  });

  window.addEventListener('keydown', onEscape, true);

  return () => {
    unsubMode();
    unsubTheme();
    window.removeEventListener('keydown', onEscape, true);
  };
}
