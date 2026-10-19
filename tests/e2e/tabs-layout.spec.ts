import { chooseSetting } from './support/settings';
import { test, expect, type Page } from '@playwright/test';

// Tabs layout, measured in a real browser: tabs on the window's own
// background (no title band), the left sidebar (pinned / collapsed / hover),
// nothing in edit mode hiding under them, and the minimap's viewport box
// matching what's on screen.

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

// Tabs sit on the window's own background: no title band, and the menu
// button, wordmark and pre-release tag look and sit exactly as they do
// without tabs. The page keeps the whole window.
test('with tabs on top there is no title band and the menu and wordmark are unchanged', async ({ page }) => {
  await setSettings(page, { openMode: 'replace' });
  await openViaLaunch(page, [A]);
  await expect(h1(page)).toHaveText('Alpha');
  const menuBefore = await rect(page, '.hamburger');
  const markBefore = await rect(page, '.wordmark');

  await setSettings(page, { openMode: 'tabs' });
  await openViaLaunch(page, [B]);
  await expect(tabs(page)).toHaveCount(2);
  await expect(page.locator('.tab-band')).toHaveCount(0);
  expect(await rect(page, '.hamburger')).toEqual(menuBefore);
  expect(await rect(page, '.wordmark')).toEqual(markBefore);
  expect(await rect(page, '.scroll')).toMatchObject({ top: 0, left: 0 });

  // The tabs share the menu button's line.
  const active = await rect(page, '[role="tab"][aria-selected="true"]');
  const menuMid = menuBefore.top + menuBefore.height / 2;
  expect(Math.abs(active.top + active.height / 2 - menuMid)).toBeLessThanOrEqual(1.5);
  // A short accent line under the active tab's name (once it has slid there).
  await expect.poll(async () => {
    const line = await rect(page, '.tabbar .indicator');
    return line.bottom <= active.bottom && line.bottom >= active.bottom - 4 && line.left > active.left && line.right < active.right;
  }).toBe(true);
  // Clear of the wordmark even when it unfolds to "remarkdown" on hover.
  await page.locator('.hamburger').hover();
  await page.waitForTimeout(400);
  const first = await rect(page, '[role="tab"]');
  expect((await rect(page, '.wordmark')).right).toBeLessThan(first.left);

  // Nothing behind the tabs at the top of the page; a fade once it scrolls.
  await expect(page.locator('.tab-haze')).toHaveCSS('opacity', '0');
  await tabs(page).nth(0).click();
  await expect(h1(page)).toHaveText('Alpha');
  await page.locator('.scroll').evaluate((el) => { el.scrollTop = 600; });
  await expect(page.locator('.tab-haze')).toHaveCSS('opacity', '1');
  await page.locator('.scroll').evaluate((el) => { el.scrollTop = 0; });
  await expect(page.locator('.tab-haze')).toHaveCSS('opacity', '0');
});

test('no tab chrome at all when tabs are not shown', async ({ page }) => {
  await setSettings(page, { openMode: 'replace' });
  await openViaLaunch(page, [A]);
  await expect(h1(page)).toHaveText('Alpha');
  await expect(page.locator('.tab-haze')).toHaveCount(0);
  expect((await rect(page, '.scroll')).top).toBe(0);
});

test('tabs on the left: a sidebar switches documents and the page moves over', async ({ page }) => {
  await openViaLaunch(page, [A, B, C]);
  await chooseSetting(page, 'Tabs & files', 'setting-tab-position', 'Left');

  await expect(page.locator('.tabbar')).toHaveCount(0);
  const sidebar = page.locator('.tab-sidebar');
  await expect(sidebar).toBeVisible();
  await expect(page.locator('.tab-sidebar [role="tab"] .label')).toHaveText(['Alpha', 'Beta', 'Gamma']);
  await expect(page.locator('.tab-sidebar [role="tab"] .tab-initial')).toHaveText(['A', 'B', 'G']);
  await expect.poll(async () => (await rect(page, '.tab-sidebar')).width).toBe(200);
  // Below the menu button, which keeps its place; no panel of its own.
  expect(await rect(page, '.tab-sidebar')).toMatchObject({ top: 60, left: 0 });
  expect((await rect(page, '.hamburger')).bottom).toBeLessThan(60);
  expect(await rect(page, '.scroll')).toMatchObject({ top: 0, left: 200 });
  await expect(sidebar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

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

  // Hover opens it over the page without moving the page, on a soft
  // background of its own while it covers the page.
  await page.mouse.move(26, 120);
  await expect.poll(async () => (await rect(page, '.tab-sidebar')).width).toBe(200);
  expect((await rect(page, '.scroll')).left).toBe(52);
  await expect(sidebar).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
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

test('reader mode hides the sidebar and gives the page the whole window', async ({ page }) => {
  await setSettings(page, { tabPosition: 'left' });
  await openViaLaunch(page, [A, B]);
  await expect(page.locator('.tab-sidebar')).toBeVisible();
  await page.locator('.reader-mode-toggle').click();
  await expect(page.locator('.tab-sidebar')).toBeHidden();
  expect(await rect(page, '.scroll')).toMatchObject({ top: 0, left: 0 });
});

// The coordinator's 0.7.0 bug: in edit mode the formatting toolbar sat under
// the tab bar. Nothing in edit mode may sit under the tabs, the sidebar or
// the menu button — before or after scrolling (the toolbar is sticky).
for (const position of ['top', 'left'] as const) {
  test(`edit mode toolbar is fully visible below the tabs (${position})`, async ({ page }) => {
    await setSettings(page, { tabPosition: position });
    await openViaLaunch(page, [A, B]);
    await tabs(page).nth(0).click();
    await expect(h1(page)).toHaveText('Alpha');
    await page.locator('.edit-mode-toggle').click();
    const toolbar = page.locator('.editor-toolbar');
    await expect(toolbar).toBeVisible();
    // While the page fades in after the tab switch it is briefly a layer of
    // its own, under the window-drag strip; measure once it has settled.
    await expect.poll(() => page.locator('.content').evaluate((el) => el.getAnimations().length)).toBe(0);

    for (const scrolled of [false, true]) {
      if (scrolled) {
        await page.locator('.scroll').evaluate((el) => { el.scrollTop = 1500; });
        await page.waitForTimeout(100);
      }
      const bar = await rect(page, '.editor-toolbar');
      const chrome = position === 'top' ? ['.tabbar', '.menu-root'] : ['.tab-sidebar', '.menu-root'];
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
      expect(m.visibleTop, `page has the whole height ${at}`).toBe(0);
      expect(Math.abs(m.cloneHeight - m.articleHeightScaled), `clone height ${at}`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.pClone - m.pArticle), `line position ${at}`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.boxTop - m.wantTop), `box top ${at}`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.boxBottom - m.wantBottom), `box bottom ${at}`).toBeLessThanOrEqual(1);
    }
  });
}

// The reading column keeps clear of everything floating on the left — the
// round buttons, the re.marks pill and the zoom control — and of the tab
// sidebar, whichever state it is in, and still stops short of the minimap.
const LEFT_CHROME = ['.edit-mode-toggle', '.toc-button', '.reader-mode-toggle', '.notes-pill-wrap', '.zoom-rail'];
const STATES = ['top', 'left-expanded', 'left-collapsed', 'left-hover-expanded'] as const;

async function textColumn(page: Page) {
  return page.locator('.viewer').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) };
  });
}

async function enterState(page: Page, state: (typeof STATES)[number]) {
  await setSettings(page, {
    tabPosition: state === 'top' ? 'top' : 'left',
    tabSidebarPinned: state === 'left-expanded',
  });
  if (state === 'left-hover-expanded') {
    await page.mouse.move(26, 300);
    await expect.poll(async () => (await rect(page, '.tab-sidebar')).width).toBe(200);
  } else {
    await page.mouse.move(700, 300);
    if (state !== 'top') {
      const w = state === 'left-expanded' ? 200 : 52;
      await expect.poll(async () => (await rect(page, '.tab-sidebar')).width).toBe(w);
    }
  }
}

for (const width of [1100, 1440]) {
  for (const state of STATES) {
    test(`the reading column clears the left-hand controls (${state}, ${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await openViaLaunch(page, [B, A]);
      await expect(h1(page)).toHaveText('Alpha');
      await enterState(page, state);
      const text = await textColumn(page);
      const boxes: Array<{ sel: string; left: number; right: number; top: number; bottom: number }> = [];
      for (const sel of LEFT_CHROME) boxes.push({ sel, ...(await rect(page, sel)) });
      if (state !== 'top') boxes.push({ sel: '.tab-sidebar', ...(await rect(page, '.tab-sidebar')) });
      for (const b of boxes) {
        expect(b.right, `${b.sel} reaches into the text (${b.right} > ${text.left})`).toBeLessThanOrEqual(text.left);
      }
      // ...and none of them sit on top of each other (the sidebar is meant
      // to open over the buttons when hovered, so it is left out here).
      const chrome = boxes.filter((b) => b.sel !== '.tab-sidebar');
      for (let i = 0; i < chrome.length; i++) {
        for (let j = i + 1; j < chrome.length; j++) {
          const a = chrome[i];
          const c = chrome[j];
          const overlap = a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top;
          expect(overlap, `${a.sel} overlaps ${c.sel}`).toBe(false);
        }
      }
      // Pinned or collapsed (not the hover overlay), the buttons sit right of the sidebar.
      if (state === 'left-expanded' || state === 'left-collapsed') {
        const side = await rect(page, '.tab-sidebar');
        for (const b of chrome) expect(b.left, `${b.sel} under the sidebar`).toBeGreaterThanOrEqual(side.right);
      }
      // The text never runs under the minimap.
      expect(text.right).toBeLessThanOrEqual((await rect(page, '.minimap')).left);
    });
  }
}

test('the contents list opens clear of the round buttons and the sidebar', async ({ page }) => {
  await setSettings(page, { tabPosition: 'left' });
  await openViaLaunch(page, [B, A]);
  await expect(h1(page)).toHaveText('Alpha');
  await page.mouse.move(700, 300);
  await page.locator('.toc-button').click();
  const pop = await rect(page, '.toc-popover');
  const side = await rect(page, '.tab-sidebar');
  expect(pop.left).toBeGreaterThanOrEqual(side.right);
  for (const sel of ['.edit-mode-toggle', '.toc-button', '.reader-mode-toggle']) {
    expect(pop.left, `${sel} under the contents list`).toBeGreaterThanOrEqual((await rect(page, sel)).right);
  }
});

for (const state of ['top', 'left-expanded', 'left-collapsed'] as const) {
  test(`margin notes still fit between the text and the minimap at 1440px (${state})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setSettings(page, { marginaliaEnabled: true });
    await openViaLaunch(page, [B, A]);
    await expect(h1(page)).toHaveText('Alpha');
    await enterState(page, state);
    const text = await textColumn(page);
    const notes = await rect(page, '.marginalia');
    const minimap = await rect(page, '.minimap');
    expect(notes.left).toBeGreaterThanOrEqual(text.right);
    expect(notes.right).toBeLessThanOrEqual(minimap.left);
  });
}
