import { test, expect } from '@playwright/test';

const FIXTURE_PATH = '/e2e/edit-mode-fixture.md';
const FIXTURE_MD = `# Hello\n\nFirst paragraph.\n`;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
  await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
  await page.evaluate(
    ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
    [FIXTURE_PATH, FIXTURE_MD],
  );
  await page.evaluate(
    (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
    FIXTURE_PATH,
  );
  // Open the doc via the hamburger menu so the editor sees a loaded doc.
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();
});

test.describe('edit mode round-trip', () => {
  test('toggle on → contenteditable PM surface visible', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    await expect(page.locator('.editor-surface .ProseMirror')).toBeVisible();
    await expect(page.locator('.editor-surface h1')).toHaveText('Hello');
  });

  test('typing flows back to disk after debounce', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    const surface = page.locator('.editor-surface .ProseMirror');
    await surface.click();
    // Append text at the end of the paragraph.
    await page.keyboard.press('End');
    await page.keyboard.type(' edited');
    // Wait for autosave debounce (default 500ms) to fire.
    await page.waitForTimeout(800);
    const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ path: string; markdown: string }>);
    expect(writes.length).toBeGreaterThan(0);
    const last = writes[writes.length - 1];
    expect(last.path).toBe(FIXTURE_PATH);
    expect(last.markdown).toContain('edited');
  });

  test('toggle off → article view returns', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    await expect(page.locator('.editor-surface .ProseMirror')).toBeVisible();
    await page.locator('.edit-mode-toggle').click();
    // Wait for the editor to unmount and the article to render.
    await expect(page.locator('.editor-surface')).toHaveCount(0);
    await expect(page.locator('article.viewer h1')).toHaveText('Hello');
  });
});
