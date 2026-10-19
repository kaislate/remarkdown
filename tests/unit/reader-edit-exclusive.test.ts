import { it, expect } from 'vitest';
import { get } from 'svelte/store';
import { toggleReaderMode, readerMode } from '../../src/stores/reader-mode';
import { editMode } from '../../src/stores/edit-mode';

it('entering reader mode while editing leaves edit mode first', () => {
  editMode.set(true);
  toggleReaderMode();
  expect(get(readerMode)).toBe(true);
  expect(get(editMode)).toBe(false);
});
