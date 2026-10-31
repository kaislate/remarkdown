import { test, expect, type Page } from '@playwright/test';

// Picking a heading from the contents: the marker slides to it, the page
// glides there, and a drop of ink runs from the contents to the heading.

const PATH = '/e2e/toc/Chapters.md';
const PARA = 'Words to read along the way, enough to fill a few lines of the column. '.repeat(6);
const DOC = '# Chapters\n\n' + Array.from({ length: 8 }, (_, i) => `## Chapter ${i + 1}\n\n${PARA}\n\n${PARA}\n\n${PARA}\n`).join('\n');

async function open(page: Page, settings: Record<string, unknown> = {}) {
  await page.goto('/');
  await page.evaluate(([p, md, s]) => {
    (window as any).__E2E_SETTINGS__(s);
    (window as any).__E2E_SEED_DOC__(p, md);
    (window as any).__E2E_QUEUE_OPENS__([p]);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, [PATH, DOC, settings] as const);
  await expect(page.locator('.viewer h1')).toHaveText('Chapters');
}

// Records scrollTop every frame for `ms`, and whether ink was on screen.
function record(page: Page, ms: number) {
  return page.evaluate((ms) => new Promise<{ tops: number[]; inkFrames: number }>((resolve) => {
    const el = document.querySelector('.scroll') as HTMLElement;
    const tops: number[] = [];
    let inkFrames = 0;
    const t0 = performance.now();
    const tick = () => {
      tops.push(el.scrollTop);
      if (document.querySelector('.ink-layer circle')) inkFrames++;
      if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve({ tops, inkFrames });
    };
    requestAnimationFrame(tick);
  }), ms);
}

// Whether the contents' marker is level with `entry`.
const markerOn = (page: Page, entry: string) => page.evaluate((entry) => {
  const m = document.querySelector('.toc-popover .marker') as HTMLElement | null;
  const li = (Array.from(document.querySelectorAll('.toc-popover li')) as HTMLElement[]).find((l) => l.textContent?.trim() === entry);
  return !!m && !!li && Math.abs(m.offsetTop - li.offsetTop) <= 1;
}, entry);

const headingTop = (page: Page, name: string) => page.evaluate((name) => {
  const h = Array.from(document.querySelectorAll('.viewer h2')).find((x) => x.textContent === name)!;
  return h.getBoundingClientRect().top - document.querySelector('.scroll')!.getBoundingClientRect().top;
}, name);

test('from the contents: the marker slides to the entry, the page glides there, and ink runs to the heading', async ({ page }) => {
  // The glide, the ink and the list closing run on the page's clock, which
  // is held here and stepped, so they are sampled every frame however fast
  // the machine draws. The marker's slide is a CSS transition on the real
  // clock; the list's closing is what it races, and a held clock keeps
  // that race out of the test.
  await page.clock.install();
  await open(page);
  await page.getByRole('button', { name: 'Open table of contents' }).click();
  const pop = page.getByRole('dialog', { name: 'Table of contents' });
  const entry = pop.getByRole('button', { name: 'Chapter 6' });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const rec = record(page, 2200);
  await entry.click();
  // The marker slides all the way to the picked entry…
  await expect.poll(() => markerOn(page, 'Chapter 6')).toBe(true);
  // …and the list stays open at least as long as that slide takes.
  const slideMs = await page.locator('.toc-popover .marker').evaluate((m) =>
    Math.max(...getComputedStyle(m).transitionDuration.split(',').map((d) => parseFloat(d) * (/ms\s*$/.test(d) ? 1 : 1000))));
  expect(slideMs).toBeGreaterThan(0);
  await page.clock.runFor(slideMs);
  await expect(pop).toBeVisible();
  await page.clock.runFor(2200);
  const { tops, inkFrames } = await rec;
  // Glided: many distinct positions on the way, never back up.
  expect(new Set(tops.map((t) => Math.round(t))).size).toBeGreaterThan(8);
  for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1] - 0.5);
  // Arrived with the heading near the top.
  // (Below the tabs, which float over the page.)
  expect(Math.abs((await headingTop(page, 'Chapter 6')) - 72)).toBeLessThanOrEqual(2);
  // The ink was on screen for a good part of it, and has gone again.
  expect(inkFrames).toBeGreaterThan(10);
  await page.clock.resume();
  await expect(page.locator('.ink-layer')).toHaveCount(0, { timeout: 3000 });
  await expect(pop).toHaveCount(0);
});

test('with both turned off it just jumps, no ink', async ({ page }) => {
  await open(page, { tocGlide: false, tocInk: false });
  await page.getByRole('button', { name: 'Open table of contents' }).click();
  const rec = record(page, 400);
  await page.getByRole('dialog', { name: 'Table of contents' }).getByRole('button', { name: 'Chapter 6' }).click();
  const { tops, inkFrames } = await rec;
  expect(inkFrames).toBe(0);
  const moving = tops.filter((t) => t > 1 && t < tops[tops.length - 1] - 1);
  expect(moving.length).toBe(0);
  expect(Math.abs((await headingTop(page, 'Chapter 6')) - 72)).toBeLessThanOrEqual(2);
});

test('reader mode contents: the marker goes straight to the picked heading, not through the ones passed', async ({ page }) => {
  await open(page, { readerNav: 'left' });
  await page.locator('.reader-mode-toggle').click();
  const nav = page.getByRole('navigation', { name: 'Contents' });
  await expect(nav).toBeVisible();
  const seen = page.evaluate(() => new Promise<string[]>((resolve) => {
    const out: string[] = [];
    const t0 = performance.now();
    const tick = () => {
      const cur = document.querySelector('.reader-contents a[aria-current]')?.textContent ?? '';
      if (out[out.length - 1] !== cur) out.push(cur);
      if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }));
  await nav.getByRole('link', { name: 'Chapter 7' }).click();
  // From where it was, straight to the picked one, and it stays there.
  const order = await seen;
  expect(order.slice(1)).toEqual(['Chapter 7']);
});
