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

  it('renders the two-line label when the welcome document is open', () => {
    setWelcomeDocOpen();
    render(WelcomeDismiss);
    const el = document.querySelector('.dismiss');
    expect(el).not.toBeNull();
    const lines = el!.querySelectorAll('div');
    expect(lines.length).toBe(2);
    expect(lines[0].textContent).toBe("Don't show welcome.md");
    expect(lines[1].textContent).toBe('on launch');
  });

  it('contains no checkbox', () => {
    setWelcomeDocOpen();
    render(WelcomeDismiss);
    expect(document.querySelector('.dismiss input')).toBeNull();
  });

  it('does not have the .applied class when the setting is off', () => {
    setWelcomeDocOpen();
    render(WelcomeDismiss);
    expect(document.querySelector('.dismiss')!.classList.contains('applied')).toBe(false);
  });

  it('gets the .applied class when the setting is on', () => {
    setWelcomeDocOpen();
    settings.update((s) => ({ ...s, dontShowWelcomeOnLaunch: true }));
    render(WelcomeDismiss);
    expect(document.querySelector('.dismiss')!.classList.contains('applied')).toBe(true);
  });

  it('clicking the label toggles the setting on', async () => {
    setWelcomeDocOpen();
    render(WelcomeDismiss);
    expect(get(settings).dontShowWelcomeOnLaunch).toBe(false);
    const user = userEvent.setup();
    await user.click(document.querySelector('.dismiss') as HTMLElement);
    expect(get(settings).dontShowWelcomeOnLaunch).toBe(true);
  });

  it('clicking again toggles the setting off', async () => {
    setWelcomeDocOpen();
    settings.update((s) => ({ ...s, dontShowWelcomeOnLaunch: true }));
    render(WelcomeDismiss);
    const user = userEvent.setup();
    await user.click(document.querySelector('.dismiss') as HTMLElement);
    expect(get(settings).dontShowWelcomeOnLaunch).toBe(false);
  });

  it('Enter / Space keys also toggle the setting', async () => {
    setWelcomeDocOpen();
    render(WelcomeDismiss);
    const el = document.querySelector('.dismiss') as HTMLElement;
    el.focus();
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    expect(get(settings).dontShowWelcomeOnLaunch).toBe(true);
    await user.keyboard(' ');
    expect(get(settings).dontShowWelcomeOnLaunch).toBe(false);
  });
});
