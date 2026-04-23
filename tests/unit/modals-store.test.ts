import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { activeModal, openModal, closeModal } from '../../src/stores/modals';

beforeEach(() => { closeModal(); });

describe('modals store', () => {
  it('starts with no active modal', () => {
    expect(get(activeModal)).toBeNull();
  });

  it('openModal sets the active modal', () => {
    openModal({ kind: 'orphans' });
    expect(get(activeModal)).toEqual({ kind: 'orphans' });
  });

  it('openModal with corrupt-sidecar includes path', () => {
    openModal({ kind: 'corrupt-sidecar', path: '/tmp/a.md' });
    expect(get(activeModal)).toEqual({ kind: 'corrupt-sidecar', path: '/tmp/a.md' });
  });

  it('closeModal clears the active modal', () => {
    openModal({ kind: 'orphans' });
    closeModal();
    expect(get(activeModal)).toBeNull();
  });
});
