import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import EditorBubbleMenu from '../../src/components/EditorBubbleMenu.svelte';

describe('EditorBubbleMenu', () => {
  it('hidden by default (visible: false)', () => {
    const { container } = render(EditorBubbleMenu, {
      props: { visible: false, x: 0, y: 0, onMark: () => {}, activeMarks: new Set() },
    });
    const el = container.querySelector('.editor-bubble-menu') as HTMLElement | null;
    expect(el?.getAttribute('hidden')).toBe('');
  });

  it('renders four mark buttons when visible', () => {
    const { container } = render(EditorBubbleMenu, {
      props: { visible: true, x: 0, y: 0, onMark: () => {}, activeMarks: new Set() },
    });
    expect(container.querySelector('[data-mark="strong"]')).not.toBeNull();
    expect(container.querySelector('[data-mark="em"]')).not.toBeNull();
    expect(container.querySelector('[data-mark="code"]')).not.toBeNull();
    expect(container.querySelector('[data-mark="link"]')).not.toBeNull();
  });

  it('clicking a mark button calls onMark with the mark name', async () => {
    const onMark = vi.fn();
    const user = userEvent.setup();
    const { container } = render(EditorBubbleMenu, {
      props: { visible: true, x: 0, y: 0, onMark, activeMarks: new Set() },
    });
    const btn = container.querySelector('[data-mark="strong"]') as HTMLButtonElement;
    await user.click(btn);
    expect(onMark).toHaveBeenCalledWith('strong');
    cleanup();
  });

  it('reflects active marks via aria-pressed', () => {
    const active = new Set(['strong', 'em']);
    const { container } = render(EditorBubbleMenu, {
      props: { visible: true, x: 0, y: 0, onMark: () => {}, activeMarks: active },
    });
    expect(container.querySelector('[data-mark="strong"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-mark="em"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-mark="code"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-mark="link"]')?.getAttribute('aria-pressed')).toBe('false');
  });
});
