import { writable, get } from 'svelte/store';
import type { Tool } from '../lib/schema';

// Fluorescent highlighter ink colours. These are the swatches users pick
// from in the colour strip; the rendered highlight uses the same RGB at
// reduced alpha (see styles/highlights.css). Saturated values that pop
// against the dark theme.
export const HIGHLIGHT_COLORS = ['#fff200', '#c2ff66', '#ff7ba1', '#66e1ff', '#c889ff'] as const;
export const DRAW_COLORS = ['#d6336c', '#5f9bff', '#f59f00', '#20c997', '#d9d9d9'] as const;

export interface ToolState {
  mode: Tool;
  highlightColor: string;
  drawColor: string;
}

const initial: ToolState = {
  mode: 'cursor',
  highlightColor: HIGHLIGHT_COLORS[0],
  drawColor: DRAW_COLORS[0],
};

export const tool = writable<ToolState>(initial);

export function setMode(mode: Tool): void {
  tool.update((t) => ({ ...t, mode }));
}

export function setColor(color: string): void {
  const current = get(tool);
  if (current.mode === 'highlight') {
    tool.update((t) => ({ ...t, highlightColor: color }));
  } else if (current.mode === 'draw') {
    tool.update((t) => ({ ...t, drawColor: color }));
  }
}
