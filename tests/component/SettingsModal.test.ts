import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import { tick } from 'svelte';

vi.mock('../../src/lib/tauri-api', () => ({
  loadSettingsJson: vi.fn(),
  saveSettingsJson: vi.fn(),
  windowLabel: vi.fn(() => 'main'),
  defaultAppStatus: vi.fn(async () => ({ supported: false, md: false, markdown: false })),
  makeDefaultApp: vi.fn(async () => {}),
}));

import { activeModal, openModal, closeModal } from '../../src/stores/modals';
import { settings, resetSettings, updateSettings } from '../../src/stores/settings';
import { DEFAULT_SETTINGS } from '../../src/lib/settings-schema';
import { defaultAppStatus, makeDefaultApp } from '../../src/lib/tauri-api';
import { toasts, clearToasts } from '../../src/stores/toasts';
import SettingsModal from '../../src/components/SettingsModal.svelte';

function open(section?: string) {
  openModal({ kind: 'settings' });
  render(SettingsModal);
  if (section) return fireEvent.click(screen.getByRole('button', { name: section }));
}

beforeEach(() => {
  closeModal();
  resetSettings();
  clearToasts();
  document.body.innerHTML = '';
});

describe('Settings window', () => {
  it('renders nothing unless Settings is open', () => {
    render(SettingsModal);
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });

  it('lists the sections on the left and starts on Appearance', () => {
    open();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(Array.from(nav.querySelectorAll('button')).map((b) => b.textContent?.trim()))
      .toEqual(['Appearance', 'Reading', 'Tabs & files', 'Annotations', 'Drawing', 'Updates', 'About']);
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Theme')).toBeInTheDocument();
  });

  it('every option shows a depiction', async () => {
    await open('Drawing');
    const cards = document.querySelectorAll('.option-card');
    expect(cards.length).toBeGreaterThan(3);
    for (const c of cards) expect(c.querySelector('[data-depiction]')).not.toBeNull();
  });

  it('switching sections shows that section\'s options', async () => {
    await open('Drawing');
    expect(screen.getByText('Pen colour')).toBeInTheDocument();
    expect(screen.queryByText('Theme')).toBeNull();
  });

  it('search finds options across sections and says when nothing matches', async () => {
    open();
    const search = screen.getByRole('searchbox', { name: 'Search settings' });
    await fireEvent.input(search, { target: { value: 'pen colour' } });
    expect(screen.getByText('Pen colour')).toBeInTheDocument();
    expect(screen.queryByText('Theme')).toBeNull();
    await fireEvent.input(search, { target: { value: 'zzzz' } });
    expect(screen.getByText(/No settings match/)).toBeInTheDocument();
  });

  it('closes with Esc, the scrim and Done, but not clicks inside', async () => {
    open();
    await fireEvent.click(screen.getByRole('dialog', { name: 'Settings' }));
    expect(get(activeModal)).toEqual({ kind: 'settings' });
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(get(activeModal)).toBeNull();
    openModal({ kind: 'settings' });
    await tick();
    await fireEvent.click(document.querySelector('.scrim')!);
    expect(get(activeModal)).toBeNull();
    openModal({ kind: 'settings' });
    await tick();
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(get(activeModal)).toBeNull();
  });

  it('Esc while searching clears the search first', async () => {
    open();
    const search = screen.getByRole('searchbox', { name: 'Search settings' });
    await fireEvent.input(search, { target: { value: 'pen' } });
    await fireEvent.keyDown(search, { key: 'Escape' });
    expect((search as HTMLInputElement).value).toBe('');
    expect(get(activeModal)).toEqual({ kind: 'settings' });
  });

  it('controls write through to the settings store', async () => {
    open();
    await fireEvent.click(screen.getByRole('switch', { name: 'Splash screen' }));
    expect(get(settings).splashEnabled).toBe(false);
    await fireEvent.input(screen.getByRole('slider', { name: 'Watermark strength' }), { target: { value: '0.3' } });
    expect(get(settings).watermarkOpacity).toBe(0.3);
    await fireEvent.click(screen.getByRole('button', { name: 'Annotations' }));
    const swatch = screen.getByRole('radiogroup', { name: 'Highlighter colour' }).querySelectorAll('[role="radio"]')[1];
    await fireEvent.click(swatch);
    expect(get(settings).defaultHighlightColor).toBe(swatch.getAttribute('aria-label'));
  });

  it('Reset to defaults restores everything', async () => {
    updateSettings({ theme: 'light', splashEnabled: false, articleWidth: 1000 });
    await open('About');
    await fireEvent.click(screen.getByRole('button', { name: 'Reset all settings' }));
    expect(get(settings)).toEqual(DEFAULT_SETTINGS);
  });

  it('open mode: three choices, and the restore option that fits the mode', async () => {
    await open('Tabs & files');
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(expect.arrayContaining(['New tab', 'Replace', 'New window']));
    expect(screen.getByRole('switch', { name: 'Reopen tabs from last time' })).toBeChecked();
    expect(screen.queryByRole('switch', { name: 'Reopen the last file on launch' })).toBeNull();
    await fireEvent.click(screen.getByRole('radio', { name: 'Replace' }));
    expect(get(settings).openMode).toBe('replace');
    expect(screen.queryByRole('switch', { name: 'Reopen tabs from last time' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Reopen the last file on launch' })).toBeInTheDocument();
  });

  it('About shows Check for updates now', async () => {
    await open('About');
    await fireEvent.click(screen.getByRole('button', { name: 'Check for updates now' }));
    expect(get(activeModal)).toEqual({ kind: 'check-update' });
  });
});

describe('Settings window — default app', () => {
  beforeEach(() => vi.mocked(makeDefaultApp).mockReset().mockResolvedValue(undefined));

  it('is hidden where it is not supported', async () => {
    vi.mocked(defaultAppStatus).mockResolvedValue({ supported: false, md: false, markdown: false });
    await open('Tabs & files');
    await Promise.resolve();
    expect(screen.queryByText('Default app for .md files')).toBeNull();
  });

  it('says so when remarkdown is already the default, with no button', async () => {
    vi.mocked(defaultAppStatus).mockResolvedValue({ supported: true, md: true, markdown: true });
    await open('Tabs & files');
    expect(await screen.findByText('remarkdown is your default')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /make remarkdown the default/i })).toBeNull();
  });

  it("offers the button when it isn't the default", async () => {
    vi.mocked(defaultAppStatus).mockResolvedValue({ supported: true, md: false, markdown: false });
    await open('Tabs & files');
    await userEvent.setup().click(await screen.findByRole('button', { name: /make remarkdown the default/i }));
    expect(makeDefaultApp).toHaveBeenCalledTimes(1);
  });

  it('re-checks when the window regains focus', async () => {
    vi.mocked(defaultAppStatus).mockResolvedValue({ supported: true, md: false, markdown: false });
    await open('Tabs & files');
    await screen.findByRole('button', { name: /make remarkdown the default/i });
    vi.mocked(defaultAppStatus).mockResolvedValue({ supported: true, md: true, markdown: true });
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('remarkdown is your default')).toBeInTheDocument();
  });
});

// Outside the describe above: vitest 2.1 reports a rejection that the app
// catches as a failure when the mock was reset in that scope's beforeEach.
it('default app: explains the manual route if it fails', async () => {
  closeModal();
  document.body.innerHTML = '';
  vi.mocked(defaultAppStatus).mockResolvedValue({ supported: true, md: false, markdown: false });
  vi.mocked(makeDefaultApp).mockImplementation(async () => { throw new Error('denied'); });
  await open('Tabs & files');
  await userEvent.setup().click(await screen.findByRole('button', { name: /make remarkdown the default/i }));
  await waitFor(() => expect(get(toasts).some((t) => t.kind === 'error' && /Open with/.test(t.message))).toBe(true));
});
