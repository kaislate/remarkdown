// Code colours follow the page: GitHub's dark colouring on dark pages,
// its light one on light pages and light reader themes — in the reader
// and in the editor alike.
import type { Page } from '@playwright/test';
import { test, expect } from './support/test';

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

test('a document without code: edit mode loads no highlighter until a code block appears', async ({ page }) => {
  const shiki: string[] = [];
  page.on('request', (r) => {
    const name = r.url().split('/').pop() ?? '';
    if (/^(wasm|github-dark|github-light)-/.test(name)) shiki.push(name);
  });
  await page.addInitScript(() => {
    localStorage.setItem('rmd-settings', JSON.stringify({ schemaVersion: 1, onboardingCompleted: true, theme: 'dark' }));
  });
  await page.goto('/');
  const path = '/e2e/docs/plain.md';
  await page.evaluate(([p, md]) => (window as any).__E2E_SEED_DOC__(p, md), [path, '# Plain\n\nJust words.\n']);
  await page.evaluate((p) => {
    (window as any).__E2E_QUEUE_OPENS__([p]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, path);
  await expect(page.locator('.viewer h1')).toHaveText('Plain');
  await page.locator('.edit-mode-toggle').click();
  const para = page.locator('.editor-surface .ProseMirror p', { hasText: 'Just words.' });
  await para.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' More.');
  await page.waitForTimeout(500);
  expect(shiki).toEqual([]);
  // The first code block starts the highlighter, and its code is coloured.
  await page.evaluate(() => {
    (document.querySelector('.toolbar-btn[data-action="code"]') as HTMLElement | null)?.click();
  });
  await expect(page.locator('.editor-surface pre')).toBeVisible();
  await page.keyboard.type('function add(a, b) {}');
  await page.locator('.editor-surface .code-block-lang-pill').click();
  await page.locator('.code-block-lang-option', { hasText: /^javascript$/ }).click();
  await expect(keyword(page, '.editor-surface')).toHaveCSS('color', DARK);
  expect(shiki.some((n) => n.startsWith('wasm-'))).toBe(true);
});
