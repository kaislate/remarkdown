import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '../../../src/lib/editor/debounce';

describe('debounce', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('delays invocation by ms', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('coalesces rapid calls into one', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    vi.advanceTimersByTime(50);
    d('b');
    vi.advanceTimersByTime(50);
    d('c');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('flush() invokes immediately and cancels pending', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    d.flush();
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('a');
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('cancel() drops pending calls without invoking', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });
});
