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
