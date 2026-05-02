import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { editMode, enterEditMode, exitEditMode, toggleEditMode } from '../../src/stores/edit-mode';

describe('edit-mode store', () => {
  beforeEach(() => {
    exitEditMode();
  });

  it('starts off', () => {
    expect(get(editMode)).toBe(false);
  });

  it('enterEditMode sets to true', () => {
    enterEditMode();
    expect(get(editMode)).toBe(true);
  });

  it('exitEditMode sets to false', () => {
    enterEditMode();
    exitEditMode();
    expect(get(editMode)).toBe(false);
  });

  it('toggleEditMode flips the value', () => {
    expect(get(editMode)).toBe(false);
    toggleEditMode();
    expect(get(editMode)).toBe(true);
    toggleEditMode();
    expect(get(editMode)).toBe(false);
  });
});
