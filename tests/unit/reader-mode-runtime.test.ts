import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
  readerMode,
  installReaderMode,
  hasOpenLayer,
} from '../../src/stores/reader-mode';
import { settings, resetSettings, updateSettings } from '../../src/stores/settings';
import { activeModal, openModal, closeModal } from '../../src/stores/modals';
import { reattachTarget, startReattach, cancelReattach } from '../../src/stores/reattach';
import { tool, setMode } from '../../src/stores/tool';
import { createSession, sessions, activeSession } from '../../src/stores/sessions';

function esc(target: EventTarget = window): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

let dispose: () => void;

beforeEach(() => {
  resetSettings();
  closeModal();
  cancelReattach();
  setMode('cursor');
  document.body.innerHTML = '';
  document.body.className = '';
  document.body.removeAttribute('data-reader-theme');
  dispose = installReaderMode();
});

afterEach(() => dispose());

describe('reader mode body state', () => {
  it('reflects reader mode on body', () => {
    expect(document.body.classList.contains('reader-mode')).toBe(false);
    readerMode.set(true);
    expect(document.body.classList.contains('reader-mode')).toBe(true);
    readerMode.set(false);
    expect(document.body.classList.contains('reader-mode')).toBe(false);
  });

  it('carries the reader theme on body and follows the setting', () => {
    expect(document.body.dataset.readerTheme).toBe('default');
    updateSettings({ readerTheme: 'sepia' });
    expect(document.body.dataset.readerTheme).toBe('sepia');
  });

  it('follows the active tab (reader mode is per tab)', () => {
    const a = get(activeSession);
    const b = createSession();
    sessions.set([a, b]);
    readerMode.set(true);
    activeSession.set(b);
    expect(document.body.classList.contains('reader-mode')).toBe(false);
    activeSession.set(a);
    expect(document.body.classList.contains('reader-mode')).toBe(true);
  });

  it('never leaves the minimap-popout class behind (the popout is retired)', () => {
    updateSettings({ minimapPopoutInFocusMode: true });
    readerMode.set(true);
    expect(document.body.classList.contains('minimap-popout')).toBe(false);
  });
});

describe('Esc in reader mode', () => {
  it('leaves reader mode when nothing else is open', () => {
    readerMode.set(true);
    esc();
    expect(get(readerMode)).toBe(false);
  });

  it('does nothing outside reader mode or for other keys', () => {
    esc();
    expect(get(readerMode)).toBe(false);
    readerMode.set(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(get(readerMode)).toBe(true);
  });

  it('a modal open on top takes the Esc first', () => {
    readerMode.set(true);
    openModal({ kind: 'settings' });
    // The modal's own handler closes it on the same keypress.
    window.addEventListener('keydown', closeModal, { once: true });
    esc();
    expect(get(activeModal)).toBeNull();
    expect(get(readerMode)).toBe(true);
    esc();
    expect(get(readerMode)).toBe(false);
  });

  it('an open popover or context menu takes the Esc first, whatever order handlers run in', () => {
    readerMode.set(true);
    for (const role of ['dialog', 'menu']) {
      const layer = document.createElement('div');
      layer.setAttribute('role', role);
      document.body.appendChild(layer);
      // A handler that already closed the layer before ours ran must not
      // make the same keypress also leave reader mode.
      layer.addEventListener('keydown', () => layer.remove());
      esc(layer);
      expect(get(readerMode), role).toBe(true);
      expect(hasOpenLayer()).toBe(false);
    }
    esc();
    expect(get(readerMode)).toBe(false);
  });

  it('an in-progress re-attach takes the Esc first', () => {
    readerMode.set(true);
    startReattach({ annotationId: 'x', snippet: 'y' });
    expect(hasOpenLayer()).toBe(true);
    esc();
    expect(get(readerMode)).toBe(true);
  });
});

describe('annotation tools in reader mode', () => {
  it('parks the active tool while reading and brings it back after', () => {
    setMode('highlight');
    readerMode.set(true);
    expect(get(tool).mode).toBe('cursor');
    readerMode.set(false);
    expect(get(tool).mode).toBe('highlight');
  });

  it('keeps the colour choices untouched', () => {
    tool.update((t) => ({ ...t, mode: 'draw', drawColor: '#20c997' }));
    readerMode.set(true);
    readerMode.set(false);
    expect(get(tool)).toMatchObject({ mode: 'draw', drawColor: '#20c997' });
  });

  it('restores the tool when switching to a tab that is not in reader mode', () => {
    const a = get(activeSession);
    const b = createSession();
    sessions.set([a, b]);
    setMode('note');
    readerMode.set(true);
    expect(get(tool).mode).toBe('cursor');
    activeSession.set(b);
    expect(get(tool).mode).toBe('note');
  });

  it('settings stay as they are', () => {
    const before = get(settings);
    readerMode.set(true);
    readerMode.set(false);
    expect(get(settings)).toEqual(before);
  });
});
