// Showing and hiding the tabs from the menu or the keyboard. The choice is
// the "Show tabs" setting, so it sticks across launches; hiding says how to
// get them back, since nothing on screen does any more.
import { get } from 'svelte/store';
import { settings, updateSettings } from '../stores/settings';
import { addToast } from '../stores/toasts';
import { formatShortcut } from './shortcuts';

// A function, not a constant: the label follows the platform probe.
export const toggleTabsShortcut = (): string => formatShortcut('Ctrl+Shift+B');

export function isToggleTabsKey(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b';
}

export function toggleTabsShown(): void {
  const show = !get(settings).showTabs;
  updateSettings({ showTabs: show });
  if (!show) {
    addToast({ kind: 'info', message: `Tabs hidden. Press ${toggleTabsShortcut()} to show them again.` });
  }
}
