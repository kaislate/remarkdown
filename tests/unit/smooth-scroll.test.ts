import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  impulseDurationMs,
  impulseCurveWithInitialSlope,
  ImpulseScroll,
  wheelPixels,
  isWheelNotch,
  installSmoothScroll,
} from '../../src/lib/smooth-scroll';

// Microsoft Edge's "impulse" scroll animation, as it was in Chromium
// (cc/animation/scroll_offset_animation_curve.cc): a fast start that glides
// to a stop, 1.5ms per pixel clamped to 200–500ms; retargeting keeps the
// current velocity; reversing starts from rest. Distances are Edge's
// percent-based ones: a wheel notch or arrow is 1/8 of the scroller.

describe('the impulse curve', () => {
  it('lasts 1.5ms per pixel, between 200 and 500ms', () => {
    expect(impulseDurationMs(50)).toBe(200);
    expect(impulseDurationMs(200)).toBe(300);
    expect(impulseDurationMs(-200)).toBe(300);
    expect(impulseDurationMs(1000)).toBe(500);
  });

  it('a longer glide stretches the whole curve: medium is twice Edge, long three times', () => {
    expect(impulseDurationMs(100, 2)).toBe(400);
    expect(impulseDurationMs(1000, 2)).toBe(1000);
    expect(impulseDurationMs(100, 3)).toBe(600);
    const a = new ImpulseScroll(0, 100, 0, 2);
    expect(a.duration).toBe(400);
    a.retarget(100, 300);
    expect(a.duration).toBe(impulseDurationMs(300 - a.start, 2));
  });

  it('starts as cubic-bezier(0.25, 0, 0, 1) and bends its first handle to match a starting speed', () => {
    expect(impulseCurveWithInitialSlope(0)).toEqual([0.25, 0, 0, 1]);
    expect(impulseCurveWithInitialSlope(2)).toEqual([0.25, 0.5, 0, 1]);
    // Steeper than the handle can reach at x1 = 0.25: x1 moves in instead.
    expect(impulseCurveWithInitialSlope(8)).toEqual([0.125, 1, 0, 1]);
  });
});

describe('ImpulseScroll', () => {
  it('runs from start to target over the impulse duration, fast first', () => {
    const a = new ImpulseScroll(0, 100, 0);
    expect(a.duration).toBe(200);
    expect(a.valueAt(0)).toBe(0);
    const quarter = a.valueAt(50);
    expect(quarter).toBeGreaterThan(40); // well past a quarter of the way
    expect(a.valueAt(100)).toBeGreaterThan(quarter);
    expect(a.valueAt(200)).toBe(100);
    expect(a.done(200)).toBe(true);
  });

  it('a second notch mid-glide continues smoothly: same position, same speed', () => {
    const a = new ImpulseScroll(0, 100, 0);
    const p = a.valueAt(60);
    const v = a.velocityAt(60);
    a.retarget(60, 200);
    expect(a.valueAt(60)).toBeCloseTo(p, 6);
    expect(a.velocityAt(60)).toBeCloseTo(v, 1);
    expect(a.target).toBe(200);
    expect(a.valueAt(60 + a.duration)).toBe(200);
  });

  it('reversing starts the new glide from rest', () => {
    const a = new ImpulseScroll(0, 100, 0);
    a.retarget(60, -50);
    expect(a.velocityAt(60)).toBeCloseTo(0, 6);
  });
});

describe('wheel input', () => {
  it('a notch is 1/8 of the scroller (at least 16px); lines and pages convert too', () => {
    expect(wheelPixels({ deltaY: 100, deltaMode: 0 }, 800)).toBe(100);
    expect(wheelPixels({ deltaY: -100, deltaMode: 0 }, 1000)).toBe(-125);
    expect(wheelPixels({ deltaY: 300, deltaMode: 0 }, 800)).toBe(300); // three notches at once
    expect(wheelPixels({ deltaY: 100, deltaMode: 0 }, 60)).toBe(16);
    expect(wheelPixels({ deltaY: 3, deltaMode: 1 }, 800)).toBe(100); // 3 lines = a notch
    expect(wheelPixels({ deltaY: 1, deltaMode: 2 }, 800)).toBe(700); // a page
  });

  it('mouse-wheel notches are animated; touchpads and free-spinning wheels are left alone', () => {
    expect(isWheelNotch({ deltaY: 100, deltaMode: 0, wheelDeltaY: -120 })).toBe(true);
    expect(isWheelNotch({ deltaY: 33.333, deltaMode: 0, wheelDeltaY: -40 })).toBe(true); // 1 line a notch
    expect(isWheelNotch({ deltaY: 7.5, deltaMode: 0, wheelDeltaY: -9 })).toBe(false);
    expect(isWheelNotch({ deltaY: 3, deltaMode: 1 })).toBe(true);
  });

  // WebKit (macOS, Linux) gives a notch ±120 in wheelDeltaY like Chromium,
  // but its deltaY is WebKit's own 40px line step, not Chromium's 100px.
  it('counted by notch (WebKit): ±120 in wheelDeltaY is a notch, whatever deltaY says', () => {
    expect(wheelPixels({ deltaY: 40, deltaMode: 0, wheelDeltaY: -120 }, 800, true)).toBe(100);
    expect(wheelPixels({ deltaY: -80, deltaMode: 0, wheelDeltaY: 240 }, 800, true)).toBe(-200);
    expect(wheelPixels({ deltaY: 40, deltaMode: 0, wheelDeltaY: -120 }, 60, true)).toBe(16);
    // Without a wheelDeltaY, or for lines and pages, as before.
    expect(wheelPixels({ deltaY: 100, deltaMode: 0 }, 800, true)).toBe(100);
    expect(wheelPixels({ deltaY: 1, deltaMode: 2, wheelDeltaY: -120 }, 800, true)).toBe(700);
    // Not counted by notch (Windows): by deltaY, exactly as it was.
    expect(wheelPixels({ deltaY: 40, deltaMode: 0, wheelDeltaY: -120 }, 800)).toBe(40);
  });

  // In WebKit ±40 or ±80 is a third or two thirds of a tick: a high-res
  // wheel between detents, or a touchpad. Only whole ticks are notches.
  it('counted by notch (WebKit): only whole ticks of ±120 are notches', () => {
    expect(isWheelNotch({ deltaY: 13.33, deltaMode: 0, wheelDeltaY: -40 }, true)).toBe(false);
    expect(isWheelNotch({ deltaY: 26.67, deltaMode: 0, wheelDeltaY: -80 }, true)).toBe(false);
    expect(isWheelNotch({ deltaY: 40, deltaMode: 0, wheelDeltaY: -120 }, true)).toBe(true);
    expect(isWheelNotch({ deltaY: -80, deltaMode: 0, wheelDeltaY: 240 }, true)).toBe(true);
    expect(isWheelNotch({ deltaY: 3, deltaMode: 1 }, true)).toBe(true);
    // Not counted by notch (Windows): a multiple of 40 is a notch, as before.
    expect(isWheelNotch({ deltaY: 33.333, deltaMode: 0, wheelDeltaY: -40 })).toBe(true);
  });
});

describe('installSmoothScroll', () => {
  let now = 0;
  let frames: Array<(t: number) => void> = [];
  const raf = (cb: (t: number) => void) => { frames.push(cb); return frames.length; };
  const step = (ms: number) => {
    now += ms;
    const run = frames;
    frames = [];
    for (const cb of run) cb(now);
  };

  function scroller(height = 800, content = 5000) {
    const el = document.createElement('div');
    let top = 0;
    Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: content, configurable: true });
    Object.defineProperty(el, 'scrollTop', {
      get: () => top,
      set: (v: number) => { top = Math.max(0, Math.min(content - height, v)); },
      configurable: true,
    });
    document.body.appendChild(el);
    return el;
  }

  function wheel(el: Element, deltaY: number, extra: Partial<WheelEventInit> & { wheelDeltaY?: number } = {}) {
    const e = new WheelEvent('wheel', { deltaY, deltaMode: 0, bubbles: true, cancelable: true, ...extra });
    Object.defineProperty(e, 'wheelDeltaY', { value: extra.wheelDeltaY ?? -deltaY * 1.2 });
    el.dispatchEvent(e);
    return e;
  }

  let installed: Array<() => void> = [];
  beforeEach(() => {
    now = 0;
    frames = [];
    document.body.innerHTML = '';
  });
  afterEach(() => {
    installed.forEach((off) => off());
    installed = [];
  });

  const opts = () => ({ now: () => now, raf, cancelRaf: () => { frames = []; }, enabled: () => true });
  const install = (el: HTMLElement, o: Parameters<typeof installSmoothScroll>[1]) => {
    const off = installSmoothScroll(el, o);
    installed.push(off);
    return off;
  };

  it('glides a wheel notch to 1/8 of the page below', () => {
    const el = scroller();
    install(el, opts());
    const e = wheel(el, 100);
    expect(e.defaultPrevented).toBe(true);
    step(16);
    expect(el.scrollTop).toBeGreaterThan(0);
    expect(el.scrollTop).toBeLessThan(100);
    for (let i = 0; i < 20; i++) step(16);
    expect(el.scrollTop).toBe(100);
  });

  it('counts WebKit notches by wheelDeltaY when told to', () => {
    const el = scroller();
    install(el, { ...opts(), wheelByNotch: true });
    expect(wheel(el, 40, { wheelDeltaY: -120 }).defaultPrevented).toBe(true);
    for (let i = 0; i < 20; i++) step(16);
    expect(el.scrollTop).toBe(100);
  });

  it('leaves a part of a WebKit tick to native scrolling', () => {
    const el = scroller();
    install(el, { ...opts(), wheelByNotch: true });
    expect(wheel(el, 13.33, { wheelDeltaY: -40 }).defaultPrevented).toBe(false);
    step(16);
    expect(el.scrollTop).toBe(0);
  });

  it('notches add up while gliding', () => {
    const el = scroller();
    install(el, opts());
    wheel(el, 100);
    step(16);
    wheel(el, 100);
    for (let i = 0; i < 40; i++) step(16);
    expect(el.scrollTop).toBe(200);
  });

  it('leaves zoom (Ctrl+wheel), sideways scrolls and touchpads to the browser', () => {
    const el = scroller();
    install(el, opts());
    expect(wheel(el, 100, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(el, 100, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(wheel(el, 7.5, { wheelDeltaY: -9 }).defaultPrevented).toBe(false);
  });

  it('leaves a scrollable box inside the page to scroll itself', () => {
    const el = scroller();
    const inner = document.createElement('div');
    inner.style.overflowY = 'auto';
    Object.defineProperty(inner, 'clientHeight', { value: 100 });
    Object.defineProperty(inner, 'scrollHeight', { value: 400 });
    Object.defineProperty(inner, 'scrollTop', { value: 0, writable: true });
    el.appendChild(inner);
    el.scrollTop = 500;
    install(el, opts());
    expect(wheel(inner, 100).defaultPrevented).toBe(false);
    // …but once it can't go any further that way, the page takes over.
    expect(wheel(inner, -100).defaultPrevented).toBe(true);
  });

  it('gives way when something else moves the page (minimap, contents)', () => {
    const el = scroller();
    install(el, opts());
    wheel(el, 100);
    step(16);
    el.scrollTop = 1500;
    for (let i = 0; i < 20; i++) step(16);
    expect(el.scrollTop).toBe(1500);
  });

  it('when turned off (setting, reduced motion, e-ink) the browser scrolls as usual', () => {
    const el = scroller();
    install(el, { ...opts(), enabled: () => false });
    expect(wheel(el, 100).defaultPrevented).toBe(false);
  });

  it('keys glide too: arrows 1/8, Page Down / Space 87.5%, Home and End', () => {
    const el = scroller();
    install(el, opts());
    const key = (k: string, init: KeyboardEventInit = {}) => {
      const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
      document.body.dispatchEvent(e);
      for (let i = 0; i < 40; i++) step(16);
      return e;
    };
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    expect(el.scrollTop).toBe(100);
    key('PageDown');
    expect(el.scrollTop).toBe(800);
    key(' ', { shiftKey: true });
    expect(el.scrollTop).toBe(100);
    key('End');
    expect(el.scrollTop).toBe(4200);
    key('Home');
    expect(el.scrollTop).toBe(0);
  });

  it('keys typed into a text field or the editor are not scrolling', () => {
    const el = scroller();
    install(el, opts());
    const input = document.createElement('input');
    document.body.appendChild(input);
    const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    input.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true'); // as ProseMirror does (jsdom ignores the property)
    el.appendChild(editor);
    const e2 = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
    editor.dispatchEvent(e2);
    expect(e2.defaultPrevented).toBe(false);
  });
});

describe('glideScrollTo (a jump that glides, e.g. from the contents)', () => {
  it('glides there along the impulse curve and reports how long it takes', async () => {
    const { glideScrollTo } = await import('../../src/lib/smooth-scroll');
    let now = 0;
    let frames: Array<() => void> = [];
    const el = document.createElement('div');
    let top = 0;
    Object.defineProperty(el, 'clientHeight', { value: 800 });
    Object.defineProperty(el, 'scrollHeight', { value: 9000 });
    Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => { top = Math.max(0, Math.min(8200, v)); } });
    const g = glideScrollTo(el, 3000, { scale: 2, now: () => now, raf: (cb) => { frames.push(() => cb(now)); return 1; } });
    expect(g.duration).toBe(1000);
    const run = () => { now += 16; const f = frames; frames = []; f.forEach((cb) => cb()); };
    run();
    expect(top).toBeGreaterThan(0);
    for (let i = 0; i < 80; i++) run();
    expect(top).toBe(3000);
  });

  it('stops if something else moves the page, and can be cancelled', async () => {
    const { glideScrollTo } = await import('../../src/lib/smooth-scroll');
    let now = 0;
    let frames: Array<() => void> = [];
    const el = document.createElement('div');
    let top = 0;
    Object.defineProperty(el, 'clientHeight', { value: 800 });
    Object.defineProperty(el, 'scrollHeight', { value: 9000 });
    Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v: number) => { top = v; } });
    const raf = (cb: (t: number) => void) => { frames.push(() => cb(now)); return 1; };
    const run = () => { now += 16; const f = frames; frames = []; f.forEach((cb) => cb()); };
    glideScrollTo(el, 3000, { now: () => now, raf });
    run();
    top = 50; // the wheel, say
    for (let i = 0; i < 60; i++) run();
    expect(top).toBe(50);
    const g = glideScrollTo(el, 2000, { now: () => now, raf });
    run();
    g.cancel();
    const at = top;
    for (let i = 0; i < 60; i++) run();
    expect(top).toBe(at);
  });
});
