import { describe, it, expect, afterEach } from 'vitest';
import { formatShortcut, redoShortcut } from '../../src/lib/shortcuts';
import { menuFor, type ClickContext, type MenuActions } from '../../src/lib/app-context-menu';
import { setPlatformForTests } from '../../src/lib/platform';
import { vi } from 'vitest';

const INPUTS = ['Ctrl+Shift+B', 'Ctrl+Alt+1', 'Ctrl + 0', 'Ctrl + −', 'Ctrl + +', 'Ctrl+Enter', 'Ctrl+,', 'Ctrl+`', 'Esc'];

describe('formatShortcut', () => {
  it('spells keys the Apple way on a Mac', () => {
    expect(formatShortcut('Ctrl+Shift+B', 'macos')).toBe('⇧⌘B');
    expect(formatShortcut('Ctrl+Alt+1', 'macos')).toBe('⌥⌘1');
    expect(formatShortcut('Ctrl + 0', 'macos')).toBe('⌘0');
    expect(formatShortcut('Ctrl + −', 'macos')).toBe('⌘−');
    expect(formatShortcut('Ctrl + +', 'macos')).toBe('⌘+');
    expect(formatShortcut('Ctrl+Enter', 'macos')).toBe('⌘↩');
    expect(formatShortcut('Ctrl+,', 'macos')).toBe('⌘,');
    expect(formatShortcut('Esc', 'macos')).toBe('Esc');
  });

  it('leaves Windows and Linux labels alone', () => {
    for (const os of ['windows', 'linux'] as const) {
      for (const k of INPUTS) expect(formatShortcut(k, os)).toBe(k);
    }
  });
});

describe('redoShortcut', () => {
  it('is Ctrl+Y off a Mac and Shift-Cmd-Z on one', () => {
    expect(redoShortcut('windows')).toBe('Ctrl+Y');
    expect(redoShortcut('linux')).toBe('Ctrl+Y');
    expect(redoShortcut('macos')).toBe('⇧⌘Z');
  });
});

describe('the context menu', () => {
  afterEach(() => setPlatformForTests('windows'));

  it('shows Cmd hints on a Mac', () => {
    setPlatformForTests('macos');
    const a = Object.fromEntries(
      ['cut', 'copy', 'paste', 'selectAll', 'highlight', 'addNote', 'copyLink', 'goToSection', 'toggleEdit', 'enterReader',
        'leaveReader', 'showInFolder', 'copyPath', 'undo', 'redo'].map((k) => [k, vi.fn()]),
    ) as unknown as MenuActions;
    const ctx = { kind: 'page', hasSelection: true } as unknown as ClickContext;
    const items = menuFor(ctx, a) ?? [];
    const copy = items.find((i) => i !== 'separator' && i.label === 'Copy');
    expect(copy && copy !== 'separator' && copy.hint).toBe('⌘C');
  });
});
