import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { get } from 'svelte/store';

vi.mock('../../src/lib/tauri-api', () => ({ loadSettingsJson: vi.fn(), saveSettingsJson: vi.fn() }));

import OptionCard from '../../src/components/settings/OptionCard.svelte';
import { OPTIONS } from '../../src/lib/settings-catalog';
import { settings, resetSettings, updateSettings } from '../../src/stores/settings';

const opt = (id: string) => OPTIONS.find((o) => o.id === id)!;

describe('OptionCard', () => {
  beforeEach(() => resetSettings());
  afterEach(() => vi.useRealTimers());

  it('shows the title, description and a depiction', () => {
    render(OptionCard, { option: opt('setting-splash') });
    expect(screen.getByText('Splash screen')).toBeInTheDocument();
    expect(screen.getByText(/animated logo/)).toBeInTheDocument();
    expect(document.querySelector('[data-depiction="splash"]')).not.toBeNull();
  });

  it('a switch writes through, honouring inverted settings', async () => {
    render(OptionCard, { option: opt('setting-show-welcome') });
    const sw = screen.getByRole('switch', { name: 'Welcome document on launch' });
    expect(sw).toBeChecked(); // dontShowWelcomeOnLaunch = false
    await fireEvent.click(sw);
    expect(get(settings).dontShowWelcomeOnLaunch).toBe(true);
  });

  it('a segmented control writes the chosen value', async () => {
    render(OptionCard, { option: opt('setting-open-mode') });
    const group = screen.getByRole('radiogroup', { name: 'When opening a file' });
    expect(group).toHaveAttribute('id', 'setting-open-mode');
    await fireEvent.click(screen.getByRole('radio', { name: 'New window' }));
    expect(get(settings).openMode).toBe('windows');
    expect(screen.getByRole('radio', { name: 'New window' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a slider writes numbers and shows a friendly value', async () => {
    render(OptionCard, { option: opt('setting-width') });
    const slider = screen.getByRole('slider', { name: 'Page width' });
    await fireEvent.input(slider, { target: { value: '900' } });
    expect(get(settings).articleWidth).toBe(900);
    expect(screen.getByText('900px')).toBeInTheDocument();
  });

  it('swatches write the colour', async () => {
    render(OptionCard, { option: opt('setting-highlight-color') });
    const swatches = screen.getAllByRole('radio');
    await fireEvent.click(swatches[2]);
    expect(get(settings).defaultHighlightColor).toBe(opt('setting-highlight-color').control.type === 'swatches'
      ? (opt('setting-highlight-color').control as { colors: readonly string[] }).colors[2] : '');
  });

  it('is greyed out and inert when it does not apply', () => {
    updateSettings({ watermarkEnabled: false });
    render(OptionCard, { option: opt('setting-watermark-opacity') });
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(document.querySelector('.option-card')).toHaveClass('disabled');
  });

  it('plays its depiction on hover and briefly after a change', async () => {
    vi.useFakeTimers();
    render(OptionCard, { option: opt('setting-splash') });
    const card = document.querySelector('.option-card')!;
    const svg = () => document.querySelector('[data-depiction="splash"]')!;
    expect(svg()).not.toHaveClass('playing');
    await fireEvent.mouseEnter(card);
    expect(svg()).toHaveClass('playing');
    await fireEvent.mouseLeave(card);
    expect(svg()).not.toHaveClass('playing');
    await fireEvent.click(screen.getByRole('switch'));
    expect(svg()).toHaveClass('playing');
    await vi.advanceTimersByTimeAsync(3000);
    expect(svg()).not.toHaveClass('playing');
  });
});
