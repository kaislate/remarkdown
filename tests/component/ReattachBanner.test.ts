import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { reattachTarget } from '../../src/stores/reattach';
import ReattachBanner from '../../src/components/ReattachBanner.svelte';

beforeEach(() => {
  reattachTarget.set(null);
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('ReattachBanner', () => {
  it('renders nothing when reattachTarget is null', () => {
    render(ReattachBanner);
    expect(document.querySelector('.reattach-banner')).toBeNull();
  });

  it('renders the banner with snippet when target is set', () => {
    reattachTarget.set({ annotationId: 'a1', snippet: 'must read slowly' });
    render(ReattachBanner);
    const banner = document.querySelector('.reattach-banner');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('must read slowly');
  });

  it('clicking Cancel clears reattachTarget', async () => {
    reattachTarget.set({ annotationId: 'a1', snippet: 'foo' });
    render(ReattachBanner);
    const user = userEvent.setup();
    const btn = document.querySelector('.reattach-cancel') as HTMLButtonElement;
    await user.click(btn);
    let current: unknown;
    reattachTarget.subscribe((v) => { current = v; })();
    expect(current).toBeNull();
  });

  it('toggles body.reattach-mode class while target is non-null', async () => {
    render(ReattachBanner);
    expect(document.body.classList.contains('reattach-mode')).toBe(false);
    reattachTarget.set({ annotationId: 'a1', snippet: 'foo' });
    await Promise.resolve();
    expect(document.body.classList.contains('reattach-mode')).toBe(true);
    reattachTarget.set(null);
    await Promise.resolve();
    expect(document.body.classList.contains('reattach-mode')).toBe(false);
  });
});
