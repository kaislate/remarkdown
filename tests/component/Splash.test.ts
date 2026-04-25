import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Splash from '../../src/components/Splash.svelte';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Splash', () => {
  it('renders the splash overlay with the full re.md → remarkdown sequence', () => {
    render(Splash);
    expect(document.querySelector('.splash')).not.toBeNull();
    expect(document.querySelector('.splash .logo')).not.toBeNull();
    expect(document.querySelectorAll('.logo span').length).toBe(6);
    // textContent concatenates everything we'll later morph from re.md → remarkdown.
    expect(document.querySelector('.logo')!.textContent).toBe('re.markdown');
  });

  it('marks itself for fade-out after the full animation runtime', async () => {
    render(Splash);
    expect(document.querySelector('.splash')).not.toBeNull();
    expect(document.querySelector('.splash')!.classList.contains('fading')).toBe(false);
    // HOLD_BEFORE_REVEAL (900) + REVEAL_DURATION (1500) + HOLD_AFTER_REVEAL (1500) = 3900
    await vi.advanceTimersByTimeAsync(4000);
    expect(document.querySelector('.splash')!.classList.contains('fading')).toBe(true);
  });

  it('unmounts itself after the fade-out completes', async () => {
    render(Splash);
    // Start of fade — splash flips to fading at 3900ms
    await vi.advanceTimersByTimeAsync(3900);
    expect(document.querySelector('.splash')!.classList.contains('fading')).toBe(true);
    // Fade-out duration is 400ms
    await vi.advanceTimersByTimeAsync(450);
    expect(document.querySelector('.splash')).toBeNull();
  });

  it('clicking dismisses the splash early', async () => {
    render(Splash);
    expect(document.querySelector('.splash')!.classList.contains('fading')).toBe(false);
    const splash = document.querySelector('.splash') as HTMLElement;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.click(splash);
    expect(document.querySelector('.splash')!.classList.contains('fading')).toBe(true);
    await vi.advanceTimersByTimeAsync(450);
    expect(document.querySelector('.splash')).toBeNull();
  });

  it('a second click during fade-out does not break or extend the timer', async () => {
    render(Splash);
    const splash = document.querySelector('.splash') as HTMLElement;
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    await user.click(splash);
    await user.click(splash); // should be a no-op
    await vi.advanceTimersByTimeAsync(450);
    expect(document.querySelector('.splash')).toBeNull();
  });
});
