import { test, expect } from './support/test';

test('app loads and shows empty reader state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Open a markdown file/i)).toBeVisible();
});
