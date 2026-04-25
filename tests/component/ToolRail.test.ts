import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import ToolRail from '../../src/components/ToolRail.svelte';
import { tool, setMode } from '../../src/stores/tool';

beforeEach(() => { setMode('cursor'); });

describe('ToolRail', () => {
  it('renders four tool buttons', () => {
    render(ToolRail);
    // Note tool's user-facing label is "re.mark" (the `note` tool mode is
    // the internal name for the same surface).
    for (const name of ['cursor', 'highlight', 're.mark', 'draw']) {
      expect(screen.getByRole('radio', { name: new RegExp(name, 'i') })).toBeInTheDocument();
    }
  });

  it('marks the active tool with aria-checked=true', () => {
    render(ToolRail);
    const cursorBtn = screen.getByRole('radio', { name: /cursor/i });
    expect(cursorBtn.getAttribute('aria-checked')).toBe('true');
  });

  it('clicking a tool updates the store and aria-checked state', async () => {
    const user = userEvent.setup();
    render(ToolRail);
    await user.click(screen.getByRole('radio', { name: /highlight/i }));
    expect(get(tool).mode).toBe('highlight');
    expect(screen.getByRole('radio', { name: /highlight/i }).getAttribute('aria-checked')).toBe('true');
  });
});
