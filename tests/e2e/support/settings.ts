import type { Page } from '@playwright/test';

// Change a setting through the Settings window the way a user would:
// open it, go to the section, pick the option, close it.
export async function chooseSetting(
  page: Page,
  section: string,
  control: string,  // the option's id, e.g. 'setting-theme'
  choice: string,   // the visible label of the option to pick, e.g. 'Light'
): Promise<void> {
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: /settings/i }).click();
  const win = page.getByRole('dialog', { name: 'Settings' });
  await win.getByRole('button', { name: section, exact: true }).click();
  await win.locator(`#${control}`).getByRole('radio', { name: choice, exact: true }).click();
  await win.getByRole('button', { name: 'Done' }).click();
}
