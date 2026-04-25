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
import WelcomeOverlay from '../../src/components/WelcomeOverlay.svelte';

beforeEach(() => {
  doc.set(null);
  welcomeDocPath.set(null);
  resetSettings();
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

  it('shows all six expected tips when visible', () => {
    setWelcomeDocOpen();
    render(WelcomeOverlay);
    expect(document.querySelector('.tip-hamburger')).not.toBeNull();
    expect(document.querySelector('.tip-drag')).not.toBeNull();
    expect(document.querySelector('.bracket-row')).not.toBeNull();
    expect(document.querySelector('.tip-tools')).not.toBeNull();
    expect(document.querySelector('.tip-titlebar')).not.toBeNull();
    expect(document.querySelector('.tip-zoom')).not.toBeNull();
  });

  it('contains the expected guidance copy', () => {
    setWelcomeDocOpen();
    render(WelcomeOverlay);
    const overlay = document.querySelector('.overlay')!;
    expect(overlay.textContent).toContain('Open');
    expect(overlay.textContent).toContain('settings');
    expect(overlay.textContent).toContain('drop');
    expect(overlay.textContent).toContain('Navigate long documents');
    expect(overlay.textContent).toContain('annotations');
    expect(overlay.textContent).toContain('drag the window');
    expect(overlay.textContent).toContain('Resize');
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

  it('the seventh re.marks tip is rendered alongside the others', () => {
    setWelcomeDocOpen();
    render(WelcomeOverlay);
    expect(document.querySelector('.tip-remarks')).not.toBeNull();
    const overlay = document.querySelector('.overlay')!;
    expect(overlay.textContent).toContain('Browse and jump to your re');
  });
});
