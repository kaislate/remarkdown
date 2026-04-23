import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import ColorStrip from '../../src/components/ColorStrip.svelte';
import { tool, setMode, HIGHLIGHT_COLORS } from '../../src/stores/tool';

beforeEach(() => { setMode('cursor'); });

describe('ColorStrip', () => {
  it('renders nothing when tool mode is cursor or note', () => {
    setMode('cursor');
    const { container } = render(ColorStrip);
    expect(container.querySelector('.strip')).toBeNull();
  });

  it('renders 5 color swatches in highlight mode', () => {
    setMode('highlight');
    render(ColorStrip);
    const swatches = screen.getAllByRole('radio');
    expect(swatches).toHaveLength(5);
  });

  it('clicking a swatch updates the highlight color', async () => {
    setMode('highlight');
    const user = userEvent.setup();
    render(ColorStrip);
    const swatches = screen.getAllByRole('radio');
    await user.click(swatches[2]);
    expect(get(tool).highlightColor).toBe(HIGHLIGHT_COLORS[2]);
  });
});
