import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  minimapShown,
  toggleMinimap,
  zoomLevel,
  increaseZoom,
  decreaseZoom,
  resetZoom,
  ZOOM_LEVELS,
} from '../../src/stores/ui';

beforeEach(() => {
  localStorage.clear();
  minimapShown.set(true);
  zoomLevel.set(1.0);
});

describe('ui store — minimapShown', () => {
  it('starts visible by default', () => {
    expect(get(minimapShown)).toBe(true);
  });

  it('toggleMinimap flips the value', () => {
    toggleMinimap();
    expect(get(minimapShown)).toBe(false);
    toggleMinimap();
    expect(get(minimapShown)).toBe(true);
  });

  it('persists the current value to localStorage on change', () => {
    minimapShown.set(false);
    expect(localStorage.getItem('rmd-minimap-shown')).toBe('false');
    minimapShown.set(true);
    expect(localStorage.getItem('rmd-minimap-shown')).toBe('true');
  });
});

describe('ui store — zoomLevel', () => {
  it('starts at 1.0 by default', () => {
    expect(get(zoomLevel)).toBe(1.0);
  });

  it('increaseZoom moves to the next stepped level', () => {
    zoomLevel.set(1.0);
    increaseZoom();
    expect(get(zoomLevel)).toBe(ZOOM_LEVELS[ZOOM_LEVELS.indexOf(1.0) + 1]);
  });

  it('decreaseZoom moves to the previous stepped level', () => {
    zoomLevel.set(1.0);
    decreaseZoom();
    expect(get(zoomLevel)).toBe(ZOOM_LEVELS[ZOOM_LEVELS.indexOf(1.0) - 1]);
  });

  it('does not exceed the max level', () => {
    zoomLevel.set(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
    increaseZoom();
    expect(get(zoomLevel)).toBe(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
  });

  it('does not go below the min level', () => {
    zoomLevel.set(ZOOM_LEVELS[0]);
    decreaseZoom();
    expect(get(zoomLevel)).toBe(ZOOM_LEVELS[0]);
  });

  it('resetZoom returns to 1.0', () => {
    zoomLevel.set(1.5);
    resetZoom();
    expect(get(zoomLevel)).toBe(1.0);
  });

  it('snaps a non-stepped initial value to the nearest defined level', () => {
    // Simulate localStorage with an unusual value, then re-read by re-importing
    // — but since the module has already been imported, we test snapping via
    // the indirect path: an off-step set should still allow stepping correctly.
    zoomLevel.set(1.27);
    increaseZoom();
    // Should snap 1.27 → nearest level (1.3) and then step up.
    const idx = ZOOM_LEVELS.indexOf(1.3);
    expect(get(zoomLevel)).toBe(ZOOM_LEVELS[idx + 1]);
  });

  it('persists the current zoom to localStorage', () => {
    zoomLevel.set(1.5);
    expect(localStorage.getItem('rmd-zoom-level')).toBe('1.5');
  });
});
