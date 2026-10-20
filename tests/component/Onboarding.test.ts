import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
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

  it('offers three profiles with screenshots; Reader is preselected', () => {
    show();
    expect(screen.getByRole('dialog', { name: /How do you want to use remarkdown/ })).toBeInTheDocument();
    const cards = within(screen.getByRole('radiogroup', { name: /How do you want/ })).getAllByRole('radio');
    expect(cards.map((c) => c.querySelector('h3')?.firstChild?.textContent)).toEqual(['Reader', 'Annotator', 'Writer']);
    for (const c of cards) expect(c.querySelector('img')?.getAttribute('alt')).toMatch(/remarkdown set up for/);
    expect(cards[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('marks the Reader layout and Textured paper "(Recommended)"', () => {
    show();
    const marked = Array.from(document.querySelectorAll('.recommended')).map((el) => el.closest('[role="radio"]')?.querySelector('h3, span')?.textContent);
    expect(marked).toEqual(['Reader(Recommended)', 'Textured']);
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
    await fireEvent.click(screen.getByRole('switch', { name: 'Always open documents in reader mode' }));
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
    expect(within(screen.getByRole('radiogroup', { name: /How do you want/ })).getAllByRole('radio')).toHaveLength(3);
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

  describe('reader mode, right on the first screen', () => {
    const colours = () => screen.getByRole('radiogroup', { name: 'Reader mode colours' });
    const minimap = () => screen.getByRole('switch', { name: 'Show the minimap in reader mode' });

    it('offers every reader style with a moving picture of it, and the minimap switch (on)', () => {
      show();
      const opts = within(colours()).getAllByRole('radio');
      expect(opts.map((o) => o.querySelector('span')?.textContent?.trim())).toEqual(['Default', 'Paper', 'Textured', 'Sepia', 'Night', 'E-ink']);
      for (const o of opts) expect(o.querySelector('svg.reader-style-preview.playing')).not.toBeNull();
      expect(minimap()).toBeChecked();
      expect(document.querySelector('.minimap-pick svg.reader-style-preview.with-map')).not.toBeNull();
    });

    it("follows the chosen layout's style until you pick one yourself", async () => {
      show();
      const checked = () => within(colours()).getAllByRole('radio').find((o) => o.getAttribute('aria-checked') === 'true')?.querySelector('span')?.textContent?.trim();
      expect(checked()).toBe('Textured');
      await fireEvent.click(screen.getByRole('radio', { name: /Annotator/ }));
      expect(checked()).toBe('Default');
      await fireEvent.click(screen.getByRole('radio', { name: /Reader/ }));
      expect(checked()).toBe('Textured');
      await fireEvent.click(within(colours()).getByRole('radio', { name: 'Night' }));
      await fireEvent.click(screen.getByRole('radio', { name: /Writer/ }));
      expect(checked()).toBe('Night');
    });

    it('Continue saves the picks with the layout', async () => {
      show();
      await fireEvent.click(screen.getByRole('radio', { name: /Reader/ }));
      await fireEvent.click(within(colours()).getByRole('radio', { name: 'Sepia' }));
      await fireEvent.click(minimap());
      expect(document.querySelector('.minimap-pick svg.reader-style-preview.with-map')).toBeNull();
      await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(get(settings)).toMatchObject({ readerTheme: 'sepia', readerMinimap: false, openInFocusMode: true });
    });

    it('Skip changes nothing', async () => {
      show();
      await fireEvent.click(within(colours()).getByRole('radio', { name: 'Night' }));
      await fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
      expect(get(settings)).toMatchObject({ readerTheme: 'default', readerMinimap: true });
    });
  });
});
