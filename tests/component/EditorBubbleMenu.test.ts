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

  it('renders sub and sup mark buttons when visible', () => {
    const { container } = render(EditorBubbleMenu, {
      props: { visible: true, x: 0, y: 0, onMark: () => {}, onApplyLink: () => {}, activeMarks: new Set(), linkHref: '' },
    });
    expect(container.querySelector('[data-mark="sub"]')).not.toBeNull();
    expect(container.querySelector('[data-mark="sup"]')).not.toBeNull();
  });

  it('clicking sub button calls onMark("sub")', async () => {
    const onMark = vi.fn();
    const user = userEvent.setup();
    const { container } = render(EditorBubbleMenu, {
      props: { visible: true, x: 0, y: 0, onMark, onApplyLink: () => {}, activeMarks: new Set(), linkHref: '' },
    });
    const btn = container.querySelector('[data-mark="sub"]') as HTMLButtonElement;
    await user.click(btn);
    expect(onMark).toHaveBeenCalledWith('sub');
    cleanup();
  });

  it('clicking sup button calls onMark("sup")', async () => {
    const onMark = vi.fn();
    const user = userEvent.setup();
    const { container } = render(EditorBubbleMenu, {
      props: { visible: true, x: 0, y: 0, onMark, onApplyLink: () => {}, activeMarks: new Set(), linkHref: '' },
    });
    const btn = container.querySelector('[data-mark="sup"]') as HTMLButtonElement;
    await user.click(btn);
    expect(onMark).toHaveBeenCalledWith('sup');
    cleanup();
  });
});
