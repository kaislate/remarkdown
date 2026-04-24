import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { minimapShown, toggleMinimap } from '../../src/stores/ui';

beforeEach(() => {
  localStorage.clear();
  minimapShown.set(true);
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
