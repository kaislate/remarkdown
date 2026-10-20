// Going in and out of reader mode, the old view dries away like ink: its
// colours drain while it dissolves in irregular blots, revealing the new
// view underneath. A view transition does the swap; the old view's
// snapshot is masked by a noise pattern (feTurbulence) whose threshold
// sweeps across over the transition (an SVG <animate>), so the blots that
// open first grow and run together the way a wash of ink dries unevenly.
// The styles are in styles/ink-transition.css. Skipped under reduced
// motion, on the e-ink reader theme, and where view transitions aren't
// supported — the change just happens.

// How long the drying takes once it's under way…
export const INK_DRY_MS = 950;
// …after a hold at the start: the mask's animation clock starts when the
// image is decoded, a moment before the swap is actually on screen.
const HOLD_MS = 250;
// How long the swap runs from when it's on screen.
export const INK_SWAP_MS = INK_DRY_MS + 100;

// A fresh mask for each transition: a new blot pattern, and a new image so
// its animation starts from the beginning.
export function inkMask(width: number, height: number, seed: number): string {
  // Opacity = 12 × (noise − t), with the threshold t sweeping across the
  // noise's range (0.15 → 0.85): patches where the noise is low dry first,
  // and the edges stay a little soft. sRGB maths, so the noise keeps its
  // spread (linearRGB squashes it and everything vanishes at once).
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'>` +
    `<filter id='i' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.004' numOctaves='4' seed='${seed}'/>` +
    `<feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0'/>` +
    `<feComponentTransfer><feFuncA type='linear' slope='12' intercept='-1.8'>` +
    `<animate attributeName='intercept' values='-1.8;-1.8;-10.2' dur='${HOLD_MS + INK_DRY_MS}ms' fill='freeze' calcMode='spline' keyTimes='0;${(HOLD_MS / (HOLD_MS + INK_DRY_MS)).toFixed(3)};1' keySplines='0 0 1 1;0.3 0 0.7 1'/>` +
    `</feFuncA></feComponentTransfer></filter>` +
    `<rect width='100%' height='100%' filter='url(%23i)'/></svg>`;
  return `url("data:image/svg+xml,${svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, '%22')}")`;
}

let seeds = 0;

// Runs `change` (which flips the mode) inside the ink transition when it
// can, else straight away.
export async function withInkTransition(change: () => void | Promise<void>, allowed: boolean): Promise<void> {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!allowed || !doc || typeof doc.startViewTransition !== 'function') {
    await change();
    return;
  }
  const mask = inkMask(window.innerWidth, window.innerHeight, (seeds = (seeds % 97) + 1));
  // Decoded before the swap starts, so the first frame isn't maskless.
  try {
    const img = new Image();
    img.src = mask.slice(5, -2);
    await img.decode();
  } catch {
    // Still go ahead; at worst the old view goes at once.
  }
  doc.documentElement.style.setProperty('--ink-mask', mask);
  doc.documentElement.style.setProperty('--ink-dry-ms', `${INK_SWAP_MS}ms`);
  const vt = doc.startViewTransition(change);
  await vt.finished.catch(() => {});
}
