import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import ZoomControls from '../../src/components/ZoomControls.svelte';
import { zoomLevel, ZOOM_LEVELS } from '../../src/stores/ui';

beforeEach(() => {
  zoomLevel.set(1.0);
});

describe('ZoomControls', () => {
  it('renders zoom out, level indicator, and zoom in buttons', () => {
    render(ZoomControls);
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom: 100 percent/i })).toBeInTheDocument();
  });

  it('clicking zoom in steps up to the next level', async () => {
    const user = userEvent.setup();
    render(ZoomControls);
    await user.click(screen.getByRole('button', { name: /zoom in/i }));
    const expected = ZOOM_LEVELS[ZOOM_LEVELS.indexOf(1.0) + 1];
    expect(get(zoomLevel)).toBe(expected);
  });

  it('clicking zoom out steps down to the previous level', async () => {
    const user = userEvent.setup();
    render(ZoomControls);
    await user.click(screen.getByRole('button', { name: /zoom out/i }));
    const expected = ZOOM_LEVELS[ZOOM_LEVELS.indexOf(1.0) - 1];
    expect(get(zoomLevel)).toBe(expected);
  });

  it('clicking the percentage label resets zoom to 1.0', async () => {
    zoomLevel.set(1.5);
    const user = userEvent.setup();
    render(ZoomControls);
    await user.click(screen.getByRole('button', { name: /zoom: 150 percent/i }));
    expect(get(zoomLevel)).toBe(1.0);
  });

  it('disables zoom-out at the minimum level', () => {
    zoomLevel.set(ZOOM_LEVELS[0]);
    render(ZoomControls);
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeDisabled();
  });

  it('disables zoom-in at the maximum level', () => {
    zoomLevel.set(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
    render(ZoomControls);
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeDisabled();
  });
});
