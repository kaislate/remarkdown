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

test.describe('edit mode — callouts', () => {
  const CALLOUT_FIXTURE_PATH = '/e2e/edit-callout-fixture.md';
  const CALLOUT_FIXTURE_MD = `# Callouts\n\n> [!info]\n> Existing callout body.\n\nA paragraph after.\n`;

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
    await page.evaluate(() => { (window as any).__E2E_WRITES__ = []; });
    await page.evaluate(
      ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
      [CALLOUT_FIXTURE_PATH, CALLOUT_FIXTURE_MD],
    );
    await page.evaluate(
      (path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path),
      CALLOUT_FIXTURE_PATH,
    );
    await page.getByRole('button', { name: /menu/i }).click();
    await page.getByRole('menuitem', { name: /open…/i }).click();
    await page.getByRole('heading', { level: 1 }).waitFor();
  });

  test('toggle on → existing callout renders as styled .callout (not plain blockquote)', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    await expect(page.locator('.editor-surface .ProseMirror .callout.callout-info')).toBeVisible();
  });

  test('insert-callout button wraps a paragraph and saves with [!info] syntax', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    // Click into the trailing paragraph "A paragraph after."
    const para = page.locator('.editor-surface .ProseMirror p', { hasText: 'A paragraph after.' });
    await para.click();
    await page.keyboard.press('End');
    // The toolbar button sits behind the fixed menu-root nav bar (z-index:100).
    // Playwright's locator.click({ force:true }) dispatches a full
    // mousedown+mouseup+click sequence, which blurs the ProseMirror editor and
    // clears its selection even with onmousedown:preventDefault on the button.
    // Using the DOM's native .click() fires only the click event without a
    // preceding mousedown, so the PM selection is preserved when the toolbar
    // handler runs.
    await page.evaluate(() => {
      (document.querySelector('.toolbar-btn[data-action="insert-callout"]') as HTMLElement | null)?.click();
    });
    await page.waitForTimeout(800);
    const writes = await page.evaluate(() => (window as any).__E2E_WRITES__ as Array<{ path: string; markdown: string }>);
    expect(writes.length).toBeGreaterThan(0);
    const last = writes[writes.length - 1];
    // Should now contain TWO callouts in the file.
    expect((last.markdown.match(/\[!info\]/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test('toggle off → article view shows callouts styled', async ({ page }) => {
    await page.locator('.edit-mode-toggle').click();
    await expect(page.locator('.editor-surface .ProseMirror .callout.callout-info')).toBeVisible();
    await page.locator('.edit-mode-toggle').click();
    await expect(page.locator('article.viewer .callout.callout-info')).toBeVisible();
  });
});
