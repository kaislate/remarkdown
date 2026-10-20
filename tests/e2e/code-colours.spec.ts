// Code colours follow the page: GitHub's dark colouring on dark pages,
// its light one on light pages and light reader themes — in the reader
// and in the editor alike.
import { test, expect, type Page } from '@playwright/test';

const PATH = '/e2e/docs/code.md';
const MD = '# Code\n\n```js\nfunction add(a, b) {\n  return a + b;\n}\n```\n';
// The colour of `function` (a keyword) in each colouring.
const DARK = 'rgb(249, 117, 131)';
const LIGHT = 'rgb(215, 58, 73)';

async function open(page: Page, settings: Record<string, unknown>) {
  await page.addInitScript((s) => {
    localStorage.setItem('rmd-settings', JSON.stringify({ schemaVersion: 1, onboardingCompleted: true, ...s }));
  }, settings);
  await page.goto('/');
  await page.evaluate(([p, md]) => (window as any).__E2E_SEED_DOC__(p, md), [PATH, MD]);
  await page.evaluate((p) => {
    (window as any).__E2E_QUEUE_OPENS__([p]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, PATH);
  await expect(page.locator('.viewer h1')).toHaveText('Code');
}

const keyword = (page: Page, scope: string) =>
  page.locator(`${scope} pre span`, { hasText: /^function$/ }).first();

test('dark theme: the dark colouring', async ({ page }) => {
  await open(page, { theme: 'dark' });
  await expect(keyword(page, '.viewer')).toHaveCSS('color', DARK);
});

test('light theme: the light colouring, on the page\'s own shade — in the reader and the editor', async ({ page }) => {
  await open(page, { theme: 'light' });
  await expect(keyword(page, '.viewer')).toHaveCSS('color', LIGHT);
  const bg = await page.locator('.viewer pre.shiki').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgb(36, 41, 46)'); // not github-dark's box
  await page.locator('.edit-mode-toggle').click();
  await expect(keyword(page, '.editor-surface')).toHaveCSS('color', LIGHT);
});

test('a light reader theme over the dark app: light colouring while reading', async ({ page }) => {
  await open(page, { theme: 'dark', readerTheme: 'paper' });
  await page.locator('.reader-mode-toggle').click();
  await expect(page.locator('body')).toHaveClass(/reader-mode/);
  await expect(keyword(page, '.viewer')).toHaveCSS('color', LIGHT);
});
