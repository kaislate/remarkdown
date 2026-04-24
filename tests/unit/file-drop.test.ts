import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

// Capture the handler the install function registers so tests can fire events.
let registeredHandler: ((event: any) => void | Promise<void>) | null = null;
const onDragDropEvent = vi.fn().mockImplementation((cb: (event: any) => void) => {
  registeredHandler = cb;
  return Promise.resolve(() => { registeredHandler = null; });
});

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent }),
}));

vi.mock('../../src/stores/doc', () => ({
  loadDocument: vi.fn(),
}));

vi.mock('../../src/stores/recent', () => ({
  recordRecent: vi.fn(),
}));

import { loadDocument } from '../../src/stores/doc';
import { recordRecent } from '../../src/stores/recent';
import { toasts, clearToasts } from '../../src/stores/toasts';
import { installFileDropHandler } from '../../src/lib/file-drop';

beforeEach(() => {
  vi.mocked(loadDocument).mockReset().mockResolvedValue(undefined);
  vi.mocked(recordRecent).mockReset().mockResolvedValue(undefined);
  onDragDropEvent.mockClear();
  clearToasts();
  registeredHandler = null;
});

describe('installFileDropHandler', () => {
  it('registers a drag-drop handler with the webview', async () => {
    const dispose = await installFileDropHandler();
    expect(onDragDropEvent).toHaveBeenCalledTimes(1);
    expect(typeof dispose).toBe('function');
  });

  it('loads the first .md file when one is dropped', async () => {
    await installFileDropHandler();
    await registeredHandler!({
      payload: { type: 'drop', paths: ['/tmp/some.md'], position: { x: 0, y: 0 } },
    });
    expect(loadDocument).toHaveBeenCalledWith('/tmp/some.md');
    expect(recordRecent).toHaveBeenCalledWith('/tmp/some.md');
  });

  it('also accepts a .markdown extension (case-insensitive)', async () => {
    await installFileDropHandler();
    await registeredHandler!({
      payload: { type: 'drop', paths: ['/tmp/Notes.MARKDOWN'] },
    });
    expect(loadDocument).toHaveBeenCalledWith('/tmp/Notes.MARKDOWN');
  });

  it('skips non-md paths and uses the first md path among multiple', async () => {
    await installFileDropHandler();
    await registeredHandler!({
      payload: { type: 'drop', paths: ['/tmp/image.png', '/tmp/notes.md', '/tmp/other.md'] },
    });
    expect(loadDocument).toHaveBeenCalledTimes(1);
    expect(loadDocument).toHaveBeenCalledWith('/tmp/notes.md');
  });

  it('warns via toast when dropping only non-md files', async () => {
    await installFileDropHandler();
    await registeredHandler!({
      payload: { type: 'drop', paths: ['/tmp/some.txt'] },
    });
    expect(loadDocument).not.toHaveBeenCalled();
    const list = get(toasts);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].kind).toBe('warning');
    expect(list[0].message).toMatch(/\.md/i);
  });

  it('ignores enter, over, and leave events', async () => {
    await installFileDropHandler();
    await registeredHandler!({ payload: { type: 'enter', paths: ['/tmp/a.md'], position: { x: 0, y: 0 } } });
    await registeredHandler!({ payload: { type: 'over', position: { x: 0, y: 0 } } });
    await registeredHandler!({ payload: { type: 'leave' } });
    expect(loadDocument).not.toHaveBeenCalled();
  });

  it('surfaces an error toast when loadDocument throws', async () => {
    vi.mocked(loadDocument).mockRejectedValue(new Error('permission denied'));
    await installFileDropHandler();
    await registeredHandler!({ payload: { type: 'drop', paths: ['/tmp/some.md'] } });
    const list = get(toasts);
    expect(list.some((t) => t.kind === 'error' && /permission denied/.test(t.message))).toBe(true);
  });
});
