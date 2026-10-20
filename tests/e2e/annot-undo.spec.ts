// Ctrl+Z / Ctrl+Y undo and redo annotation changes in the reader.
import { test, expect, type Page } from '@playwright/test';

const PATH = '/e2e/docs/undo.md';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
  await page.evaluate((p) => (window as any).__E2E_SEED_DOC__(p, '# Undo\n\nThe quick brown fox jumps over the lazy dog.\n'), PATH);
  await page.evaluate((p) => {
    (window as any).__E2E_QUEUE_OPENS__([p]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, PATH);
  await expect(page.locator('.viewer h1')).toHaveText('Undo');
});

async function highlight(page: Page, text: string) {
  await page.getByRole('radio', { name: /highlight/i }).click();
  await page.evaluate((t) => {
    const p = document.querySelector('.viewer p')!;
    const tn = p.firstChild as Text;
    const i = tn.data.indexOf(t);
    const r = document.createRange();
    r.setStart(tn, i);
    r.setEnd(tn, i + t.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, text);
  await page.getByRole('radio', { name: /cursor/i }).click();
}

const savedCount = (page: Page) =>
  page.evaluate((p) => {
    const raw = localStorage.getItem(`rmd-sidecar::${p}`);
    return raw ? (JSON.parse(raw).annotations as unknown[]).length : 0;
  }, PATH);

test('Ctrl+Z takes a highlight away again, Ctrl+Y brings it back, and saving follows', async ({ page }) => {
  await highlight(page, 'brown fox');
  await expect.poll(() => savedCount(page)).toBe(1);
  await page.locator('.viewer h1').click();
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Undone: added a highlight.')).toBeVisible();
  await expect.poll(() => savedCount(page)).toBe(0);
  await page.keyboard.press('Control+y');
  await expect(page.getByText('Redone: added a highlight.')).toBeVisible();
  await expect.poll(() => savedCount(page)).toBe(1);
});

test('nothing to undo says so', async ({ page }) => {
  await page.locator('.viewer h1').click();
  await page.keyboard.press('Control+z');
  await expect(page.getByText('Nothing to undo.')).toBeVisible();
});
