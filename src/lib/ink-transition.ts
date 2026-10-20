// Going in and out of reader mode, the old view dries away like ink: its
// colours drain while blots open up in it and run together, revealing the
// new view underneath. A view transition does the swap; the old view's
// snapshot is masked by a paint worklet (public/ink-worklet.js) driven by
// a CSS-animated --ink-t, so it starts on the first frame and runs at the
// display's rate. The styles are in styles/ink-transition.css. Skipped under
// reduced motion, on the e-ink reader theme, and where view transitions
// aren't supported — the change just happens. Without paint worklets the
// old view simply fades.

export const INK_DRY_MS = 1000;

let workletReady = false;

// Loaded once at start-up, so it's ready by the first switch.
export function loadInkWorklet(): void {
  const css = typeof CSS !== 'undefined' ? (CSS as unknown as { paintWorklet?: { addModule(url: string): Promise<void> } }) : null;
  if (!css?.paintWorklet) return;
  css.paintWorklet
    .addModule('/ink-worklet.js')
    .then(() => { workletReady = true; })
    .catch(() => {});
}

// Runs `change` (which flips the mode) inside the ink transition when it
// can, else straight away.
export async function withInkTransition(change: () => void | Promise<void>, allowed: boolean): Promise<void> {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!allowed || !doc || typeof doc.startViewTransition !== 'function') {
    await change();
    return;
  }
  const root = doc.documentElement;
  root.style.setProperty('--ink-seed', String(1 + Math.floor(Math.random() * 997)));
  root.style.setProperty('--ink-dry-ms', `${INK_DRY_MS}ms`);
  root.classList.toggle('ink-worklet', workletReady);
  const vt = doc.startViewTransition(change);
  await vt.finished.catch(() => {});
}
