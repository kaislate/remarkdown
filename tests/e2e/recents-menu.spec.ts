import { test, expect, type Page } from '@playwright/test';

const A = '/e2e/recents/Alpha.md';
const B = '/e2e/recents/Beta.md';

async function setup(page: Page) {
  // Seed documents, the recents list and a launch file before the app loads.
  await page.addInitScript(([a, b]) => {
    const doc = (md: string) => JSON.stringify({ markdown: md, sidecar_raw: null, sha256: md.length.toString(16).padStart(64, '0'), bytes: md.length });
    localStorage.setItem(`rmd-doc::${a}`, doc('# Alpha\n'));
    localStorage.setItem(`rmd-doc::${b}`, doc('# Beta\n'));
    localStorage.setItem('rmd-recent', JSON.stringify([b, a]));
    (window as any).__E2E_PENDING_OPENS__ = [a];
  }, [A, B]);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Alpha' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  return page.getByRole('menuitem', { name: /^Beta\.md/ });
}

test('middle-clicking a recent file opens it in a new tab', async ({ page }) => {
  const row = await setup(page);
  await row.click({ button: 'middle' });
  await expect(page.locator('[role="tab"] .label')).toHaveText(['Alpha', 'Beta']);
  await expect(page.getByRole('heading', { level: 1, name: 'Beta' })).toBeVisible();
});

test('right-click menu sits above the hamburger menu and its actions work', async ({ page }) => {
  const row = await setup(page);
  await row.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: /Beta\.md actions/ });
  await expect(menu).toBeVisible();
  const item = menu.getByRole('menuitem', { name: 'Show in folder' });
  const topmost = await item.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
  expect(topmost).toBe(true);
  if (process.env.SHOT_DIR) { await page.waitForTimeout(300); await page.screenshot({ path: `${process.env.SHOT_DIR}/recents-menu.png`, clip: { x: 0, y: 0, width: 640, height: 640 } }); }
  await item.click();
  expect(await page.evaluate(() => (window as any).__E2E_REVEALED__)).toEqual(['/e2e/recents/Beta.md']);
  await expect(menu).toHaveCount(0);
});
