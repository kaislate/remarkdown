// The three starting layouts offered on first launch ("How do you want to
// use remarkdown?"). Picking one applies its settings; "Customize this
// layout" then shows the option cards listed in `customize` so the user
// can adjust them one by one. Screenshots are real captures of the app in
// each layout (regenerate with GENERATE_ONBOARDING_SHOTS=1 npx playwright
// test onboarding-screenshots).

import type { Settings } from './settings-schema';
import readerShot from '../assets/onboarding/reader.jpg';
import annotatorShot from '../assets/onboarding/annotator.jpg';
import writerShot from '../assets/onboarding/writer.jpg';

export interface Profile {
  id: 'reader' | 'annotator' | 'writer';
  title: string;
  tagline: string;
  bullets: string[];
  settings: Partial<Settings>;
  customize: string[]; // option ids from settings-catalog
  screenshot: string;
}

export const PROFILES: Profile[] = [
  {
    id: 'reader',
    title: 'Reader',
    tagline: 'Just read. Files open full-screen with nothing but the page.',
    bullets: ['Opens in reader mode', 'Textured paper, nothing on screen but the page', 'Annotation tools hidden'],
    settings: {
      openInFocusMode: true,
      openInEditMode: false,
      readerTheme: 'textured',
      hideAnnotationControls: true,
      marginaliaEnabled: false,
      tabPosition: 'top',
    },
    customize: ['setting-open-focus', 'setting-reader-theme', 'setting-reader-nav', 'setting-reader-minimap', 'setting-width', 'setting-zoom', 'setting-hide-controls'],
    screenshot: readerShot,
  },
  {
    id: 'annotator',
    title: 'Annotator',
    tagline: 'Mark it up. For studying, reviewing and research.',
    bullets: ['Highlighter, re.marks and pen', 'Margin notes', 'Tabs for several documents'],
    settings: {
      openInFocusMode: false,
      openInEditMode: false,
      hideAnnotationControls: false,
      marginaliaEnabled: true,
      tabPosition: 'top',
    },
    customize: ['setting-hide-controls', 'setting-highlight-color', 'setting-marginalia', 'setting-ink-color', 'setting-auto-transform'],
    screenshot: annotatorShot,
  },
  {
    id: 'writer',
    title: 'Writer',
    tagline: 'Write it. Documents open ready to edit.',
    bullets: ['Opens in edit mode', 'Formatting toolbar', 'Tabs in a sidebar on the left'],
    settings: {
      openInEditMode: true,
      openInFocusMode: false,
      hideAnnotationControls: true,
      marginaliaEnabled: false,
      openMode: 'tabs',
      tabPosition: 'left',
    },
    customize: ['setting-open-edit', 'setting-tab-position', 'setting-width', 'setting-theme', 'setting-hide-controls'],
    screenshot: writerShot,
  },
];
