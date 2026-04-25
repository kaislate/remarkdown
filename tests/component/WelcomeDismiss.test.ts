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
import WelcomeDismiss from '../../src/components/WelcomeDismiss.svelte';

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

describe('WelcomeDismiss', () => {
  it('renders nothing when no document is open', () => {
    render(WelcomeDismiss);
    expect(document.querySelector('.dismiss')).toBeNull();
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
    render(WelcomeDismiss);
    expect(document.querySelector('.dismiss')).toBeNull();
  });

  it('renders when the welcome document is open', () => {
    setWelcomeDocOpen();
    render(WelcomeDismiss);
    const el = document.querySelector('.dismiss');
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("Don't show welcome.md on launch");
  });

  it('checkbox reflects the current dontShowWelcomeOnLaunch setting', () => {
    setWelcomeDocOpen();
    settings.update((s) => ({ ...s, dontShowWelcomeOnLaunch: true }));
    render(WelcomeDismiss);
    const cb = document.querySelector('.dismiss input[type="checkbox"]') as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it('clicking the checkbox toggles the setting on', async () => {
    setWelcomeDocOpen();
    render(WelcomeDismiss);
    expect(get(settings).dontShowWelcomeOnLaunch).toBe(false);
    const cb = document.querySelector('.dismiss input[type="checkbox"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.click(cb);
    expect(get(settings).dontShowWelcomeOnLaunch).toBe(true);
  });

  it('clicking again toggles the setting off', async () => {
    setWelcomeDocOpen();
    settings.update((s) => ({ ...s, dontShowWelcomeOnLaunch: true }));
    render(WelcomeDismiss);
    const cb = document.querySelector('.dismiss input[type="checkbox"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.click(cb);
    expect(get(settings).dontShowWelcomeOnLaunch).toBe(false);
  });
});
