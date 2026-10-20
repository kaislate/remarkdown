import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { tutorialOverlayVisible, resetTutorialState, toggleTutorial } from '../../src/stores/tutorial';
import { readerMode } from '../../src/stores/reader-mode';
import { doc } from '../../src/stores/doc';
import { welcomeDocPath } from '../../src/stores/welcome';
import { inkSwapping } from '../../src/lib/ink-transition';
import { resetSettings } from '../../src/stores/settings';

const WELCOME = '/app/welcome.md';

describe('the welcome tutorial and reader mode', () => {
  beforeEach(() => {
    resetSettings();
    resetTutorialState();
    readerMode.set(false);
    inkSwapping.set(false);
    welcomeDocPath.set(WELCOME);
    doc.set({ path: WELCOME, markdown: '# Welcome', sha256: '0', bytes: 9 } as never);
  });

  it('shows over the welcome document in the normal view', () => {
    expect(get(tutorialOverlayVisible)).toBe(true);
  });

  it('waits while reading, and meets you once you come out and the ink has dried', () => {
    readerMode.set(true);
    expect(get(tutorialOverlayVisible)).toBe(false);
    toggleTutorial(); // '?' can't force it over the page either
    expect(get(tutorialOverlayVisible)).toBe(false);
    resetTutorialState();
    inkSwapping.set(true);
    readerMode.set(false);
    expect(get(tutorialOverlayVisible)).toBe(false);
    inkSwapping.set(false);
    expect(get(tutorialOverlayVisible)).toBe(true);
  });
});
