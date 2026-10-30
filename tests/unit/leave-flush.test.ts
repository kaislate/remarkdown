import { describe, it, expect, vi, beforeEach } from 'vitest';

// A Mac app can be quit from the Dock or by logging out without any window
// hearing about it, so on a Mac every window saves when it loses focus.
// Elsewhere closing the window always runs the close handler: no change.

let focusHandler: ((e: { payload: boolean }) => void) | null = null;
const onFocusChanged = vi.fn(async (cb: (e: { payload: boolean }) => void) => {
  focusHandler = cb;
  return () => {};
});
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onFocusChanged }),
}));
vi.mock('../../src/stores/tabs', () => ({ runBeforeSwitch: vi.fn(async () => {}) }));
vi.mock('../../src/stores/session-persist', () => ({ flushSessionNow: vi.fn(async () => {}) }));

import { runBeforeSwitch } from '../../src/stores/tabs';
import { flushSessionNow } from '../../src/stores/session-persist';
import { setPlatformForTests } from '../../src/lib/platform';
import { installMacBlurFlush, settlePendingSaves } from '../../src/lib/leave-flush';

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  focusHandler = null;
  vi.clearAllMocks();
});

describe('installMacBlurFlush', () => {
  it('on a Mac, losing focus saves pending edits and the open tabs', async () => {
    setPlatformForTests('macos');
    await installMacBlurFlush();
    expect(onFocusChanged).toHaveBeenCalledOnce();

    focusHandler!({ payload: false });
    await settle();
    expect(runBeforeSwitch).toHaveBeenCalledOnce();
    expect(flushSessionNow).toHaveBeenCalledOnce();
  });

  it('gaining focus saves nothing', async () => {
    setPlatformForTests('macos');
    await installMacBlurFlush();
    focusHandler!({ payload: true });
    await settle();
    expect(runBeforeSwitch).not.toHaveBeenCalled();
    expect(flushSessionNow).not.toHaveBeenCalled();
  });

  it('is not registered on Windows or Linux', async () => {
    for (const os of ['windows', 'linux'] as const) {
      setPlatformForTests(os);
      expect(await installMacBlurFlush()).toBeNull();
    }
    expect(onFocusChanged).not.toHaveBeenCalled();
  });

  it('a failed save is logged, never thrown', async () => {
    setPlatformForTests('macos');
    vi.mocked(flushSessionNow).mockRejectedValueOnce(new Error('disk full'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await installMacBlurFlush();
    focusHandler!({ payload: false });
    await settle();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('settlePendingSaves', () => {
  it('runs the before-switch hooks (the shared part of close and blur)', async () => {
    await settlePendingSaves();
    expect(runBeforeSwitch).toHaveBeenCalledOnce();
    expect(flushSessionNow).not.toHaveBeenCalled();
  });
});
