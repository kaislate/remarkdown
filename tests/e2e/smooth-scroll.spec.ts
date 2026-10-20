import { test, expect, type Page } from '@playwright/test';

// Edge-style smooth scrolling, in a real browser: a wheel notch sets the
// page gliding — most of the way in the first moments, then easing to a
// stop — and lands exactly 1/8 of the page further on; notches add up.

const PATH = '/e2e/smooth/Long.md';
const DOC = '# Long\n\n' + Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}. ` + 'Words to read along the way. '.repeat(8)).join('\n\n');

async function open(page: Page) {
  await page.goto('/');
  await page.evaluate(([p, md]) => {
    (window as any).__E2E_SEED_DOC__(p, md);
    (window as any).__E2E_QUEUE_OPENS__([p]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, [PATH, DOC]);
  await expect(page.locator('.viewer h1')).toHaveText('Long');
  await page.mouse.move(550, 400);
}

const top = (page: Page) => page.locator('.scroll').evaluate((el) => el.scrollTop);
const step = (page: Page) => page.locator('.scroll').evaluate((el) => Math.max(16, el.clientHeight / 8));

test('a wheel notch glides 1/8 of the page, fast at first then easing to a stop', async ({ page }) => {
  await open(page);
  const want = await step(page);
  // Sample the glide every frame from inside the page.
  const samples = page.evaluate(() => new Promise<number[]>((resolve) => {
    const el = document.querySelector('.scroll') as HTMLElement;
    const out: number[] = [];
    const start = performance.now();
    const tick = () => {
      out.push(el.scrollTop);
      if (performance.now() - start < 700) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }));
  await page.mouse.wheel(0, 100);
  const s = await samples;
  const end = s[s.length - 1];
  expect(Math.abs(end - want)).toBeLessThanOrEqual(1);
  // It moved over several frames, not in one jump…
  const moving = s.filter((v) => v > 0.5 && v < end - 0.5);
  expect(moving.length).toBeGreaterThanOrEqual(4);
  // …and most of the distance went by in the first part of the glide.
  const firstMoving = s.findIndex((v) => v > 0.5);
  expect(s[firstMoving + Math.floor(moving.length / 3)]).toBeGreaterThan(end * 0.5);
  // Never past the target, never backwards.
  for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1] - 0.01);
  expect(Math.max(...s)).toBeLessThanOrEqual(end + 0.5);
});

test('quick notches add up into one glide', async ({ page }) => {
  await open(page);
  const want = await step(page);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(40);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(40);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => top(page)).toBeGreaterThan(want * 3 - 1);
  await page.waitForTimeout(300);
  expect(Math.abs((await top(page)) - want * 3)).toBeLessThanOrEqual(1);
});

test('Page Down glides most of a page', async ({ page }) => {
  await open(page);
  await page.locator('.viewer p').nth(2).click();
  const h = await page.locator('.scroll').evaluate((el) => el.clientHeight);
  await page.keyboard.press('PageDown');
  await expect.poll(async () => Math.abs((await top(page)) - h * 0.875)).toBeLessThanOrEqual(1);
});

test('turned off, the wheel scrolls the usual way', async ({ page }) => {
  await open(page);
  await page.evaluate(() => (window as any).__E2E_SETTINGS__({ smoothScrolling: false }));
  const want = await step(page);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(600);
  const t = await top(page);
  expect(t).toBeGreaterThan(0);
  expect(Math.abs(t - want)).toBeGreaterThan(1); // the browser's own 100px, not 1/8 of the page
});
