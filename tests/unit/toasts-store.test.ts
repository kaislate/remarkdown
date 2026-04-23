// tests/unit/toasts-store.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { toasts, addToast, dismissToast, clearToasts } from '../../src/stores/toasts';

describe('toasts store', () => {
  beforeEach(() => { clearToasts(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts empty', () => {
    expect(get(toasts)).toEqual([]);
  });

  it('addToast appends a toast with a unique id', () => {
    addToast({ kind: 'info', message: 'hello' });
    const list = get(toasts);
    expect(list).toHaveLength(1);
    expect(list[0].message).toBe('hello');
    expect(list[0].id).toBeDefined();
  });

  it('auto-dismisses info toasts after 4 seconds', async () => {
    addToast({ kind: 'info', message: 'hi' });
    expect(get(toasts)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4100);
    expect(get(toasts)).toHaveLength(0);
  });

  it('auto-dismisses warning toasts after 4 seconds', async () => {
    addToast({ kind: 'warning', message: 'careful' });
    await vi.advanceTimersByTimeAsync(4100);
    expect(get(toasts)).toHaveLength(0);
  });

  it('does NOT auto-dismiss error toasts (they persist until dismissed)', async () => {
    addToast({ kind: 'error', message: 'fail' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(get(toasts)).toHaveLength(1);
  });

  it('dismissToast removes by id', () => {
    addToast({ kind: 'info', message: 'a' });
    const id = get(toasts)[0].id;
    dismissToast(id);
    expect(get(toasts)).toHaveLength(0);
  });

  it('clearToasts empties the list', () => {
    addToast({ kind: 'info', message: 'a' });
    addToast({ kind: 'warning', message: 'b' });
    clearToasts();
    expect(get(toasts)).toEqual([]);
  });
});
