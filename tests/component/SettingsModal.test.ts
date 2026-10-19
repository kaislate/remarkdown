import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  loadSettingsJson: vi.fn(),
  saveSettingsJson: vi.fn(),
  windowLabel: vi.fn(() => 'main'),
  defaultAppStatus: vi.fn(async () => ({ supported: false, md: false, markdown: false })),
  makeDefaultApp: vi.fn(async () => {}),
}));

import { activeModal, openModal, closeModal } from '../../src/stores/modals';
import { defaultAppStatus, makeDefaultApp } from '../../src/lib/tauri-api';
import { toasts, clearToasts } from '../../src/stores/toasts';
import { screen, waitFor } from '@testing-library/svelte';
import { settings, resetSettings } from '../../src/stores/settings';
import SettingsModal from '../../src/components/SettingsModal.svelte';

beforeEach(() => {
  closeModal();
  resetSettings();
  document.body.innerHTML = '';
});

describe('SettingsModal', () => {
  it('renders nothing when the active modal is not "settings"', () => {
    render(SettingsModal);
    expect(document.querySelector('.settings-panel')).toBeNull();
  });

  it('renders the panel with all six top-level sections when opened', () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    expect(document.querySelector('.settings-panel')).not.toBeNull();
    const headings = Array.from(document.querySelectorAll('section h3')).map((h) => h.textContent);
    expect(headings).toEqual([
      'Appearance',
      'Reading',
      'Startup & files',
      'Highlights & re.marks',
      'Drawing',
      'Updates',
    ]);
  });

  it('clicking the scrim closes the modal', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    const user = userEvent.setup();
    await user.click(document.querySelector('.scrim') as HTMLElement);
    expect(get(activeModal)).toBeNull();
  });

  it('Esc closes the modal', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(get(activeModal)).toBeNull();
  });

  it('clicking inside the panel does NOT close it', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    const user = userEvent.setup();
    await user.click(document.querySelector('.settings-panel') as HTMLElement);
    expect(get(activeModal)?.kind).toBe('settings');
  });

  it('toggling the splash checkbox writes through to the settings store', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    const splash = document.getElementById('setting-splash') as HTMLInputElement;
    expect(splash.checked).toBe(true);
    const user = userEvent.setup();
    await user.click(splash);
    expect(get(settings).splashEnabled).toBe(false);
  });

  it('changing the watermark opacity slider updates the settings store', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    const slider = document.getElementById('setting-watermark-opacity') as HTMLInputElement;
    slider.value = '0.18';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(get(settings).watermarkOpacity).toBeCloseTo(0.18);
  });

  it('selecting a default highlight swatch updates the settings store', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    const swatches = document.querySelectorAll('.swatches')[0].querySelectorAll('.swatch');
    const user = userEvent.setup();
    // Click the second swatch.
    await user.click(swatches[1] as HTMLElement);
    // The chosen colour must be one of the current HIGHLIGHT_COLORS preset.
    const { HIGHLIGHT_COLORS } = await import('../../src/stores/tool');
    expect(HIGHLIGHT_COLORS as readonly string[]).toContain(get(settings).defaultHighlightColor);
  });

  it('Reset to defaults restores all settings to defaults', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    settings.update((s) => ({ ...s, theme: 'light', maxRecent: 3 }));
    const user = userEvent.setup();
    const reset = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Reset to defaults',
    )!;
    await user.click(reset);
    const s = get(settings);
    expect(s.theme).toBe('dark');
    expect(s.maxRecent).toBe(10);
  });

  it('Done button closes the modal', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    const user = userEvent.setup();
    const done = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Done',
    )!;
    await user.click(done);
    expect(get(activeModal)).toBeNull();
  });
});

describe('SettingsModal — opening files', () => {
  it('offers the three open modes and saves the choice', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    const select = document.querySelector<HTMLSelectElement>('#setting-open-mode')!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['tabs', 'replace', 'windows']);
    expect(select.value).toBe('tabs');
    await userEvent.setup().selectOptions(select, 'windows');
    expect(get(settings).openMode).toBe('windows');
  });

  it('shows "Reopen tabs" only in tabs mode and "Reopen last file" only outside it', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    expect(document.querySelector('#setting-reopen-tabs')).not.toBeNull();
    expect(document.querySelector('#setting-open-last')).toBeNull();
    await userEvent.setup().selectOptions(document.querySelector<HTMLSelectElement>('#setting-open-mode')!, 'replace');
    expect(document.querySelector('#setting-reopen-tabs')).toBeNull();
    expect(document.querySelector('#setting-open-last')).not.toBeNull();
  });

  it('the reopen-tabs checkbox updates the setting', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    const box = document.querySelector<HTMLInputElement>('#setting-reopen-tabs')!;
    expect(box.checked).toBe(true);
    await userEvent.setup().click(box);
    expect(get(settings).reopenTabsOnLaunch).toBe(false);
  });

  it('"Tab position" moves the tabs between the top and the left, in tabs mode only', async () => {
    openModal({ kind: 'settings' });
    render(SettingsModal);
    const select = document.querySelector<HTMLSelectElement>('#setting-tab-position')!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['top', 'left']);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Along the top', 'On the left']);
    expect(select.value).toBe('top');
    await userEvent.setup().selectOptions(select, 'left');
    expect(get(settings).tabPosition).toBe('left');
    await userEvent.setup().selectOptions(document.querySelector<HTMLSelectElement>('#setting-open-mode')!, 'replace');
    expect(document.querySelector('#setting-tab-position')).toBeNull();
  });
});

describe('SettingsModal — default app', () => {
  beforeEach(() => {
    vi.mocked(makeDefaultApp).mockReset().mockResolvedValue(undefined);
    clearToasts();
  });

  it('is hidden where it is not supported', async () => {
    vi.mocked(defaultAppStatus).mockResolvedValue({ supported: false, md: false, markdown: false });
    openModal({ kind: 'settings' });
    render(SettingsModal);
    await Promise.resolve();
    expect(screen.queryByText(/default app/i)).toBeNull();
  });

  it('says so when remarkdown is already the default, with no button', async () => {
    vi.mocked(defaultAppStatus).mockResolvedValue({ supported: true, md: true, markdown: true });
    openModal({ kind: 'settings' });
    render(SettingsModal);
    expect(await screen.findByText('remarkdown is your default app for .md files')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /make remarkdown the default/i })).toBeNull();
  });

  it("offers the button when it isn't the default, and calls makeDefaultApp", async () => {
    vi.mocked(defaultAppStatus).mockResolvedValue({ supported: true, md: false, markdown: false });
    openModal({ kind: 'settings' });
    render(SettingsModal);
    expect(await screen.findByText(/isn't your default app for .md files yet/i)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /make remarkdown the default/i }));
    expect(makeDefaultApp).toHaveBeenCalledTimes(1);
  });

  it('explains the manual route if it fails', async () => {
    vi.mocked(defaultAppStatus).mockResolvedValue({ supported: true, md: false, markdown: false });
    vi.mocked(makeDefaultApp).mockImplementation(async () => { throw new Error('access denied'); });
    openModal({ kind: 'settings' });
    render(SettingsModal);
    await userEvent.setup().click(await screen.findByRole('button', { name: /make remarkdown the default/i }));
    await waitFor(() => expect(get(toasts).some((t) => t.kind === 'error' && /Open with/.test(t.message))).toBe(true));
  });

  it('re-checks the status when the window regains focus', async () => {
    vi.mocked(defaultAppStatus).mockResolvedValue({ supported: true, md: false, markdown: false });
    openModal({ kind: 'settings' });
    render(SettingsModal);
    await screen.findByText(/isn't your default app/i);
    vi.mocked(defaultAppStatus).mockResolvedValue({ supported: true, md: true, markdown: true });
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('remarkdown is your default app for .md files')).toBeInTheDocument();
  });
});
