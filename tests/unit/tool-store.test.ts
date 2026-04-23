import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { tool, setMode, setColor, HIGHLIGHT_COLORS, DRAW_COLORS } from '../../src/stores/tool';

describe('tool store', () => {
  beforeEach(() => {
    setMode('cursor');
  });

  it('starts in cursor mode with sensible default colors', () => {
    const t = get(tool);
    expect(t.mode).toBe('cursor');
    expect(HIGHLIGHT_COLORS).toContain(t.highlightColor);
    expect(DRAW_COLORS).toContain(t.drawColor);
  });

  it('setMode switches the active tool', () => {
    setMode('highlight');
    expect(get(tool).mode).toBe('highlight');
    setMode('note');
    expect(get(tool).mode).toBe('note');
    setMode('draw');
    expect(get(tool).mode).toBe('draw');
  });

  it('setColor in highlight mode updates highlightColor, leaves drawColor alone', () => {
    setMode('highlight');
    const originalDraw = get(tool).drawColor;
    setColor('#d6336c');
    const t = get(tool);
    expect(t.highlightColor).toBe('#d6336c');
    expect(t.drawColor).toBe(originalDraw);
  });

  it('setColor in draw mode updates drawColor, leaves highlightColor alone', () => {
    setMode('draw');
    const originalHighlight = get(tool).highlightColor;
    setColor('#5f9bff');
    const t = get(tool);
    expect(t.drawColor).toBe('#5f9bff');
    expect(t.highlightColor).toBe(originalHighlight);
  });

  it('setColor is a no-op in cursor and note modes', () => {
    setMode('cursor');
    const before = get(tool);
    setColor('#123456');
    expect(get(tool)).toEqual(before);

    setMode('note');
    const before2 = get(tool);
    setColor('#123456');
    expect(get(tool)).toEqual(before2);
  });
});
