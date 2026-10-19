import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({
  loadSettingsJson: vi.fn(),
  saveSettingsJson: vi.fn(),
  windowLabel: vi.fn(() => 'main'),
}));

import Onboarding from '../../src/components/Onboarding.svelte';
import { PROFILES } from '../../src/lib/profiles';
import { OPTIONS } from '../../src/lib/settings-catalog';
import { SettingsSchema } from '../../src/lib/settings-schema';
import { activeModal, openModal, closeModal } from '../../src/stores/modals';
import { settings, resetSettings, updateSettings } from '../../src/stores/settings';

const profile = (id: string) => PROFILES.find((p) => p.id === id)!;

describe('profiles', () => {
  it('are Reader, Annotator and Writer, with valid settings and customize lists', () => {
    expect(PROFILES.map((p) => p.title)).toEqual(['Reader', 'Annotator', 'Writer']);
    const keys = Object.keys(SettingsSchema.shape);
    const ids = new Set(OPTIONS.map((o) => o.id));
    for (const p of PROFILES) {
      for (const k of Object.keys(p.settings)) expect(keys, `${p.id}.${k}`).toContain(k);
      for (const id of p.customize) expect(ids.has(id), `${p.id}: ${id}`).toBe(true);
      expect(p.screenshot).toBeTruthy();
    }
  });
});

describe('Onboarding', () => {
  beforeEach(() => {
    resetSettings();
    closeModal();
    document.body.innerHTML = '';
  });

  function show() {
    openModal({ kind: 'onboarding' });
    render(Onboarding);
  }

  it('offers three profiles with screenshots; Annotator is preselected', () => {
    show();
    expect(screen.getByRole('dialog', { name: /How do you want to use remarkdown/ })).toBeInTheDocument();
    const cards = screen.getAllByRole('radio');
    expect(cards.map((c) => c.querySelector('h3')?.textContent)).toEqual(['Reader', 'Annotator', 'Writer']);
    for (const c of cards) expect(c.querySelector('img')?.getAttribute('alt')).toMatch(/remarkdown set up for/);
    expect(cards[1]).toHaveAttribute('aria-checked', 'true');
  });

  it('Continue applies the chosen profile and finishes', async () => {
    show();
    await fireEvent.click(screen.getByRole('radio', { name: /Writer/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const s = get(settings);
    for (const [k, v] of Object.entries(profile('writer').settings)) expect(s[k as keyof typeof s], k).toEqual(v);
    expect(s.onboardingCompleted).toBe(true);
    expect(get(activeModal)).toBeNull();
  });

  it('Customize shows that profile\'s options, already set, to adjust before finishing', async () => {
    show();
    await fireEvent.click(screen.getByRole('radio', { name: /Reader/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Customize this layout/ }));
    expect(screen.getByRole('heading', { name: /Customize the Reader layout/ })).toBeInTheDocument();
    const shown = Array.from(document.querySelectorAll('[data-option]')).map((n) => n.getAttribute('data-option'));
    expect(shown).toEqual(profile('reader').customize);
    expect(get(settings).openInFocusMode).toBe(true);
    await fireEvent.click(screen.getByRole('switch', { name: /reader mode/i }));
    expect(get(settings).openInFocusMode).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(get(settings).onboardingCompleted).toBe(true);
    expect(get(settings).openInFocusMode).toBe(false);
  });

  it('Back from Customize undoes the profile', async () => {
    updateSettings({ marginaliaEnabled: true, openInFocusMode: false });
    show();
    await fireEvent.click(screen.getByRole('radio', { name: /Reader/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Customize this layout/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(get(settings).openInFocusMode).toBe(false);
    expect(get(settings).marginaliaEnabled).toBe(true);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('Skip keeps the current settings and does not ask again', async () => {
    updateSettings({ theme: 'light' });
    show();
    await fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(get(settings).theme).toBe('light');
    expect(get(settings).onboardingCompleted).toBe(true);
    expect(get(activeModal)).toBeNull();
  });

  it('arrow keys move between profiles', async () => {
    show();
    const cards = screen.getAllByRole('radio');
    cards[1].focus();
    await fireEvent.keyDown(cards[1], { key: 'ArrowRight' });
    expect(cards[2]).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(cards[2]);
  });
});
