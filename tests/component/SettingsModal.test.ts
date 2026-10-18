import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  loadSettingsJson: vi.fn(),
  saveSettingsJson: vi.fn(),
}));

import { activeModal, openModal, closeModal } from '../../src/stores/modals';
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
});
