import { test, expect, type Page } from '@playwright/test';

// Tabs v2 layout, measured in a real browser: the solid title band, the
// left sidebar (pinned / collapsed / hover), nothing in edit mode hiding
// under them, and the minimap's viewport box matching what's on screen.

const A = '/e2e/layout/Alpha.md';
const B = '/e2e/layout/Beta.md';
const C = '/e2e/layout/Gamma.md';

const LONG = Array.from(
  { length: 90 },
  (_, i) => `Paragraph ${i + 1} — enough words here to wrap across a couple of lines in the reading column, so that line breaks matter.`,
).join('\n\n');
const DOCS: Record<string, string> = {
  [A]: `# Alpha\n\nThe alpha document.\n\n## Part one\n\n${LONG}\n`,
  [B]: '# Beta\n\nSecond document.\n',
  [C]: '# Gamma\n\nThird document.\n',
};

async function openViaLaunch(page: Page, paths: string[]) {
  await page.evaluate((ps) => {
    (window as any).__E2E_QUEUE_OPENS__(ps);
    (window as any).__E2E_FIRE_OPEN_REQUESTED__();
  }, paths);
}

async function setSettings(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((p) => (window as any).__E2E_SETTINGS__(p), patch);
}

const tabs = (page: Page) => page.getByRole('tab');
const h1 = (page: Page) => page.locator('.viewer h1, .editor-surface h1').first();
const rect = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((docs) => {
    for (const [p, md] of Object.entries(docs)) (window as any).__E2E_SEED_DOC__(p, md);
  }, DOCS);
});

test('with tabs on top the title band is solid and the page starts below it', async ({ page }) => {
  await openViaLaunch(page, [A, B]);
  await expect(tabs(page)).toHaveCount(2);
  const band = await rect(page, '.tab-band');
  expect(band).toMatchObject({ top: 0, left: 0, height: 40 });
  expect(band.width).toBe(1100);
  expect(await page.locator('.tab-band').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(21, 19, 31)');
  const scroll = await rect(page, '.scroll');
  expect(scroll.top).toBe(40);
  expect(scroll.left).toBe(0);
  // The active tab sits on the band's bottom edge, opening into the page.
  const active = await rect(page, '[role="tab"][aria-selected="true"]');
  expect(active.bottom).toBe(40);
  // Its accent line runs along its top edge.
  const line = await rect(page, '.tabbar .indicator');
  expect(Math.abs(line.top - active.top)).toBeLessThanOrEqual(0.5);
  expect(line.left).toBeGreaterThan(active.left);
  expect(line.right).toBeLessThan(active.right);
});

test('the band goes see-through again when tabs are not shown', async ({ page }) => {
  await setSettings(page, { openMode: 'replace' });
  await openViaLaunch(page, [A]);
  await expect(h1(page)).toHaveText('Alpha');
  await expect(page.locator('.tab-band')).toHaveCount(0);
  expect((await rect(page, '.scroll')).top).toBe(0);
});

test('tabs on the left: a sidebar switches documents and the page moves over', async ({ page }) => {
  await openViaLaunch(page, [A, B, C]);
  await page.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /settings/i }).click();
  await page.locator('#setting-tab-position').selectOption('left');
  await page.keyboard.press('Escape');

  await expect(page.locator('.tabbar')).toHaveCount(0);
  const sidebar = page.locator('.tab-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(page.locator('.tab-sidebar [role="tab"] .label')).toHaveText(['Alpha', 'Beta', 'Gamma']);
  await expect(page.locator('.tab-sidebar [role="tab"] .tab-initial')).toHaveText(['A', 'B', 'G']);
  await expect.poll(async () => (await rect(page, '.tab-sidebar')).width).toBe(200);
  expect(await rect(page, '.tab-sidebar')).toMatchObject({ top: 40, left: 0 });
  expect(await rect(page, '.scroll')).toMatchObject({ top: 40, left: 200 });

  await tabs(page).nth(0).click();
  await expect(h1(page)).toHaveText('Alpha');
  await tabs(page).nth(1).click();
  await expect(h1(page)).toHaveText('Beta');
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');

  // Collapse: initials only, the page gets the room back.
  await page.getByRole('button', { name: 'Collapse the sidebar' }).click();
  await page.mouse.move(700, 400);
  await expect.poll(async () => (await rect(page, '.tab-sidebar')).width).toBe(52);
  expect((await rect(page, '.scroll')).left).toBe(52);
  await expect(page.locator('.tab-sidebar [role="tab"] .label').first()).toHaveCSS('opacity', '0');

  // Hover opens it over the page without moving the page.
  await page.mouse.move(26, 120);
  await expect.poll(async () => (await rect(page, '.tab-sidebar')).width).toBe(200);
  expect((await rect(page, '.scroll')).left).toBe(52);
  await expect(page.locator('.tab-sidebar [role="tab"] .label').first()).toHaveCSS('opacity', '1');
  await page.mouse.move(700, 400);
  await expect.poll(async () => (await rect(page, '.tab-sidebar')).width).toBe(52);

  // Pin it open again.
  await page.getByRole('button', { name: 'Keep the sidebar open' }).click();
  await page.mouse.move(700, 400);
  await expect.poll(async () => (await rect(page, '.tab-sidebar')).width).toBe(200);
  expect((await rect(page, '.scroll')).left).toBe(200);

  // Middle-click closes a row; rows still switch afterwards.
  await tabs(page).nth(2).click({ button: 'middle' });
  await expect(page.locator('.tab-sidebar [role="tab"] .label')).toHaveText(['Alpha', 'Beta']);
});

test('right-click a tab: Close others and Close tabs to the right', async ({ page }) => {
  await openViaLaunch(page, [A, B, C]);
  await tabs(page).nth(0).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Close tabs to the right' }).click();
  await expect(page.locator('[role="tab"] .label')).toHaveText(['Alpha']);
  await expect(h1(page)).toHaveText('Alpha');

  await openViaLaunch(page, [B, C]);
  await expect(tabs(page)).toHaveCount(3);
  await tabs(page).nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Close others' }).click();
  await expect(page.locator('[role="tab"] .label')).toHaveText(['Beta']);
  await expect(h1(page)).toHaveText('Beta');

  await tabs(page).nth(0).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show in folder' }).click();
  expect(await page.evaluate(() => (window as any).__E2E_REVEALED__)).toEqual([B]);
});

test('reader mode hides the band and the sidebar and gives the page the whole window', async ({ page }) => {
  await setSettings(page, { tabPosition: 'left' });
  await openViaLaunch(page, [A, B]);
  await expect(page.locator('.tab-sidebar')).toBeVisible();
  await page.locator('.reader-mode-toggle').click();
  await expect(page.locator('.tab-sidebar')).toBeHidden();
  await expect(page.locator('.tab-band')).toBeHidden();
  expect(await rect(page, '.scroll')).toMatchObject({ top: 0, left: 0 });
});

// The coordinator's 0.7.0 bug: in edit mode the formatting toolbar sat under
// the tab bar. Nothing in edit mode may start above the band or under the
// sidebar — before or after scrolling (the toolbar is sticky).
for (const position of ['top', 'left'] as const) {
  test(`edit mode toolbar is fully visible below the tabs (${position})`, async ({ page }) => {
    await setSettings(page, { tabPosition: position });
    await openViaLaunch(page, [A, B]);
    await tabs(page).nth(0).click();
    await expect(h1(page)).toHaveText('Alpha');
    await page.locator('.edit-mode-toggle').click();
    const toolbar = page.locator('.editor-toolbar');
    await expect(toolbar).toBeVisible();

    for (const scrolled of [false, true]) {
      if (scrolled) {
        await page.locator('.scroll').evaluate((el) => { el.scrollTop = 1500; });
        await page.waitForTimeout(100);
      }
      const bar = await rect(page, '.editor-toolbar');
      const chrome = position === 'top' ? ['.tab-band', '.tabbar'] : ['.tab-band', '.tab-sidebar'];
      for (const sel of chrome) {
        const c = await rect(page, sel);
        const overlaps = bar.left < c.right && bar.right > c.left && bar.top < c.bottom && bar.bottom > c.top;
        expect(overlaps, `${sel} overlaps the toolbar (scrolled: ${scrolled})`).toBe(false);
      }
      // Every toolbar button is what you'd click at its centre.
      const blocked = await page.locator('.editor-toolbar .toolbar-btn, .editor-toolbar summary').evaluateAll((btns) =>
        btns
          .filter((b) => {
            const r = b.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !hit || !b.contains(hit);
          })
          .map((b) => b.textContent?.trim()),
      );
      expect(blocked, `covered buttons (scrolled: ${scrolled})`).toEqual([]);
    }
  });
}

// The minimap's highlighted box must stand for exactly the visible part of
// the page: map its edges back through the clone's scale and position and
// compare with the scroll container's visible range, within 1px on the map.
const MINIMAP_CASES = [
  ...(['top', 'left'] as const).flatMap((position) => [1, 1.5].map((zoom) => ({ position, zoom, articleWidth: 720 }))),
  // A narrower reading column than the default: the clone must follow it.
  { position: 'top' as const, zoom: 1, articleWidth: 560 },
];
for (const { position, zoom, articleWidth } of MINIMAP_CASES) {
  test(`minimap box matches the visible page (${position}, zoom ${zoom}, width ${articleWidth})`, async ({ page }) => {
    await setSettings(page, { tabPosition: position, articleWidth });
    await page.evaluate((w) => document.documentElement.style.setProperty('--article-width', `${w}px`), articleWidth);
    await openViaLaunch(page, [B, A]);
    await expect(h1(page)).toHaveText('Alpha');
    if (zoom === 1.5) {
      for (let i = 0; i < 3; i++) await page.keyboard.press('Control+=');
      await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--zoom').trim())).toBe('1.5');
    }
    await page.waitForTimeout(500); // minimap snapshot debounce + layout

    const scroller = page.locator('.scroll');
    const max = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(max).toBeGreaterThan(2000);
    for (const f of [0, 0.2, 0.5, 0.8, 1]) {
      await scroller.evaluate((el, top) => { el.scrollTop = top; }, Math.round(max * f));
      await page.waitForTimeout(80);
      const m = await page.evaluate(() => {
        const scroll = document.querySelector('.scroll') as HTMLElement;
        const article = document.querySelector('.viewer') as HTMLElement;
        const clone = document.querySelector('.minimap-content') as HTMLElement;
        const box = document.querySelector('.viewport-indicator') as HTMLElement;
        const sr = scroll.getBoundingClientRect();
        const ar = article.getBoundingClientRect();
        const cr = clone.getBoundingClientRect();
        const br = box.getBoundingClientRect();
        const scale = cr.width / ar.width;
        // The page you can see, in article coordinates.
        const visTop = sr.top - ar.top;
        const visBottom = visTop + scroll.clientHeight;
        // A line deep in the document sits at the same (scaled) place in
        // the clone — the clone wraps exactly like the article.
        const p = article.querySelectorAll('p')[60];
        const cp = clone.querySelectorAll('p')[60];
        return {
          boxTop: br.top,
          boxBottom: br.bottom,
          wantTop: cr.top + visTop * scale,
          wantBottom: cr.top + visBottom * scale,
          cloneHeight: cr.height,
          articleHeightScaled: ar.height * scale,
          pArticle: (p.getBoundingClientRect().top - ar.top) * scale,
          pClone: cp.getBoundingClientRect().top - cr.top,
          visibleTop: sr.top,
        };
      });
      const at = `(${position}, zoom ${zoom}, ${Math.round(f * 100)}%)`;
      expect(m.visibleTop, `page starts below the band ${at}`).toBe(40);
      expect(Math.abs(m.cloneHeight - m.articleHeightScaled), `clone height ${at}`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.pClone - m.pArticle), `line position ${at}`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.boxTop - m.wantTop), `box top ${at}`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.boxBottom - m.wantBottom), `box bottom ${at}`).toBeLessThanOrEqual(1);
    }
  });
}
