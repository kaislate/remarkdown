// Tutorial overlay visibility state.
//
// Default visibility logic (the "auto" gate) follows the original
// behaviour: show when the welcome doc is open AND the user hasn't
// permanently dismissed it AND they haven't session-dismissed it. Never
// in reader mode, nor during the ink swap in or out of it.
//
// Two override flags layer on top:
//   tutorialSessionDismissed — flipped by the "Got it" button or by
//     pressing '?' while the overlay is visible. Hides for the session;
//     resets next launch.
//   tutorialForceShown — flipped by pressing '?' while the overlay is
//     hidden. Forces visibility regardless of the welcome-doc-open
//     check or the persisted dismissal, so users can re-open the
//     tutorial from any document at any time.

import { derived, get, writable } from 'svelte/store';
import { isWelcomeDocOpen } from './welcome';
import { settings, updateSettings } from './settings';
import { readerMode } from './reader-mode';
import { inkSwapping } from '../lib/ink-transition';

export const tutorialSessionDismissed = writable(false);
export const tutorialForceShown = writable(false);

export const tutorialOverlayVisible = derived(
  [isWelcomeDocOpen, settings, tutorialSessionDismissed, tutorialForceShown, readerMode, inkSwapping],
  ([$open, $settings, $sessionDismissed, $forced, $reading, $swapping]) => {
    // Not over a page being read, nor while the ink is drying: someone
    // who starts in reader mode (the Reader layout) meets the tutorial
    // when they first come out of it, once the swap has finished.
    if ($reading || $swapping) return false;
    if ($forced) return true;
    return $open && !$settings.welcomeTutorialDismissed && !$sessionDismissed;
  },
);

export function dismissTutorialForSession() {
  tutorialSessionDismissed.set(true);
  tutorialForceShown.set(false);
}

export function dismissTutorialForever() {
  updateSettings({ welcomeTutorialDismissed: true });
  tutorialSessionDismissed.set(true);
  tutorialForceShown.set(false);
}

// Toggle: if currently visible, hide for the session. If currently
// hidden (for any reason — wrong doc, dismissed setting, session
// dismissal), force it visible.
export function toggleTutorial() {
  const visible = get(tutorialOverlayVisible);
  if (visible) {
    tutorialSessionDismissed.set(true);
    tutorialForceShown.set(false);
  } else {
    tutorialForceShown.set(true);
    tutorialSessionDismissed.set(false);
  }
}

// Test helper — wipes both override flags back to defaults.
export function resetTutorialState() {
  tutorialSessionDismissed.set(false);
  tutorialForceShown.set(false);
}
