import { test, expect } from '@playwright/test';

test('a fresh install asks how you want to use remarkdown, once', async ({ page }) => {
  await page.addInitScript(() => { (window as any).__E2E_FRESH_INSTALL__ = true; });
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'How do you want to use remarkdown?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radiogroup', { name: 'How do you want to use remarkdown?' }).getByRole('radio')).toHaveCount(3);
  await expect(dialog.getByRole('radiogroup', { name: 'Reader mode colours' }).getByRole('radio')).toHaveCount(5);
  for (const img of await dialog.locator('img').all()) {
    expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await dialog.getByRole('radio', { name: /Writer/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rmd-settings') ?? '{}'))).toMatchObject({
    onboardingCompleted: true,
    openInEditMode: true,
  });
  await page.reload();
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog', { name: 'How do you want to use remarkdown?' })).toHaveCount(0);
});

test('people updating from 0.7 are asked too, once', async ({ page }) => {
  // A 0.7 settings file: no onboardingCompleted at all.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('rmd-settings', JSON.stringify({ schemaVersion: 1, theme: 'dark', openMode: 'tabs' }));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'How do you want to use remarkdown?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Skip for now' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rmd-settings') ?? '{}').onboardingCompleted)).toBe(true);
  await page.reload();
  await page.waitForTimeout(500);
  await expect(dialog).toHaveCount(0);
});

test('once answered, it stays in Settings', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(400);
  await expect(page.getByRole('dialog', { name: 'How do you want to use remarkdown?' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /settings/i }).click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a starting layout…' }).click();
  await expect(page.getByRole('dialog', { name: 'How do you want to use remarkdown?' })).toBeVisible();
});
