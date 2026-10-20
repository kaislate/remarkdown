// Smooth scrolling the way Microsoft Edge did it: the "Windows scrolling
// personality" Microsoft added to Chromium for Edge (impulse-style scroll
// animations + percent-based scrolling). Chromium has since dropped it, so
// the WebView can't be asked for it any more; this is a port of the same
// math, applied to the page's own scroller.
//
// The impulse curve (cc/animation/scroll_offset_animation_curve.cc):
//   - cubic-bezier(0.25, 0, 0, 1): the page starts moving at once and
//     glides to a stop, like a push against friction;
//   - 1.5ms per pixel of distance, clamped to 200–500ms;
//   - a new notch while gliding retargets from the current position and
//     keeps the current speed (the curve's first handle is bent to match
//     it), so notches add up into one smooth motion; reversing direction
//     starts from rest.
// The distances (cc/input/scroll_utils.h, percent-based scrolling): a wheel
// notch or an arrow key moves 1/8 of the scroller's height (at least 16px),
// Page Up / Page Down / Space 87.5% of it.
//
// Touchpads (and free-spinning wheels) send fine-grained deltas that are
// already smooth; like Edge, those are left to scroll natively.

const IMPULSE_X1 = 0.25;
const IMPULSE_X2 = 0;
const IMPULSE_Y2 = 1;
const IMPULSE_MIN_MS = 200;
const IMPULSE_MAX_MS = 500;
const IMPULSE_MS_PER_PX = 1.5;

const PERCENT_PER_STEP = 0.125;
const MIN_STEP_PX = 16;
const PAGE_FRACTION = 0.875;
// Chromium's own wheel delta for one notch at Windows' default 3 lines.
const PX_PER_NOTCH = 100;
const PX_PER_LINE = PX_PER_NOTCH / 3;

export function impulseDurationMs(deltaPx: number): number {
  return Math.min(IMPULSE_MAX_MS, Math.max(IMPULSE_MIN_MS, IMPULSE_MS_PER_PX * Math.abs(deltaPx)));
}

// The impulse curve's control points, its first handle bent so the curve
// starts at `slope` (progress per unit time, both normalised).
export function impulseCurveWithInitialSlope(slope: number): [number, number, number, number] {
  let x1 = IMPULSE_X1;
  let y1 = 1;
  if (x1 * slope < 1) y1 = x1 * slope;
  else x1 = y1 / slope;
  return [x1, y1, IMPULSE_X2, IMPULSE_Y2];
}

// A unit cubic Bézier (0,0)-(x1,y1)-(x2,y2)-(1,1), as CSS / Chromium solve it.
class UnitBezier {
  private cx: number; private bx: number; private ax: number;
  private cy: number; private by: number; private ay: number;
  constructor(x1: number, y1: number, x2: number, y2: number) {
    this.cx = 3 * x1; this.bx = 3 * (x2 - x1) - this.cx; this.ax = 1 - this.cx - this.bx;
    this.cy = 3 * y1; this.by = 3 * (y2 - y1) - this.cy; this.ay = 1 - this.cy - this.by;
  }
  private sx(s: number) { return ((this.ax * s + this.bx) * s + this.cx) * s; }
  private sy(s: number) { return ((this.ay * s + this.by) * s + this.cy) * s; }
  private dsx(s: number) { return (3 * this.ax * s + 2 * this.bx) * s + this.cx; }
  private dsy(s: number) { return (3 * this.ay * s + 2 * this.by) * s + this.cy; }
  private solve(x: number): number {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const err = this.sx(s) - x;
      if (Math.abs(err) < 1e-7) return s;
      const d = this.dsx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    while (lo < hi) {
      const v = this.sx(s);
      if (Math.abs(v - x) < 1e-7) return s;
      if (x > v) lo = s; else hi = s;
      s = (lo + hi) / 2;
      if (hi - lo < 1e-9) break;
    }
    return s;
  }
  y(x: number): number { return this.sy(this.solve(x)); }
  slope(x: number): number {
    const s = this.solve(x);
    const dx = this.dsx(s);
    return dx === 0 ? 0 : this.dsy(s) / dx;
  }
}

// One glide from `start` to `target`, retargetable mid-way.
export class ImpulseScroll {
  start: number;
  target: number;
  t0: number;
  duration: number;
  private curve: UnitBezier;

  constructor(start: number, target: number, t0: number) {
    this.start = start;
    this.target = target;
    this.t0 = t0;
    this.duration = impulseDurationMs(target - start);
    this.curve = new UnitBezier(...impulseCurveWithInitialSlope(0));
  }

  private progress(t: number): number {
    return this.duration <= 0 ? 1 : Math.min(1, Math.max(0, (t - this.t0) / this.duration));
  }

  valueAt(t: number): number {
    const x = this.progress(t);
    if (x >= 1) return this.target;
    return this.start + (this.target - this.start) * this.curve.y(x);
  }

  // Pixels per millisecond.
  velocityAt(t: number): number {
    const x = this.progress(t);
    if (x >= 1) return 0;
    return ((this.target - this.start) * this.curve.slope(x)) / this.duration;
  }

  done(t: number): boolean {
    return this.progress(t) >= 1;
  }

  retarget(t: number, newTarget: number): void {
    const position = this.valueAt(t);
    const velocity = this.velocityAt(t);
    const delta = newTarget - position;
    const duration = impulseDurationMs(delta);
    const reversed = Math.sign(newTarget - position) !== Math.sign(this.target - position);
    let slope = delta === 0 ? 0 : velocity * (duration / delta);
    if (reversed || slope < 0) slope = 0;
    this.start = position;
    this.target = newTarget;
    this.t0 = t;
    this.duration = duration;
    this.curve = new UnitBezier(...impulseCurveWithInitialSlope(slope));
  }
}

interface WheelLike {
  deltaY: number;
  deltaMode: number;
  wheelDeltaY?: number;
}

// One step: 1/8 of the scroller, at least 16px.
function stepPx(height: number): number {
  return Math.max(MIN_STEP_PX, PERCENT_PER_STEP * height);
}

// Edge's distance for a wheel event on a scroller `height` tall.
export function wheelPixels(e: WheelLike, height: number): number {
  if (e.deltaMode === 2) return Math.sign(e.deltaY) * Math.abs(e.deltaY) * PAGE_FRACTION * height;
  const native = e.deltaMode === 1 ? e.deltaY * PX_PER_LINE : e.deltaY;
  return (native / PX_PER_NOTCH) * stepPx(height);
}

// A mouse wheel's notch (animated) rather than a touchpad's or a
// free-spinning wheel's fine-grained movement (already smooth). Windows
// reports notches as multiples of the classic wheel delta.
export function isWheelNotch(e: WheelLike): boolean {
  if (e.deltaMode !== 0) return true;
  if (typeof e.wheelDeltaY === 'number' && e.wheelDeltaY !== 0) return e.wheelDeltaY % 40 === 0;
  return Math.abs(e.deltaY) >= 33;
}

export interface SmoothScrollOptions {
  // Checked on every event: the setting, reduced motion, e-ink.
  enabled: () => boolean;
  now?: () => number;
  raf?: (cb: (t: number) => void) => number;
  cancelRaf?: (id: number) => void;
}

const INTERACTIVE = 'a, button, input, textarea, select, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="tab"], [role="menuitem"], [role="slider"], [role="switch"], [role="radio"], [role="checkbox"]';

// Takes over wheel notches over `el` and scrolling keys while nothing that
// takes typing has focus. Returns a function that removes it.
export function installSmoothScroll(el: HTMLElement, opts: SmoothScrollOptions): () => void {
  const now = opts.now ?? (() => performance.now());
  const raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
  const cancelRaf = opts.cancelRaf ?? ((id) => cancelAnimationFrame(id));
  let anim: ImpulseScroll | null = null;
  let frame = 0;
  let lastSet = 0;

  const maxScroll = () => Math.max(0, el.scrollHeight - el.clientHeight);

  function stop(): void {
    anim = null;
    if (frame) cancelRaf(frame);
    frame = 0;
  }

  function tick(): void {
    frame = 0;
    if (!anim) return;
    // Something else moved the page (the minimap, the contents, a jump):
    // it wins.
    if (Math.abs(el.scrollTop - lastSet) > 1) { stop(); return; }
    const t = now();
    el.scrollTop = anim.valueAt(t);
    lastSet = el.scrollTop;
    if (anim.done(t)) anim = null;
    else frame = raf(tick);
  }

  const gliding = (t: number) => !!anim && !anim.done(t) && Math.abs(el.scrollTop - lastSet) <= 1;

  // Glide to `to` (clamped to the page). False if the page is already
  // there and not moving, so the event can go on to whatever else wants it.
  function glideTo(to: number): boolean {
    const t = now();
    const target = Math.min(maxScroll(), Math.max(0, to));
    if (gliding(t)) {
      if (target !== anim!.target) anim!.retarget(t, target);
    } else {
      stop();
      const start = el.scrollTop;
      if (target === start) return false;
      anim = new ImpulseScroll(start, target, t);
      lastSet = start;
    }
    if (!frame) frame = raf(tick);
    return true;
  }

  // Glide by `delta` px from where a running glide is headed (so notches
  // add up), or from where the page is.
  function glideBy(delta: number): boolean {
    return glideTo((gliding(now()) ? anim!.target : el.scrollTop) + delta);
  }

  // A scrollable box inside the page that can still move this way gets the
  // wheel itself (code blocks, popovers, lists).
  function innerScrollerTakes(target: EventTarget | null, dir: number): boolean {
    for (let n = target instanceof Element ? target : null; n && n !== el; n = n.parentElement) {
      if (!(n instanceof HTMLElement)) continue;
      if (n.scrollHeight <= n.clientHeight) continue;
      const oy = getComputedStyle(n).overflowY;
      if (oy !== 'auto' && oy !== 'scroll') continue;
      if (dir > 0 ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0) return true;
    }
    return false;
  }

  function onWheel(e: WheelEvent): void {
    if (!opts.enabled() || e.defaultPrevented) return;
    if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || e.deltaY === 0) return;
    if (!isWheelNotch(e as WheelEvent & WheelLike)) return;
    if (innerScrollerTakes(e.target, Math.sign(e.deltaY))) return;
    if (glideBy(wheelPixels(e, el.clientHeight))) e.preventDefault();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!opts.enabled() || e.defaultPrevented) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const target = e.target as Element | null;
    if (target && target !== document.body && target !== el) {
      if (!el.contains(target) || target.closest(INTERACTIVE)) return;
    }
    const h = el.clientHeight;
    let moved: boolean;
    switch (e.key) {
      case 'ArrowDown': if (e.shiftKey) return; moved = glideBy(stepPx(h)); break;
      case 'ArrowUp': if (e.shiftKey) return; moved = glideBy(-stepPx(h)); break;
      case 'PageDown': moved = glideBy(PAGE_FRACTION * h); break;
      case 'PageUp': moved = glideBy(-PAGE_FRACTION * h); break;
      case ' ': moved = glideBy((e.shiftKey ? -1 : 1) * PAGE_FRACTION * h); break;
      case 'Home': moved = glideTo(0); break;
      case 'End': moved = glideTo(maxScroll()); break;
      default: return;
    }
    if (moved) e.preventDefault();
  }

  el.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeydown);
  return () => {
    stop();
    el.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeydown);
  };
}
