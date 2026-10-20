import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  loadSettingsJson: vi.fn(),
  saveSettingsJson: vi.fn(),
}));

import { doc } from '../../src/stores/doc';
import { welcomeDocPath } from '../../src/stores/welcome';
import { settings, resetSettings } from '../../src/stores/settings';
import { resetTutorialState } from '../../src/stores/tutorial';
import WelcomeOverlay from '../../src/components/WelcomeOverlay.svelte';

beforeEach(() => {
  doc.set(null);
  welcomeDocPath.set(null);
  resetSettings();
  resetTutorialState();
  document.body.innerHTML = '';
});

function setWelcomeDocOpen() {
  const path = '/app/data/welcome.md';
  welcomeDocPath.set(path);
  doc.set({
    path,
    dir: '/app/data',
    sha256: 'x',
    bytes: 0,
    markdown: '',
    html: '',
    plaintext: '',
    blocks: [],
    sidecarRaw: null,
  });
}

describe('WelcomeOverlay', () => {
  it('renders nothing when no document is open', () => {
    render(WelcomeOverlay);
    expect(document.querySelector('.overlay')).toBeNull();
  });

  it('renders nothing when a non-welcome document is open', () => {
    welcomeDocPath.set('/app/data/welcome.md');
    doc.set({
      path: '/some/other.md',
      dir: '/some',
      sha256: 'x',
      bytes: 0,
      markdown: '',
      html: '',
      plaintext: '',
      blocks: [],
      sidecarRaw: null,
    });
    render(WelcomeOverlay);
    expect(document.querySelector('.overlay')).toBeNull();
  });

  it('renders the overlay when welcome doc is open and tutorial not dismissed', () => {
    setWelcomeDocOpen();
    render(WelcomeOverlay);
    expect(document.querySelector('.overlay')).not.toBeNull();
  });

  it('renders nothing when tutorial has been dismissed', () => {
    setWelcomeDocOpen();
    settings.update((s) => ({ ...s, welcomeTutorialDismissed: true }));
    render(WelcomeOverlay);
    expect(document.querySelector('.overlay')).toBeNull();
  });

  // Controls on screen, at the given boxes (jsdom has no layout).
  function control(cls: string, left: number, top: number, width = 38, height = 38) {
    const el = document.createElement('div');
    el.className = cls;
    el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
    el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList;
    document.body.appendChild(el);
    return el;
  }
  const shown = () => Array.from(document.querySelectorAll('[data-tip]')).map((t) => t.getAttribute('data-tip'));

  it('shows a tip for each control on screen, and none for those that are not', async () => {
    control('hamburger', 14, 14);
    control('edit-mode-toggle', 14, 60);
    control('toc-button', 14, 106);
    control('reader-mode-toggle', 14, 152);
    control('zoom-rail', 22, 700, 118, 40);
    setWelcomeDocOpen();
    render(WelcomeOverlay);
    await new Promise((r) => setTimeout(r, 60));
    expect(shown()).toEqual(expect.arrayContaining(['menu', 'edit', 'contents', 'reader', 'drag', 'drop', 'zoom']));
    // No annotation tools, re.marks pill or minimap on screen: no tips for them.
    expect(shown()).not.toContain('tools');
    expect(shown()).not.toContain('remarks');
    expect(shown()).not.toContain('minimap');
  });

  it('speaks of documents, not markdown files', async () => {
    control('hamburger', 14, 14);
    setWelcomeDocOpen();
    render(WelcomeOverlay);
    await new Promise((r) => setTimeout(r, 60));
    const text = document.querySelector('.overlay')!.textContent ?? '';
    expect(text).toContain('Open documents and settings');
    expect(text).toContain('drop a document');
    expect(text).toContain('drag the window');
    expect(text).not.toMatch(/\.md\b|markdown/i);
  });

  it('clicking "Got it" hides the overlay for the session WITHOUT touching the persisted setting', async () => {
    setWelcomeDocOpen();
    render(WelcomeOverlay);
    expect(get(settings).welcomeTutorialDismissed).toBe(false);
    const user = userEvent.setup();
    await user.click(document.querySelector('.dismiss-tutorial') as HTMLElement);
    // Overlay is gone for the current session.
    expect(document.querySelector('.overlay')).toBeNull();
    // But the setting is unchanged — next launch will show it again.
    expect(get(settings).welcomeTutorialDismissed).toBe(false);
  });

  it('clicking "Hide tutorial forever" sets the persisted setting AND hides the overlay', async () => {
    setWelcomeDocOpen();
    render(WelcomeOverlay);
    expect(get(settings).welcomeTutorialDismissed).toBe(false);
    const user = userEvent.setup();
    await user.click(document.querySelector('.dismiss-forever') as HTMLElement);
    expect(get(settings).welcomeTutorialDismissed).toBe(true);
    expect(document.querySelector('.overlay')).toBeNull();
  });

  it('the re.marks tip shows when the re.marks pill is on screen', async () => {
    control('notes-pill-wrap', 49, 694, 86, 38);
    setWelcomeDocOpen();
    render(WelcomeOverlay);
    await new Promise((r) => setTimeout(r, 60));
    expect(shown()).toContain('remarks');
    expect(document.querySelector('.overlay')!.textContent).toContain('Browse and jump to your re');
  });
});
