import { writable, get } from 'svelte/store';
import type { Tool } from '../lib/schema';

export const HIGHLIGHT_COLORS = ['#ffd25a', '#82d99c', '#ffa58a', '#a8c5ff', '#e0a8ff'] as const;
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
