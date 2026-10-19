import { test, expect, type Page } from '@playwright/test';

// A file changed by another program while the user is editing it must
// never be silently overwritten.

const P = '/e2e/conflict/Plan.md';

async function startEditing(page: Page) {
  await page.goto('/');
  await page.evaluate((p) => {
    (window as any).__E2E_SEED_DOC__(p, '# Plan\n\nOriginal line.\n');
    (window as any).__E2E_QUEUE_OPENS__([p]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, P);
  await expect(page.getByRole('heading', { level: 1, name: 'Plan' })).toBeVisible();
  await page.locator('.edit-mode-toggle').click();
  const surface = page.locator('.editor-surface .ProseMirror');
  await surface.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Mine one.');
  await page.waitForTimeout(800); // first autosave lands normally
  // Another program rewrites the file.
  await page.evaluate((p) => (window as any).__E2E_SEED_DOC__(p, '# Plan\n\nTheir line.\n'), P);
  await page.keyboard.type(' Mine two.');
  await page.waitForTimeout(800);
  return surface;
}

const disk = (page: Page, p = P) =>
  page.evaluate((path) => JSON.parse(localStorage.getItem(`rmd-doc::${path}`)!).markdown as string, p);

test('the other program\'s save is not overwritten; the user is asked', async ({ page }) => {
  await startEditing(page);
  await expect(page.getByRole('alertdialog')).toContainText('changed by another program');
  expect(await disk(page)).toContain('Their line.');
});

test('keep my version overwrites with the latest edits', async ({ page }) => {
  await startEditing(page);
  await page.getByRole('button', { name: 'Keep my version' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect.poll(() => disk(page)).toContain('Mine two.');
  expect(await disk(page)).not.toContain('Their line.');
});

test('use the other version loads it into the editor and drops my edits', async ({ page }) => {
  const surface = await startEditing(page);
  await page.getByRole('button', { name: 'Use the other version' }).click();
  await expect(surface).toContainText('Their line.');
  await expect(surface).not.toContainText('Mine two.');
  await page.waitForTimeout(800);
  expect(await disk(page)).toContain('Their line.');
  // Editing continues normally afterwards.
  await page.locator('.editor-surface .ProseMirror p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' After.');
  await expect.poll(() => disk(page)).toContain('Their line. After.');
});

test('save mine as a copy keeps both versions and opens the copy', async ({ page }) => {
  await startEditing(page);
  await page.getByRole('button', { name: 'Save mine as a copy' }).click();
  const copy = '/e2e/conflict/Plan (my copy).md';
  await expect.poll(() => page.evaluate((p) => localStorage.getItem(`rmd-doc::${p}`) !== null, copy)).toBe(true);
  expect(await disk(page, copy)).toContain('Mine two.');
  expect(await disk(page)).toContain('Their line.');
  await expect(page.locator('[role="tab"] .label')).toHaveText(['Plan', 'Plan (my copy)']);
});
