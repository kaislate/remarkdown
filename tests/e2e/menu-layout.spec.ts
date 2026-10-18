import { test, expect, type Locator } from '@playwright/test';

// Regression for GitHub #23: the hamburger popover opened directly
// underneath the left-hand round buttons (edit / contents / focus),
// which sat at an equal-or-higher z-index and painted over the menu
// items. The popover now opens to the right of that button column and
// above it in the stacking order.

const FIXTURE_PATH = '/e2e/menu-layout-fixture.md';
const FIXTURE_MD = `# Menu layout\n\nSome text.\n`;

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('element has no bounding box');
  return b;
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).__E2E_CLEAR_ALL__?.());
  await page.evaluate(
    ([path, md]) => (window as any).__E2E_SEED_DOC__?.(path, md),
    [FIXTURE_PATH, FIXTURE_MD],
  );
  await page.evaluate((path) => (window as any).__E2E_SET_DIALOG_PATH__?.(path), FIXTURE_PATH);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /open…/i }).click({ force: true });
  await page.getByRole('heading', { level: 1 }).waitFor();
});

test('menu popover does not overlap the left-hand round buttons', async ({ page }) => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  const popover = page.locator('.menu-root .popover');
  await expect(popover).toBeVisible();
  // Let the entrance animation settle before measuring.
  await page.waitForTimeout(400);
  const menuBox = await box(popover);

  for (const sel of ['.edit-mode-toggle', '.toc-button', '.reader-mode-toggle']) {
    const btn = page.locator(sel).first();
    if (!(await btn.isVisible())) continue;
    expect(intersects(menuBox, await box(btn)), `${sel} overlaps the menu`).toBe(false);
  }
});

test('every menu item is the topmost element at its own centre', async ({ page }) => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.waitForTimeout(400);
  const items = page.locator('.menu-root .popover [role="menuitem"]');
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const hit = await items.nth(i).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (top === el || el.contains(top));
    });
    expect(hit, `menu item ${i} is covered by another element`).toBe(true);
  }
});

test('round buttons sit under the dimmed backdrop while the menu is open', async ({ page }) => {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.waitForTimeout(400);
  const btn = page.locator('.edit-mode-toggle').first();
  const covered = await btn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && top.classList.contains('menu-overlay');
  });
  expect(covered).toBe(true);
});
