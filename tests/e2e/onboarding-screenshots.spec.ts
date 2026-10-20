import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Generates the real screenshots shown on the first-run profile cards
// (src/assets/onboarding/*.jpg). Skipped in normal runs; regenerate after
// visual changes with:
//   GENERATE_ONBOARDING_SHOTS=1 npx playwright test onboarding-screenshots

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/assets/onboarding');
const PATH = '/Documents/Field notes on slow reading.md';
const DOC = `# Field notes on slow reading

Most of what we read is built to be skimmed. Headlines, summaries and bullet points are designed so the eye can slide past and still collect the gist.

Some writing doesn't survive that treatment. An argument that builds over several pages, a poem, a set of instructions with one important exception: these ask for attention one sentence at a time.

## Three habits worth keeping

- Read the first paragraph twice before going on.
- Stop at the end of each section and say, in a sentence, what it claimed.
- Mark the places you disagree with, not just the ones you like.

> The reader who would truly understand a passage must read slowly, and with care, turning the pages back when needed.

## Why it matters

Speed is a fine thing for a timetable. For an argument, it is mostly a way of arriving at the end without having been anywhere. Slowing down is not about reading less; it is about letting each idea finish before the next one starts.
`;

const now = '2026-10-19T09:00:00Z';
// Block ids are `kind:index` over top-level blocks (MarkdownRenderer):
// h1:1 p:2 p:3 h2:4 ul:5 bq:6 h2:7 p:8.
const ANNOTATIONS = [
  { id: 'h1', type: 'highlight', color: '#ffd25a', anchor: { text: 'ask for attention one sentence at a time', prefix: '', suffix: '', blockHint: 'p:3' }, createdAt: now, updatedAt: now },
  { id: 'h2', type: 'highlight', color: '#7ee7a8', anchor: { text: 'Mark the places you disagree with', prefix: '', suffix: '', blockHint: 'ul:5' }, createdAt: now, updatedAt: now },
  { id: 'n1', type: 'note', anchor: { text: 'skimmed', prefix: '', suffix: '', blockHint: 'p:2' }, body: 'True of most of my inbox.', createdAt: now, updatedAt: now },
  { id: 'n2', type: 'note', anchor: { text: 'letting each idea finish', prefix: '', suffix: '', blockHint: 'p:8' }, body: 'Good line for the talk.', createdAt: now, updatedAt: now },
];

const PROFILE_SETTINGS: Record<string, Record<string, unknown>> = {
  reader: { openInFocusMode: true, openInEditMode: false, readerTheme: 'textured', hideAnnotationControls: true, marginaliaEnabled: false, tabPosition: 'top' },
  annotator: { openInFocusMode: false, openInEditMode: false, hideAnnotationControls: false, marginaliaEnabled: true, tabPosition: 'top' },
  writer: { openInEditMode: true, openInFocusMode: false, hideAnnotationControls: true, marginaliaEnabled: false, openMode: 'tabs', tabPosition: 'left' },
};

for (const [id, overrides] of Object.entries(PROFILE_SETTINGS)) {
  test(`onboarding screenshot: ${id}`, async ({ page }) => {
    test.skip(!process.env.GENERATE_ONBOARDING_SHOTS, 'set GENERATE_ONBOARDING_SHOTS=1 to regenerate');
    await page.setViewportSize({ width: 1500, height: 940 });
    await page.addInitScript(([path, md, annots, settings]) => {
      const bytes = new TextEncoder().encode(md as string);
      localStorage.setItem(`rmd-doc::${path}`, JSON.stringify({ markdown: md, sidecar_raw: null, sha256: '5'.repeat(64), bytes: bytes.length }));
      localStorage.setItem(`rmd-sidecar::${path}`, JSON.stringify({
        $schema: 'remarkdown/v1',
        document: { path, sha256: '5'.repeat(64), lastSeenBytes: bytes.length },
        annotations: annots,
      }));
      localStorage.setItem('rmd-settings', JSON.stringify({
        schemaVersion: 1, splashEnabled: false, onboardingCompleted: true, dontShowWelcomeOnLaunch: true, ...(settings as object),
      }));
      (window as any).__E2E_PENDING_OPENS__ = [path];
    }, [PATH, DOC, ANNOTATIONS, overrides]);
    await page.goto('/');
    await expect(page.locator('h1:visible').first()).toBeVisible();
    // Highlights, notes and the minimap settle; reader mode's "Press Esc"
    // hint has faded (it shows for 2.5s on entry).
    await page.waitForTimeout(id === 'reader' ? 3400 : 1200);
    await page.screenshot({ path: `${OUT}/${id}.jpg`, type: 'jpeg', quality: 82 });
  });
}
