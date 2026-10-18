import '@testing-library/jest-dom/vitest';

// jsdom does not implement CSS Custom Highlight API. Provide a minimal shim so
// HighlightLayer can run in the test environment; tests assert via this shim.

class MockHighlight {
  ranges: Set<Range>;
  constructor(...ranges: Range[]) {
    this.ranges = new Set(ranges);
  }
  add(range: Range) { this.ranges.add(range); }
  clear() { this.ranges.clear(); }
  delete(range: Range) { this.ranges.delete(range); }
}

if (typeof window !== 'undefined') {
  // @ts-expect-error adding to global
  window.Highlight = MockHighlight;
  const g: any = window.CSS ?? {};
  if (!g.highlights) g.highlights = new Map();
  if (!g.escape) g.escape = (s: string) => s.replace(/[^\w-]/g, '\\$&');
  // @ts-expect-error adding to global
  window.CSS = g;
}

// jsdom does not implement the Web Animations API, which Svelte 5
// transitions (in:/out:/transition:) drive via element.animate(). Stub
// it with an animation that finishes on the next microtask so
// transitioned elements still mount, and outro'd elements still
// unmount, in component tests.
// animate:flip (keyed lists, e.g. the tab bar) also asks an element for its
// running animations before measuring it.
if (typeof Element !== 'undefined' && !Element.prototype.getAnimations) {
  Element.prototype.getAnimations = function () { return []; };
}
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = function () {
    const anim: any = {
      onfinish: null as null | (() => void),
      oncancel: null as null | (() => void),
      currentTime: 0,
      playState: 'finished',
      cancel() { anim.oncancel?.(); },
      finish() { anim.onfinish?.(); },
      play() {},
      pause() {},
      reverse() {},
      addEventListener() {},
      removeEventListener() {},
    };
    anim.finished = Promise.resolve(anim);
    queueMicrotask(() => anim.onfinish?.());
    return anim as Animation;
  };
}

// Document stores (doc, annots, editMode, readerMode) are proxies onto the
// active tab's session. Give every test a fresh single empty session so
// state can't leak between tests the way module-level stores couldn't before.
import { beforeEach } from 'vitest';
import { resetSessionsForTests } from '../src/stores/sessions';
beforeEach(() => resetSessionsForTests());
