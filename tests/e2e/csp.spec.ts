import { test, expect } from './support/test';
import { appCsp } from './support/csp';

// The suite runs under the app's Content Security Policy (support/csp.ts),
// and support/test.ts fails a test whose page breaks it. These make sure
// both are really there, so a passing suite means the policy holds.

test('the page carries the app CSP', async ({ page }) => {
  await page.goto('/');
  const meta = page.locator('meta[http-equiv="Content-Security-Policy"]');
  await expect(meta).toHaveAttribute('content', appCsp());
  await expect(page.getByText(/Open a markdown file/i)).toBeVisible();
});

// The guard's own check: what the policy blocks is reported, directive and
// all. Each test clears the list afterwards, or the guard would fail it.
test('an inline script is blocked and reported', async ({ page, cspViolations }) => {
  await page.goto('/');
  await expect(page.getByText(/Open a markdown file/i)).toBeVisible();
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__ran = true;';
    document.body.append(s);
  });
  await expect.poll(() => cspViolations.length).toBe(1);
  expect(cspViolations[0]).toMatch(/^script-src(-elem)? blocked inline/);
  expect(await page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran)).toBeUndefined();
  cspViolations.length = 0;
});

test('a request to an unlisted host is blocked and reported, in a page of its own', async ({ browser, cspViolations }) => {
  const page = await browser.newPage();
  await page.goto('/');
  await expect(page.getByText(/Open a markdown file/i)).toBeVisible();
  const failed = await page.evaluate(() => fetch('https://example.com/exfiltrate').then(() => false, () => true));
  expect(failed).toBe(true);
  await expect.poll(() => cspViolations.length).toBe(1);
  expect(cspViolations[0]).toMatch(/^connect-src blocked https:\/\/example\.com\/exfiltrate/);
  cspViolations.length = 0;
  await page.close();
});
