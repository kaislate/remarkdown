// Jumping to a heading picked from the contents (the ToC popover, or the
// contents beside the page in reader mode). With "Glide to a section" the
// page glides there on the smooth-scrolling curve (lib/smooth-scroll.ts);
// with "Ink trail" a drop of ink runs from the contents to the heading and
// lands under it (InkLayer.svelte). Both stand down under reduced motion and
// on the e-ink reader theme.
import { get, writable } from 'svelte/store';
import { settings } from '../stores/settings';
import { readerMode } from '../stores/reader-mode';
import { viewerScroll } from '../stores/viewport';
import { glideScrollTo, GLIDE_SCALES, type Glide } from './smooth-scroll';

export function motionAllowed(): boolean {
  if (get(readerMode) && get(settings).readerTheme === 'eink') return false;
  return !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
}

export interface InkTrail {
  id: number;
  // Where the ink starts: the contents' marker, in window coordinates.
  from: { x: number; y: number };
  // The heading it runs to (followed live while the page glides).
  target: HTMLElement;
  // How long the run takes, ms — about as long as the page's glide.
  travel: number;
}

export const inkTrail = writable<InkTrail | null>(null);

// The shortest run, so the ink reads as a motion even when the page jumps.
const MIN_TRAVEL_MS = 460;

let glide: Glide | null = null;
let inkIds = 0;

export interface JumpOptions {
  // Space left above the heading once there (default: clear of the top
  // tabs, which float over the page).
  offset?: number;
  // Go to the very top instead (the document's title).
  toTop?: boolean;
  // The marker the ink leaves from; no ink without it.
  from?: { x: number; y: number };
}

function defaultOffset(): number {
  const b = document.body.classList;
  return b.contains('has-tabs') && !b.contains('tabs-left') && !b.contains('reader-mode') ? 72 : 24;
}

// Returns how long until the page has arrived, ms (0 if it jumped).
export function jumpToSection(heading: HTMLElement, opts: JumpOptions = {}): number {
  const scroll = get(viewerScroll);
  if (!scroll) return 0;
  const s = get(settings);
  const top = opts.toTop
    ? 0
    : scroll.scrollTop + heading.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (opts.offset ?? defaultOffset());
  glide?.cancel();
  glide = null;
  let ms = 0;
  const motion = motionAllowed();
  if (s.tocGlide && motion) {
    glide = glideScrollTo(scroll, top, { scale: GLIDE_SCALES[s.smoothScrollGlide] });
    ms = glide.duration;
  } else {
    scroll.scrollTop = top;
  }
  if (s.tocInk && motion && opts.from) {
    inkTrail.set({ id: ++inkIds, from: opts.from, target: heading, travel: Math.max(MIN_TRAVEL_MS, ms * 0.9) });
  }
  return ms;
}
