// Shortcut labels as the platform spells them. Every label in the app is
// written the Windows way ("Ctrl+Shift+B"); on a Mac the same keys are
// Cmd, and Apple's habit is glyphs in a fixed order with no separators.
// Call this when a label is rendered, not at module load, so it follows the
// platform probe that finishes after imports are evaluated.

import { platform, type OS } from './platform';

const MODIFIER = /^(Ctrl|Alt|Shift)\s*\+\s*/;

export function formatShortcut(keys: string, os: OS = platform()): string {
  if (os !== 'macos') return keys;
  let rest = keys;
  let alt = false;
  let shift = false;
  let cmd = false;
  for (let m = MODIFIER.exec(rest); m; m = MODIFIER.exec(rest)) {
    if (m[1] === 'Ctrl') cmd = true;
    else if (m[1] === 'Alt') alt = true;
    else shift = true;
    rest = rest.slice(m[0].length);
  }
  if (rest === 'Enter') rest = '↩';
  // Apple order is control, option, shift, command. Ctrl in our spelling
  // means the primary modifier, which is Cmd here, so control never appears.
  return `${alt ? '⌥' : ''}${shift ? '⇧' : ''}${cmd ? '⌘' : ''}${rest}`;
}

// The app's annotation redo takes Cmd+Shift+Z on a Mac, which is the
// spelling Mac users reach for; Ctrl+Y is the Windows/Linux habit.
export function redoShortcut(os: OS = platform()): string {
  return os === 'macos' ? '⇧⌘Z' : 'Ctrl+Y';
}
