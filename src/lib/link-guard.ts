// The window never follows a link, wherever the link is. The reader routes
// the links in its article (Viewer.svelte), but documents show up elsewhere
// too: the footnote and source previews in edit mode, and the release notes
// in the update dialog. Followed in place, a relative link there reloads
// the app (Tauri answers any path with index.html), losing the editor and
// its undo; a web link would replace the app. Rust refuses most of those
// navigations as well (navigation.rs), but not all: Tauri lets through any
// URL its parser rejects and the webview doesn't, so this is the guard.
//
// One capture listener on the window sees every click before anything on
// the page can stop it, and always prevents the default. Outside the
// reader a link can only go to the browser or mail app: a relative path or
// an '#id' has nothing to mean there. A diagram's links and the editor's
// go nowhere (the editor is for changing them, not following them).
//
// A form is the other way a page leaves: mermaid keeps form controls in a
// diagram's HTML labels, and a click on the button would go to the form's
// action. No form in the app submits by navigating (the link popover
// handles its own submit), so every submit is prevented the same way.

import { linkAction } from './link-action';

const XLINK = 'http://www.w3.org/1999/xlink';
// Where a link is someone else's to route, or nobody's.
const NOT_OURS = '[data-own-links], .mermaid-block, .mermaid-block-editor, [contenteditable]';

export function installLinkGuard(target: Window, external: (url: string) => void): () => void {
  const onLink = (e: MouseEvent) => {
    // A middle click arrives as auxclick; the right button's is the
    // context menu's.
    if (e.type === 'auxclick' && e.button !== 1) return;
    const a = (e.target as Element | null)?.closest?.('a, area');
    // An SVG link (a diagram's) may carry its target as xlink:href.
    const href = a?.getAttribute('href') ?? a?.getAttributeNS(XLINK, 'href');
    if (!a || href == null) return;
    e.preventDefault();
    if (a.closest(NOT_OURS)) return;
    const action = linkAction(href, null);
    if (action.kind === 'external') external(action.url);
  };
  const onSubmit = (e: Event) => e.preventDefault();
  target.addEventListener('click', onLink, true);
  target.addEventListener('auxclick', onLink, true);
  target.addEventListener('submit', onSubmit, true);
  return () => {
    target.removeEventListener('click', onLink, true);
    target.removeEventListener('auxclick', onLink, true);
    target.removeEventListener('submit', onSubmit, true);
  };
}
