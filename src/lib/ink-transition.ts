// Going in and out of reader mode, the old view dries away like ink: its
// colours drain while fractal ink splotches soak through it and run
// together, revealing the new view underneath. A view transition does the
// swap; the old view's snapshot is masked by a paint worklet
// (public/ink-worklet.js) driven by a CSS-animated --ink-t, so it runs at
// the display's rate. The styles are in styles/ink-transition.css. Skipped
// under reduced motion, on the e-ink reader theme, and where view
// transitions aren't supported — the change just happens. Without paint
// worklets the old view simply fades.
//
// The worklet builds each pattern's soak map once; doing that on the
// switch's first frame showed as a hitch. So the next switch's pattern is
// picked in advance and warmed: a small element in the window's
// proportions (the map depends on those, not the size) paints it, nearly
// invisible, at start-up, after every switch and after a resize.

import { writable } from 'svelte/store';

export const INK_DRY_MS = 1000;
const WARM_MS = 700;

let workletReady = false;
let nextSeed = 1 + Math.floor(Math.random() * 997);
let warmTimer: ReturnType<typeof setTimeout> | null = null;

function warm(): void {
  if (!workletReady || typeof document === 'undefined') return;
  let el = document.querySelector<HTMLElement>('.ink-warm');
  if (!el) {
    el = document.createElement('div');
    el.className = 'ink-warm';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  const ratio = window.innerHeight / Math.max(1, window.innerWidth);
  el.style.height = `${Math.round(160 * ratio)}px`;
  el.style.setProperty('--ink-seed', String(nextSeed));
  // Painted over a few frames (the worklet may run in more than one scope,
  // each with its own cache), then taken away.
  el.classList.remove('warming');
  void el.offsetWidth;
  el.classList.add('warming');
  if (warmTimer) clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    el?.remove();
    warmTimer = null;
  }, WARM_MS);
}

// Loaded once at start-up, so it's ready (and warm) by the first switch.
export function loadInkWorklet(): void {
  const css = typeof CSS !== 'undefined' ? (CSS as unknown as { paintWorklet?: { addModule(url: string): Promise<void> } }) : null;
  if (!css?.paintWorklet) return;
  css.paintWorklet
    .addModule('/ink-worklet.js')
    .then(() => {
      workletReady = true;
      warm();
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      window.addEventListener('resize', () => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(warm, 300);
      });
    })
    .catch(() => {});
}

// Is a swap running? (The welcome tutorial waits for the ink to dry.)
export const inkSwapping = writable(false);

// Runs `change` (which flips the mode) inside the ink transition when it
// can, else straight away. `ms` is how long the ink takes to dry.
export async function withInkTransition(
  change: () => void | Promise<void>,
  allowed: boolean,
  ms: number = INK_DRY_MS,
): Promise<void> {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!allowed || !doc || typeof doc.startViewTransition !== 'function') {
    await change();
    return;
  }
  const root = doc.documentElement;
  root.style.setProperty('--ink-seed', String(nextSeed));
  root.style.setProperty('--ink-dry-ms', `${ms}ms`);
  root.classList.toggle('ink-worklet', workletReady);
  inkSwapping.set(true);
  const vt = doc.startViewTransition(change);
  await vt.finished.catch(() => {});
  inkSwapping.set(false);
  // The next switch gets a new pattern, built now while nothing's moving.
  nextSeed = 1 + Math.floor(Math.random() * 997);
  warm();
}
